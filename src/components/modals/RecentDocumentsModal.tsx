import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import {
  RecentDocumentItem,
  DocumentVersionSnapshot,
  VersionSnapshotReason,
} from '../../types';
import {
  getDocumentVersions,
  deleteDocumentVersion,
  MAX_RECENT_DOCUMENTS,
  MAX_VERSIONS_PER_DOCUMENT,
} from '../../services/recentDocumentsService';
import { downloadMarkdownFile } from '../../services/exportService';
import { MiddleEllipsisText } from '@/components/ui/MiddleEllipsisText';
import {
  History,
  X,
  Search,
  Cloud,
  FileText,
  Trash2,
  Clock,
  ArrowRight,
  ArrowLeft,
  Folder,
  Download,
  CopyPlus,
  Eye,
  EyeOff,
  ShieldCheck,
} from 'lucide-react';

const REASON_LABELS: Record<VersionSnapshotReason, { label: string; className: string }> = {
  open: {
    label: 'Ao abrir',
    className: 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300',
  },
  sync: {
    label: 'Sincronização',
    className: 'bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300',
  },
  conflict: {
    label: 'Conflito',
    className: 'bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300',
  },
  edit: {
    label: 'Edição',
    className: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  },
};

export const RecentDocumentsModal: React.FC = () => {
  const {
    isRecentModalOpen,
    setIsRecentModalOpen,
    recentDocuments,
    loadRecentDocuments,
    deleteRecentDocument,
    openTab,
    setSyncNotification,
    document: currentDoc,
  } = useAppStore(
    useShallow((state) => ({
      isRecentModalOpen: state.isRecentModalOpen,
      setIsRecentModalOpen: state.setIsRecentModalOpen,
      recentDocuments: state.recentDocuments,
      loadRecentDocuments: state.loadRecentDocuments,
      deleteRecentDocument: state.deleteRecentDocument,
      openTab: state.openTab,
      setSyncNotification: state.setSyncNotification,
      document: state.document,
    }))
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<RecentDocumentItem | null>(null);
  const [versions, setVersions] = useState<DocumentVersionSnapshot[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [expandedPreviewId, setExpandedPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (isRecentModalOpen) {
      void loadRecentDocuments();
      setSearchQuery('');
      setSelectedDoc(null);
      setVersions([]);
      setExpandedPreviewId(null);
    }
  }, [isRecentModalOpen, loadRecentDocuments]);

  useEffect(() => {
    if (!isRecentModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (selectedDoc) {
          setSelectedDoc(null);
          setVersions([]);
          setExpandedPreviewId(null);
        } else {
          setIsRecentModalOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecentModalOpen, selectedDoc, setIsRecentModalOpen]);

  const handleSelectDoc = useCallback(async (item: RecentDocumentItem) => {
    setSelectedDoc(item);
    setIsLoadingVersions(true);
    setExpandedPreviewId(null);
    try {
      const list = await getDocumentVersions(item.id);
      setVersions(list);
    } catch {
      setVersions([]);
    } finally {
      setIsLoadingVersions(false);
    }
  }, []);

  if (!isRecentModalOpen) return null;

  const filteredDocs = recentDocuments.filter((doc) =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  const handleDeleteDoc = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteRecentDocument(id);
    if (selectedDoc?.id === id) {
      setSelectedDoc(null);
      setVersions([]);
    }
  };

  const handleDeleteVersion = async (versionId: string) => {
    if (!selectedDoc) return;
    const remaining = await deleteDocumentVersion(selectedDoc.id, versionId);
    setVersions(remaining);
    await loadRecentDocuments();
  };

  const handleOpenVersionCopy = (version: DocumentVersionSnapshot) => {
    const timeTag = new Date(version.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    const baseTitle = version.title || selectedDoc?.title || 'Documento.md';
    const safeTitle = `[Cópia ${timeTag}] ${baseTitle}`;

    openTab(
      {
        title: safeTitle,
        content: version.content,
        oneDriveItemId: null,
        lastSavedAt: null,
        isDirty: true,
        docId: `recovered-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      },
      null
    );
    setIsRecentModalOpen(false);
    setSyncNotification(`Versão de ${timeTag} aberta em nova aba como cópia segura.`);
  };

  const handleDownloadVersion = (version: DocumentVersionSnapshot) => {
    const fileName = version.title || selectedDoc?.title || 'backup.md';
    downloadMarkdownFile(version.content, fileName);
    setSyncNotification(`Backup "${fileName}" baixado para o dispositivo.`);
  };

  const formatTimestamp = (timestamp: number, withSeconds = false) => {
    const date = new Date(timestamp);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const timeOpts: Intl.DateTimeFormatOptions = withSeconds
      ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      : { hour: '2-digit', minute: '2-digit' };

    if (isToday) {
      return `Hoje às ${date.toLocaleTimeString([], timeOpts)}`;
    }
    return `${date.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} às ${date.toLocaleTimeString([], timeOpts)}`;
  };

  const buildPreviewSnippet = (text: string, expanded: boolean) => {
    const cleaned = text.replace(/\r\n/g, '\n').trim();
    if (!cleaned) return '(Conteúdo vazio)';
    if (expanded) {
      return cleaned.length > 2000 ? `${cleaned.slice(0, 2000)}\n...` : cleaned;
    }
    const singleLine = cleaned.replace(/\s+/g, ' ');
    return singleLine.length > 160 ? `${singleLine.slice(0, 160)}…` : singleLine;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {selectedDoc ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedDoc(null);
                  setVersions([]);
                  setExpandedPreviewId(null);
                }}
                className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                title="Voltar para lista de arquivos"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <History className="w-5 h-5" />
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">
                  {selectedDoc ? (
                    <MiddleEllipsisText text={selectedDoc.title} className="max-w-[340px]" />
                  ) : (
                    'Histórico de Versões e Backups'
                  )}
                </h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                  {selectedDoc
                    ? `${versions.length}/${MAX_VERSIONS_PER_DOCUMENT} versões`
                    : `${recentDocuments.length}/${MAX_RECENT_DOCUMENTS}`}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {selectedDoc
                  ? 'Escolha uma versão salva para abrir como cópia segura ou baixar em .md'
                  : `Até ${MAX_VERSIONS_PER_DOCUMENT} versões arquivadas por documento para recuperação segura`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsRecentModalOpen(false)}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar (apenas na lista de arquivos) */}
        {!selectedDoc && (
          <div className="p-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pesquisar arquivo no cofre de backups..."
                className="w-full h-9 pl-9 pr-4 text-xs rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[240px]">
          {selectedDoc ? (
            isLoadingVersions ? (
              <div className="flex flex-col items-center justify-center py-14 text-xs text-slate-500 dark:text-slate-400">
                Carregando versões arquivadas...
              </div>
            ) : versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-3">
                  <FileText className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nenhuma versão salva para este arquivo
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                  As versões são arquivadas automaticamente ao abrir, editar ou sincronizar documentos com conteúdo.
                </p>
              </div>
            ) : (
              versions.map((version, idx) => {
                const reasonBadge = REASON_LABELS[version.reason] || REASON_LABELS.edit;
                const isExpanded = expandedPreviewId === version.versionId;

                return (
                  <div
                    key={version.versionId}
                    className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/60 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                            {idx === 0 ? 'Versão #1 (Mais recente)' : `Versão #${idx + 1}`}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${reasonBadge.className}`}
                          >
                            {reasonBadge.label}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {version.charCount.toLocaleString()} caracteres
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>{formatTimestamp(version.timestamp, true)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedPreviewId(isExpanded ? null : version.versionId)
                          }
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                          title={isExpanded ? 'Recolher prévia' : 'Ver prévia completa'}
                        >
                          {isExpanded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteVersion(version.versionId)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                          title="Excluir esta versão"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Prévia do conteúdo */}
                    <div
                      className={`text-[11px] font-mono text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-700/70 rounded-lg p-2.5 ${
                        isExpanded ? 'max-h-52 overflow-y-auto whitespace-pre-wrap' : 'truncate'
                      }`}
                    >
                      {buildPreviewSnippet(version.content, isExpanded)}
                    </div>

                    {/* Ações da versão */}
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleOpenVersionCopy(version)}
                        className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                      >
                        <CopyPlus className="w-3.5 h-3.5" />
                        <span>Abrir como cópia em nova aba</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDownloadVersion(version)}
                        className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Baixar arquivo .md</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )
          ) : filteredDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-3">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {searchQuery ? 'Nenhum documento encontrado' : 'Cofre de backups vazio'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                {searchQuery
                  ? 'Tente buscar com outro termo.'
                  : `Até ${MAX_VERSIONS_PER_DOCUMENT} versões dos últimos ${MAX_RECENT_DOCUMENTS} documentos abertos ou editados ficarão arquivadas aqui para emergência.`}
              </p>
            </div>
          ) : (
            filteredDocs.map((item) => {
              const isCurrent = currentDoc
                ? Boolean(currentDoc.oneDriveItemId && currentDoc.oneDriveItemId === item.oneDriveItemId) ||
                  Boolean(
                    currentDoc.docId &&
                      (item.id === `draft:${currentDoc.docId}` ||
                        item.id === `file:${currentDoc.docId}` ||
                        item.id === `local_${currentDoc.docId}`)
                  ) ||
                  Boolean(!currentDoc.oneDriveItemId && currentDoc.title === item.title)
                : false;

              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectDoc(item)}
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

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <MiddleEllipsisText
                          text={item.title}
                          className="text-xs font-bold text-slate-800 dark:text-slate-100 max-w-[300px]"
                        />
                        {item.isOneDrive ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 shrink-0">
                            OneDrive
                          </span>
                        ) : item.sourceType === 'local_file' ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 shrink-0">
                            Arquivo Local
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 shrink-0">
                            Rascunho
                          </span>
                        )}
                        {isCurrent && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 shrink-0">
                            Aberto Agora
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTimestamp(item.lastModifiedAt || item.lastOpenedAt)}
                        </span>
                        {typeof item.versionCount === 'number' && item.versionCount > 0 && (
                          <>
                            <span>•</span>
                            <span className="font-medium text-slate-500 dark:text-slate-400">
                              {item.versionCount} {item.versionCount === 1 ? 'versão' : 'versões'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => handleDeleteDoc(e, item.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                      title="Remover arquivo e versões do cofre"
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
          {selectedDoc ? (
            <button
              type="button"
              onClick={() => {
                setSelectedDoc(null);
                setVersions([]);
                setExpandedPreviewId(null);
              }}
              className="px-3 py-1.5 rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar aos arquivos</span>
            </button>
          ) : (
            <span>
              {filteredDocs.length} {filteredDocs.length === 1 ? 'arquivo no cofre' : 'arquivos no cofre'}
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsRecentModalOpen(false)}
            className="px-4 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
