import React, { useRef, useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import { AppearanceMenu } from './AppearanceMenu';
import { UnsavedChangesModal, GuardActionType } from '../modals/UnsavedChangesModal';
import { downloadMarkdownFile, printDocument } from '../../services/exportService';
import {
  Highlighter,
  Edit3,
  BookOpen,
  FolderOpen,
  Save,
  Download,
  Printer,
  ChevronDown,
  Cloud,
  Check,
  RefreshCw,
  MoreVertical,
  WifiOff,
  FilePlus,
  Pencil,
  History,
  X,
  Plus,
} from 'lucide-react';
import { flushPendingEditorContent } from '../../services/editorContentBridge';
import { saveActiveDocument } from '../../services/documentSaveService';
import { SaveDestinationModal } from '../modals/SaveDestinationModal';
import { saveCoordinator } from '../../services/saveCoordinator';
import { TabItem } from '../../types';
import { usePwaInstall } from '../../hooks/usePwaInstall';

export const Header: React.FC = () => {
  const hasDocument = useAppStore((state) => Boolean(state.document));

  const currentDoc = useAppStore(
    useShallow((state) => ({
      title: state.document?.title || '',
      isDirty: state.document?.isDirty || false,
      lastSavedAt: state.document?.lastSavedAt || null,
      oneDriveItemId: state.document?.oneDriveItemId || null,
      docId: state.document?.docId || '',
      revision: state.document?.revision ?? 0,
      draftRevision: state.document?.draftRevision ?? 0,
    }))
  );

  const {
    tabs,
    activeTabId,
    openTab,
    switchTab,
    closeTab,
    renameTab,
    fileHandle,
    setFileHandle,
    isHighlightMode,
    toggleHighlightMode,
    isEditable,
    setIsEditable,
    highlightCount,
    syncStatus,
    setSyncStatus,
    userProfile,
    setIsOneDriveModalOpen,
    createNewDocument,
    recentDocuments,
    setIsRecentModalOpen,
    isSaveDestinationModalOpen,
    setIsSaveDestinationModalOpen,
    cloudConflict,
    syncNotification,
    setIsInstallModalOpen,
  } = useAppStore(
    useShallow((state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      openTab: state.openTab,
      switchTab: state.switchTab,
      closeTab: state.closeTab,
      renameTab: state.renameTab,
      fileHandle: state.fileHandle,
      setFileHandle: state.setFileHandle,
      isHighlightMode: state.isHighlightMode,
      toggleHighlightMode: state.toggleHighlightMode,
      isEditable: state.isEditable,
      setIsEditable: state.setIsEditable,
      highlightCount: state.highlightCount,
      syncStatus: state.syncStatus,
      setSyncStatus: state.setSyncStatus,
      userProfile: state.userProfile,
      setIsOneDriveModalOpen: state.setIsOneDriveModalOpen,
      createNewDocument: state.createNewDocument,
      recentDocuments: state.recentDocuments,
      setIsRecentModalOpen: state.setIsRecentModalOpen,
      isSaveDestinationModalOpen: state.isSaveDestinationModalOpen,
      setIsSaveDestinationModalOpen: state.setIsSaveDestinationModalOpen,
      cloudConflict: state.cloudConflict,
      syncNotification: state.syncNotification,
      setIsInstallModalOpen: state.setIsInstallModalOpen,
    }))
  );

  const { isStandalone } = usePwaInstall();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // Mantém a variável CSS --header-height sincronizada com a altura real do cabeçalho
  useEffect(() => {
    const updateHeaderHeight = () => {
      if (headerRef.current) {
        const height = headerRef.current.offsetHeight;
        if (height > 0) {
          document.documentElement.style.setProperty('--header-height', `${height}px`);
        }
      }
    };

    updateHeaderHeight();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && headerRef.current) {
      ro = new ResizeObserver(updateHeaderHeight);
      ro.observe(headerRef.current);
    }

    window.addEventListener('resize', updateHeaderHeight);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, [tabs.length]);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  // Tab renaming state
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const tabRenameInputRef = useRef<HTMLInputElement>(null);
  const isCancelingRenameRef = useRef(false);

  // Tab context menu state
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const tabContextMenuRef = useRef<HTMLDivElement>(null);

  // Guard action & tab closure confirmation state
  const [unsavedModalAction, setUnsavedModalAction] = useState<GuardActionType | null>(null);
  const [tabToCloseId, setTabToCloseId] = useState<string | null>(null);
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);

  // Close Export & Mobile Dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    };
    if (isExportMenuOpen || isMobileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExportMenuOpen, isMobileMenuOpen]);

  // Close Tab Context Menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tabContextMenuRef.current && !tabContextMenuRef.current.contains(e.target as Node)) {
        setTabContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTabContextMenu(null);
      }
    };
    if (tabContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [tabContextMenu]);

  // Inline tab rename triggers
  const handleStartTabRename = (tab: TabItem) => {
    isCancelingRenameRef.current = false;
    setEditingTabId(tab.id);
    setEditingTitle(tab.title);
    setTimeout(() => {
      const inputEl = tabRenameInputRef.current;
      if (inputEl) {
        inputEl.focus();
        const dotIndex = tab.title.lastIndexOf('.');
        if (dotIndex > 0) {
          inputEl.setSelectionRange(0, dotIndex);
        } else {
          inputEl.select();
        }
        inputEl.scrollLeft = 0;
        inputEl.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }, 30);
  };

  const handleFinishTabRename = () => {
    if (isCancelingRenameRef.current) {
      isCancelingRenameRef.current = false;
      return;
    }
    if (editingTabId) {
      const targetTabId = editingTabId;
      const prevTitle = tabs.find((t) => t.id === targetTabId)?.title;
      setEditingTabId(null);
      renameTab(targetTabId, editingTitle);

      // Se renomeou a aba ativa conectada ao OneDrive, dispara salvamento imediato para atualizar o nome na nuvem
      const freshState = useAppStore.getState();
      if (
        targetTabId === freshState.activeTabId &&
        freshState.document?.oneDriveItemId &&
        freshState.document.title !== prevTitle
      ) {
        saveCoordinator.save({ interactive: false });
      }
    }
  };

  const handleTabRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleFinishTabRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      isCancelingRenameRef.current = true;
      setEditingTabId(null);
    }
  };

  const handleOpenTabContextMenu = (e: React.MouseEvent, tab: TabItem) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 170);
    const y = e.clientY + 8;
    setTabContextMenu({ x, y, tabId: tab.id });
  };

  // Monitor online status for sync resilience
  useEffect(() => {
    const handleOnline = () => {
      if (syncStatus === 'offline-pending') {
        setSyncStatus('idle');
      }
    };
    const handleOffline = () => {
      if (currentDoc.isDirty) {
        setSyncStatus('offline-pending');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncStatus, currentDoc.isDirty, setSyncStatus]);

  // Fechamento inteligente de aba (X)
  const handleCloseTabClick = (e: React.MouseEvent, tab: TabItem) => {
    e.stopPropagation();

    // 1. Se não houver alterações pendentes ou for rascunho em branco: fecha em silêncio imediato
    const isBlank =
      tab.title === 'Sem Título.md' &&
      !tab.isDirty &&
      (!tab.snapshot?.content || tab.snapshot.content.trim() === '');

    if (!tab.isDirty || isBlank) {
      closeTab(tab.id, true);
      return;
    }

    // 2. Se possuir alterações pendentes:
    // Foca na aba primeiro se não for a ativa
    if (tab.id !== activeTabId) {
      switchTab(tab.id);
    }

    setTabToCloseId(tab.id);
    setUnsavedModalAction('close');
  };

  const handleConfirmDiscard = () => {
    if (tabToCloseId) {
      closeTab(tabToCloseId, true);
      setTabToCloseId(null);
    }
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setUnsavedModalAction(null);
    action?.();
  };

  const handleConfirmSaveAndProceed = async () => {
    const saved = await handleSaveFile();
    if (!saved) {
      pendingActionRef.current = null;
      setUnsavedModalAction(null);
      setTabToCloseId(null);
      return;
    }
    if (tabToCloseId) {
      closeTab(tabToCloseId, true);
      setTabToCloseId(null);
    }
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setUnsavedModalAction(null);
    action?.();
  };

  const handleCancelGuard = () => {
    pendingActionRef.current = null;
    setUnsavedModalAction(null);
    setTabToCloseId(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleNewFile = () => {
    createNewDocument();
  };

  const handleOpenFile = async () => {
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
      } else {
        fileInputRef.current?.click();
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        fileInputRef.current?.click();
      }
    }
  };

  const handleFileUploadFallback = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target?.files?.[0];
    if (!file) return;

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
      }
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSaveFile = async (): Promise<boolean> => {
    const result = await saveActiveDocument();
    if (result.status === 'saved') {
      showNotification(result.message || 'Salvo!');
      return true;
    }
    if (result.status === 'error') {
      showNotification(result.message || 'Erro ao salvar.', true);
    }
    return false;
  };

  const handleSaveButtonClick = async (): Promise<boolean> => {
    const doc = useAppStore.getState().document;
    if (!doc) return false;

    const hasSource = Boolean(doc.oneDriveItemId || fileHandle || doc.fileHandle);
    if (!hasSource) {
      setIsSaveDestinationModalOpen(true);
      return false;
    }

    return await handleSaveFile();
  };

  const getUnifiedStatus = () => {
    if (cloudConflict) {
      return {
        text: 'Conflito',
        subtext: 'Arquivo alterado na nuvem ou externamente',
        dotClass: 'bg-rose-500 animate-pulse',
        colorClass: 'text-rose-600 dark:text-rose-400 font-semibold',
        badgeClass: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800',
        isClickable: false,
      };
    }

    if (syncStatus === 'error') {
      return {
        text: 'Erro — tentar novamente',
        subtext: 'Falha ao salvar',
        dotClass: 'bg-red-500',
        colorClass: 'text-red-600 dark:text-red-400 font-semibold hover:underline',
        badgeClass: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800',
        isClickable: true,
        action: () => handleSaveButtonClick(),
      };
    }

    if (syncStatus === 'offline-pending' || (!navigator.onLine && currentDoc.isDirty)) {
      return {
        text: 'Pendente (offline)',
        subtext: 'Salvo neste navegador; será enviado ao voltar online',
        dotClass: 'bg-amber-500',
        colorClass: 'text-amber-600 dark:text-amber-400 font-medium',
        badgeClass: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
        isClickable: false,
      };
    }

    if (syncStatus === 'saving') {
      return {
        text: 'Salvando…',
        subtext: 'Gravando alterações',
        dotClass: 'bg-sky-500 animate-ping',
        colorClass: 'text-sky-600 dark:text-sky-400 font-medium',
        badgeClass: 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800',
        isClickable: false,
      };
    }

    const hasSource = Boolean(currentDoc.oneDriveItemId || fileHandle);
    const hasPendingChanges = hasSource ? currentDoc.isDirty : currentDoc.revision > currentDoc.draftRevision;

    if (hasPendingChanges) {
      return {
        text: 'Editando…',
        subtext: 'Alterações não salvas',
        dotClass: 'bg-amber-500',
        colorClass: 'text-amber-600 dark:text-amber-400 font-medium',
        badgeClass: '',
        isClickable: false,
      };
    }

    if (currentDoc.oneDriveItemId) {
      const timeStr = currentDoc.lastSavedAt ? ` às ${currentDoc.lastSavedAt}` : '';
      return {
        text: `Salvo no OneDrive${timeStr}`,
        subtext: 'Sincronizado na nuvem',
        dotClass: 'bg-emerald-500',
        colorClass: 'text-slate-500 dark:text-slate-400',
        badgeClass: '',
        isClickable: false,
      };
    }

    if (fileHandle) {
      const timeStr = currentDoc.lastSavedAt ? ` às ${currentDoc.lastSavedAt}` : '';
      return {
        text: `Salvo no arquivo${timeStr}`,
        subtext: 'Arquivo local vinculado',
        dotClass: 'bg-emerald-500',
        colorClass: 'text-slate-500 dark:text-slate-400',
        badgeClass: '',
        isClickable: false,
      };
    }

    return {
      text: 'Rascunho salvo no cache',
      subtext: 'Armazenado no cache local',
      dotClass: 'bg-slate-400 dark:bg-slate-500',
      colorClass: 'text-slate-400 dark:text-slate-500',
      badgeClass: '',
      isClickable: false,
    };
  };

  const statusInfo = getUnifiedStatus();

  const showNotification = (msg: string, isError: boolean = false) => {
    if (isError) {
      setSaveSuccessMessage(null);
      setSaveErrorMessage(msg);
      setTimeout(() => setSaveErrorMessage(null), 5000);
    } else {
      setSaveErrorMessage(null);
      setSaveSuccessMessage(msg);
      setTimeout(() => setSaveSuccessMessage(null), 3000);
    }
  };

  const handleExportMD = () => {
    flushPendingEditorContent();
    const freshDoc = useAppStore.getState().document;
    if (!freshDoc) return;
    downloadMarkdownFile(freshDoc.content, freshDoc.title || 'documento.md');
  };

  const handlePrint = () => {
    flushPendingEditorContent();
    const freshDoc = useAppStore.getState().document;
    if (!freshDoc) return;
    printDocument(freshDoc.title || 'documento');
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 header-safe-area transition-colors print:hidden shadow-xs"
    >
      {/* LINHA 1: Ações Principais e Indicadores de Status */}
      <div className="h-10 sm:h-11 px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-4 max-w-7xl mx-auto">
        {/* Esquerda / Centro-Esquerda: Status de salvamento e feedback inline */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {hasDocument && (
            <div className="flex items-center gap-1.5 text-[11px] leading-tight shrink-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusInfo.dotClass}`} />
              {statusInfo.isClickable ? (
                <button
                  type="button"
                  onClick={statusInfo.action}
                  className={`px-1.5 py-0.5 rounded border transition-colors ${statusInfo.colorClass} ${statusInfo.badgeClass}`}
                  title="Clique para tentar salvar novamente"
                >
                  {statusInfo.text}
                </button>
              ) : (
                <span className={`truncate max-w-[140px] sm:max-w-[200px] md:max-w-none ${statusInfo.colorClass}`} title={statusInfo.subtext}>
                  {statusInfo.text}
                </span>
              )}
            </div>
          )}

          {saveSuccessMessage && (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full animate-in fade-in shrink-0">
              ✓ {saveSuccessMessage}
            </span>
          )}
          {saveErrorMessage && (
            <span className="text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 px-2 py-0.5 rounded-full animate-in fade-in truncate max-w-[200px] sm:max-w-[300px]" title={saveErrorMessage}>
              ⚠ {saveErrorMessage}
            </span>
          )}
          {syncNotification && !saveSuccessMessage && !saveErrorMessage && (
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-full animate-in fade-in truncate max-w-[200px] sm:max-w-[300px]" title={syncNotification}>
              {syncNotification}
            </span>
          )}
        </div>

        {/* Direita: Barra de Ferramentas de Ações */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {hasDocument && (
            <>
              {/* Modo Grifar (Toggle Button + Badge) */}
              <button
                onClick={toggleHighlightMode}
                className={`px-2.5 sm:px-3 h-8 rounded-xl font-medium text-xs flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                  isHighlightMode
                    ? 'bg-amber-500 text-white shadow-sm font-semibold'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
                title="Ativar/Desativar Modo Grifar (Atalho: tecla G)"
              >
                <Highlighter className="w-4 h-4" />
                <span className="hidden md:inline">Grifar</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    isHighlightMode ? 'bg-amber-700 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {highlightCount}
                </span>
              </button>

              {/* Modo Leitura / Edição Segmented Switch */}
              <div
                role="group"
                aria-label="Modo de visualização"
                className="h-8 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700/80 flex items-center shrink-0 shadow-inner"
              >
                <button
                  type="button"
                  onClick={() => setIsEditable(false)}
                  title="Modo Leitura (focado na leitura e grifos)"
                  className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs transition-all duration-200 cursor-pointer ${
                    !isEditable
                      ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium'
                  }`}
                >
                  <BookOpen className={`w-3.5 h-3.5 ${!isEditable ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                  <span className="hidden sm:inline">Leitura</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsEditable(true)}
                  title="Modo Edição (digitação e formatação Markdown)"
                  className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs transition-all duration-200 cursor-pointer ${
                    isEditable
                      ? 'bg-blue-600 text-white shadow-sm font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium'
                  }`}
                >
                  <Edit3 className={`w-3.5 h-3.5 ${isEditable ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} />
                  <span className="hidden sm:inline">Edição</span>
                </button>
              </div>
            </>
          )}

          {/* Input Fallback invisível */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt"
            className="hidden"
            onChange={handleFileUploadFallback}
          />

          {/* Desktop Actions: Abrir, Recentes, Salvar, Exportar */}
          <div className="hidden lg:flex items-center gap-1 sm:gap-1.5 pl-1.5 sm:pl-2 border-l border-slate-200 dark:border-slate-800 shrink-0">
            {/* Botão Abrir */}
            <button
              onClick={handleOpenFile}
              title="Abrir arquivo Markdown local"
              className="px-2.5 sm:px-3 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0 cursor-pointer"
            >
              <FolderOpen className="w-4 h-4 text-blue-500" />
              <span className="hidden xl:inline">Abrir</span>
            </button>

            {/* Botão Recentes */}
            <button
              onClick={() => setIsRecentModalOpen(true)}
              title="Histórico de documentos recentes (até 30 em cache)"
              className="px-2.5 sm:px-3 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0 cursor-pointer"
            >
              <History className="w-4 h-4 text-amber-500" />
              <span className="hidden xl:inline">Recentes</span>
              {recentDocuments.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  {recentDocuments.length}
                </span>
              )}
            </button>

            {/* Botão Salvar e Dropdown Exportar (somente quando há documento) */}
            {hasDocument && (
              <>
                <button
                  onClick={handleSaveButtonClick}
                  title="Salvar alterações (Ctrl+S)"
                  className="px-2.5 sm:px-3 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0 cursor-pointer"
                >
                  <Save className="w-4 h-4 text-emerald-500" />
                  <span className="hidden xl:inline">Salvar</span>
                </button>

                <div className="relative shrink-0" ref={exportMenuRef}>
                  <button
                    onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                    title="Exportar documento (Markdown ou PDF)"
                    className={`px-2.5 sm:px-3 h-8 rounded-xl transition-colors flex items-center gap-1.5 text-xs font-medium shrink-0 cursor-pointer ${
                      isExportMenuOpen
                        ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    <Download className="w-4 h-4 text-purple-500" />
                    <span>Exportar</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isExportMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isExportMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-44 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-1.5 z-50 space-y-1 animate-in fade-in zoom-in-95">
                      <button
                        onClick={() => {
                          handleExportMD();
                          setIsExportMenuOpen(false);
                        }}
                        className="w-full px-2.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-purple-50 dark:hover:bg-purple-950/40 rounded-lg flex items-center gap-2.5 transition-colors group cursor-pointer"
                      >
                        <div className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-950/60 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0 group-hover:scale-105 transition-transform">
                          <Download className="w-3.5 h-3.5" />
                        </div>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">Markdown</span>
                      </button>

                      <button
                        onClick={() => {
                          handlePrint();
                          setIsExportMenuOpen(false);
                        }}
                        className="w-full px-2.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded-lg flex items-center gap-2.5 transition-colors group cursor-pointer"
                      >
                        <div className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-sky-950/60 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0 group-hover:scale-105 transition-transform">
                          <Printer className="w-3.5 h-3.5" />
                        </div>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">PDF</span>
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Aparência Menu */}
          <AppearanceMenu />

          {/* OneDrive Sync Button */}
          <button
            onClick={() => setIsOneDriveModalOpen(true)}
            className="px-2.5 sm:px-3 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0 cursor-pointer"
          >
            <Cloud className="w-4 h-4 text-blue-500" />
            <span className="hidden sm:inline">
              {userProfile ? userProfile.name.split(' ')[0] : 'OneDrive'}
            </span>

            {syncStatus === 'saving' && <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
            {syncStatus === 'saved' && <Check className="w-3.5 h-3.5 text-emerald-500" />}
            {syncStatus === 'offline-pending' && <WifiOff className="w-3.5 h-3.5 text-amber-500" />}
          </button>

          {/* Botão Instalar App (PWA) */}
          {!isStandalone && (
            <button
              onClick={() => setIsInstallModalOpen(true)}
              title="Instalar aplicativo no Windows ou iPad"
              className="px-2.5 sm:px-3 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/80 hover:bg-blue-100 dark:hover:bg-blue-900/60 flex items-center gap-1.5 text-xs font-semibold transition-all shrink-0 cursor-pointer shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Instalar App</span>
            </button>
          )}

          {/* Mobile Overflow Menu */}
          <div className="relative lg:hidden shrink-0" ref={mobileMenuRef}>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              title="Mais opções"
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                isMobileMenuOpen
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {isMobileMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-2 z-50 space-y-1 animate-in fade-in zoom-in-95">
                <button
                  onClick={() => {
                    handleNewFile();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2 cursor-pointer"
                >
                  <FilePlus className="w-4 h-4 text-purple-500" /> Novo
                </button>
                <button
                  onClick={() => {
                    handleOpenFile();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-blue-500" /> Abrir
                </button>
                <button
                  onClick={() => {
                    setIsRecentModalOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <History className="w-4 h-4 text-amber-500" /> Recentes
                  </span>
                  {recentDocuments.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                      {recentDocuments.length}
                    </span>
                  )}
                </button>

                {hasDocument && (
                  <>
                    <button
                      onClick={() => {
                        handleSaveButtonClick();
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2 cursor-pointer"
                    >
                      <Save className="w-4 h-4 text-emerald-500" /> Salvar
                    </button>

                    <div className="pt-1.5 border-t border-slate-100 dark:border-slate-700/60 mt-1 space-y-1">
                      <div className="px-2 py-0.5 text-[10px] font-bold uppercase text-slate-400 dark:text-slate-400 tracking-wider">
                        Exportar
                      </div>
                      <button
                        onClick={() => {
                          handleExportMD();
                          setIsMobileMenuOpen(false);
                        }}
                        className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2 cursor-pointer"
                      >
                        <Download className="w-4 h-4 text-purple-500" /> Markdown
                      </button>
                      <button
                        onClick={() => {
                          handlePrint();
                          setIsMobileMenuOpen(false);
                        }}
                        className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2 cursor-pointer"
                      >
                        <Printer className="w-4 h-4 text-sky-500" /> PDF
                      </button>
                    </div>
                  </>
                )}


                {!isStandalone && (
                  <div className="pt-1 mt-1 border-t border-slate-100 dark:border-slate-700">
                    <button
                      onClick={() => {
                        setIsInstallModalOpen(true);
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full p-2 text-left text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg flex items-center gap-2 cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-blue-500" /> Instalar Aplicativo
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LINHA 2: Barra Fina de Abas Estilo Navegador */}
      {tabs.length > 0 && (
        <div className="h-7 sm:h-8 bg-slate-50/80 dark:bg-slate-950/40 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center px-3 py-0.5">
          <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5 max-w-7xl mx-auto w-full">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const isEditing = editingTabId === tab.id;

              return (
                <div
                  key={tab.id}
                  onClick={() => {
                    if (!isEditing && !isActive) switchTab(tab.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (!isEditing) {
                      handleStartTabRename(tab);
                    }
                  }}
                  onContextMenu={(e) => handleOpenTabContextMenu(e, tab)}
                  className={`group relative h-6 sm:h-6.5 px-2 py-0.5 rounded-md flex items-center gap-1.5 transition-all select-none shrink-0 cursor-pointer ${
                    isActive || isEditing
                      ? 'bg-white dark:bg-slate-800 shadow-xs border border-slate-200/90 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 font-medium'
                  }`}
                  title={`${tab.title}${tab.isDirty ? ' (não salvo)' : ''} — Duplo clique para renomear`}
                >
                  {/* Dot indicador de alterações não salvas */}
                  {tab.isDirty && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 animate-pulse"
                      title="Alterações não salvas"
                    />
                  )}

                  {/* Nome da aba ou input inline de renomeação com expansão automática */}
                  {isEditing ? (
                    <div className="inline-grid items-center min-w-[110px] sm:min-w-[140px] max-w-[calc(100vw-4.5rem)] sm:max-w-[680px]">
                      <span
                        aria-hidden="true"
                        className="invisible col-start-1 row-start-1 whitespace-pre text-[11px] sm:text-xs font-semibold px-1.5 py-0 border border-transparent pointer-events-none select-none overflow-hidden"
                      >
                        {`${editingTitle || ' '}\u00A0\u00A0`}
                      </span>
                      <input
                        ref={tabRenameInputRef}
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={handleFinishTabRename}
                        onKeyDown={handleTabRenameKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        aria-label="Renomear arquivo"
                        className="col-start-1 row-start-1 w-full min-w-0 select-text text-[11px] sm:text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-blue-500 rounded px-1.5 py-0 outline-none shadow-xs"
                      />
                    </div>
                  ) : (
                    <span className="text-[11px] sm:text-xs truncate max-w-[120px] sm:max-w-[180px] md:max-w-[240px]">
                      {tab.title}
                    </span>
                  )}

                  {/* Botão Fechar Aba (X) com fechamento inteligente */}
                  <button
                    type="button"
                    onClick={(e) => handleCloseTabClick(e, tab)}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className="w-3.5 h-3.5 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                    title={tab.isDirty ? 'Fechar aba (alterações não salvas)' : 'Fechar aba'}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}

            {/* Botão + (Nova Aba) */}
            <button
              type="button"
              onClick={handleNewFile}
              title="Nova aba (novo arquivo em branco)"
              className="w-6 h-6 rounded flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-purple-600 dark:hover:text-purple-400 transition-colors shrink-0 cursor-pointer ml-0.5"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Menu de Contexto Flutuante para Abas (Clique Direito) */}
      {tabContextMenu && (
        <div
          ref={tabContextMenuRef}
          style={{ top: `${tabContextMenu.y}px`, left: `${tabContextMenu.x}px` }}
          className="fixed z-50 w-36 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-1 space-y-0.5 animate-in fade-in zoom-in-95 text-xs font-medium"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const tab = tabs.find((t) => t.id === tabContextMenu.tabId);
              setTabContextMenu(null);
              if (tab) handleStartTabRename(tab);
            }}
            className="w-full px-2 py-1.5 text-left rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5 text-slate-400" />
            Renomear
          </button>

          <button
            type="button"
            onClick={(e) => {
              const tab = tabs.find((t) => t.id === tabContextMenu.tabId);
              setTabContextMenu(null);
              if (tab) handleCloseTabClick(e, tab);
            }}
            className="w-full px-2 py-1.5 text-left rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2 text-red-600 dark:text-red-400 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Fechar aba
          </button>
        </div>
      )}

      {/* Modal de confirmação inteligente ao fechar documento/aba com alterações não salvas */}
      <UnsavedChangesModal
        isOpen={unsavedModalAction !== null}
        onClose={handleCancelGuard}
        onConfirmDiscard={handleConfirmDiscard}
        onConfirmSaveAndProceed={handleConfirmSaveAndProceed}
        documentTitle={
          (tabToCloseId && tabs.find((t) => t.id === tabToCloseId)?.title) ||
          activeTab?.title ||
          currentDoc.title
        }
        actionType={unsavedModalAction || 'close'}
        customActionTitle="Fechar Aba"
        customDescription="Esta aba possui alterações que ainda não foram salvas. O que você gostaria de fazer antes de fechar?"
      />

      {/* Modal de seleção de destino ao salvar documento sem fonte permanente */}
      <SaveDestinationModal
        isOpen={isSaveDestinationModalOpen}
        onClose={() => setIsSaveDestinationModalOpen(false)}
        documentTitle={activeTab?.title || currentDoc.title}
        onSaveToOneDrive={() => {
          setIsSaveDestinationModalOpen(false);
          setIsOneDriveModalOpen(true, 'save_as');
        }}
        onSaveToLocal={async () => {
          setIsSaveDestinationModalOpen(false);
          const res = await saveCoordinator.save({ interactive: true });
          if (res.status === 'ok') {
            showNotification(res.message || 'Arquivo salvo!');
          }
        }}
      />
    </header>
  );
};
