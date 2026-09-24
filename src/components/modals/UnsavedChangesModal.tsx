import React from 'react';
import { AlertTriangle, Save, X, Trash2 } from 'lucide-react';

export type GuardActionType = 'new' | 'open_local' | 'open_onedrive' | 'open_recent';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDiscard: () => void;
  onConfirmSaveAndProceed: () => Promise<void>;
  documentTitle: string;
  actionType?: GuardActionType;
  customActionTitle?: string;
  customDescription?: string;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  onClose,
  onConfirmDiscard,
  onConfirmSaveAndProceed,
  documentTitle,
  actionType = 'new',
  customActionTitle,
  customDescription,
}) => {
  if (!isOpen) return null;

  const getActionLabels = () => {
    switch (actionType) {
      case 'open_local':
        return {
          title: customActionTitle || 'Abrir Arquivo Local',
          description:
            customDescription ||
            'O documento atual possui alterações que ainda não foram salvas. O que você gostaria de fazer antes de abrir um arquivo do seu dispositivo?',
          saveButton: 'Salvar Arquivo Atual e Abrir',
          discardButton: 'Descartar Alterações e Abrir',
        };
      case 'open_onedrive':
        return {
          title: customActionTitle || 'Abrir Arquivo do OneDrive',
          description:
            customDescription ||
            'O documento atual possui alterações que ainda não foram salvas. O que você gostaria de fazer antes de carregar o arquivo da nuvem?',
          saveButton: 'Salvar Arquivo Atual e Abrir Nuvem',
          discardButton: 'Descartar Alterações e Abrir Nuvem',
        };
      case 'open_recent':
        return {
          title: customActionTitle || 'Abrir Documento do Histórico',
          description:
            customDescription ||
            'O documento atual possui alterações que ainda não foram salvas. O que você gostaria de fazer antes de alternar para este documento?',
          saveButton: 'Salvar Arquivo Atual e Abrir',
          discardButton: 'Descartar Alterações e Abrir',
        };
      case 'new':
      default:
        return {
          title: customActionTitle || 'Iniciar Novo Documento',
          description:
            customDescription ||
            'O documento atual possui alterações que ainda não foram salvas. O que você gostaria de fazer antes de abrir uma nova folha em branco?',
          saveButton: 'Salvar Arquivo e Criar Novo',
          discardButton: 'Descartar Alterações e Criar Novo',
        };
    }
  };

  const labels = getActionLabels();

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-5 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                Alterações Não Salvas
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[260px]">
                {documentTitle || 'Documento sem título'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Cancelar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message */}
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Ação solicitada: {labels.title}
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {labels.description}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
          <button
            type="button"
            onClick={onConfirmSaveAndProceed}
            className="w-full h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {labels.saveButton}
          </button>

          <button
            type="button"
            onClick={onConfirmDiscard}
            className="w-full h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-700 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            {labels.discardButton}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full h-9 px-4 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors cursor-pointer"
          >
            Cancelar e Continuar Editando
          </button>
        </div>
      </div>
    </div>
  );
};
