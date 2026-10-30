import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { RecentDocumentItem } from '../../types';
import {
  Highlighter,
  History,
  FolderOpen,
  FileText,
  FilePlus,
  Cloud,
  Clock,
  ArrowRight,
  Folder,
  BookOpen,
  Download,
} from 'lucide-react';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { SAMPLE_LEGISLATION_DOC } from '../sampleDocs';

export interface HomeScreenProps {
  isOverlay?: boolean;
  onCloseOverlay?: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ isOverlay = false, onCloseOverlay }) => {
  const {
    document: currentDoc,
    openTab,
    setIsOneDriveModalOpen,
    createNewDocument,
    recentDocuments,
    loadRecentDocuments,
    openRecentDocument,
    setIsRecentModalOpen,
    setIsInstallModalOpen,
    loadCachedDocument,
  } = useAppStore(
    useShallow((state) => ({
      document: state.document,
      openTab: state.openTab,
      setIsOneDriveModalOpen: state.setIsOneDriveModalOpen,
      createNewDocument: state.createNewDocument,
      recentDocuments: state.recentDocuments,
      loadRecentDocuments: state.loadRecentDocuments,
      openRecentDocument: state.openRecentDocument,
      setIsRecentModalOpen: state.setIsRecentModalOpen,
      setIsInstallModalOpen: state.setIsInstallModalOpen,
      loadCachedDocument: state.loadCachedDocument,
    }))
  );

  const { isStandalone } = usePwaInstall();

  const [mostRecentTitle, setMostRecentTitle] = useState<string>('Amostra da Legislação');

  useEffect(() => {
    loadRecentDocuments();
  }, [loadRecentDocuments]);

  useEffect(() => {
    if (currentDoc?.title) {
      setMostRecentTitle(currentDoc.title);
    } else if (recentDocuments.length > 0) {
      setMostRecentTitle(recentDocuments[0].title);
    } else {
      setMostRecentTitle('Amostra - Vade Mecum');
    }
  }, [currentDoc?.title, recentDocuments]);

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

  const handleContinueLast = async () => {
    await loadCachedDocument();
    handleFinishAction();
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

        openTab(
          {
            title: file.name,
            content: text,
            oneDriveItemId: null,
            lastSavedAt: new Date().toLocaleTimeString(),
            isDirty: false,
          },
          handle
        );
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
              if (rawText) {
                openTab(
                  {
                    title: file.name,
                    content: rawText,
                    oneDriveItemId: null,
                    lastSavedAt: new Date().toLocaleTimeString(),
                    isDirty: false,
                  },
                  null
                );
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

  const handleOpenRecentItem = async (item: RecentDocumentItem) => {
    await openRecentDocument(item);
    handleFinishAction();
  };

  const previewRecents = recentDocuments.slice(0, 3);

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4 w-full mb-4 sm:mb-5">
        {/* Card 1: Continuar Último / Amostra */}
        <button
          type="button"
          onClick={handleContinueLast}
          className="group relative flex flex-col items-center justify-between p-4 lg:p-5 bg-slate-50/80 dark:bg-slate-800/60 hover:bg-blue-50/80 dark:hover:bg-slate-800 border-2 border-slate-200/90 dark:border-slate-700/80 hover:border-blue-500 dark:hover:border-blue-500 rounded-2xl transition-all duration-200 text-center shadow-sm hover:shadow-md cursor-pointer hover:-translate-y-0.5"
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-2.5 sm:mb-3 group-hover:scale-110 transition-transform">
            <History className="w-6 h-6" />
          </div>

          <div className="space-y-1 mb-2.5 sm:mb-3">
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              Continuar Último
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
              Retomar o documento salvo no cache ou histórico
            </p>
          </div>

          <div className="w-full pt-2.5 sm:pt-3 border-t border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
            <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="truncate max-w-[140px]">{mostRecentTitle}</span>
          </div>
        </button>

        {/* Card 2: Abrir Arquivo */}
        <button
          type="button"
          onClick={handleOpenFileClick}
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
              Carregar um arquivo .md do seu dispositivo
            </p>
          </div>

          <div className="w-full pt-2.5 sm:pt-3 border-t border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            Escolher Arquivo...
          </div>
        </button>

        {/* Card 3: OneDrive */}
        <button
          type="button"
          onClick={handleOpenOneDrive}
          className="group relative flex flex-col items-center justify-between p-4 lg:p-5 bg-slate-50/80 dark:bg-slate-800/60 hover:bg-sky-50/80 dark:hover:bg-slate-800 border-2 border-slate-200/90 dark:border-slate-700/80 hover:border-sky-500 dark:hover:border-sky-500 rounded-2xl transition-all duration-200 text-center shadow-sm hover:shadow-md cursor-pointer hover:-translate-y-0.5"
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400 flex items-center justify-center mb-2.5 sm:mb-3 group-hover:scale-110 transition-transform">
            <Cloud className="w-6 h-6" />
          </div>

          <div className="space-y-1 mb-2.5 sm:mb-3">
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
              OneDrive
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
              Acessar ou salvar na nuvem da Microsoft
            </p>
          </div>

          <div className="w-full pt-2.5 sm:pt-3 border-t border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center text-xs font-semibold text-sky-600 dark:text-sky-400">
            Abrir da Nuvem...
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

      {/* Recents Section */}
      {recentDocuments.length > 0 ? (
        <div className="w-full pt-3.5 sm:pt-4 border-t border-slate-200 dark:border-slate-800 text-left">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Arquivos Recentes em Cache ({recentDocuments.length}/30)
            </span>
            <button
              type="button"
              onClick={() => {
                handleFinishAction();
                setIsRecentModalOpen(true);
              }}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
            >
              Ver todos os {recentDocuments.length} arquivos
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
            {previewRecents.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleOpenRecentItem(item)}
                className="flex items-center gap-3 p-2.5 sm:p-3 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-slate-800 text-left transition-all group cursor-pointer shadow-xs hover:shadow-sm"
              >
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    item.isOneDrive
                      ? 'bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400'
                      : item.sourceType === 'local_file'
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                      : 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {item.isOneDrive ? (
                    <Cloud className="w-4 h-4" />
                  ) : item.sourceType === 'local_file' ? (
                    <Folder className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                    {item.title}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>{new Date(item.lastOpenedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {item.isOneDrive ? (
                      <span className="text-sky-500 font-semibold">• OneDrive</span>
                    ) : item.sourceType === 'local_file' ? (
                      <span className="text-emerald-500 font-semibold">• Local</span>
                    ) : (
                      <span className="text-amber-500 font-semibold">• Rascunho</span>
                    )}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="w-full pt-3.5 border-t border-slate-200/60 dark:border-slate-800/60 flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-slate-500">
          <BookOpen className="w-4 h-4" />
          <span>Nenhum documento recente ainda. Comece abrindo um arquivo ou criando um novo!</span>
        </div>
      )}

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
