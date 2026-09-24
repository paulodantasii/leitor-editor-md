import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { loginWithOneDrive, logoutOneDrive, getActiveAccount } from '../../services/msalService';
import { listOneDriveItems, downloadOneDriveFile, saveOneDriveFile } from '../../services/oneDriveService';
import { OneDriveItem } from '../../types';
import { UnsavedChangesModal } from './UnsavedChangesModal';
import { X, Cloud, Folder, FileCode, LogIn, LogOut, RefreshCw, UploadCloud, ChevronRight, Settings } from 'lucide-react';

export const OneDriveModal: React.FC = () => {
  const {
    isOneDriveModalOpen,
    setIsOneDriveModalOpen,
    userProfile,
    setUserProfile,
    document: currentDoc,
    setDocument,
    setSyncStatus,
    setIsSettingsModalOpen,
  } = useAppStore();

  const [items, setItems] = useState<OneDriveItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [folderHistory, setFolderHistory] = useState<Array<{ id?: string; name: string }>>([
    { name: 'OneDrive' },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingFileToOpen, setPendingFileToOpen] = useState<OneDriveItem | null>(null);
  const [isUnsavedGuardOpen, setIsUnsavedGuardOpen] = useState(false);

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

      setDocument({
        title: file.name,
        content: rawText,
        oneDriveItemId: file.id,
        lastSavedAt: new Date().toLocaleTimeString(),
        isDirty: false,
        cloudLastModified: file.lastModifiedDateTime,
      });

      setSyncStatus('saved');
      setIsOneDriveModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao abrir arquivo do OneDrive.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenFile = (file: OneDriveItem) => {
    if (currentDoc.isDirty) {
      setPendingFileToOpen(file);
      setIsUnsavedGuardOpen(true);
    } else {
      doOpenFile(file);
    }
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
    try {
      if (currentDoc.oneDriveItemId) {
        await saveOneDriveFile(currentDoc.oneDriveItemId, currentDoc.content);
      }
      setDocument({ isDirty: false, lastSavedAt: new Date().toLocaleTimeString() });
    } catch (err) {
      console.warn('Erro ao salvar documento atual antes de trocar de arquivo:', err);
    }

    const file = pendingFileToOpen;
    setPendingFileToOpen(null);
    setIsUnsavedGuardOpen(false);
    if (file) {
      doOpenFile(file);
    }
  };

  const handleSaveCurrentToCloud = async () => {
    if (!currentDoc.oneDriveItemId) {
      setErrorMsg('Este documento ainda não foi associado a um arquivo do OneDrive. Selecione um arquivo para sobrescrever.');
      return;
    }

    setIsLoading(true);
    setSyncStatus('saving');
    try {
      await saveOneDriveFile(currentDoc.oneDriveItemId, currentDoc.content);
      setSyncStatus('saved');
      setDocument({ isDirty: false, lastSavedAt: new Date().toLocaleTimeString() });
      setIsOneDriveModalOpen(false);
    } catch (err: any) {
      setSyncStatus('error');
      setErrorMsg(err.message || 'Erro ao salvar documento no OneDrive.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
          <div className="flex items-center gap-2">
            <Cloud className="w-6 h-6 text-blue-500" />
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              Sincronização OneDrive
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setIsOneDriveModalOpen(false);
                setIsSettingsModalOpen(true);
              }}
              title="Configurar Client ID Azure"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={() => setIsOneDriveModalOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* User Account / Login Bar */}
        <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl flex items-center justify-between">
          {userProfile ? (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm shadow-sm">
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
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 flex items-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" /> Sair
            </button>
          ) : (
            <button
              onClick={handleLogin}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm flex items-center gap-1.5 transition-all"
            >
              <LogIn className="w-4 h-4" /> Conectar OneDrive
            </button>
          )}
        </div>

        {/* Error Notification */}
        {errorMsg && (
          <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl p-3 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{errorMsg}</span>
            <button
              onClick={() => {
                setIsOneDriveModalOpen(false);
                setIsSettingsModalOpen(true);
              }}
              className="font-semibold underline ml-2 shrink-0"
            >
              Configurar Chave
            </button>
          </div>
        )}

        {/* Cloud Explorer / File Selector */}
        {userProfile && (
          <div className="flex-1 overflow-hidden flex flex-col border border-slate-200 dark:border-slate-700 rounded-xl">
            {/* Breadcrumb Navigation */}
            <div className="bg-slate-100 dark:bg-slate-700/50 px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 overflow-x-auto">
              {folderHistory.map((folder, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
                  <button
                    onClick={() => handleNavigateBreadcrumb(idx)}
                    className="hover:text-blue-600 dark:hover:text-blue-400 truncate max-w-[120px]"
                  >
                    {folder.name}
                  </button>
                </React.Fragment>
              ))}
              <button
                onClick={() => loadFolder(currentFolderId)}
                title="Atualizar pasta"
                className="ml-auto p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* File List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-[220px]">
              {isLoading && items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                  <span className="text-xs">Carregando arquivos do OneDrive...</span>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-xs">
                  Nenhum arquivo .md / .txt encontrado nesta pasta.
                </div>
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors group cursor-pointer"
                    onClick={() => (item.folder ? handleOpenFolder(item) : handleOpenFile(item))}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {item.folder ? (
                        <Folder className="w-5 h-5 text-amber-500 shrink-0" />
                      ) : (
                        <FileCode className="w-5 h-5 text-blue-500 shrink-0" />
                      )}
                      <div className="truncate">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
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
                        className="px-3 py-1 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-semibold transition-all"
                      >
                        Abrir
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2">
          {currentDoc.oneDriveItemId && userProfile ? (
            <button
              onClick={handleSaveCurrentToCloud}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex items-center gap-1.5 transition-all"
            >
              <UploadCloud className="w-4 h-4" /> Sobrescrever na Nuvem
            </button>
          ) : (
            <span />
          )}

          <button
            onClick={() => setIsOneDriveModalOpen(false)}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Fechar
          </button>
        </div>

        <UnsavedChangesModal
          isOpen={isUnsavedGuardOpen}
          onClose={() => {
            setIsUnsavedGuardOpen(false);
            setPendingFileToOpen(null);
          }}
          onConfirmDiscard={handleConfirmDiscardFromGuard}
          onConfirmSaveAndProceed={handleConfirmSaveFromGuard}
          documentTitle={currentDoc.title}
          actionType="open_onedrive"
        />
      </div>
    </div>
  );
};
