import React, { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import { getReloadTabsWarningInfo } from '../../services/cleanReloadService';
import { hasPendingBridgeChanges } from '../../services/editorContentBridge';
import { MiddleEllipsisText } from '../ui/MiddleEllipsisText';
import { ModalCloseButton } from '../ui/ModalNavButtons';

interface ReloadAppConfirmModalProps {
  isOpen: boolean;
  isReloading: boolean;
  onClose: () => void;
  onConfirmReload: () => Promise<void>;
}

const MAX_VISIBLE_DIRTY_TABS = 3;

export const ReloadAppConfirmModal: React.FC<ReloadAppConfirmModalProps> = ({
  isOpen,
  isReloading,
  onClose,
  onConfirmReload,
}) => {
  const { tabs, activeTabId, activeDoc } = useAppStore(
    useShallow((state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      activeDoc: state.document,
    }))
  );

  useEffect(() => {
    if (!isOpen || isReloading) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isReloading, onClose]);

  if (!isOpen) return null;

  const warningInfo = getReloadTabsWarningInfo(
    tabs,
    activeTabId,
    activeDoc,
    hasPendingBridgeChanges()
  );

  const visibleDirtyTitles = warningInfo.dirtyTabTitles.slice(0, MAX_VISIBLE_DIRTY_TABS);
  const remainingDirtyCount = Math.max(
    0,
    warningInfo.dirtyTabTitles.length - MAX_VISIBLE_DIRTY_TABS
  );

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reload-app-confirm-title"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-5 animate-in zoom-in-95 duration-200">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3
                id="reload-app-confirm-title"
                className="text-base font-bold text-slate-800 dark:text-slate-100"
              >
                Recarregar Aplicativo
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Todas as abas abertas serão fechadas
              </p>
            </div>
          </div>
          <ModalCloseButton onClick={onClose} disabled={isReloading} />
        </div>

        {/* Corpo */}
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <p>
            Antes de recarregar o aplicativo, certifique-se de salvar todo o seu progresso (no
            OneDrive ou no seu dispositivo).
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Ao confirmar, todas as abas abertas serão fechadas e o aplicativo será reiniciado na tela
            inicial. Seus documentos já salvos e o histórico de recentes continuam preservados.
          </p>
        </div>

        {/* Caixa contextual dinâmica */}
        {warningInfo.hasUnsavedWork ? (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl p-3.5 space-y-2">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
              Alterações não salvas detectadas — recomendamos voltar e salvar antes de recarregar:
            </p>
            {visibleDirtyTitles.length > 0 && (
              <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
                {visibleDirtyTitles.map((title) => (
                  <li key={title} className="flex items-center gap-1.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <MiddleEllipsisText text={title} className="min-w-0 flex-1" />
                  </li>
                ))}
                {remainingDirtyCount > 0 && (
                  <li className="text-[11px] font-medium text-amber-700/80 dark:text-amber-300/80 pl-3">
                    +{remainingDirtyCount}{' '}
                    {remainingDirtyCount === 1 ? 'outro documento' : 'outros documentos'}
                  </li>
                )}
              </ul>
            )}
          </div>
        ) : warningInfo.totalTabsCount > 0 ? (
          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl p-3 text-xs text-slate-600 dark:text-slate-300">
            {warningInfo.totalTabsCount}{' '}
            {warningInfo.totalTabsCount === 1
              ? 'aba aberta será fechada ao recarregar.'
              : 'abas abertas serão fechadas ao recarregar.'}
          </div>
        ) : null}

        {/* Rodapé */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isReloading}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {warningInfo.hasUnsavedWork ? 'Voltar e Salvar' : 'Cancelar'}
          </button>
          <button
            type="button"
            onClick={onConfirmReload}
            disabled={isReloading}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white shadow-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isReloading ? 'animate-spin' : ''}`} />
            <span>{isReloading ? 'Recarregando...' : 'Fechar Tudo e Recarregar'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
