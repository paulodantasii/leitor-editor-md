import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { loginWithOneDrive, getActiveAccount } from '../../services/msalService';
import {
  listOneDriveItems,
  downloadOneDriveFile,
  createOneDriveFile,
  computeNextAvailableFileName,
  normalizeMarkdownFileName,
  createOneDriveFolder,
  renameOneDriveItem,
  deleteOneDriveItem,
  deleteOneDriveItemsBatch,
  moveOneDriveItemsBatch,
  copyOneDriveFile,
  copyOneDriveFilesBatch,
  searchOneDriveItems,
} from '../../services/oneDriveService';
import { saveActiveDocument } from '../../services/documentSaveService';
import { saveRecentDocument, deleteRecentDocument } from '../../services/recentDocumentsService';
import { OneDriveItem, DocumentState } from '../../types';
import { UnsavedChangesModal } from './UnsavedChangesModal';
import { OneDriveItemRow } from './OneDriveItemRow';
import { MiddleEllipsisText } from '@/components/ui/MiddleEllipsisText';
import {
  X,
  Cloud,
  Home,
  LogIn,
  RefreshCw,
  UploadCloud,
  ChevronRight,
  Settings,
  Save,
  AlertCircle,
  FolderPlus,
  ArrowUpDown,
  Search,
  FolderInput,
  Copy,
  Trash2,
  CornerUpLeft,
} from 'lucide-react';

type SortOption = 'name_asc' | 'name_desc' | 'date_desc';

interface ClipboardState {
  mode: 'move' | 'copy';
  items: OneDriveItem[];
}

export const OneDriveModal: React.FC = () => {
  const {
    isOneDriveModalOpen,
    setIsOneDriveModalOpen,
    oneDriveModalMode,
    oneDriveSuccessAction,
    setOneDriveSuccessAction,
    closeDocument,
    userProfile,
    setUserProfile,
    currentDoc,
    setDocument,
    tabs,
    openTab,
    setSyncStatus,
    setSyncNotification,
    setIsSettingsModalOpen,
    setFileHandle,
    syncOneDriveFileRenamed,
    detachDeletedOneDriveItems,
  } = useAppStore(
    useShallow((state) => ({
      isOneDriveModalOpen: state.isOneDriveModalOpen,
      setIsOneDriveModalOpen: state.setIsOneDriveModalOpen,
      oneDriveModalMode: state.oneDriveModalMode,
      oneDriveSuccessAction: state.oneDriveSuccessAction,
      setOneDriveSuccessAction: state.setOneDriveSuccessAction,
      closeDocument: state.closeDocument,
      userProfile: state.userProfile,
      setUserProfile: state.setUserProfile,
      currentDoc: state.document,
      setDocument: state.setDocument,
      tabs: state.tabs,
      openTab: state.openTab,
      setSyncStatus: state.setSyncStatus,
      setSyncNotification: state.setSyncNotification,
      setIsSettingsModalOpen: state.setIsSettingsModalOpen,
      setFileHandle: state.setFileHandle,
      syncOneDriveFileRenamed: state.syncOneDriveFileRenamed,
      detachDeletedOneDriveItems: state.detachDeletedOneDriveItems,
    }))
  );

  const [items, setItems] = useState<OneDriveItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [folderHistory, setFolderHistory] = useState<Array<{ id?: string; name: string }>>([
    { name: 'Raiz' },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingFileToOpen, setPendingFileToOpen] = useState<OneDriveItem | null>(null);
  const [isUnsavedGuardOpen, setIsUnsavedGuardOpen] = useState(false);
  const [saveFileName, setSaveFileName] = useState('');

  // Estados de Gerenciamento Avançado
  const [sortOption, setSortOption] = useState<SortOption>('name_asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState<OneDriveItem[] | null>(null);
  const [isSearchingGlobal, setIsSearchingGlobal] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isBatchDeletingConfirm, setIsBatchDeletingConfirm] = useState(false);

  const [clipboardState, setClipboardState] = useState<ClipboardState | null>(null);

  const newFolderInputRef = useRef<HTMLInputElement>(null);

  // Verifica sessão MSAL ativa
  useEffect(() => {
    async function checkAccount() {
      try {
        const acc = await getActiveAccount();
        if (acc) {
          setUserProfile({
            name: acc.name || acc.username,
            email: acc.username,
          });
        }
      } catch (err) {
        console.warn('MSAL session check failed', err);
      }
    }
    checkAccount();
  }, [setUserProfile]);

  // Sincroniza nome inicial ao abrir no modo save_as
  useEffect(() => {
    if (isOneDriveModalOpen) {
      if (oneDriveModalMode === 'save_as') {
        setSaveFileName(currentDoc?.title || 'Sem Título.md');
      }
      setErrorMsg(null);
      setSelectedIds(new Set());
      setRenamingItemId(null);
      setConfirmDeleteId(null);
      setIsBatchDeletingConfirm(false);
      setIsCreatingFolder(false);
      setNewFolderName('');
      setClipboardState(null);
      setSearchQuery('');
      setGlobalSearchResults(null);
    }
  }, [isOneDriveModalOpen, oneDriveModalMode, currentDoc?.title]);

  // Foco no input de nova pasta
  useEffect(() => {
    if (isCreatingFolder) {
      setTimeout(() => {
        newFolderInputRef.current?.focus();
      }, 50);
    }
  }, [isCreatingFolder]);

  // Fechamento via Escape
  useEffect(() => {
    if (!isOneDriveModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isCreatingFolder) {
          setIsCreatingFolder(false);
        } else if (renamingItemId) {
          setRenamingItemId(null);
        } else if (confirmDeleteId) {
          setConfirmDeleteId(null);
        } else if (isBatchDeletingConfirm) {
          setIsBatchDeletingConfirm(false);
        } else if (clipboardState) {
          setClipboardState(null);
        } else if (globalSearchResults !== null) {
          setGlobalSearchResults(null);
          setSearchQuery('');
        } else {
          setIsOneDriveModalOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isOneDriveModalOpen,
    isCreatingFolder,
    renamingItemId,
    confirmDeleteId,
    isBatchDeletingConfirm,
    clipboardState,
    globalSearchResults,
    setIsOneDriveModalOpen,
  ]);

  // Carrega itens da pasta
  const loadFolder = useCallback(async (folderId?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    setSelectedIds(new Set());
    setRenamingItemId(null);
    setConfirmDeleteId(null);
    try {
      const folderItems = await listOneDriveItems(folderId);
      setItems(folderItems);
    } catch (err: any) {
      if (err.message === 'CLIENT_ID_REQUIRED') {
        setErrorMsg('É necessário configurar o Client ID do Microsoft Azure nas configurações.');
      } else {
        setErrorMsg(err.message || 'Erro ao carregar pasta do OneDrive.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOneDriveModalOpen && userProfile && globalSearchResults === null) {
      loadFolder(currentFolderId);
    }
  }, [isOneDriveModalOpen, userProfile, currentFolderId, globalSearchResults, loadFolder]);

  // IDs de documentos abertos no editor
  const openItemIds = useMemo(() => {
    const ids = new Set<string>();
    if (currentDoc?.oneDriveItemId) ids.add(currentDoc.oneDriveItemId);
    tabs.forEach((t) => {
      if (t.oneDriveItemId) ids.add(t.oneDriveItemId);
    });
    return ids;
  }, [currentDoc?.oneDriveItemId, tabs]);

  // Resolução de nomes para o modo Save As
  const { isNameCollision, previewResolvedName } = useMemo(() => {
    if (oneDriveModalMode !== 'save_as' || !saveFileName.trim()) {
      return { isNameCollision: false, previewResolvedName: '' };
    }
    const normalized = normalizeMarkdownFileName(saveFileName);
    const existingNames = items.filter((i) => !i.folder).map((i) => i.name);
    const hasCollision = existingNames.some((n) => n.toLowerCase() === normalized.toLowerCase());
    const resolved = hasCollision ? computeNextAvailableFileName(normalized, existingNames) : normalized;
    return { isNameCollision: hasCollision, previewResolvedName: resolved };
  }, [oneDriveModalMode, saveFileName, items]);

  // Filtragem e Ordenação da Lista (deve ficar antes do early return para respeitar as Rules of Hooks do React)
  const displayedItems = useMemo(() => {
    let source = globalSearchResults !== null ? globalSearchResults : items;

    // Filtro local pelo searchQuery quando não estiver em busca global
    if (globalSearchResults === null && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      source = source.filter((i) => i.name.toLowerCase().includes(q));
    }

    // Ordenação: Pastas sempre primeiro
    const folders = source.filter((i) => Boolean(i.folder));
    const files = source.filter((i) => !i.folder);

    const sortFn = (a: OneDriveItem, b: OneDriveItem) => {
      if (sortOption === 'name_asc') {
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (sortOption === 'name_desc') {
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      }
      // date_desc
      return new Date(b.lastModifiedDateTime).getTime() - new Date(a.lastModifiedDateTime).getTime();
    };

    folders.sort(sortFn);
    files.sort(sortFn);

    return [...folders, ...files];
  }, [items, globalSearchResults, searchQuery, sortOption]);

  if (!isOneDriveModalOpen) return null;

  const handleLogin = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const profile = await loginWithOneDrive();
      if (profile) {
        setUserProfile(profile);
        loadFolder();
      }
    } catch (err: any) {
      if (err.message === 'CLIENT_ID_REQUIRED') {
        setErrorMsg('Insira o Client ID do aplicativo do Azure nas configurações para autenticar.');
      } else {
        setErrorMsg(err.message || 'Falha no login com OneDrive.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenFolder = (folder: OneDriveItem) => {
    setGlobalSearchResults(null);
    setSearchQuery('');
    setCurrentFolderId(folder.id);
    setFolderHistory((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleNavigateBreadcrumb = (index: number) => {
    setGlobalSearchResults(null);
    setSearchQuery('');
    const target = folderHistory[index];
    setFolderHistory(folderHistory.slice(0, index + 1));
    setCurrentFolderId(target.id);
  };

  const doOpenFile = async (file: OneDriveItem) => {
    setIsLoading(true);
    try {
      const rawText = await downloadOneDriveFile(file.id);

      openTab(
        {
          title: file.name,
          content: rawText,
          oneDriveItemId: file.id,
          lastSavedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isDirty: false,
          cloudLastModified: file.lastModifiedDateTime,
          cloudETag: file.eTag || null,
          docId: `onedrive:${file.id}`,
        },
        null
      );

      setSyncStatus('saved');
      setIsOneDriveModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao abrir arquivo do OneDrive.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenFile = (file: OneDriveItem) => {
    if (oneDriveModalMode === 'save_as') {
      setSaveFileName(file.name);
      return;
    }
    doOpenFile(file);
  };

  const handleConfirmDiscardFromGuard = () => {
    const file = pendingFileToOpen;
    setPendingFileToOpen(null);
    setIsUnsavedGuardOpen(false);
    if (file) {
      doOpenFile(file);
    }
  };

  const handleConfirmSaveFromGuard = async () => {
    const file = pendingFileToOpen;
    setIsLoading(true);
    const result = await saveActiveDocument();
    setIsLoading(false);

    if (result.status !== 'saved') {
      setPendingFileToOpen(null);
      setIsUnsavedGuardOpen(false);
      if (result.status === 'error') {
        setErrorMsg(`Não foi possível salvar o documento atual; o novo arquivo não foi aberto. ${result.message || ''}`.trim());
      }
      return;
    }

    setPendingFileToOpen(null);
    setIsUnsavedGuardOpen(false);
    if (file) {
      doOpenFile(file);
    }
  };

  const handleSaveCurrentToCloud = async () => {
    if (!currentDoc?.oneDriveItemId) {
      setErrorMsg('Este documento ainda não foi associado a um arquivo do OneDrive.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    const result = await saveActiveDocument();
    setIsLoading(false);

    if (result.status === 'saved') {
      setIsOneDriveModalOpen(false);
    } else if (result.status === 'error') {
      setErrorMsg(result.message || 'Erro ao salvar documento no OneDrive.');
    }
  };

  const handleSaveAsConfirm = async () => {
    if (!currentDoc) {
      setErrorMsg('Nenhum documento ativo para salvar.');
      return;
    }
    if (!saveFileName.trim()) {
      setErrorMsg('Por favor, informe um nome para o arquivo.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const existingNames = items.filter((i) => !i.folder).map((i) => i.name);
      const createdItem = await createOneDriveFile(
        currentFolderId,
        saveFileName,
        currentDoc.content || '',
        existingNames
      );

      const oldDocId = currentDoc.docId;
      if (oldDocId && !currentDoc.oneDriveItemId) {
        await deleteRecentDocument(`draft:${oldDocId}`).catch(() => {});
      }

      const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const updatedDoc: DocumentState = {
        ...currentDoc,
        title: createdItem.name,
        oneDriveItemId: createdItem.id,
        cloudETag: createdItem.eTag || null,
        cloudLastModified: createdItem.lastModifiedDateTime,
        lastSavedAt: nowFormatted,
        isDirty: false,
        sourceRevision: currentDoc.revision ?? 0,
        draftRevision: currentDoc.revision ?? 0,
        docId: `onedrive:${createdItem.id}`,
        fileHandle: null,
      };

      setFileHandle(null);
      setDocument(updatedDoc);
      setSyncStatus('saved');

      await saveRecentDocument({ ...updatedDoc });
      setIsOneDriveModalOpen(false);

      if (oneDriveSuccessAction === 'close') {
        setOneDriveSuccessAction(null);
        closeDocument();
        setSyncNotification(`Salvo como "${createdItem.name}" e fechado.`);
      } else {
        setSyncNotification(`Salvo no OneDrive como "${createdItem.name}"!`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao criar arquivo no OneDrive.');
    } finally {
      setIsLoading(false);
    }
  };

  // Criação de Nova Pasta
  const handleConfirmCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await createOneDriveFolder(currentFolderId, newFolderName);
      setIsCreatingFolder(false);
      setNewFolderName('');
      await loadFolder(currentFolderId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao criar pasta.');
    } finally {
      setIsLoading(false);
    }
  };

  // Renomeação de Item
  const handleStartRename = (item: OneDriveItem) => {
    setRenamingItemId(item.id);
    setRenameValue(item.name);
    setConfirmDeleteId(null);
  };

  const handleConfirmRename = async (item: OneDriveItem) => {
    if (!renameValue.trim() || renameValue === item.name) {
      setRenamingItemId(null);
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const renamed = await renameOneDriveItem(item.id, renameValue, Boolean(item.folder));
      setRenamingItemId(null);
      if (!item.folder) {
        await syncOneDriveFileRenamed(item.id, renamed);
      }
      await loadFolder(currentFolderId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao renomear.');
    } finally {
      setIsLoading(false);
    }
  };

  // Exclusão Individual
  const handleConfirmDelete = async (item: OneDriveItem) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await deleteOneDriveItem(item.id);
      setConfirmDeleteId(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      if (!item.folder) {
        await detachDeletedOneDriveItems([item.id]);
      }
      await loadFolder(currentFolderId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao excluir item.');
    } finally {
      setIsLoading(false);
    }
  };

  // Exclusão em Lote
  const handleConfirmBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const ids = Array.from(selectedIds);
      const res = await deleteOneDriveItemsBatch(ids);
      setIsBatchDeletingConfirm(false);
      setSelectedIds(new Set());
      if (res.succeeded.length > 0) {
        await detachDeletedOneDriveItems(res.succeeded);
      }
      if (res.failed.length > 0) {
        setErrorMsg(`Não foi possível excluir ${res.failed.length} item(ns).`);
      }
      await loadFolder(currentFolderId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro na exclusão em lote.');
    } finally {
      setIsLoading(false);
    }
  };

  // Duplicar Arquivo Individual
  const handleDuplicateFile = async (item: OneDriveItem) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const existingNames = items.map((i) => i.name);
      await copyOneDriveFile(item.id, item.name, currentFolderId, existingNames);
      await loadFolder(currentFolderId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao duplicar arquivo.');
    } finally {
      setIsLoading(false);
    }
  };

  // Mover Único Item
  const handleStartMoveSingle = (item: OneDriveItem) => {
    setClipboardState({ mode: 'move', items: [item] });
  };

  // Operações de Clipboard (Mover ou Copiar aqui)
  const handleExecuteClipboard = async () => {
    if (!clipboardState || clipboardState.items.length === 0) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (clipboardState.mode === 'move') {
        const ids = clipboardState.items.map((i) => i.id);
        const res = await moveOneDriveItemsBatch(ids, currentFolderId);
        if (res.failed.length > 0) {
          setErrorMsg(`Erro ao mover ${res.failed.length} item(ns): ${res.failed[0].error}`);
        }
      } else {
        const fileItems = clipboardState.items.filter((i) => !i.folder).map((i) => ({ id: i.id, name: i.name }));
        const existingNames = items.map((i) => i.name);
        const res = await copyOneDriveFilesBatch(fileItems, currentFolderId, existingNames);
        if (res.failed.length > 0) {
          setErrorMsg(`Erro ao copiar ${res.failed.length} arquivo(s): ${res.failed[0].error}`);
        }
      }
      setClipboardState(null);
      setSelectedIds(new Set());
      await loadFolder(currentFolderId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao transferir itens.');
    } finally {
      setIsLoading(false);
    }
  };

  // Busca Global
  const handleTriggerGlobalSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setIsSearchingGlobal(true);
    setErrorMsg(null);
    try {
      const results = await searchOneDriveItems(q);
      setGlobalSearchResults(results);
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha na pesquisa do OneDrive.');
    } finally {
      setIsSearchingGlobal(false);
    }
  };

  // Seleção
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllToggle = () => {
    if (selectedIds.size === displayedItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedItems.map((i) => i.id)));
    }
  };

  const isSaveAs = oneDriveModalMode === 'save_as';
  const showFooter = isSaveAs || Boolean(currentDoc?.oneDriveItemId && userProfile);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
      onClick={() => setIsOneDriveModalOpen(false)}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl p-4 sm:p-5 space-y-3 animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho Enxuto */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-2.5">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-sky-500 shrink-0" />
            <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100">
              {isSaveAs ? 'Salvar no OneDrive' : 'OneDrive'}
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setIsOneDriveModalOpen(false);
                setIsSettingsModalOpen(true);
              }}
              title="Configurar Client ID Azure"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsOneDriveModalOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Card de Autenticação apenas se deslogado */}
        {!userProfile && (
          <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Conecte sua conta Microsoft para acessar, criar e sincronizar documentos no OneDrive.
            </p>
            <button
              type="button"
              onClick={handleLogin}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white shadow-sm flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
            >
              <LogIn className="w-4 h-4" /> Conectar OneDrive
            </button>
          </div>
        )}

        {/* Notificação de Erro */}
        {errorMsg && (
          <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl p-2.5 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5 min-w-0 truncate">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">{errorMsg}</span>
            </span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="p-1 text-red-500 hover:text-red-700 shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Explorador de Arquivos do OneDrive */}
        {userProfile && (
          <div className="flex-1 overflow-hidden flex flex-col border border-slate-200 dark:border-slate-700 rounded-xl min-h-[280px]">
            {/* Barra de Ferramentas - Linha 1: Breadcrumb + Ações */}
            <div className="bg-slate-100 dark:bg-slate-700/50 px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              {/* Breadcrumb Enxuto */}
              <div className="flex items-center gap-1 overflow-x-auto min-w-0">
                {globalSearchResults !== null ? (
                  <div className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400">
                    <Search className="w-3.5 h-3.5" />
                    <span>Resultados da busca</span>
                    <button
                      type="button"
                      onClick={() => {
                        setGlobalSearchResults(null);
                        setSearchQuery('');
                      }}
                      className="ml-1 px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 text-[10px] text-slate-700 dark:text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      <CornerUpLeft className="w-3 h-3" /> Voltar à pasta
                    </button>
                  </div>
                ) : (
                  folderHistory.map((folder, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
                      <button
                        type="button"
                        onClick={() => handleNavigateBreadcrumb(idx)}
                        className={`hover:text-sky-600 dark:hover:text-sky-400 cursor-pointer flex items-center ${
                          idx === 0 ? 'p-1' : ''
                        }`}
                        title={idx === 0 ? 'Pasta raiz' : folder.name}
                      >
                        {idx === 0 ? (
                          <Home className="w-3.5 h-3.5" />
                        ) : (
                          <MiddleEllipsisText text={folder.name} className="max-w-[120px]" />
                        )}
                      </button>
                    </React.Fragment>
                  ))
                )}
              </div>

              {/* Ações da Pasta: Nova Pasta, Ordenação e Atualizar */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => setIsCreatingFolder(true)}
                  title="Nova pasta"
                  aria-label="Nova pasta"
                  className="h-6 w-6 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-center cursor-pointer shadow-xs"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
                </button>

                <div className="relative flex items-center">
                  <select
                    value={sortOption}
                    onChange={(e) => setSortOption(e.target.value as SortOption)}
                    aria-label="Critério de ordenação"
                    className="h-6 px-1.5 text-[11px] rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 cursor-pointer focus:outline-none"
                  >
                    <option value="name_asc">Nome (A-Z)</option>
                    <option value="name_desc">Nome (Z-A)</option>
                    <option value="date_desc">Mais recentes</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => loadFolder(currentFolderId)}
                  title="Atualizar pasta"
                  disabled={isLoading}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Barra de Ferramentas - Linha 2: Busca Enxuta + Seleção Geral */}
            <div className="bg-slate-50/70 dark:bg-slate-800/60 px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 text-xs">
              {displayedItems.length > 0 && (
                <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer shrink-0 select-none">
                  <input
                    type="checkbox"
                    checked={displayedItems.length > 0 && selectedIds.size === displayedItems.length}
                    onChange={handleSelectAllToggle}
                    className="w-3.5 h-3.5 rounded accent-sky-600 cursor-pointer"
                  />
                  <span className="hidden sm:inline">Todos</span>
                </label>
              )}

              <div className="relative flex-1 flex items-center">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleTriggerGlobalSearch();
                    }
                  }}
                  placeholder="Filtrar ou Enter para buscar em todo o OneDrive..."
                  className="w-full h-7 pl-7 pr-16 text-xs rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />

                <div className="absolute right-1 flex items-center gap-1">
                  {searchQuery.trim().length >= 2 && globalSearchResults === null && (
                    <button
                      type="button"
                      disabled={isSearchingGlobal}
                      onClick={handleTriggerGlobalSearch}
                      title="Buscar em todo o OneDrive"
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 hover:bg-sky-200 dark:bg-sky-950/70 dark:hover:bg-sky-900 text-sky-700 dark:text-sky-300 cursor-pointer"
                    >
                      {isSearchingGlobal ? 'Buscando...' : 'Em tudo'}
                    </button>
                  )}
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setGlobalSearchResults(null);
                      }}
                      className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Banner de Modo de Transferência ("Mover/Copiar para cá") */}
            {clipboardState && (
              <div className="bg-sky-50 dark:bg-sky-950/70 border-b border-sky-200 dark:border-sky-800 px-3 py-1.5 flex items-center justify-between text-xs text-sky-800 dark:text-sky-200 animate-in fade-in">
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  {clipboardState.mode === 'move' ? (
                    <FolderInput className="w-4 h-4 text-sky-600 shrink-0" />
                  ) : (
                    <Copy className="w-4 h-4 text-sky-600 shrink-0" />
                  )}
                  <span className="truncate">
                    {clipboardState.mode === 'move' ? 'Movendo' : 'Copiando'}{' '}
                    <b>{clipboardState.items.length} item(ns)</b>. Navegue até a pasta de destino:
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={handleExecuteClipboard}
                    className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-700 text-white font-bold text-[11px] shadow-xs cursor-pointer"
                  >
                    {clipboardState.mode === 'move' ? 'Mover para cá' : 'Copiar para cá'}
                  </button>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => setClipboardState(null)}
                    className="px-2 py-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-[11px] cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Barra Contextual de Seleção em Lote */}
            {selectedIds.size > 0 && !clipboardState && (
              <div className="bg-slate-100 dark:bg-slate-700/80 border-b border-slate-200 dark:border-slate-600 px-3 py-1.5 flex items-center justify-between text-xs text-slate-700 dark:text-slate-200">
                <span className="font-semibold text-[11px]">{selectedIds.size} selecionado(s)</span>

                {isBatchDeletingConfirm ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-red-600 dark:text-red-400 font-medium text-[11px]">
                      Excluir {selectedIds.size} item(ns)?
                    </span>
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={handleConfirmBatchDelete}
                      className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white font-semibold text-[11px] cursor-pointer"
                    >
                      Sim, excluir
                    </button>
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => setIsBatchDeletingConfirm(false)}
                      className="px-2 py-0.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 text-[11px] cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const selectedItems = displayedItems.filter((i) => selectedIds.has(i.id));
                        setClipboardState({ mode: 'move', items: selectedItems });
                      }}
                      className="px-2 py-1 rounded text-[11px] font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1 cursor-pointer"
                    >
                      <FolderInput className="w-3 h-3 text-sky-500" /> Mover
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const selectedFileItems = displayedItems.filter(
                          (i) => selectedIds.has(i.id) && !i.folder
                        );
                        if (selectedFileItems.length === 0) {
                          setErrorMsg('Apenas arquivos podem ser copiados.');
                          return;
                        }
                        setClipboardState({ mode: 'copy', items: selectedFileItems });
                      }}
                      className="px-2 py-1 rounded text-[11px] font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3 text-sky-500" /> Copiar
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsBatchDeletingConfirm(true)}
                      className="px-2 py-1 rounded text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" /> Excluir
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      className="ml-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Limpar
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Linha Inline de Criação de Nova Pasta */}
            {isCreatingFolder && (
              <div className="bg-amber-50/70 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/60 p-2 flex items-center gap-2 text-xs animate-in fade-in">
                <FolderPlus className="w-4 h-4 text-amber-500 shrink-0" />
                <input
                  ref={newFolderInputRef}
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleConfirmCreateFolder();
                    } else if (e.key === 'Escape') {
                      setIsCreatingFolder(false);
                      setNewFolderName('');
                    }
                  }}
                  placeholder="Nome da nova pasta..."
                  className="flex-1 h-7 px-2 text-xs rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <button
                  type="button"
                  disabled={isLoading || !newFolderName.trim()}
                  onClick={handleConfirmCreateFolder}
                  className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px] cursor-pointer disabled:opacity-50"
                >
                  Criar
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    setIsCreatingFolder(false);
                    setNewFolderName('');
                  }}
                  className="px-2 py-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-[11px] cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            )}

            {/* Lista de Itens Enxuta e de Alta Densidade */}
            <div className="overflow-y-auto p-1.5 space-y-0.5 h-[55vh]">
              {isLoading && displayedItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-sky-500" />
                  <span className="text-xs">Carregando itens do OneDrive...</span>
                </div>
              ) : displayedItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 text-xs">
                  {searchQuery.trim()
                    ? 'Nenhum resultado encontrado para a busca.'
                    : isSaveAs
                    ? 'Esta pasta está vazia. Você pode salvar seu arquivo diretamente aqui.'
                    : 'Nenhum arquivo ou pasta encontrado neste local.'}
                </div>
              ) : (
                displayedItems.map((item) => (
                  <OneDriveItemRow
                    key={item.id}
                    item={item}
                    isSelected={selectedIds.has(item.id)}
                    isSaveAs={isSaveAs}
                    isHighlightedSaveTarget={
                      isSaveAs && !item.folder && saveFileName.toLowerCase() === item.name.toLowerCase()
                    }
                    isOpenInEditor={openItemIds.has(item.id)}
                    isRenaming={renamingItemId === item.id}
                    renameValue={renameValue}
                    isConfirmingDelete={confirmDeleteId === item.id}
                    disabled={isLoading}
                    showParentPath={globalSearchResults !== null}
                    onToggleSelect={handleToggleSelect}
                    onPrimaryClick={(target) =>
                      target.folder ? handleOpenFolder(target) : handleOpenFile(target)
                    }
                    onStartRename={handleStartRename}
                    onRenameChange={setRenameValue}
                    onConfirmRename={handleConfirmRename}
                    onCancelRename={() => setRenamingItemId(null)}
                    onStartDelete={(target) => {
                      setConfirmDeleteId(target.id);
                      setRenamingItemId(null);
                    }}
                    onConfirmDelete={handleConfirmDelete}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    onStartMoveSingle={handleStartMoveSingle}
                    onDuplicateFile={handleDuplicateFile}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* Input de Nome no Modo Salvar Como */}
        {isSaveAs && userProfile && (
          <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <label htmlFor="onedrive-filename-input">Nome do arquivo:</label>
              {isNameCollision ? (
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-normal truncate max-w-[320px]">
                  Arquivo existente nesta pasta. Será salvo como: <b>{previewResolvedName}</b>
                </span>
              ) : (
                previewResolvedName &&
                previewResolvedName !== saveFileName && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                    Será salvo como: <b>{previewResolvedName}</b>
                  </span>
                )
              )}
            </div>
            <input
              id="onedrive-filename-input"
              type="text"
              value={saveFileName}
              onChange={(e) => setSaveFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveAsConfirm();
                }
              }}
              placeholder="Ex: Minhas Anotações.md"
              className="w-full h-8 px-3 text-xs rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500 text-slate-800 dark:text-slate-100"
            />
          </div>
        )}

        {/* Rodapé Condicional (Apenas quando estritamente necessário) */}
        {showFooter && (
          <div className="flex items-center justify-between pt-1">
            {isSaveAs ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsOneDriveModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                {userProfile && (
                  <button
                    type="button"
                    onClick={handleSaveAsConfirm}
                    disabled={isLoading || !saveFileName.trim()}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Save className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    {isLoading ? 'Salvando...' : 'Salvar Aqui'}
                  </button>
                )}
              </>
            ) : (
              currentDoc?.oneDriveItemId && userProfile && (
                <button
                  type="button"
                  onClick={handleSaveCurrentToCloud}
                  disabled={isLoading}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex items-center gap-1.5 transition-all cursor-pointer ml-auto"
                >
                  <UploadCloud className="w-3.5 h-3.5" /> Sobrescrever na Nuvem
                </button>
              )
            )}
          </div>
        )}

        <UnsavedChangesModal
          isOpen={isUnsavedGuardOpen}
          onClose={() => {
            setIsUnsavedGuardOpen(false);
            setPendingFileToOpen(null);
          }}
          onConfirmDiscard={handleConfirmDiscardFromGuard}
          onConfirmSaveAndProceed={handleConfirmSaveFromGuard}
          documentTitle={currentDoc?.title || ''}
          actionType="open_onedrive"
        />
      </div>
    </div>
  );
};
