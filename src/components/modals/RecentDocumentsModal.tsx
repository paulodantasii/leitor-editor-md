import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { RecentDocumentItem } from '../../types';
import { UnsavedChangesModal } from './UnsavedChangesModal';
import {
  History,
  X,
  Search,
  Cloud,
  FileText,
  Trash2,
  Clock,
  ArrowRight,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

export const RecentDocumentsModal: React.FC = () => {
  const {
    isRecentModalOpen,
    setIsRecentModalOpen,
    recentDocuments,
    loadRecentDocuments,
    openRecentDocument,
    deleteRecentDocument,
    document: currentDoc,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [pendingItemToOpen, setPendingItemToOpen] = useState<RecentDocumentItem | null>(null);
  const [isUnsavedGuardOpen, setIsUnsavedGuardOpen] = useState(false);

  // Load recent documents whenever modal opens
  useEffect(() => {
    if (isRecentModalOpen) {
      loadRecentDocuments();
      setSearchQuery('');
      setNotification(null);
    }
  }, [isRecentModalOpen, loadRecentDocuments]);

  if (!isRecentModalOpen) return null;

  const filteredDocs = recentDocuments.filter((doc) =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  const doOpenItem = async (item: RecentDocumentItem) => {
    setIsLoading(true);
    setNotification(null);
    try {
      const result = await openRecentDocument(item);
      if (result.success) {
        if (result.updatedFromCloud) {
          showNotification('Versão mais recente carregada do OneDrive!');
        } else if (result.warning) {
          showNotification(result.warning);
        }
        setTimeout(() => {
          setIsRecentModalOpen(false);
        }, 300);
      } else {
        setNotification(result.warning || 'Erro ao carregar documento.');
      }
    } catch {
      setNotification('Erro inesperado ao carregar documento.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleItemClick = (item: RecentDocumentItem) => {
    if (currentDoc.isDirty) {
      setPendingItemToOpen(item);
      setIsUnsavedGuardOpen(true);
    } else {
      doOpenItem(item);
    }
  };

  const handleConfirmDiscardFromGuard = () => {
    const item = pendingItemToOpen;
    setPendingItemToOpen(null);
    setIsUnsavedGuardOpen(false);
    if (item) {
      doOpenItem(item);
    }
  };

  const handleConfirmSaveFromGuard = async () => {
    // Current document is saved automatically via store or cloud
    setPendingItemToOpen(null);
    setIsUnsavedGuardOpen(false);
    const item = pendingItemToOpen;
    if (item) {
      doOpenItem(item);
    }
  };

  const handleDeleteItem = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteRecentDocument(id);
  };

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();

    if (isToday) {
      return `Hoje às ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return `${date.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} às ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  Documentos Recentes
                </h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  {recentDocuments.length}/30
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Histórico persistente em cache com atualização inteligente da nuvem
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsRecentModalOpen(false)}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar nos arquivos recentes..."
              className="w-full h-9 pl-9 pr-4 text-xs rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>

        {/* Notification Toast */}
        {notification && (
          <div className="px-5 py-2.5 bg-blue-50 dark:bg-blue-950/50 border-b border-blue-200 dark:border-blue-900/50 flex items-center gap-2 text-xs font-medium text-blue-700 dark:text-blue-300">
            <AlertCircle className="w-4 h-4 shrink-0 text-blue-500" />
            <span className="flex-1">{notification}</span>
          </div>
        )}

        {/* Documents List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-[220px]">
          {filteredDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-3">
                <FileText className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {searchQuery ? 'Nenhum documento encontrado' : 'Nenhum documento no histórico'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                {searchQuery
                  ? 'Tente buscar com outro termo.'
                  : 'Os últimos 30 arquivos abertos ou editados serão guardados automaticamente aqui.'}
              </p>
            </div>
          ) : (
            filteredDocs.map((item) => {
              const isCurrent = currentDoc.title === item.title;

              return (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className={`group relative flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60'
                      : 'bg-white dark:bg-slate-800/60 border-slate-100 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 pr-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        item.isOneDrive
                          ? 'bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400'
                          : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {item.isOneDrive ? <Cloud className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate max-w-[320px]">
                          {item.title}
                        </span>
                        {item.isOneDrive && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 shrink-0">
                            OneDrive
                          </span>
                        )}
                        {isCurrent && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 shrink-0">
                            Aberto Agora
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTimestamp(item.lastOpenedAt)}
                        </span>
                        <span>•</span>
                        <span>{item.content ? `${Math.round(item.content.length / 1024)} KB` : 'Vazio'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => handleDeleteItem(e, item.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                      title="Remover do histórico"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all">
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>
            {filteredDocs.length} {filteredDocs.length === 1 ? 'documento listado' : 'documentos listados'}
          </span>
          <button
            onClick={() => setIsRecentModalOpen(false)}
            className="px-4 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* Unsaved Guard when switching documents from recent history */}
      <UnsavedChangesModal
        isOpen={isUnsavedGuardOpen}
        onClose={() => {
          setIsUnsavedGuardOpen(false);
          setPendingItemToOpen(null);
        }}
        onConfirmDiscard={handleConfirmDiscardFromGuard}
        onConfirmSaveAndProceed={handleConfirmSaveFromGuard}
        documentTitle={currentDoc.title}
        actionType="open_recent"
      />
    </div>
  );
};
