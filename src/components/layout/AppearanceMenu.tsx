import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Sliders, Sun, Moon, Type, Maximize2, RotateCw } from 'lucide-react';
import { FontFamily, TextWidth } from '../../types';
import { forceAppUpdate } from '../../services/appUpdateService';

export const AppearanceMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { preferences, setPreferences } = useAppStore();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleTheme = () => {
    const newTheme = preferences.theme === 'light' ? 'dark' : 'light';
    setPreferences({ theme: newTheme });
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const handleFontSize = (delta: number) => {
    const newSize = Math.min(Math.max(preferences.fontSize + delta, 14), 24);
    setPreferences({ fontSize: newSize });
  };

  const handleFontFamily = (family: FontFamily) => {
    setPreferences({ fontFamily: family });
  };

  const handleTextWidth = (width: TextWidth) => {
    setPreferences({ textWidth: width });
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Aparência e Tipografia"
        className={`px-2.5 sm:px-3 h-8 rounded-xl transition-colors flex items-center gap-1.5 text-xs font-medium shrink-0 ${
          isOpen
            ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
        }`}
      >
        <Sliders className="w-4 h-4" />
        <span className="hidden md:inline">Aparência</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-4 z-40 space-y-4 animate-in fade-in zoom-in-95">
          <div className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Aparência & Tipografia
          </div>

          {/* Modo Tema */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200 flex items-center gap-2">
              {preferences.theme === 'dark' ? <Moon className="w-4 h-4 text-purple-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
              Tema
            </span>
            <div className="flex items-center bg-slate-100 dark:bg-slate-700 p-0.5 rounded-lg">
              <button
                onClick={toggleTheme}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  preferences.theme === 'light'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Claro
              </button>
              <button
                onClick={toggleTheme}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  preferences.theme === 'dark'
                    ? 'bg-slate-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                Escuro
              </button>
            </div>
          </div>

          {/* Tamanho da Fonte */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <Type className="w-4 h-4 text-slate-400" />
              Tamanho ({preferences.fontSize}px)
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleFontSize(-1)}
                disabled={preferences.fontSize <= 14}
                className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-sm font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40 transition-colors"
              >
                A-
              </button>
              <button
                onClick={() => handleFontSize(1)}
                disabled={preferences.fontSize >= 24}
                className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-sm font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40 transition-colors"
              >
                A+
              </button>
            </div>
          </div>

          {/* Família da Fonte */}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Fonte</span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleFontFamily('sans')}
                className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
                  preferences.fontFamily === 'sans'
                    ? 'bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400'
                    : 'bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                Sans-Serif (Inter)
              </button>
              <button
                onClick={() => handleFontFamily('serif')}
                className={`py-1.5 px-3 rounded-lg text-xs font-serif font-medium transition-all ${
                  preferences.fontFamily === 'serif'
                    ? 'bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400'
                    : 'bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                Serif (Merriweather)
              </button>
            </div>
          </div>

          {/* Largura da Tela */}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Maximize2 className="w-3 h-3" /> Largura do Texto
            </span>
            <div className="grid grid-cols-4 gap-1">
              {(['narrow', 'normal', 'wide', 'full'] as TextWidth[]).map((width) => {
                const labels: Record<TextWidth, string> = {
                  narrow: 'Estreito',
                  normal: 'Normal',
                  wide: 'Larga',
                  full: 'Total',
                };
                return (
                  <button
                    key={width}
                    onClick={() => handleTextWidth(width)}
                    className={`py-1 text-xs rounded-md font-medium transition-all ${
                      preferences.textWidth === width
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {labels[width]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Atualização & Limpeza de Cache de Ativos */}
          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Versão & Cache</span>
            <button
              onClick={forceAppUpdate}
              title="Limpa o cache de arquivos e recarrega a versão mais recente do app (mantém seus documentos salvos intactos)"
              className="px-2.5 py-1 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5 text-blue-500" />
              Recarregar App
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
