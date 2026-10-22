import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { getOneDriveItemMetadata, downloadOneDriveFile } from '../services/oneDriveService';
import { saveRecentDocument } from '../services/recentDocumentsService';
import { saveCoordinator } from '../services/saveCoordinator';

const AUTOSAVE_IDLE_DELAY_MS = 3000; // 3 segundos de pausa após digitação
const AUTOSAVE_MAX_WAIT_MS = 30000; // 30 segundos de max-wait durante digitação contínua
const CLOUD_POLL_INTERVAL_MS = 10000; // Polling ativo a cada 10 segundos enquanto aberto na tela
const RETRY_BACKOFF_DELAYS = [5000, 15000, 60000]; // 5s -> 15s -> 60s

export function useAutoSaveAndSync() {
  const {
    document: currentDoc,
    setDocument,
    setSyncStatus,
    setSyncNotification,
    setCloudConflict,
    fileHandle,
  } = useAppStore(
    useShallow((state) => ({
      document: state.document,
      setDocument: state.setDocument,
      setSyncStatus: state.setSyncStatus,
      setSyncNotification: state.setSyncNotification,
      setCloudConflict: state.setCloudConflict,
      fileHandle: state.fileHandle,
    }))
  );

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const maxWaitTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryAttemptRef = useRef<number>(0);
  const isCheckingCloudRef = useRef(false);
  const currentDocRef = useRef(currentDoc);
  const isDirtySinceRef = useRef<number | null>(null);

  // Mantém refs sincronizadas para evitar closures antigas
  useEffect(() => {
    currentDocRef.current = currentDoc;
  }, [currentDoc]);

  // 1. Proteção contra fechamento acidental da página quando houver edições não salvas em qualquer aba aberta
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const state = useAppStore.getState();
      const hasAnyDirty = state.tabs.some((t) => t.isDirty) || Boolean(state.document?.isDirty);
      if (hasAnyDirty) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // 2. Política Inteligente de Autosave (OneDrive e Arquivo Local com Handle)
  useEffect(() => {
    if (!currentDoc) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current);
        maxWaitTimerRef.current = null;
      }
      isDirtySinceRef.current = null;
      return;
    }

    const hasWritableSource = Boolean(currentDoc.oneDriveItemId || fileHandle || currentDoc.fileHandle);

    // Se não tiver alterações ou não tiver fonte gravável, limpa timers
    if (!currentDoc.isDirty || !hasWritableSource) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current);
        maxWaitTimerRef.current = null;
      }
      isDirtySinceRef.current = null;
      return;
    }

    if (!isDirtySinceRef.current) {
      isDirtySinceRef.current = Date.now();
    }

    const triggerSave = async () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current);
        maxWaitTimerRef.current = null;
      }
      isDirtySinceRef.current = null;

      const result = await saveCoordinator.save({ interactive: false });
      if (result.status === 'ok') {
        retryAttemptRef.current = 0;
      } else if (result.status === 'error' || result.status === 'offline') {
        // Agendar retentativa com backoff
        const attempt = retryAttemptRef.current;
        const delay = RETRY_BACKOFF_DELAYS[Math.min(attempt, RETRY_BACKOFF_DELAYS.length - 1)];
        retryAttemptRef.current = attempt + 1;

        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          if (currentDocRef.current?.isDirty) {
            triggerSave();
          }
        }, delay);
      }
    };

    // A. Idle Debounce de 3s
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      triggerSave();
    }, AUTOSAVE_IDLE_DELAY_MS);

    // B. Max-Wait de 30s (garante salvamento mesmo se o usuário digitar sem parar)
    if (!maxWaitTimerRef.current) {
      maxWaitTimerRef.current = setTimeout(() => {
        triggerSave();
      }, AUTOSAVE_MAX_WAIT_MS);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [currentDoc?.content, currentDoc?.isDirty, currentDoc?.oneDriveItemId, fileHandle, currentDoc?.fileHandle]);

  // 3. Gatilhos Imediatos: Perda de Foco, Aba Oculta, Voltar Online
  useEffect(() => {
    const handleImmediateSaveIfDirty = () => {
      const doc = currentDocRef.current;
      if (!doc) return;
      const state = useAppStore.getState();
      const hasSource = Boolean(doc.oneDriveItemId || state.fileHandle || doc.fileHandle);

      if (doc.isDirty && hasSource) {
        saveCoordinator.save({ interactive: false });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleImmediateSaveIfDirty();
      }
    };

    const handlePageHide = () => {
      handleImmediateSaveIfDirty();
    };

    const handleBlur = () => {
      handleImmediateSaveIfDirty();
    };

    const handleOnline = () => {
      // Reconectou: tenta enviar imediatamente qualquer alteração pendente
      retryAttemptRef.current = 0;
      handleImmediateSaveIfDirty();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('online', handleOnline);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  // 4. Polling Ativo do OneDrive com eTag (Detecção Precisa de Conflitos)
  useEffect(() => {
    const checkCloudFreshness = async () => {
      const doc = currentDocRef.current;
      if (!doc || !doc.oneDriveItemId || !navigator.onLine || saveCoordinator.isSaving()) return;

      if (isCheckingCloudRef.current) return;
      isCheckingCloudRef.current = true;

      try {
        const metadata = await getOneDriveItemMetadata(doc.oneDriveItemId);
        const cloudModified = metadata.lastModifiedDateTime;
        const cloudETag = metadata.eTag;

        if (!cloudModified) return;

        // Ancoragem inicial se ainda não tiver eTag ou timestamp
        if (!doc.cloudETag && !doc.cloudLastModified) {
          setDocument({
            cloudLastModified: cloudModified,
            cloudETag: cloudETag || null,
          });
          return;
        }

        // Compara por eTag (exato); se não houver eTag, compara horário com margem de 1s
        const isDifferent = doc.cloudETag
          ? cloudETag && cloudETag !== doc.cloudETag
          : new Date(cloudModified).getTime() > new Date(doc.cloudLastModified || 0).getTime() + 1000;

        if (isDifferent) {
          if (!doc.isDirty) {
            // Sincronização suave e automática: baixa e atualiza na tela
            setSyncStatus('saving');
            const freshContent = await downloadOneDriveFile(doc.oneDriveItemId);

            const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            setDocument({
              content: freshContent,
              cloudLastModified: cloudModified,
              cloudETag: cloudETag || null,
              lastSavedAt: nowFormatted,
              isDirty: false,
              sourceRevision: doc.revision,
            });

            await saveRecentDocument({
              ...doc,
              content: freshContent,
              cloudLastModified: cloudModified,
              cloudETag: cloudETag || null,
              lastSavedAt: nowFormatted,
              isDirty: false,
              sourceRevision: doc.revision,
            });

            setSyncStatus('saved');
            setSyncNotification(`Documento atualizado com a versão mais recente da nuvem (${nowFormatted})`);
          } else {
            // Conflito real: usuário tem edições locais não salvas E a nuvem mudou
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

    // A: Primeira checagem 2s após montar
    const initialTimer = setTimeout(() => {
      checkCloudFreshness();
    }, 2000);

    // B: Polling ativo periódico a cada 10s enquanto visível
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkCloudFreshness();
      }
    }, CLOUD_POLL_INTERVAL_MS);

    // C: Checagem imediata ao focar na janela / desbloquear tela
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
  }, [currentDoc?.oneDriveItemId, setDocument, setSyncStatus, setSyncNotification, setCloudConflict]);
}
