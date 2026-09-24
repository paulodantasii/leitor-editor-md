import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { saveOneDriveFile, getOneDriveItemMetadata, downloadOneDriveFile } from '../services/oneDriveService';
import { saveRecentDocument } from '../services/recentDocumentsService';

const AUTOSAVE_DEBOUNCE_DELAY_MS = 2500; // 2.5 seconds of inactivity after typing

export function useAutoSaveAndSync() {
  const {
    document: currentDoc,
    setDocument,
    syncStatus,
    setSyncStatus,
    userProfile,
  } = useAppStore();

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const lastCheckedCloudRef = useRef(0);

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
    // Only auto-save to OneDrive if document is associated with OneDrive and is dirty
    if (!currentDoc.oneDriveItemId || !currentDoc.isDirty || !userProfile) {
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
  }, [currentDoc.content, currentDoc.isDirty, currentDoc.oneDriveItemId, userProfile, setDocument, setSyncStatus]);

  // 3. Cloud Freshness Check (When user returns to tab / unlocks iPad)
  useEffect(() => {
    const checkCloudFreshness = async () => {
      // Avoid excessive checks: throttle to at most once every 15 seconds
      const now = Date.now();
      if (now - lastCheckedCloudRef.current < 15000) return;
      lastCheckedCloudRef.current = now;

      if (!currentDoc.oneDriveItemId || !userProfile || !navigator.onLine) return;

      try {
        const metadata = await getOneDriveItemMetadata(currentDoc.oneDriveItemId);
        const cloudModified = metadata.lastModifiedDateTime;

        if (currentDoc.cloudLastModified && cloudModified && cloudModified > currentDoc.cloudLastModified) {
          // A newer version exists on OneDrive!
          if (!currentDoc.isDirty) {
            // Safe auto-refresh: User hasn't modified local document, pull latest cloud version seamlessly
            setSyncStatus('saving');
            const freshContent = await downloadOneDriveFile(currentDoc.oneDriveItemId);

            setDocument({
              content: freshContent,
              cloudLastModified: cloudModified,
              lastSavedAt: new Date().toLocaleTimeString(),
              isDirty: false,
            });

            setSyncStatus('saved');
          } else {
            // Both local and cloud were modified: warn user about conflict
            console.warn('Conflito detectado: versão mais recente existe no OneDrive enquanto há alterações locais pendentes.');
          }
        }
      } catch (err) {
        // Silently ignore background polling errors
      }
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        checkCloudFreshness();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [currentDoc.oneDriveItemId, currentDoc.cloudLastModified, currentDoc.isDirty, userProfile, setDocument, setSyncStatus]);
}
