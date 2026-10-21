import React from 'react';
import { Cloud, Folder, FileText, X, AlertCircle } from 'lucide-react';

interface CloseDraftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveToOneDrive: () => void;
  onSaveToLocal: () => void;
  onKeepAsDraft: () => void;
  documentTitle: string;
}

export const CloseDraftModal: React.FC<CloseDraftModalProps> = ({
  isOpen,
  onClose,
  onSaveToOneDrive,
  onSaveToLocal,
  onKeepAsDraft,
  documentTitle,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-5 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                Onde deseja salvar antes de fechar?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[260px]">
                {documentTitle || 'Documento sem título'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Cancelar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message */}
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Este documento ainda não possui um arquivo permanente vinculado. Escolha onde salvar ou mantenha-o seguro como rascunho no histórico deste navegador:
        </p>

        {/* Action Options */}
        <div className="space-y-2.5">
          {/* Option 1: OneDrive */}
          <button
            type="button"
            onClick={onSaveToOneDrive}
            className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-sky-50 dark:hover:bg-sky-950/30 border border-slate-200 dark:border-slate-700 hover:border-sky-500 dark:hover:border-sky-500 text-left transition-all flex items-center gap-3 group cursor-pointer"
          >
            <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Cloud className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400">
                Salvar no OneDrive
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Sincroniza na nuvem com versionamento e acesso em outros dispositivos
              </div>
            </div>
          </button>

          {/* Option 2: Local Device */}
          <button
            type="button"
            onClick={onSaveToLocal}
            className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 text-left transition-all flex items-center gap-3 group cursor-pointer"
          >
            <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Folder className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                Salvar no Dispositivo
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Grava como arquivo Markdown (.md) no seu computador
              </div>
            </div>
          </button>

          {/* Option 3: Keep as Draft */}
          <button
            type="button"
            onClick={onKeepAsDraft}
            className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-amber-50 dark:hover:bg-amber-950/30 border border-slate-200 dark:border-slate-700 hover:border-amber-500 dark:hover:border-amber-500 text-left transition-all flex items-center gap-3 group cursor-pointer"
          >
            <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 flex items-center gap-2">
                <span>Fechar mantendo como Rascunho</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded-full bg-amber-200 dark:bg-amber-900/80 text-amber-800 dark:text-amber-200">
                  Sem perda
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Permanece no histórico deste navegador com o selo Rascunho
              </div>
            </div>
          </button>
        </div>

        {/* Footer cancel */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};
