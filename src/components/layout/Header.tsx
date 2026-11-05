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
  Save,
  Download,
  Printer,
  MoreVertical,
  WifiOff,
  Settings,
} from 'lucide-react';
import { flushPendingEditorContent } from '../../services/editorContentBridge';
import { saveActiveDocument } from '../../services/documentSaveService';
import { SaveDestinationModal } from '../modals/SaveDestinationModal';
import { saveCoordinator } from '../../services/saveCoordinator';
import { TabItem } from '../../types';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { TabBar } from './TabBar';

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
    openHomeTab,
    switchTab,
    closeTab,
    fileHandle,
    isHighlightMode,
    toggleHighlightMode,
    isEditable,
    setIsEditable,
    highlightCount,
    syncStatus,
    setSyncStatus,
    setIsOneDriveModalOpen,
    isSaveDestinationModalOpen,
    setIsSaveDestinationModalOpen,
    cloudConflict,
    setSyncNotification,
    setIsInstallModalOpen,
    setIsSettingsModalOpen,
  } = useAppStore(
    useShallow((state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      openHomeTab: state.openHomeTab,
      switchTab: state.switchTab,
      closeTab: state.closeTab,
      fileHandle: state.fileHandle,
      isHighlightMode: state.isHighlightMode,
      toggleHighlightMode: state.toggleHighlightMode,
      isEditable: state.isEditable,
      setIsEditable: state.setIsEditable,
      highlightCount: state.highlightCount,
      syncStatus: state.syncStatus,
      setSyncStatus: state.setSyncStatus,
      setIsOneDriveModalOpen: state.setIsOneDriveModalOpen,
      isSaveDestinationModalOpen: state.isSaveDestinationModalOpen,
      setIsSaveDestinationModalOpen: state.setIsSaveDestinationModalOpen,
      cloudConflict: state.cloudConflict,
      setSyncNotification: state.setSyncNotification,
      setIsInstallModalOpen: state.setIsInstallModalOpen,
      setIsSettingsModalOpen: state.setIsSettingsModalOpen,
    }))
  );

  const { isStandalone } = usePwaInstall();

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

  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);



  // Guard action & tab closure confirmation state
  const [unsavedModalAction, setUnsavedModalAction] = useState<GuardActionType | null>(null);
  const [tabToCloseId, setTabToCloseId] = useState<string | null>(null);
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);

  // Fecha o menu [...] ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    if (isMoreMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMoreMenuOpen]);



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
        colorClass: 'text-rose-600 dark:text-rose-400 font-medium',
        badgeClass: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800',
        isClickable: false,
      };
    }

    if (syncStatus === 'error') {
      return {
        text: 'Erro — repetir',
        subtext: 'Falha ao salvar. Clique para tentar novamente.',
        dotClass: 'bg-red-500',
        colorClass: 'text-red-600 dark:text-red-400 font-medium hover:underline',
        badgeClass: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800',
        isClickable: true,
        action: () => handleSaveButtonClick(),
      };
    }

    if (syncStatus === 'offline-pending' || (!navigator.onLine && currentDoc.isDirty)) {
      return {
        text: 'Pendente (offline)',
        subtext: 'Salvo neste navegador; será enviado ao voltar online',
        dotClass: 'bg-amber-500/80',
        colorClass: 'text-amber-600/80 dark:text-amber-400/80 font-normal',
        badgeClass: '',
        isClickable: false,
      };
    }

    if (syncStatus === 'saving') {
      return {
        text: 'Salvando…',
        subtext: 'Gravando alterações',
        dotClass: 'bg-sky-400/80 dark:bg-sky-400/70 animate-pulse',
        colorClass: 'text-slate-400 dark:text-slate-500 font-normal',
        badgeClass: '',
        isClickable: false,
      };
    }

    const hasSource = Boolean(currentDoc.oneDriveItemId || fileHandle);
    const hasPendingChanges = hasSource ? currentDoc.isDirty : currentDoc.revision > currentDoc.draftRevision;

    if (hasPendingChanges) {
      return {
        text: 'Editando…',
        subtext: 'Alterações em andamento',
        dotClass: 'bg-amber-400/75 dark:bg-amber-400/60',
        colorClass: 'text-slate-400 dark:text-slate-500 font-normal',
        badgeClass: '',
        isClickable: false,
      };
    }

    if (currentDoc.oneDriveItemId) {
      const timeStr = currentDoc.lastSavedAt ? ` às ${currentDoc.lastSavedAt}` : '';
      return {
        text: 'Salvo no OneDrive',
        subtext: `Sincronizado na nuvem${timeStr}`,
        dotClass: 'bg-emerald-500/75 dark:bg-emerald-400/70',
        colorClass: 'text-slate-400 dark:text-slate-500 font-normal',
        badgeClass: '',
        isClickable: false,
      };
    }

    if (fileHandle) {
      const timeStr = currentDoc.lastSavedAt ? ` às ${currentDoc.lastSavedAt}` : '';
      return {
        text: 'Salvo no arquivo',
        subtext: `Arquivo local sincronizado${timeStr}`,
        dotClass: 'bg-emerald-500/75 dark:bg-emerald-400/70',
        colorClass: 'text-slate-400 dark:text-slate-500 font-normal',
        badgeClass: '',
        isClickable: false,
      };
    }

    return {
      text: 'Rascunho salvo',
      subtext: 'Armazenado automaticamente no cache deste navegador',
      dotClass: 'bg-slate-400/75 dark:bg-slate-500',
      colorClass: 'text-slate-400 dark:text-slate-500 font-normal',
      badgeClass: '',
      isClickable: false,
    };
  };

  const statusInfo = getUnifiedStatus();

  const showNotification = (msg: string, isError: boolean = false) => {
    setSyncNotification(isError ? `Erro: ${msg}` : msg);
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
      {/* LINHA 1: Status de salvamento (esquerda) e ações (direita) */}
      <div className="h-10 sm:h-11 px-2.5 sm:px-4 flex items-center justify-between gap-2 max-w-7xl mx-auto">
        {/* Esquerda: Status de salvamento visível e discreto */}
        <div className="flex items-center justify-start min-w-0 overflow-hidden">
          {hasDocument && (
            <div
              className="flex items-center gap-1.5 text-[11px] leading-tight select-none min-w-0 max-w-full transition-colors"
              title={statusInfo.subtext}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-300 ${statusInfo.dotClass}`} />
              {statusInfo.isClickable ? (
                <button
                  type="button"
                  onClick={statusInfo.action}
                  className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer truncate ${statusInfo.colorClass} ${statusInfo.badgeClass}`}
                  title={statusInfo.subtext}
                >
                  <span className="hidden sm:inline">{statusInfo.text}</span>
                </button>
              ) : (
                <span className={`hidden sm:inline truncate transition-colors duration-300 ${statusInfo.colorClass}`}>
                  {statusInfo.text}
                </span>
              )}
              {syncStatus === 'offline-pending' && <WifiOff className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
            </div>
          )}
        </div>

        {/* Direita: Grifar, Leitura | Edição, Aparência e menu [...] */}
        <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0 ml-auto">
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

          {/* Aparência Menu */}
          <AppearanceMenu />

          {/* Menu [...] */}
          <div className="relative shrink-0" ref={moreMenuRef}>
            <button
              onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
              title="Mais opções"
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                isMoreMenuOpen
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {isMoreMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-2 z-50 space-y-1 animate-in fade-in zoom-in-95">
                {hasDocument && (
                  <>
                    <button
                      onClick={() => {
                        handleSaveButtonClick();
                        setIsMoreMenuOpen(false);
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
                          setIsMoreMenuOpen(false);
                        }}
                        className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2 cursor-pointer"
                      >
                        <Download className="w-4 h-4 text-purple-500" /> Markdown
                      </button>
                      <button
                        onClick={() => {
                          handlePrint();
                          setIsMoreMenuOpen(false);
                        }}
                        className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2 cursor-pointer"
                      >
                        <Printer className="w-4 h-4 text-sky-500" /> PDF
                      </button>
                    </div>
                  </>
                )}

                <div className="pt-1 mt-1 border-t border-slate-100 dark:border-slate-700 space-y-1">
                  <button
                    onClick={() => {
                      setIsSettingsModalOpen(true);
                      setIsMoreMenuOpen(false);
                    }}
                    className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2 cursor-pointer"
                  >
                    <Settings className="w-4 h-4 text-slate-500" /> Configurações
                  </button>

                  {!isStandalone && (
                    <button
                      onClick={() => {
                        setIsInstallModalOpen(true);
                        setIsMoreMenuOpen(false);
                      }}
                      className="w-full p-2 text-left text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg flex items-center gap-2 cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-blue-500" /> Instalar Aplicativo
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LINHA 2: Barra de Abas com Suporte a Drag & Drop e Grupos */}
      {tabs.length > 0 && (
        <TabBar
          onRequestCloseTab={handleCloseTabClick}
          onNewTab={() => {
            openHomeTab();
          }}
        />
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
