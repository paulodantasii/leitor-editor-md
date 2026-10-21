import React, { useEffect, useState } from 'react';
import { Cloud, Folder, X, Save, Sparkles } from 'lucide-react';

interface SaveDestinationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveToOneDrive: () => void;
  onSaveToLocal: () => void;
  documentTitle?: string;
}

const LAST_DESTINATION_KEY = 'leitor_md_last_save_destination';

export const SaveDestinationModal: React.FC<SaveDestinationModalProps> = ({
  isOpen,
  onClose,
  onSaveToOneDrive,
  onSaveToLocal,
  documentTitle,
}) => {
  const [lastDestination, setLastDestination] = useState<'onedrive' | 'local' | null>(null);

  useEffect(() => {
    if (isOpen && typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(LAST_DESTINATION_KEY) as 'onedrive' | 'local' | null;
      if (stored === 'onedrive' || stored === 'local') {
        setLastDestination(stored);
      }
    }
  }, [isOpen]);

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

  const handleSelectOneDrive = () => {
    try {
      localStorage.setItem(LAST_DESTINATION_KEY, 'onedrive');
    } catch {
      // ignore
    }
    onSaveToOneDrive();
  };

  const handleSelectLocal = () => {
    try {
      localStorage.setItem(LAST_DESTINATION_KEY, 'local');
    } catch {
      // ignore
    }
    onSaveToLocal();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-5 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
              <Save className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                Onde deseja salvar este documento?
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
          Escolha o destino permanente para o seu documento. Após salvar, o salvamento automático continuará gravando suas alterações diretamente:
        </p>

        {/* Action Options */}
        <div className="space-y-2.5">
          {/* Option 1: OneDrive */}
          <button
            type="button"
            onClick={handleSelectOneDrive}
            className={`w-full p-3.5 rounded-xl border text-left transition-all flex items-center gap-3 group cursor-pointer ${
              lastDestination === 'onedrive'
                ? 'bg-sky-50/70 dark:bg-sky-950/30 border-sky-400 dark:border-sky-600 ring-1 ring-sky-400/40'
                : 'bg-slate-50 dark:bg-slate-800/80 hover:bg-sky-50 dark:hover:bg-sky-950/30 border-slate-200 dark:border-slate-700 hover:border-sky-500 dark:hover:border-sky-500'
            }`}
          >
            <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Cloud className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400">
                  Salvar no OneDrive
                </div>
                {lastDestination === 'onedrive' && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/80 text-sky-700 dark:text-sky-300">
                    <Sparkles className="w-3 h-3" /> Último usado
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Escolha a pasta na nuvem, navegue e sincronize com versionamento
              </div>
            </div>
          </button>

          {/* Option 2: Local Device */}
          <button
            type="button"
            onClick={handleSelectLocal}
            className={`w-full p-3.5 rounded-xl border text-left transition-all flex items-center gap-3 group cursor-pointer ${
              lastDestination === 'local'
                ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-600 ring-1 ring-emerald-400/40'
                : 'bg-slate-50 dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500'
            }`}
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Folder className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                  Salvar no Dispositivo
                </div>
                {lastDestination === 'local' && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300">
                    <Sparkles className="w-3 h-3" /> Último usado
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Grava como arquivo .md no seu computador com sobrescrita direta
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
