import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { saveOneDriveFile, getOneDriveItemMetadata, downloadOneDriveFile } from '../services/oneDriveService';
import { saveRecentDocument } from '../services/recentDocumentsService';

const AUTOSAVE_DEBOUNCE_DELAY_MS = 2500; // 2.5 segundos de pausa após digitação
const CLOUD_POLL_INTERVAL_MS = 10000; // Polling ativo a cada 10 segundos enquanto aberto na tela

export function useAutoSaveAndSync() {
  const {
    document: currentDoc,
    setDocument,
    setSyncStatus,
    setSyncNotification,
    setCloudConflict,
  } = useAppStore();

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const isCheckingCloudRef = useRef(false);
  const currentDocRef = useRef(currentDoc);

  // Keep ref synchronized to avoid stale closures in intervals
  useEffect(() => {
    currentDocRef.current = currentDoc;
  }, [currentDoc]);

  // 1. Protection against accidental page close or reload when dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (currentDoc.isDirty) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentDoc.isDirty]);

  // 2. Intelligent AutoSave for OneDrive with debounce
  useEffect(() => {
    if (!currentDoc.oneDriveItemId || !currentDoc.isDirty || !navigator.onLine) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;

      try {
        setSyncStatus('saving');
        const updatedItem = await saveOneDriveFile(currentDoc.oneDriveItemId!, currentDoc.content);

        const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        setDocument({
          isDirty: false,
          lastSavedAt: nowFormatted,
          cloudLastModified: updatedItem.lastModifiedDateTime,
        });

        // Also update local cache with the newest state
        await saveRecentDocument({
          ...currentDoc,
          isDirty: false,
          lastSavedAt: nowFormatted,
          cloudLastModified: updatedItem.lastModifiedDateTime,
        });

        setSyncStatus('saved');
      } catch (err) {
        console.warn('Falha no salvamento automático para o OneDrive (tentará novamente mais tarde):', err);
        setSyncStatus(navigator.onLine ? 'error' : 'offline-pending');
      } finally {
        isSavingRef.current = false;
      }
    }, AUTOSAVE_DEBOUNCE_DELAY_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [currentDoc.content, currentDoc.isDirty, currentDoc.oneDriveItemId, setDocument, setSyncStatus]);

  // 3. Active Background Polling & Window Focus / Visibility Freshness Check
  useEffect(() => {
    const checkCloudFreshness = async () => {
      const doc = currentDocRef.current;
      if (!doc.oneDriveItemId || !navigator.onLine || isSavingRef.current) return;

      if (isCheckingCloudRef.current) return;
      isCheckingCloudRef.current = true;

      try {
        const metadata = await getOneDriveItemMetadata(doc.oneDriveItemId);
        const cloudModified = metadata.lastModifiedDateTime;

        if (!cloudModified) return;

        // Ancoragem inicial: se ainda não tiver o timestamp da nuvem, ancora agora!
        if (!doc.cloudLastModified) {
          setDocument({ cloudLastModified: cloudModified });
          return;
        }

        const cloudTime = new Date(cloudModified).getTime();
        const localCloudTime = new Date(doc.cloudLastModified).getTime();

        // Se a nuvem tem uma versão com data mais recente (diferença mínima de 1s para evitar jitter de relógio)
        if (cloudTime > localCloudTime + 1000) {
          if (!doc.isDirty) {
            // Sincronização automática suave: baixa e atualiza na tela
            setSyncStatus('saving');
            const freshContent = await downloadOneDriveFile(doc.oneDriveItemId);

            const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            setDocument({
              content: freshContent,
              cloudLastModified: cloudModified,
              lastSavedAt: nowFormatted,
              isDirty: false,
            });

            await saveRecentDocument({
              ...doc,
              content: freshContent,
              cloudLastModified: cloudModified,
              lastSavedAt: nowFormatted,
              isDirty: false,
            });

            setSyncStatus('saved');
            setSyncNotification(`Documento atualizado com a versão mais recente da nuvem (${nowFormatted})`);
          } else {
            // Conflito: usuário tem edições locais não salvas E a nuvem mudou
            const freshContent = await downloadOneDriveFile(doc.oneDriveItemId);
            setCloudConflict({
              cloudModified,
              cloudContent: freshContent,
            });
          }
        }
      } catch (err) {
        // Silenciosamente ignora erros transitórios de rede em segundo plano
      } finally {
        isCheckingCloudRef.current = false;
      }
    };

    // A: Executa a primeira checagem após 2 segundos de montar o documento
    const initialTimer = setTimeout(() => {
      checkCloudFreshness();
    }, 2000);

    // B: Polling ativo periódico a cada 10 segundos enquanto o documento estiver aberto
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkCloudFreshness();
      }
    }, CLOUD_POLL_INTERVAL_MS);

    // C: Checagem imediata ao alternar para a aba ou desbloquear dispositivo
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        checkCloudFreshness();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [currentDoc.oneDriveItemId, setDocument, setSyncStatus, setSyncNotification, setCloudConflict]);
}
