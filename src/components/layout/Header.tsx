import React, { useRef, useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { AppearanceMenu } from './AppearanceMenu';
import { ConfirmNewModal } from '../modals/ConfirmNewModal';
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
} from 'lucide-react';

export const Header: React.FC = () => {
  const {
    document: currentDoc,
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
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editableTitle, setEditableTitle] = useState(currentDoc.title);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [isConfirmNewModalOpen, setIsConfirmNewModalOpen] = useState(false);

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

  // Start Blank File with Intelligent Confirmation & Save Option
  const handleNewFile = () => {
    const hasContent = Boolean(currentDoc.content && currentDoc.content.trim().length > 0);
    const isDirty = currentDoc.isDirty;

    if (isDirty || hasContent) {
      setIsConfirmNewModalOpen(true);
      return;
    }

    // Se já estiver completamente em branco, apenas executa createNewDocument
    createNewDocument();
  };

  const handleConfirmDiscardNew = () => {
    setIsConfirmNewModalOpen(false);
    createNewDocument();
    showNotification('Novo documento em branco');
  };

  const handleConfirmSaveAndNew = async () => {
    await handleSaveFile();
    setIsConfirmNewModalOpen(false);
    createNewDocument();
    showNotification('Salvo e novo documento criado');
  };

  // Native Open File with iPad/Mobile Fallback
  const handleOpenFile = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [
            {
              description: 'Arquivos Markdown',
              accept: { 'text/markdown': ['.md', '.txt'] },
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
  };

  // Fallback File Upload Event (Mobile / iPad)
  const handleFileUploadFallback = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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

  // Save File with iPad / Mobile Resilience
  const handleSaveFile = async () => {
    const contentToSave = currentDoc.content;

    try {
      if (fileHandle && typeof fileHandle.createWritable === 'function') {
        // Desktop direct file overwrite
        const writable = await fileHandle.createWritable();
        await writable.write(contentToSave);
        await writable.close();

        setDocument({ isDirty: false, lastSavedAt: new Date().toLocaleTimeString() });
        showNotification('Arquivo salvo!');
      } else if ('showSaveFilePicker' in window) {
        // Desktop Save As Picker
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: currentDoc.title || 'documento_grifado.md',
          types: [{ description: 'Arquivo Markdown', accept: { 'text/markdown': ['.md'] } }],
        });

        const writable = await handle.createWritable();
        await writable.write(contentToSave);
        await writable.close();

        const file = await handle.getFile();
        setFileHandle(handle);
        setDocument({
          title: file.name,
          isDirty: false,
          lastSavedAt: new Date().toLocaleTimeString(),
        });
        showNotification('Arquivo salvo!');
      } else {
        // iPad / Mobile Fallback: Triggers iOS "Save to Files" prompt
        downloadMarkdownFile(contentToSave, currentDoc.title || 'documento.md');
        setDocument({ isDirty: false, lastSavedAt: new Date().toLocaleTimeString() });
        showNotification('Salvo no dispositivo!');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        // Mobile fallback if picker fails or is restricted by iOS Safari
        downloadMarkdownFile(contentToSave, currentDoc.title || 'documento.md');
        setDocument({ isDirty: false, lastSavedAt: new Date().toLocaleTimeString() });
        showNotification('Salvo no dispositivo!');
      }
    }
  };

  // Show temporary toast message
  const showNotification = (msg: string) => {
    setSaveSuccessMessage(msg);
    setTimeout(() => {
      setSaveSuccessMessage(null);
    }, 3000);
  };

  // Export Standalone MD Copy
  const handleExportMD = () => {
    downloadMarkdownFile(currentDoc.content, currentDoc.title || 'documento.md');
  };

  // Print Clean Reader Page / Save as PDF
  const handlePrint = () => {
    printDocument(currentDoc.title || 'documento');
  };

  return (
    <header className="sticky top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 header-safe-area transition-colors print:hidden">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-4">
        {/* Left Section: Logo & Document Title */}
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

              {currentDoc.isDirty && (
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="Alterações não salvas" />
              )}
              {saveSuccessMessage && (
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full animate-in fade-in shrink-0">
                  ✓ {saveSuccessMessage}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:block truncate whitespace-nowrap">
              {fileHandle
                ? 'Arquivo local conectado (Salvar direto)'
                : currentDoc.oneDriveItemId
                ? 'Sincronizado via OneDrive'
                : 'Salvo em cache'}
            </p>
          </div>
        </div>

        {/* Center/Right Section: Actions Toolbar */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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

          {/* Desktop Actions: Abrir, Salvar, Exportar */}
          <div className="hidden lg:flex items-center gap-1 sm:gap-1.5 pl-1.5 sm:pl-2 border-l border-slate-200 dark:border-slate-800 shrink-0">
            {/* Input Fallback */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt"
              className="hidden"
              onChange={handleFileUploadFallback}
            />

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

            {/* Botão Salvar */}
            <button
              onClick={handleSaveFile}
              title="Salvar alterações substituindo o arquivo original (Ctrl+S)"
              className="px-2.5 sm:px-3 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0"
            >
              <Save className="w-4 h-4 text-emerald-500" />
              <span className="hidden xl:inline">Salvar</span>
            </button>

            {/* Dropdown Exportar */}
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
                <div className="absolute right-0 mt-2 w-44 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-1.5 z-40 space-y-1 animate-in fade-in">
                  <button
                    onClick={() => {
                      handleExportMD();
                      setIsExportMenuOpen(false);
                    }}
                    className="w-full px-2.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-purple-50 dark:hover:bg-purple-950/40 rounded-lg flex items-center gap-2.5 transition-colors group"
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
                    className="w-full px-2.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded-lg flex items-center gap-2.5 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-sky-950/60 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0 group-hover:scale-105 transition-transform">
                      <Printer className="w-3.5 h-3.5" />
                    </div>
                    <span className="font-semibold text-slate-800 dark:text-slate-100">PDF</span>
                  </button>
                </div>
              )}
            </div>
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
          <div className="relative lg:hidden shrink-0 flex items-center" ref={mobileMenuRef}>
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
              <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-2 z-40 space-y-1 animate-in fade-in">
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
                    handleSaveFile();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full p-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2"
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
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmNewModal
        isOpen={isConfirmNewModalOpen}
        onClose={() => setIsConfirmNewModalOpen(false)}
        onConfirmDiscard={handleConfirmDiscardNew}
        onConfirmSaveAndNew={handleConfirmSaveAndNew}
        isDirty={currentDoc.isDirty}
        documentTitle={currentDoc.title}
      />
    </header>
  );
};

