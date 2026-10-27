import React, { useEffect } from 'react';
import { Header } from './components/layout/Header';
import { TiptapEditor } from './components/editor/TiptapEditor';
import { OneDriveModal } from './components/modals/OneDriveModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { RecentDocumentsModal } from './components/modals/RecentDocumentsModal';
import { CloudConflictModal } from './components/modals/CloudConflictModal';
import { InstallAppModal } from './components/modals/InstallAppModal';
import { SyncNotificationToast } from './components/layout/SyncNotificationToast';
import { useAppStore } from './store/useAppStore';

import { ReadingProgress } from './components/layout/ReadingProgress';
import { useAutoSaveAndSync } from './hooks/useAutoSaveAndSync';
import { getActiveAccount } from './services/msalService';
import { saveActiveDocument } from './services/documentSaveService';
import { initAutoUpdateListeners } from './services/appUpdateService';

import { HomeScreen } from './components/home/HomeScreen';

export const App: React.FC = () => {
  const theme = useAppStore((state) => state.preferences.theme);
  const docTitle = useAppStore((state) => state.document?.title);
  const hasDocument = useAppStore((state) => Boolean(state.document));
  const toggleHighlightMode = useAppStore((state) => state.toggleHighlightMode);
  const setUserProfile = useAppStore((state) => state.setUserProfile);
  const setSyncNotification = useAppStore((state) => state.setSyncNotification);

  // Restore MSAL session on boot so background cloud sync is immediately active
  useEffect(() => {
    getActiveAccount()
      .then((account) => {
        if (account) {
          setUserProfile({
            name: account.name || account.username,
            email: account.username,
          });
        }
      })
      .catch((err) => {
        console.warn('Falha ao restaurar sessão MSAL no boot:', err);
      });
  }, [setUserProfile]);

  // Activates background autosave and beforeunload guard
  useAutoSaveAndSync();

  // Sync document title in browser tab
  useEffect(() => {
    const cleanTitle = docTitle ? docTitle.replace(/\.(md|markdown|txt)$/i, '').trim() : '';
    document.title = cleanTitle ? `${cleanTitle} - Leitor & Editor MD` : 'Leitor & Editor Markdown PWA';
  }, [docTitle]);

  // Global Keyboard Shortcuts (Press 'G' to toggle Highlight mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S / Cmd+S: salva o documento (bloqueia o "Salvar página" do navegador)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();

        const state = useAppStore.getState();
        const doc = state.document;
        if (!doc) return;

        const hasSource = Boolean(doc.oneDriveItemId || state.fileHandle || doc.fileHandle);
        if (!hasSource) {
          state.setIsSaveDestinationModalOpen(true);
          return;
        }

        saveActiveDocument().then((result) => {
          if (result.status === 'saved') {
            setSyncNotification(result.message || 'Salvo!');
          } else if (result.status === 'error') {
            setSyncNotification(`Erro ao salvar: ${result.message || 'tente novamente.'}`);
          }
        });
        return;
      }

      // Ignore if combined with modifier keys (Ctrl, Alt, Meta)
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key === 'g' || e.key === 'G') {
        const target = e.target as HTMLElement | null;
        // Don't trigger if user is typing inside an input, textarea, select or contenteditable area
        const isTyping =
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable ||
            Boolean(target.closest('[contenteditable="true"]')));

        if (!isTyping) {
          e.preventDefault();
          toggleHighlightMode();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleHighlightMode, setSyncNotification]);

  // Register PWA Service Worker & Zero-Stale Auto-Update Listeners
  useEffect(() => {
    return initAutoUpdateListeners();
  }, []);

  // Sync theme class on document element & meta theme-color
  useEffect(() => {
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      if (themeColorMeta) themeColorMeta.setAttribute('content', '#0f172a');
    } else {
      document.documentElement.classList.remove('dark');
      if (themeColorMeta) themeColorMeta.setAttribute('content', '#ffffff');
    }
  }, [theme]);

  return (
    <div
      className="min-h-screen flex flex-col transition-colors print:bg-transparent print:text-slate-900"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <Header />

      <main className="flex-1 flex flex-col items-center relative w-full">
        {hasDocument ? <TiptapEditor /> : <HomeScreen />}
      </main>

      <ReadingProgress />
      <OneDriveModal />
      <SettingsModal />
      <RecentDocumentsModal />
      <CloudConflictModal />
      <InstallAppModal />
      <SyncNotificationToast />
    </div>
  );
};

export default App;
