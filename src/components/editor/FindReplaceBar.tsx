import React, { useEffect, useState } from 'react';
import {
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  CaseSensitive,
  WholeWord,
  Regex,
  Replace,
  ReplaceAll,
} from 'lucide-react';
import { SearchOptions, TextMatchRange } from '../../services/searchReplaceService';

export interface FindReplaceBarProps {
  readonly isOpen: boolean;
  readonly isReplaceExpanded: boolean;
  readonly isEditable: boolean;
  readonly query: string;
  readonly replacement: string;
  readonly options: SearchOptions;
  readonly matches: ReadonlyArray<TextMatchRange>;
  readonly activeIndex: number;
  readonly error: string | null;
  readonly replaceFeedback: string | null;
  readonly searchInputRef: React.RefObject<HTMLInputElement>;
  readonly replaceInputRef: React.RefObject<HTMLInputElement>;
  readonly onQueryChange: (value: string) => void;
  readonly onReplacementChange: (value: string) => void;
  readonly onToggleOption: (key: keyof SearchOptions) => void;
  readonly onToggleReplaceExpanded: () => void;
  readonly onNext: () => void;
  readonly onPrev: () => void;
  readonly onReplaceCurrent: () => void;
  readonly onReplaceAll: () => void;
  readonly onClose: () => void;
}

export const FindReplaceBar: React.FC<FindReplaceBarProps> = ({
  isOpen,
  isReplaceExpanded,
  isEditable,
  query,
  replacement,
  options,
  matches,
  activeIndex,
  error,
  replaceFeedback,
  searchInputRef,
  replaceInputRef,
  onQueryChange,
  onReplacementChange,
  onToggleOption,
  onToggleReplaceExpanded,
  onNext,
  onPrev,
  onReplaceCurrent,
  onReplaceAll,
  onClose,
}) => {
  const [toolbarHeightPx, setToolbarHeightPx] = useState(0);

  // Mede a altura da EditorToolbar quando em Modo Edição para posicionar a barra logo abaixo sem sobrepor
  useEffect(() => {
    if (!isOpen || !isEditable) {
      setToolbarHeightPx(0);
      return;
    }

    const toolbarEl = document.querySelector('[data-editor-toolbar]') as HTMLElement | null;
    if (!toolbarEl) {
      setToolbarHeightPx(0);
      return;
    }

    const measure = () => {
      setToolbarHeightPx(toolbarEl.offsetHeight);
    };

    measure();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(toolbarEl);
    }
    window.addEventListener('resize', measure);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isOpen, isEditable]);

  if (!isOpen) {
    return null;
  }

  const topOffsetPx = isEditable && toolbarHeightPx > 0 ? toolbarHeightPx + 10 : 10;
  const stickyTopCss = `calc(var(--header-height, 4.875rem) + ${topOffsetPx}px)`;
  const hasMatches = matches.length > 0;
  const canReplace = hasMatches && !error;

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter' || e.key === 'F3') {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    }
  };

  const handleReplaceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'F3') {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canReplace) {
        onReplaceCurrent();
      }
    }
  };

  const renderFilterButton = (
    key: keyof SearchOptions,
    label: string,
    title: string,
    content: React.ReactNode
  ) => {
    const active = options[key];
    return (
      <button
        type="button"
        onClick={() => onToggleOption(key)}
        aria-pressed={active}
        aria-label={label}
        title={title}
        className={`h-6 min-w-[24px] px-1 rounded-md flex items-center justify-center text-[11px] transition-colors cursor-pointer shrink-0 ${
          active
            ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-semibold ring-1 ring-blue-300 dark:ring-blue-700'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
      >
        {content}
      </button>
    );
  };

  return (
    <div
      style={{ top: stickyTopCss }}
      className="sticky z-[25] h-0 overflow-visible w-full flex items-start justify-end px-2 sm:px-3 pointer-events-none print:hidden"
    >
      <div
        data-find-replace-bar
        role="region"
        aria-label="Localizar e substituir no documento"
        className="pointer-events-auto h-fit self-start w-full sm:w-[500px] max-w-full bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-700 shadow-xl ring-1 ring-slate-900/5 dark:ring-white/10 rounded-xl p-2 flex flex-col gap-1.5 font-sans"
      >
        {/* Linha 1: Localizar + Filtros + Contador + Navegação */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-1">
          <button
            type="button"
            onClick={onToggleReplaceExpanded}
            aria-expanded={isReplaceExpanded}
            aria-label={isReplaceExpanded ? 'Ocultar substituição' : 'Mostrar substituição'}
            title={isReplaceExpanded ? 'Ocultar substituição' : 'Substituir (Ctrl+H)'}
            className="w-6 h-8 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer shrink-0"
          >
            {isReplaceExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>

          <div
            className={`flex-1 min-w-[180px] h-8 px-2 rounded-lg border flex items-center gap-1 bg-slate-50 dark:bg-slate-900/80 transition-colors ${
              error
                ? 'border-rose-400 dark:border-rose-500 focus-within:border-rose-500'
                : 'border-slate-200 dark:border-slate-700 focus-within:border-blue-500 dark:focus-within:border-blue-400'
            }`}
          >
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />

            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Localizar..."
              aria-label="Texto para localizar"
              spellCheck={false}
              className="flex-1 min-w-[60px] bg-transparent text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none"
            />

            {query.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onQueryChange('');
                  searchInputRef.current?.focus();
                }}
                aria-label="Limpar busca"
                title="Limpar busca"
                className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            )}

            <div className="flex items-center gap-0.5 pl-1 border-l border-slate-200 dark:border-slate-700 shrink-0">
              {renderFilterButton(
                'caseSensitive',
                'Diferenciar maiúsculas e minúsculas',
                'Diferenciar maiúsculas/minúsculas (Aa)',
                <CaseSensitive className="w-3.5 h-3.5" />
              )}
              {renderFilterButton(
                'wholeWord',
                'Palavra inteira',
                'Palavra inteira',
                <WholeWord className="w-3.5 h-3.5" />
              )}
              {renderFilterButton(
                'ignoreAccents',
                'Ignorar acentos',
                'Ignorar acentos (ex.: acao encontra ação)',
                <span className="font-bold text-[10px] tracking-tighter leading-none">Á≈A</span>
              )}
              {renderFilterButton(
                'useRegex',
                'Usar expressão regular',
                'Expressão Regular (.*)',
                <Regex className="w-3.5 h-3.5" />
              )}
            </div>
          </div>

          {/* Contador e botões de navegação */}
          <div className="flex items-center gap-0.5 shrink-0 ml-auto sm:ml-0">
            {query.length > 0 && !error && (
              <span
                aria-live="polite"
                className={`px-1.5 text-[11px] tabular-nums whitespace-nowrap select-none ${
                  hasMatches
                    ? 'text-slate-600 dark:text-slate-300 font-medium'
                    : 'text-rose-600 dark:text-rose-400 font-medium'
                }`}
              >
                {hasMatches ? `${activeIndex + 1} de ${matches.length}` : '0 resultados'}
              </span>
            )}

            <button
              type="button"
              onClick={onPrev}
              disabled={!hasMatches}
              aria-label="Ocorrência anterior"
              title="Ocorrência anterior (Shift+Enter)"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronUp className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onNext}
              disabled={!hasMatches}
              aria-label="Próxima ocorrência"
              title="Próxima ocorrência (Enter)"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronDown className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar barra de busca"
              title="Fechar (Esc)"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Linha 2: Substituir */}
        {isReplaceExpanded && (
          <div className="flex items-center gap-1">
            <div className="w-6 shrink-0" aria-hidden="true" />

            <div className="flex-1 min-w-0 h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 focus-within:border-blue-500 dark:focus-within:border-blue-400 flex items-center gap-1 bg-slate-50 dark:bg-slate-900/80 transition-colors">
              <input
                ref={replaceInputRef}
                type="text"
                value={replacement}
                onChange={(e) => onReplacementChange(e.target.value)}
                onKeyDown={handleReplaceKeyDown}
                placeholder="Substituir por..."
                aria-label="Texto de substituição"
                spellCheck={false}
                className="flex-1 min-w-0 bg-transparent text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none"
              />
              {replacement.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onReplacementChange('');
                    replaceInputRef.current?.focus();
                  }}
                  aria-label="Limpar substituição"
                  title="Limpar substituição"
                  className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onReplaceCurrent}
                disabled={!canReplace}
                title="Substituir ocorrência atual (Enter)"
                className="h-8 px-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/40 text-slate-700 dark:text-slate-200 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-40 disabled:pointer-events-none text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Replace className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Substituir</span>
              </button>

              <button
                type="button"
                onClick={onReplaceAll}
                disabled={!canReplace}
                title="Substituir todas as ocorrências no documento"
                className="h-8 px-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:pointer-events-none text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
              >
                <ReplaceAll className="w-3.5 h-3.5" />
                <span>Tudo</span>
              </button>
            </div>
          </div>
        )}

        {/* Mensagem de erro de Regex ou feedback de substituição */}
        {error ? (
          <div role="alert" className="pl-7 text-[11px] text-rose-600 dark:text-rose-400 font-medium">
            {error}
          </div>
        ) : replaceFeedback ? (
          <div aria-live="polite" className="pl-7 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
            {replaceFeedback}
          </div>
        ) : null}
      </div>
    </div>
  );
};
