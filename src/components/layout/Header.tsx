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
  Settings,
  FilePlus,
  Pencil,
  RotateCw,
  History,
  X,
  Trash2,
} from 'lucide-react';
import { forceAppUpdate } from '../../services/appUpdateService';
import { flushPendingEditorContent } from '../../services/editorContentBridge';
import { saveActiveDocument } from '../../services/documentSaveService';
import { CloseDraftModal } from '../modals/CloseDraftModal';
import { CloseErrorConflictModal } from '../modals/CloseErrorConflictModal';
import { SaveDestinationModal } from '../modals/SaveDestinationModal';
import { isBlankUntitledDocument } from '../../services/documentUtils';
import { saveCoordinator } from '../../services/saveCoordinator';

export const Header: React.FC = () => {
  const hasDocument = useAppStore((state) => Boolean(state.document));

  // Seletor de metadados: NÃO re-renderiza quando o conteúdo Markdown do texto é alterado
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
    setDocument,
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
    setIsSettingsModalOpen,
    createNewDocument,
    closeDocument,
    recentDocuments,
    setIsRecentModalOpen,
    isSaveDestinationModalOpen,
    setIsSaveDestinationModalOpen,
    cloudConflict,
  } = useAppStore(
    useShallow((state) => ({
      setDocument: state.setDocument,
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
      setIsSettingsModalOpen: state.setIsSettingsModalOpen,
      createNewDocument: state.createNewDocument,
      closeDocument: state.closeDocument,
      recentDocuments: state.recentDocuments,
      setIsRecentModalOpen: state.setIsRecentModalOpen,
      isSaveDestinationModalOpen: state.isSaveDestinationModalOpen,
      setIsSaveDestinationModalOpen: state.setIsSaveDestinationModalOpen,
      cloudConflict: state.cloudConflict,
    }))
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [isCloseMenuOpen, setIsCloseMenuOpen] = useState(false);
  const closeMenuRef = useRef<HTMLDivElement>(null);
  const [isCloseDraftModalOpen, setIsCloseDraftModalOpen] = useState(false);
  const [closeErrorConflict, setCloseErrorConflict] = useState<{ message: string } | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editableTitle, setEditableTitle] = useState(currentDoc.title);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [unsavedModalAction, setUnsavedModalAction] = useState<GuardActionType | null>(null);
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);

  // Close Export, Mobile & Close Dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setIsMobileMenuOpen(false);
      }
      if (closeMenuRef.current && !closeMenuRef.current.contains(event.target as Node)) {
        setIsCloseMenuOpen(false);
      }
    };
    if (isExportMenuOpen || isMobileMenuOpen || isCloseMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExportMenuOpen, isMobileMenuOpen, isCloseMenuOpen]);

  // Sync editable title when document changes
  useEffect(() => {
    setEditableTitle(currentDoc.title);
  }, [currentDoc.title]);

  const handleStartRename = () => {
    setIsEditingTitle(true);
    setEditableTitle(currentDoc.title);
    setTimeout(() => {
      if (titleInputRef.current) {
        titleInputRef.current.focus();
        // Select filename without .md extension
        const dotIndex = currentDoc.title.lastIndexOf('.');
        if (dotIndex > 0) {
          titleInputRef.current.setSelectionRange(0, dotIndex);
        } else {
          titleInputRef.current.select();
        }
      }
    }, 20);
  };

  const handleFinishRename = () => {
    setIsEditingTitle(false);
    let finalTitle = editableTitle.trim();
    if (!finalTitle) {
      finalTitle = currentDoc.title || 'Sem Título.md';
    } else if (
      !finalTitle.toLowerCase().endsWith('.md') &&
      !finalTitle.toLowerCase().endsWith('.markdown') &&
      !finalTitle.toLowerCase().endsWith('.txt')
    ) {
      finalTitle = `${finalTitle}.md`;
    }

    if (finalTitle !== currentDoc.title) {
      if (fileHandle && fileHandle.name !== finalTitle) {
        setFileHandle(null);
      }
      setDocument({
        title: finalTitle,
        isDirty: true,
      });
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleFinishRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditableTitle(currentDoc.title);
      setIsEditingTitle(false);
    }
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

  // Helper to guard actions against unsaved data loss
  const executeWithGuard = (actionType: GuardActionType, callback: () => void | Promise<void>) => {
    if (currentDoc.isDirty) {
      pendingActionRef.current = callback;
      setUnsavedModalAction(actionType);
    } else {
      callback();
    }
  };

  const handleConfirmDiscard = () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setUnsavedModalAction(null);
    action?.();
  };

  const handleConfirmSaveAndProceed = async () => {
    const saved = await handleSaveFile();
    if (!saved) {
      // Cancelou ou falhou: permanece no documento atual, sem perder alterações
      pendingActionRef.current = null;
      setUnsavedModalAction(null);
      return;
    }
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setUnsavedModalAction(null);
    action?.();
  };

  const handleCancelGuard = () => {
    pendingActionRef.current = null;
    setUnsavedModalAction(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Fluxo Salvar e Fechar (Fase 4 - Seção 3.2)
  const handleSaveAndClose = async () => {
    const state = useAppStore.getState();
    const doc = state.document;
    if (!doc) {
      closeDocument();
      return;
    }

    // 1. Documento efêmero e vazio? Fecha silenciosamente sem perguntar
    if (isBlankUntitledDocument(doc) && (!doc.content || doc.content.trim() === '')) {
      closeDocument();
      return;
    }

    // 2. Flush do editor + rascunho local
    flushPendingEditorContent();
    const freshDoc = useAppStore.getState().document;
    if (!freshDoc) {
      closeDocument();
      return;
    }

    // 3. Tem fonte gravável?
    const hasSource = Boolean(freshDoc.oneDriveItemId || fileHandle || freshDoc.fileHandle);

    if (hasSource) {
      // saveCoordinator.save (estrito)
      const result = await saveCoordinator.save({ interactive: false });
      if (result.status === 'ok') {
        closeDocument();
        showNotification('Documento salvo e fechado');
      } else {
        // Falha / offline / conflito
        setCloseErrorConflict({
          message: result.message || 'Falha de conexão ou erro no servidor',
        });
      }
    } else {
      // Rascunho (só cache): pergunta onde salvar ou fechar como rascunho
      setIsCloseDraftModalOpen(true);
    }
  };

  // Fechar sem salvar
  const handleCloseWithoutSaving = () => {
    const doc = useAppStore.getState().document;
    if (!doc) {
      closeDocument();
      return;
    }

    if (isBlankUntitledDocument(doc) && (!doc.content || doc.content.trim() === '')) {
      closeDocument();
      return;
    }

    if (doc.isDirty) {
      pendingActionRef.current = () => {
        closeDocument();
      };
      setUnsavedModalAction('close');
    } else {
      closeDocument();
    }
  };

  // Start Blank File with Intelligent Confirmation & Save Option
  const handleNewFile = () => {
    flushPendingEditorContent();
    const activeDoc = useAppStore.getState().document;
    if (!activeDoc) {
      createNewDocument();
      showNotification('Novo documento em branco');
      return;
    }

    const hasContent = Boolean(activeDoc.content && activeDoc.content.trim().length > 0);
    const isDirty = activeDoc.isDirty;

    if (isDirty || hasContent) {
      pendingActionRef.current = () => {
        createNewDocument();
        showNotification('Novo documento em branco');
      };
      setUnsavedModalAction('new');
      return;
    }

    createNewDocument();
  };

  // Native Open File with iPad/Mobile Fallback and Unsaved Guard
  const handleOpenFile = () => {
    executeWithGuard('open_local', async () => {
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
        } else {
          // iPad / Mobile Fallback: Uses native Files app picker
          fileInputRef.current?.click();
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          fileInputRef.current?.click();
        }
      }
    });
  };

  // Fallback File Upload Event (Mobile / iPad) with Unsaved Guard
  const handleFileUploadFallback = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const performLoad = () => {
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
        }
      };
      reader.readAsText(file);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };

    executeWithGuard('open_local', performLoad);
  };

  // Salvar: OneDrive → arquivo local conectado → "Salvar como"/download. Retorna true só se salvou de fato.
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

  // Clique no botão Salvar ou atalho: se o documento não tem fonte, abre o menu de destino (Seção 3.4)
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

  // Indicador de status único (Fase 5 - Seção 3.3)
  // Editando… · Rascunho salvo neste navegador · Salvando… · Salvo no OneDrive às 09:12 · Salvo no arquivo às 09:12 · Pendente (offline) · Conflito · Erro — tentar novamente
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
      text: 'Rascunho salvo neste navegador',
      subtext: 'Armazenado no cache local',
      dotClass: 'bg-slate-400 dark:bg-slate-500',
      colorClass: 'text-slate-400 dark:text-slate-500',
      badgeClass: '',
      isClickable: false,
    };
  };

  const statusInfo = getUnifiedStatus();

  // Show temporary toast message
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

  // Export Standalone MD Copy
  const handleExportMD = () => {
    flushPendingEditorContent();
    const freshDoc = useAppStore.getState().document;
    if (!freshDoc) return;
    downloadMarkdownFile(freshDoc.content, freshDoc.title || 'documento.md');
  };

  // Print Clean Reader Page / Save as PDF
  const handlePrint = () => {
    flushPendingEditorContent();
    const freshDoc = useAppStore.getState().document;
    if (!freshDoc) return;
    printDocument(freshDoc.title || 'documento');
  };

  return (
    <header className="sticky top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 header-safe-area transition-colors print:hidden">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-4">
        {/* Left Section: Logo & Document Title / Brand */}
        {!hasDocument ? (
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-md shrink-0">
              <Highlighter className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-sm sm:text-base font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">
                Leitor & Editor Markdown
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 max-w-full">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-md shrink-0">
              <Highlighter className="w-5 h-5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={editableTitle}
                    onChange={(e) => setEditableTitle(e.target.value)}
                    onBlur={handleFinishRename}
                    onKeyDown={handleTitleKeyDown}
                    className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-blue-500 rounded px-1.5 py-0.5 -mx-1.5 outline-none ring-2 ring-blue-500/20 w-full min-w-0 max-w-[140px] sm:max-w-[240px] md:max-w-[320px] lg:max-w-[380px] xl:max-w-[480px] shadow-sm"
                    title="Pressione Enter para salvar ou Esc para cancelar"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={handleStartRename}
                    className="group flex items-center gap-1.5 text-left text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80 px-1.5 py-0.5 -mx-1.5 rounded transition-all cursor-pointer min-w-0 max-w-[140px] sm:max-w-[240px] md:max-w-[320px] lg:max-w-[380px] xl:max-w-[480px]"
                    title="Clique para renomear o arquivo"
                  >
                    <span className="truncate">{currentDoc.title}</span>
                    <Pencil className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                )}

                {/* Botão Fechar com Menu Dropdown (Fase 4 - Seção 3.3) */}
                <div className="relative shrink-0 ml-0.5" ref={closeMenuRef}>
                  <div className="flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700/80 transition-colors">
                    <button
                      type="button"
                      onClick={handleSaveAndClose}
                      className="p-1 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-l-lg transition-colors cursor-pointer"
                      title="Salvar e Fechar (Padrão)"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCloseMenuOpen(!isCloseMenuOpen)}
                      className="px-0.5 py-1 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-r-lg border-l border-slate-200 dark:border-slate-700/80 transition-colors cursor-pointer"
                      title="Opções de fechamento"
                    >
                      <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isCloseMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {isCloseMenuOpen && (
                    <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-1.5 z-50 space-y-1 animate-in fade-in zoom-in-95">
                      <button
                        type="button"
                        onClick={() => {
                          setIsCloseMenuOpen(false);
                          handleSaveAndClose();
                        }}
                        className="w-full px-2.5 py-2 text-left text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg flex items-center justify-between transition-colors group cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <Save className="w-3.5 h-3.5 text-blue-500" />
                          Salvar e Fechar
                        </span>
                        <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold bg-blue-100 dark:bg-blue-950/60 px-1.5 py-0.5 rounded-full">
                          Padrão
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsCloseMenuOpen(false);
                          handleCloseWithoutSaving();
                        }}
                        className="w-full px-2.5 py-2 text-left text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg flex items-center gap-2 transition-colors text-red-600 dark:text-red-400 group cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        Fechar sem salvar
                      </button>
                    </div>
                  )}
                </div>

                {saveSuccessMessage && (
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full animate-in fade-in shrink-0">
                    ✓ {saveSuccessMessage}
                  </span>
                )}
                {saveErrorMessage && (
                  <span className="text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 px-2 py-0.5 rounded-full animate-in fade-in truncate max-w-[260px]" title={saveErrorMessage}>
                    ⚠ {saveErrorMessage}
                  </span>
                )}
              </div>

              {/* Indicador de status único (Fase 5 - Seção 3.3) */}
              <div className="flex items-center gap-1.5 text-[11px] leading-tight mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusInfo.dotClass}`} />
                {statusInfo.isClickable ? (
                  <button
                    type="button"
                    onClick={statusInfo.action}
                    className={`px-1.5 py-0.2 rounded border transition-colors ${statusInfo.colorClass} ${statusInfo.badgeClass}`}
                    title="Clique para tentar salvar novamente"
                  >
                    {statusInfo.text}
                  </button>
                ) : (
                  <span className={`truncate ${statusInfo.colorClass}`} title={statusInfo.subtext}>
                    {statusInfo.text}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Center/Right Section: Actions Toolbar */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Ações específicas quando há documento aberto */}
          {hasDocument && (
            <>
              {/* Modo Grifar (Toggle Button + Badge) */}
              <button
                onClick={toggleHighlightMode}
                className={`px-2.5 sm:px-3 h-8 rounded-xl font-medium text-xs flex items-center gap-1.5 transition-all shrink-0 ${
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
                  className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs transition-all duration-200 ${
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
                  className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs transition-all duration-200 ${
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

          {/* Desktop Actions: Novo, Abrir, Recentes */}
          <div className="hidden lg:flex items-center gap-1 sm:gap-1.5 pl-1.5 sm:pl-2 border-l border-slate-200 dark:border-slate-800 shrink-0">
            {/* Botão Novo */}
            <button
              onClick={handleNewFile}
              title="Iniciar novo arquivo em branco"
              className="px-2.5 sm:px-3 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0"
            >
              <FilePlus className="w-4 h-4 text-purple-500" />
              <span className="hidden xl:inline">Novo</span>
            </button>

            {/* Botão Abrir */}
            <button
              onClick={handleOpenFile}
              title="Abrir arquivo Markdown local"
              className="px-2.5 sm:px-3 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0"
            >
              <FolderOpen className="w-4 h-4 text-blue-500" />
              <span className="hidden xl:inline">Abrir</span>
            </button>

            {/* Botão Recentes */}
            <button
              onClick={() => setIsRecentModalOpen(true)}
              title="Histórico de documentos recentes (até 30 em cache)"
              className="px-2.5 sm:px-3 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0"
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
                    className={`px-2.5 sm:px-3 h-8 rounded-xl transition-colors flex items-center gap-1.5 text-xs font-medium shrink-0 ${
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
            className="px-2.5 sm:px-3 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0"
          >
            <Cloud className="w-4 h-4 text-blue-500" />
            <span className="hidden sm:inline">
              {userProfile ? userProfile.name.split(' ')[0] : 'OneDrive'}
            </span>

            {/* Sync status indicator badge */}
            {syncStatus === 'saving' && <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
            {syncStatus === 'saved' && <Check className="w-3.5 h-3.5 text-emerald-500" />}
            {syncStatus === 'offline-pending' && <WifiOff className="w-3.5 h-3.5 text-amber-500" />}
          </button>

          {/* Mobile Overflow Menu */}
          <div className="relative lg:hidden shrink-0" ref={mobileMenuRef}>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              title="Mais opções"
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors shrink-0 ${
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
                  className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2"
                >
                  <FilePlus className="w-4 h-4 text-purple-500" /> Novo
                </button>
                <button
                  onClick={() => {
                    handleOpenFile();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2"
                >
                  <FolderOpen className="w-4 h-4 text-blue-500" /> Abrir
                </button>
                <button
                  onClick={() => {
                    setIsRecentModalOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center justify-between"
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
                        Fechar Documento
                      </div>
                      <button
                        onClick={() => {
                          setIsMobileMenuOpen(false);
                          handleSaveAndClose();
                        }}
                        className="w-full p-2 text-left text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg flex items-center gap-2 font-semibold"
                      >
                        <Save className="w-4 h-4" /> Salvar e Fechar
                      </button>
                      <button
                        onClick={() => {
                          setIsMobileMenuOpen(false);
                          handleCloseWithoutSaving();
                        }}
                        className="w-full p-2 text-left text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg flex items-center gap-2"
                      >
                        <X className="w-4 h-4" /> Fechar sem salvar
                      </button>
                    </div>

                    <div className="pt-1.5 border-t border-slate-100 dark:border-slate-700/60 mt-1 space-y-1">
                      <div className="px-2 py-0.5 text-[10px] font-bold uppercase text-slate-400 dark:text-slate-400 tracking-wider">
                        Exportar
                      </div>
                      <button
                        onClick={() => {
                          handleExportMD();
                          setIsMobileMenuOpen(false);
                        }}
                        className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2"
                      >
                        <Download className="w-4 h-4 text-purple-500" /> Markdown
                      </button>
                      <button
                        onClick={() => {
                          handlePrint();
                          setIsMobileMenuOpen(false);
                        }}
                        className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2"
                      >
                        <Printer className="w-4 h-4 text-sky-500" /> PDF
                      </button>
                    </div>
                  </>
                )}

                <div className="pt-1.5 border-t border-slate-100 dark:border-slate-700/60 mt-1">
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      forceAppUpdate();
                    }}
                    className="w-full p-2 text-left text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2"
                  >
                    <RotateCw className="w-4 h-4 text-blue-500" /> Recarregar App
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de confirmação de descarte de alterações */}
      <UnsavedChangesModal
        isOpen={unsavedModalAction !== null}
        onClose={handleCancelGuard}
        onConfirmDiscard={handleConfirmDiscard}
        onConfirmSaveAndProceed={handleConfirmSaveAndProceed}
        documentTitle={currentDoc.title}
        actionType={unsavedModalAction || 'new'}
      />

      {/* Modal de seleção de destino ao salvar documento sem fonte permanente (Seção 3.4) */}
      <SaveDestinationModal
        isOpen={isSaveDestinationModalOpen}
        onClose={() => setIsSaveDestinationModalOpen(false)}
        documentTitle={currentDoc.title}
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

      {/* Modal de fechamento de rascunho sem fonte permanente (Fase 4 - Seção 3.2) */}
      <CloseDraftModal
        isOpen={isCloseDraftModalOpen}
        onClose={() => setIsCloseDraftModalOpen(false)}
        documentTitle={currentDoc.title}
        onSaveToOneDrive={() => {
          setIsCloseDraftModalOpen(false);
          setIsOneDriveModalOpen(true, 'save_as', 'close');
        }}
        onSaveToLocal={async () => {
          setIsCloseDraftModalOpen(false);
          const res = await saveCoordinator.save({ interactive: true });
          if (res.status === 'ok') {
            closeDocument();
            showNotification('Documento salvo e fechado');
          }
        }}
        onKeepAsDraft={async () => {
          setIsCloseDraftModalOpen(false);
          await saveCoordinator.saveDraft();
          closeDocument();
          showNotification('Rascunho mantido no histórico');
        }}
      />

      {/* Modal de erro/conflito ao fechar (Fase 4 - Seção 3.2) */}
      <CloseErrorConflictModal
        isOpen={closeErrorConflict !== null}
        message={closeErrorConflict?.message || ''}
        onRetry={() => {
          setCloseErrorConflict(null);
          handleSaveAndClose();
        }}
        onCloseAndKeepPending={async () => {
          setCloseErrorConflict(null);
          await saveCoordinator.saveDraft();
          closeDocument();
          showNotification('Rascunho mantido pendente para envio');
        }}
        onCancel={() => {
          setCloseErrorConflict(null);
        }}
      />
    </header>
  );
};

