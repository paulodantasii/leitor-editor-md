import React, { useEffect, useState } from 'react';
import { Header } from './components/layout/Header';
import { TiptapEditor } from './components/editor/TiptapEditor';
import { OneDriveModal } from './components/modals/OneDriveModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { WelcomeScreen } from './components/modals/WelcomeScreen';
import { RecentDocumentsModal } from './components/modals/RecentDocumentsModal';
import { useAppStore } from './store/useAppStore';

import { ReadingProgress } from './components/layout/ReadingProgress';
import { useAutoSaveAndSync } from './hooks/useAutoSaveAndSync';

export const App: React.FC = () => {
  const { preferences, document: currentDoc, loadCachedDocument, toggleHighlightMode } = useAppStore();

  // Activates background autosave and beforeunload guard
  useAutoSaveAndSync();

  // Sync document title in browser tab
  useEffect(() => {
    const cleanTitle = currentDoc.title ? currentDoc.title.replace(/\.(md|markdown|txt)$/i, '').trim() : '';
    document.title = cleanTitle ? `${cleanTitle} - Leitor & Editor MD` : 'Leitor & Editor Markdown PWA';
  }, [currentDoc.title]);

  // Show Welcome screen if opening browser from scratch (sessionStorage empty)
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    const hasSession = sessionStorage.getItem('has_active_session');
    return !hasSession;
  });

  // Global Keyboard Shortcuts (Press 'G' to toggle Highlight mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [toggleHighlightMode]);

  // Register PWA Service Worker
  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      const swUrl = `${import.meta.env.BASE_URL}sw.js`;
      navigator.serviceWorker
        .register(swUrl)
        .then((reg) => console.log('Service Worker registrado com sucesso:', reg.scope))
        .catch((err) => console.warn('Falha no registro do Service Worker:', err));
    }
  }, []);

  // Sync theme class on document element & meta theme-color
  useEffect(() => {
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (preferences.theme === 'dark') {
      document.documentElement.classList.add('dark');
      if (themeColorMeta) themeColorMeta.setAttribute('content', '#0f172a');
    } else {
      document.documentElement.classList.remove('dark');
      if (themeColorMeta) themeColorMeta.setAttribute('content', '#ffffff');
    }
  }, [preferences.theme]);

  const handleContinueLast = () => {
    sessionStorage.setItem('has_active_session', 'true');
    loadCachedDocument();
    setShowWelcome(false);
  };

  const handleOpenNew = () => {
    sessionStorage.setItem('has_active_session', 'true');
    setShowWelcome(false);
  };

  return (
    <div
      className="min-h-screen flex flex-col transition-colors print:bg-transparent print:text-slate-900"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <Header />

      <main className="flex-1 flex flex-col items-center relative">
        <TiptapEditor />
      </main>

      {/* Startup Choice Modal (shown when browser opens from scratch) */}
      {showWelcome && (
        <WelcomeScreen
          onContinueLast={handleContinueLast}
          onOpenNew={handleOpenNew}
        />
      )}

      <ReadingProgress />
      <OneDriveModal />
      <SettingsModal />
      <RecentDocumentsModal />
    </div>
  );
};

export default App;
