import React from 'react';
import { AlertTriangle, Save, FilePlus, X, Trash2 } from 'lucide-react';

interface ConfirmNewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDiscard: () => void;
  onConfirmSaveAndNew: () => void;
  isDirty: boolean;
  documentTitle: string;
}

export const ConfirmNewModal: React.FC<ConfirmNewModalProps> = ({
  isOpen,
  onClose,
  onConfirmDiscard,
  onConfirmSaveAndNew,
  isDirty,
  documentTitle,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-5 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isDirty
                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                  : 'bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400'
              }`}
            >
              {isDirty ? <AlertTriangle className="w-5 h-5" /> : <FilePlus className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                {isDirty ? 'Alterações Não Salvas' : 'Iniciar Novo Documento'}
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
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {isDirty ? (
            <>
              O documento atual possui alterações que ainda não foram salvas. O que você gostaria de fazer antes de abrir uma nova folha em branco?
            </>
          ) : (
            <>
              Deseja fechar o documento atual e iniciar uma nova folha em branco para digitação?
            </>
          )}
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
          {isDirty ? (
            <>
              <button
                type="button"
                onClick={onConfirmSaveAndNew}
                className="w-full h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                Salvar Arquivo e Criar Novo
              </button>

              <button
                type="button"
                onClick={onConfirmDiscard}
                className="w-full h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-700 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Descartar Alterações e Criar Novo
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full h-9 px-4 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            </>
          ) : (
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onConfirmDiscard}
                className="h-9 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
              >
                <FilePlus className="w-4 h-4" />
                Criar Novo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
