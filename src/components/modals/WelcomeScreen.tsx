import React, { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { RecentDocumentItem } from '../../types';
import { Highlighter, History, FolderOpen, FileText, FilePlus, Cloud, Clock, ArrowRight } from 'lucide-react';

interface WelcomeScreenProps {
  onContinueLast: () => void;
  onOpenNew: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onContinueLast, onOpenNew }) => {
  const {
    document: currentDoc,
    setDocument,
    setFileHandle,
    setIsOneDriveModalOpen,
    createNewDocument,
    recentDocuments,
    loadRecentDocuments,
    openRecentDocument,
    setIsRecentModalOpen,
  } = useAppStore();

  useEffect(() => {
    loadRecentDocuments();
  }, [loadRecentDocuments]);

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

        setFileHandle(handle);
        setDocument({
          title: file.name,
          content: text,
          oneDriveItemId: null,
          lastSavedAt: new Date().toLocaleTimeString(),
          isDirty: false,
        });
        onOpenNew();
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
                setFileHandle(null);
                setDocument({
                  title: file.name,
                  content: rawText,
                  oneDriveItemId: null,
                  lastSavedAt: new Date().toLocaleTimeString(),
                  isDirty: false,
                });
                onOpenNew();
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
    onOpenNew();
  };

  const handleOpenOneDrive = () => {
    setIsOneDriveModalOpen(true);
    onOpenNew();
  };

  const handleOpenRecentItem = async (item: RecentDocumentItem) => {
    await openRecentDocument(item);
    onOpenNew();
  };

  const previewRecents = recentDocuments.slice(0, 3);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-300 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-5xl w-full p-6 sm:p-10 flex flex-col items-center text-center my-auto">
        {/* App Logo */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-blue-500/30 mb-4">
          <Highlighter className="w-9 h-9" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-800 dark:text-slate-100 mb-2">
          Leitor & Editor de Markdown
        </h1>
        <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 mb-8 max-w-md">
          Como você gostaria de começar sua sessão de leitura e edição hoje?
        </p>

        {/* Option Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full mb-6">
          {/* Option 1: Continue Last Cached File */}
          <button
            onClick={onContinueLast}
            className="group relative flex flex-col items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/80 hover:bg-blue-50/80 dark:hover:bg-slate-800 border-2 border-slate-200 dark:border-slate-700/70 hover:border-blue-500 dark:hover:border-blue-500 rounded-2xl transition-all duration-200 text-center shadow-sm hover:shadow-md cursor-pointer"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <History className="w-6 h-6" />
            </div>

            <div className="space-y-1 mb-3">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                Continuar Último
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Abrir o documento salvo no cache do navegador
              </p>
            </div>

            <div className="w-full pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
              <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className="truncate max-w-[120px]">{currentDoc.title}</span>
            </div>
          </button>

          {/* Option 2: Open New File */}
          <button
            onClick={handleOpenFileClick}
            className="group relative flex flex-col items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/80 hover:bg-emerald-50/80 dark:hover:bg-slate-800 border-2 border-slate-200 dark:border-slate-700/70 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-2xl transition-all duration-200 text-center shadow-sm hover:shadow-md cursor-pointer"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <FolderOpen className="w-6 h-6" />
            </div>

            <div className="space-y-1 mb-3">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                Abrir Arquivo
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Selecionar um arquivo .md do seu dispositivo
              </p>
            </div>

            <div className="w-full pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Escolher Arquivo...
            </div>
          </button>

          {/* Option 3: OneDrive */}
          <button
            onClick={handleOpenOneDrive}
            className="group relative flex flex-col items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/80 hover:bg-sky-50/80 dark:hover:bg-slate-800 border-2 border-slate-200 dark:border-slate-700/70 hover:border-sky-500 dark:hover:border-sky-500 rounded-2xl transition-all duration-200 text-center shadow-sm hover:shadow-md cursor-pointer"
          >
            <div className="w-12 h-12 rounded-xl bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Cloud className="w-6 h-6" />
            </div>

            <div className="space-y-1 mb-3">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                OneDrive
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Acessar arquivos armazenados na nuvem do OneDrive
              </p>
            </div>

            <div className="w-full pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center text-xs font-semibold text-sky-600 dark:text-sky-400">
              Abrir da Nuvem...
            </div>
          </button>

          {/* Option 4: Start Blank File */}
          <button
            onClick={handleStartBlankDoc}
            className="group relative flex flex-col items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/80 hover:bg-purple-50/80 dark:hover:bg-slate-800 border-2 border-slate-200 dark:border-slate-700/70 hover:border-purple-500 dark:hover:border-purple-500 rounded-2xl transition-all duration-200 text-center shadow-sm hover:shadow-md cursor-pointer"
          >
            <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <FilePlus className="w-6 h-6" />
            </div>

            <div className="space-y-1 mb-3">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                Novo Documento
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Iniciar um documento em branco do zero
              </p>
            </div>

            <div className="w-full pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center text-xs font-semibold text-purple-600 dark:text-purple-400">
              Criar Novo...
            </div>
          </button>
        </div>

        {/* Section: Recent Documents in Cache (if any exist) */}
        {recentDocuments.length > 0 && (
          <div className="w-full pt-5 border-t border-slate-200/70 dark:border-slate-800/80 text-left">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Arquivos Recentes em Cache ({recentDocuments.length}/30)
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onOpenNew();
                  setIsRecentModalOpen(true);
                }}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                Ver todos os {recentDocuments.length} arquivos
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full">
              {previewRecents.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleOpenRecentItem(item)}
                  className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-slate-800 text-left transition-all group cursor-pointer"
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      item.isOneDrive
                        ? 'bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400'
                        : 'bg-slate-200/70 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {item.isOneDrive ? <Cloud className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(item.lastOpenedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {item.isOneDrive && <span className="text-sky-500 font-semibold">• OneDrive</span>}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
