import React, { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { RefreshCw, CheckCircle, X } from 'lucide-react';

export const SyncNotificationToast: React.FC = () => {
  const { syncNotification, setSyncNotification } = useAppStore();

  useEffect(() => {
    if (syncNotification) {
      const timer = setTimeout(() => {
        setSyncNotification(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [syncNotification, setSyncNotification]);

  if (!syncNotification) return null;

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-top-3 duration-300 pointer-events-auto">
      <div className="flex items-center gap-2.5 px-4 py-2 bg-slate-900/90 dark:bg-slate-800/95 text-white backdrop-blur-md rounded-2xl shadow-xl border border-slate-700/60 text-xs font-medium">
        <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
        <span className="truncate max-w-[340px] sm:max-w-md">{syncNotification}</span>
        <button
          onClick={() => setSyncNotification(null)}
          className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer ml-1"
          title="Fechar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
