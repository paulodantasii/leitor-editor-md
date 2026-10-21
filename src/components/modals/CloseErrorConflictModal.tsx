import React from 'react';
import { AlertTriangle, RefreshCw, Archive, X } from 'lucide-react';

interface CloseErrorConflictModalProps {
  isOpen: boolean;
  message: string;
  onRetry: () => void;
  onCloseAndKeepPending: () => void;
  onCancel: () => void;
}

export const CloseErrorConflictModal: React.FC<CloseErrorConflictModalProps> = ({
  isOpen,
  message,
  onRetry,
  onCloseAndKeepPending,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-5 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                Não foi possível sincronizar antes de fechar
              </h3>
              <p className="text-xs text-red-600 dark:text-red-400">
                {message || 'Falha de conexão ou erro no servidor'}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Cancelar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message */}
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Suas alterações estão seguras no rascunho local deste navegador. Você pode tentar sincronizar novamente agora, ou fechar mantendo o rascunho pendente para envio posterior.
        </p>

        {/* Action Options */}
        <div className="space-y-2.5">
          {/* Option 1: Retry */}
          <button
            type="button"
            onClick={onRetry}
            className="w-full p-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-left transition-all flex items-center gap-3 group cursor-pointer shadow-sm"
          >
            <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
              <RefreshCw className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold">
                Tentar Salvar Novamente
              </div>
              <div className="text-[11px] text-blue-100">
                Repete o envio para a fonte agora
              </div>
            </div>
          </button>

          {/* Option 2: Close and keep pending */}
          <button
            type="button"
            onClick={onCloseAndKeepPending}
            className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-amber-50 dark:hover:bg-amber-950/30 border border-slate-200 dark:border-slate-700 hover:border-amber-500 dark:hover:border-amber-500 text-left transition-all flex items-center gap-3 group cursor-pointer"
          >
            <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Archive className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 flex items-center gap-2">
                <span>Fechar e manter rascunho pendente</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded-full bg-amber-200 dark:bg-amber-900/80 text-amber-800 dark:text-amber-200">
                  Sem perda
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                O rascunho fica no navegador e será reenviado quando a conexão voltar
              </div>
            </div>
          </button>
        </div>

        {/* Footer cancel */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            Cancelar e Continuar Editando
          </button>
        </div>
      </div>
    </div>
  );
};
