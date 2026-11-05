import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import {
  getStoredClientId,
  setStoredClientId,
  loginWithOneDrive,
  logoutOneDrive,
} from '../../services/msalService';
import { forceAppUpdate } from '../../services/appUpdateService';
import {
  X,
  Key,
  Info,
  Check,
  Settings,
  Cloud,
  LogIn,
  LogOut,
  RotateCw,
  AlertCircle,
} from 'lucide-react';

export const SettingsModal: React.FC = () => {
  const { isSettingsModalOpen, setIsSettingsModalOpen, userProfile, setUserProfile } = useAppStore(
    useShallow((state) => ({
      isSettingsModalOpen: state.isSettingsModalOpen,
      setIsSettingsModalOpen: state.setIsSettingsModalOpen,
      userProfile: state.userProfile,
      setUserProfile: state.setUserProfile,
    }))
  );

  const [clientId, setClientIdInput] = useState(getStoredClientId());
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (isSettingsModalOpen) {
      setClientIdInput(getStoredClientId());
      setAuthError(null);
      setSavedSuccess(false);
    }
  }, [isSettingsModalOpen]);

  if (!isSettingsModalOpen) return null;

  const handleSaveClientId = () => {
    setStoredClientId(clientId.trim());
    setSavedSuccess(true);
    setAuthError(null);
    setTimeout(() => {
      setSavedSuccess(false);
    }, 1500);
  };

  const handleLogin = async () => {
    // Salva automaticamente o Client ID digitado antes de autenticar, caso tenha sido preenchido
    if (clientId.trim()) {
      setStoredClientId(clientId.trim());
    }
    setIsAuthLoading(true);
    setAuthError(null);
    try {
      const profile = await loginWithOneDrive();
      if (profile) {
        setUserProfile(profile);
      }
    } catch (err: any) {
      if (err.message === 'CLIENT_ID_REQUIRED') {
        setAuthError('Informe e salve o Client ID do aplicativo Azure abaixo antes de conectar.');
      } else {
        setAuthError(err.message || 'Falha ao conectar com a conta Microsoft.');
      }
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsAuthLoading(true);
    setAuthError(null);
    try {
      await logoutOneDrive();
      setUserProfile(null);
    } catch (err: any) {
      setAuthError(err.message || 'Erro ao desconectar conta.');
    } finally {
      setIsAuthLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg p-6 space-y-5 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100">
                Configurações
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Integração com nuvem e manutenção do aplicativo
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsSettingsModalOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Seção 1: Conta OneDrive */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <Cloud className="w-3.5 h-3.5 text-sky-500" />
            <span>Conta Microsoft OneDrive</span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/80 p-3.5 rounded-xl flex items-center justify-between gap-3">
            {userProfile ? (
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-sky-600 text-white font-bold flex items-center justify-center text-sm shadow-xs shrink-0">
                  {userProfile.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {userProfile.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {userProfile.email}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Nenhuma conta conectada. Conecte seu OneDrive para abrir e sincronizar arquivos na nuvem.
              </div>
            )}

            {userProfile ? (
              <button
                type="button"
                onClick={handleLogout}
                disabled={isAuthLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sair</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLogin}
                disabled={isAuthLoading}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white shadow-xs flex items-center gap-1.5 transition-all shrink-0 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Conectar</span>
              </button>
            )}
          </div>

          {authError && (
            <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl p-3 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}
        </div>

        {/* Seção 2: Client ID do Azure */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-700/70">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <Key className="w-3.5 h-3.5 text-blue-500" />
            <span>Credencial de Integração (Client ID)</span>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-xl p-3 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
              Para sincronizar com o OneDrive, informe o <strong>Client ID</strong> registrado no portal <strong>Microsoft Entra ID (Azure AD)</strong>. O aplicativo funciona 100% offline se preferir usar apenas arquivos locais.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientIdInput(e.target.value)}
              placeholder="ex: 00000000-0000-0000-0000-000000000000"
              className="flex-1 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={handleSaveClientId}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" /> Salvo!
                </>
              ) : (
                'Salvar Chave'
              )}
            </button>
          </div>
        </div>

        {/* Seção 3: Sistema & Cache */}
        <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-700/70">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Sistema & Atualização
          </div>
          <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/80 p-3.5 rounded-xl flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Limpa o cache de ativos estáticos e recarrega a versão mais recente do aplicativo (seus documentos salvos são preservados).
            </div>
            <button
              type="button"
              onClick={forceAppUpdate}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300/80 dark:hover:bg-slate-600 flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5 text-blue-500" />
              <span>Recarregar App</span>
            </button>
          </div>
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(false)}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
