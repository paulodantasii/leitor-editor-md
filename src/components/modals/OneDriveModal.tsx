import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { loginWithOneDrive, logoutOneDrive, getActiveAccount } from '../../services/msalService';
import {
  listOneDriveItems,
  downloadOneDriveFile,
  createOneDriveFile,
  computeNextAvailableFileName,
  normalizeMarkdownFileName,
} from '../../services/oneDriveService';
import { saveActiveDocument } from '../../services/documentSaveService';
import { saveRecentDocument, deleteRecentDocument } from '../../services/recentDocumentsService';
import { OneDriveItem, DocumentState } from '../../types';
import { UnsavedChangesModal } from './UnsavedChangesModal';
import {
  X,
  Cloud,
  Folder,
  FileCode,
  LogIn,
  LogOut,
  RefreshCw,
  UploadCloud,
  ChevronRight,
  Settings,
  Save,
  AlertCircle,
} from 'lucide-react';

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
    document: currentDoc,
    setDocument,
    openTab,
    setSyncStatus,
    setSyncNotification,
    setIsSettingsModalOpen,
    setFileHandle,
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
      document: state.document,
      setDocument: state.setDocument,
      openTab: state.openTab,
      setSyncStatus: state.setSyncStatus,
      setSyncNotification: state.setSyncNotification,
      setIsSettingsModalOpen: state.setIsSettingsModalOpen,
      setFileHandle: state.setFileHandle,
    }))
  );

  const [items, setItems] = useState<OneDriveItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [folderHistory, setFolderHistory] = useState<Array<{ id?: string; name: string }>>([
    { name: 'OneDrive' },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingFileToOpen, setPendingFileToOpen] = useState<OneDriveItem | null>(null);
  const [isUnsavedGuardOpen, setIsUnsavedGuardOpen] = useState(false);
  const [saveFileName, setSaveFileName] = useState('');

  // Check active MSAL session
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

  // Sync initial file name when modal opens in save_as mode
  useEffect(() => {
    if (isOneDriveModalOpen) {
      if (oneDriveModalMode === 'save_as') {
        setSaveFileName(currentDoc?.title || 'Sem Título.md');
      }
      setErrorMsg(null);
    }
  }, [isOneDriveModalOpen, oneDriveModalMode, currentDoc?.title]);

  // Fetch items from OneDrive
  const loadFolder = useCallback(async (folderId?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
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
    if (isOneDriveModalOpen && userProfile) {
      loadFolder(currentFolderId);
    }
  }, [isOneDriveModalOpen, userProfile, currentFolderId, loadFolder]);

  // Name collision computation for Save As mode preview
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

  const handleLogout = async () => {
    await logoutOneDrive();
    setUserProfile(null);
    setItems([]);
  };

  const handleOpenFolder = (folder: OneDriveItem) => {
    setCurrentFolderId(folder.id);
    setFolderHistory((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleNavigateBreadcrumb = (index: number) => {
    const target = folderHistory[index];
    setFolderHistory(folderHistory.slice(0, index + 1));
    setCurrentFolderId(target.id);
  };

  const doOpenFile = async (file: OneDriveItem) => {
    setIsLoading(true);
    try {
      const rawText = await downloadOneDriveFile(file.id);

      openTab({
        title: file.name,
        content: rawText,
        oneDriveItemId: file.id,
        lastSavedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isDirty: false,
        cloudLastModified: file.lastModifiedDateTime,
        cloudETag: file.eTag || null,
        docId: `onedrive:${file.id}`,
      }, null);

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

      // Limpa rascunho anterior do histórico de recentes se era rascunho
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

      // Grava no histórico de recentes
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

  const isSaveAs = oneDriveModalMode === 'save_as';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
          <div className="flex items-center gap-2">
            <Cloud className="w-6 h-6 text-sky-500" />
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100">
                {isSaveAs ? 'Salvar como no OneDrive' : 'Sincronização OneDrive'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isSaveAs
                  ? 'Escolha a pasta de destino e confirme o nome do arquivo'
                  : 'Navegue pelas pastas e abra ou sincronize seus documentos'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setIsOneDriveModalOpen(false);
                setIsSettingsModalOpen(true);
              }}
              title="Configurar Client ID Azure"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={() => setIsOneDriveModalOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* User Account / Login Bar */}
        <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl flex items-center justify-between">
          {userProfile ? (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-sky-600 text-white font-bold flex items-center justify-center text-sm shadow-sm">
                {userProfile.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-tight">
                  {userProfile.name}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{userProfile.email}</p>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Conecte sua conta Microsoft para acessar e salvar documentos na nuvem.
            </div>
          )}

          {userProfile ? (
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> Sair
            </button>
          ) : (
            <button
              onClick={handleLogin}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <LogIn className="w-4 h-4" /> Conectar OneDrive
            </button>
          )}
        </div>

        {/* Error Notification */}
        {errorMsg && (
          <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl p-3 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {errorMsg}
            </span>
            <button
              onClick={() => {
                setIsOneDriveModalOpen(false);
                setIsSettingsModalOpen(true);
              }}
              className="font-semibold underline ml-2 shrink-0 cursor-pointer"
            >
              Configurar Chave
            </button>
          </div>
        )}

        {/* Cloud Explorer / File Selector */}
        {userProfile && (
          <div className="flex-1 overflow-hidden flex flex-col border border-slate-200 dark:border-slate-700 rounded-xl min-h-[220px]">
            {/* Breadcrumb Navigation */}
            <div className="bg-slate-100 dark:bg-slate-700/50 px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 overflow-x-auto">
              {folderHistory.map((folder, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
                  <button
                    onClick={() => handleNavigateBreadcrumb(idx)}
                    className="hover:text-sky-600 dark:hover:text-sky-400 truncate max-w-[120px] cursor-pointer"
                  >
                    {folder.name}
                  </button>
                </React.Fragment>
              ))}
              <button
                onClick={() => loadFolder(currentFolderId)}
                title="Atualizar pasta"
                className="ml-auto p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* File List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoading && items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-44 text-slate-400 gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-sky-500" />
                  <span className="text-xs">Carregando itens do OneDrive...</span>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-44 text-slate-400 text-xs">
                  {isSaveAs
                    ? 'Esta pasta está vazia. Você pode salvar seu arquivo diretamente aqui.'
                    : 'Nenhum arquivo .md / .txt encontrado nesta pasta.'}
                </div>
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between p-2.5 rounded-lg transition-colors group cursor-pointer ${
                      isSaveAs && !item.folder && saveFileName.toLowerCase() === item.name.toLowerCase()
                        ? 'bg-sky-50 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-800'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-700/60'
                    }`}
                    onClick={() => (item.folder ? handleOpenFolder(item) : handleOpenFile(item))}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {item.folder ? (
                        <Folder className="w-5 h-5 text-amber-500 shrink-0" />
                      ) : (
                        <FileCode className="w-5 h-5 text-sky-500 shrink-0" />
                      )}
                      <div className="truncate">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate group-hover:text-sky-600 dark:group-hover:text-sky-400">
                          {item.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {item.folder
                            ? `${item.folder.childCount || 0} itens`
                            : item.size
                            ? `${Math.round(item.size / 1024)} KB`
                            : 'Arquivo Markdown'}
                        </p>
                      </div>
                    </div>

                    {!item.folder && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFile(item);
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          isSaveAs
                            ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-900/50 dark:hover:text-sky-300'
                            : 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 hover:bg-sky-600 hover:text-white'
                        }`}
                      >
                        {isSaveAs ? 'Usar nome' : 'Abrir'}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Save As File Name Input Card */}
        {isSaveAs && userProfile && (
          <div className="bg-slate-50 dark:bg-slate-900/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <label htmlFor="onedrive-filename-input">Nome do arquivo:</label>
              {isNameCollision ? (
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-normal truncate max-w-[320px]">
                  Arquivo existente nesta pasta. Será salvo como: <b>{previewResolvedName}</b>
                </span>
              ) : (
                previewResolvedName && previewResolvedName !== saveFileName && (
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
              className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-800 dark:text-slate-100"
            />
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2">
          {isSaveAs ? (
            <>
              <button
                type="button"
                onClick={() => setIsOneDriveModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              {userProfile && (
                <button
                  type="button"
                  onClick={handleSaveAsConfirm}
                  disabled={isLoading || !saveFileName.trim()}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white shadow-sm flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Save className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                  {isLoading ? 'Salvando...' : 'Salvar Aqui'}
                </button>
              )}
            </>
          ) : (
            <>
              {currentDoc?.oneDriveItemId && userProfile ? (
                <button
                  onClick={handleSaveCurrentToCloud}
                  disabled={isLoading}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <UploadCloud className="w-4 h-4" /> Sobrescrever na Nuvem
                </button>
              ) : (
                <span />
              )}

              <button
                onClick={() => setIsOneDriveModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                Fechar
              </button>
            </>
          )}
        </div>

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
