import React, { useEffect } from 'react';
import { Cloud, Folder, History, X, FolderOpen } from 'lucide-react';

interface OpenSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFromLocal: () => void;
  onOpenFromOneDrive: () => void;
  onOpenFromRecents: () => void;
  recentCount: number;
}

export const OpenSourceModal: React.FC<OpenSourceModalProps> = ({
  isOpen,
  onClose,
  onOpenFromLocal,
  onOpenFromOneDrive,
  onOpenFromRecents,
  recentCount,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-5 animate-in zoom-in-95 duration-200 text-left">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                De onde deseja abrir o documento?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Escolha a origem do arquivo Markdown
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Cancelar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Options */}
        <div className="space-y-2.5">
          {/* Option 1: Local Device */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFromLocal();
            }}
            className="w-full p-3.5 rounded-xl border text-left transition-all flex items-center gap-3 group cursor-pointer bg-slate-50 dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Folder className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                Abrir do Dispositivo
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Selecionar um arquivo .md ou .txt salvo neste dispositivo
              </div>
            </div>
          </button>

          {/* Option 2: OneDrive */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFromOneDrive();
            }}
            className="w-full p-3.5 rounded-xl border text-left transition-all flex items-center gap-3 group cursor-pointer bg-slate-50 dark:bg-slate-800/80 hover:bg-sky-50 dark:hover:bg-sky-950/30 border-slate-200 dark:border-slate-700 hover:border-sky-500 dark:hover:border-sky-500"
          >
            <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Cloud className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400">
                Abrir do OneDrive
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Navegar pelas pastas sincronizadas na nuvem da Microsoft
              </div>
            </div>
          </button>

          {/* Option 3: Recent Documents */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFromRecents();
            }}
            className="w-full p-3.5 rounded-xl border text-left transition-all flex items-center gap-3 group cursor-pointer bg-slate-50 dark:bg-slate-800/80 hover:bg-amber-50 dark:hover:bg-amber-950/30 border-slate-200 dark:border-slate-700 hover:border-amber-500 dark:hover:border-amber-500"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <History className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400">
                  Documentos Recentes
                </div>
                {recentCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/70 text-amber-700 dark:text-amber-300">
                    {recentCount}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Ver histórico completo de documentos abertos recentemente
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
