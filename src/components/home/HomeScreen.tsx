import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import {
  Highlighter,
  FolderOpen,
  FilePlus,
  Download,
} from 'lucide-react';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { OpenSourceModal } from '../modals/OpenSourceModal';
import { saveRecentDocument } from '../../services/recentDocumentsService';

export interface HomeScreenProps {
  isOverlay?: boolean;
  onCloseOverlay?: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ isOverlay = false, onCloseOverlay }) => {
  const {
    openTab,
    setIsOneDriveModalOpen,
    createNewDocument,
    setIsInstallModalOpen,
  } = useAppStore(
    useShallow((state) => ({
      openTab: state.openTab,
      setIsOneDriveModalOpen: state.setIsOneDriveModalOpen,
      createNewDocument: state.createNewDocument,
      setIsInstallModalOpen: state.setIsInstallModalOpen,
    }))
  );

  const { isStandalone } = usePwaInstall();

  const [isOpenSourceModalOpen, setIsOpenSourceModalOpen] = useState(false);

  const handleFinishAction = () => {
    try {
      sessionStorage.setItem('has_active_session', 'true');
    } catch {
      // ignore
    }
    if (isOverlay && onCloseOverlay) {
      onCloseOverlay();
    }
  };

  const handleOpenFileClick = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [
            {
              description: 'Arquivos Markdown',
              accept: { 'text/markdown': ['.md', '.markdown', '.txt'] },
            },
          ],
          multiple: false,
        });

        const file = await handle.getFile();
        const text = await file.text();
        const nowStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        openTab(
          {
            title: file.name,
            content: text,
            oneDriveItemId: null,
            lastSavedAt: nowStr,
            isDirty: false,
            localLastModified: file.lastModified,
          },
          handle
        );
        const openedDoc = useAppStore.getState().document;
        if (openedDoc) {
          void saveRecentDocument(openedDoc, 'open');
        }
        handleFinishAction();
      } else {
        // Fallback file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md,.markdown,.txt';
        input.onchange = (e: any) => {
          const file = e.target?.files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
              const rawText = event.target?.result as string;
              if (typeof rawText === 'string') {
                const nowStr = new Date().toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });
                openTab(
                  {
                    title: file.name,
                    content: rawText,
                    oneDriveItemId: null,
                    lastSavedAt: nowStr,
                    isDirty: false,
                    localLastModified: file.lastModified,
                  },
                  null
                );
                const openedDoc = useAppStore.getState().document;
                if (openedDoc) {
                  void saveRecentDocument(openedDoc, 'open');
                }
                handleFinishAction();
              }
            };
            reader.readAsText(file);
          }
        };
        input.click();
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Erro ao abrir arquivo:', err);
      }
    }
  };

  const handleStartBlankDoc = () => {
    createNewDocument();
    handleFinishAction();
  };

  const handleOpenOneDrive = () => {
    setIsOneDriveModalOpen(true);
    handleFinishAction();
  };

  const content = (
    <div className={`w-full max-w-5xl mx-auto flex flex-col items-center text-center ${
      isOverlay
        ? 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-10 my-auto animate-in zoom-in-95 duration-200'
        : 'px-4 py-1 sm:px-6 sm:py-2 my-auto animate-in fade-in duration-300'
    }`}>
      {/* App Logo & Header */}
      <div className="relative mb-2.5 group">
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 text-white flex items-center justify-center shadow-xl shadow-blue-500/25 group-hover:scale-105 transition-transform duration-300">
          <Highlighter className="w-8 h-8 sm:w-9 sm:h-9" />
        </div>
      </div>

      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight mb-1.5">
        Leitor & Editor de Markdown
      </h1>
      <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 mb-4 sm:mb-5 max-w-lg leading-relaxed">
        Ambiente moderno para leitura com grifos coloridos, edição rica e sincronização contínua com OneDrive e arquivos locais.
      </p>

      {/* Primary Action Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4 w-full max-w-2xl mb-4 sm:mb-5">
        {/* Card 2: Abrir Arquivo */}
        <button
          type="button"
          onClick={() => setIsOpenSourceModalOpen(true)}
          className="group relative flex flex-col items-center justify-between p-4 lg:p-5 bg-slate-50/80 dark:bg-slate-800/60 hover:bg-emerald-50/80 dark:hover:bg-slate-800 border-2 border-slate-200/90 dark:border-slate-700/80 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-2xl transition-all duration-200 text-center shadow-sm hover:shadow-md cursor-pointer hover:-translate-y-0.5"
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-2.5 sm:mb-3 group-hover:scale-110 transition-transform">
            <FolderOpen className="w-6 h-6" />
          </div>

          <div className="space-y-1 mb-2.5 sm:mb-3">
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
              Abrir Arquivo
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
              Carregar do dispositivo ou do OneDrive
            </p>
          </div>

          <div className="w-full pt-2.5 sm:pt-3 border-t border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            Escolher Arquivo...
          </div>
        </button>

        {/* Card 4: Novo Documento */}
        <button
          type="button"
          onClick={handleStartBlankDoc}
          className="group relative flex flex-col items-center justify-between p-4 lg:p-5 bg-slate-50/80 dark:bg-slate-800/60 hover:bg-purple-50/80 dark:hover:bg-slate-800 border-2 border-slate-200/90 dark:border-slate-700/80 hover:border-purple-500 dark:hover:border-purple-500 rounded-2xl transition-all duration-200 text-center shadow-sm hover:shadow-md cursor-pointer hover:-translate-y-0.5"
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-2.5 sm:mb-3 group-hover:scale-110 transition-transform">
            <FilePlus className="w-6 h-6" />
          </div>

          <div className="space-y-1 mb-2.5 sm:mb-3">
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
              Novo Documento
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
              Iniciar uma folha em branco limpa
            </p>
          </div>

          <div className="w-full pt-2.5 sm:pt-3 border-t border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center text-xs font-semibold text-purple-600 dark:text-purple-400">
            Criar Novo...
          </div>
        </button>
      </div>

      {/* Atalho Discreto para Instalação (PWA) */}
      {!isStandalone && (
        <div className="w-full pt-2 flex items-center justify-center">
          <button
            type="button"
            onClick={() => setIsInstallModalOpen(true)}
            className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1.5 transition-colors cursor-pointer py-1 px-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5 text-blue-500" />
            <span>Instalar como aplicativo no Windows ou iPad</span>
          </button>
        </div>
      )}

      <OpenSourceModal
        isOpen={isOpenSourceModalOpen}
        onClose={() => setIsOpenSourceModalOpen(false)}
        onOpenFromLocal={handleOpenFileClick}
        onOpenFromOneDrive={handleOpenOneDrive}
      />
    </div>
  );

  if (isOverlay) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-300 overflow-y-auto">
        {content}
      </div>
    );
  }

  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center py-2 sm:py-3 px-4">
      {content}
    </div>
  );
};
