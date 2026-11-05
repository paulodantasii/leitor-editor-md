import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ListTree,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  Hash,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  TocStateSnapshot,
  TocHeadingItem,
  subscribeTocState,
  getTocSnapshot,
  computeBreadcrumbTrail,
  requestNavigateToHeading,
} from '../../services/tocService';

export const DocumentOutlineBar: React.FC = () => {
  const hasDocument = useAppStore((state) => Boolean(state.document));
  const docId = useAppStore((state) => state.document?.docId);

  const [toc, setToc] = useState<TocStateSnapshot>(() => getTocSnapshot());
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const barContainerRef = useRef<HTMLDivElement>(null);
  const activeItemButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return subscribeTocState((snapshot) => {
      setToc(snapshot);
    });
  }, []);

  // Fecha o popover ao trocar de documento/aba
  useEffect(() => {
    setIsOpen(false);
    setSearchQuery('');
  }, [docId, hasDocument]);

  // Fecha o popover ao clicar fora ou pressionar Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (barContainerRef.current && !barContainerRef.current.contains(target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Ao abrir o popover, centraliza o item ativo na lista de rolagem
  useEffect(() => {
    if (!isOpen) return;
    const rafId = requestAnimationFrame(() => {
      activeItemButtonRef.current?.scrollIntoView({
        block: 'nearest',
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [isOpen]);

  const { headings, activeIndex } = toc;

  const trail = useMemo(
    () => computeBreadcrumbTrail(headings, activeIndex),
    [headings, activeIndex]
  );

  // Calcula o recuo visual relativo ao menor nível presente no documento (ex.: se o doc começa em H2, H2 tem recuo 0)
  const minLevelInDoc = useMemo(() => {
    if (headings.length === 0) return 1;
    return headings.reduce((min, h) => (h.level < min ? h.level : min), 6);
  }, [headings]);

  const filteredHeadings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return headings;
    return headings.filter((h) => h.text.toLowerCase().includes(q));
  }, [headings, searchQuery]);

  if (!hasDocument || headings.length === 0 || trail.length === 0) {
    return null;
  }

  // Se houver 4+ níveis na trilha (ex.: H1 > H2 > H3 > H4), em telas estreitas exibe H1 > … > Penúltimo > Atual
  // para garantir que o título raiz e a localização imediata tenham espaço generoso de leitura.
  const displayTrail: Array<{ type: 'item'; item: TocHeadingItem } | { type: 'ellipsis' }> =
    trail.length > 3
      ? [
          { type: 'item', item: trail[0] },
          { type: 'ellipsis' },
          { type: 'item', item: trail[trail.length - 2] },
          { type: 'item', item: trail[trail.length - 1] },
        ]
      : trail.map((item) => ({ type: 'item', item }));

  const handleSelectHeading = (headingIndex: number) => {
    setIsOpen(false);
    setSearchQuery('');
    requestNavigateToHeading(headingIndex);
  };

  return (
    <div
      ref={barContainerRef}
      className="relative h-6 sm:h-7 bg-slate-50/90 dark:bg-slate-900/90 border-t border-slate-200/70 dark:border-slate-800/80 px-2.5 sm:px-4 flex items-center select-none print:hidden"
    >
      <div className="max-w-7xl mx-auto w-full flex items-center min-w-0">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-label="Abrir sumário de títulos do documento"
          title="Onde você está no documento — Clique para abrir o Sumário completo"
          className={`group w-full h-5 sm:h-6 px-1.5 sm:px-2 rounded-md flex items-center gap-1 sm:gap-1.5 text-left transition-colors min-w-0 cursor-pointer ${
            isOpen
              ? 'bg-blue-50/90 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400'
              : 'hover:bg-slate-200/60 dark:hover:bg-slate-800/70 text-slate-600 dark:text-slate-300'
          }`}
        >
          <ListTree
            className={`w-3.5 h-3.5 shrink-0 transition-colors ${
              isOpen
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-slate-400 dark:text-slate-500 group-hover:text-blue-500 dark:group-hover:text-blue-400'
            }`}
          />

          {/* Trilha Hierárquica: H1 > H2 > H3 */}
          <div className="flex-1 flex items-center gap-1 min-w-0 overflow-hidden text-[11px] sm:text-xs leading-none">
            {displayTrail.map((entry, idx) => {
              const isLast = idx === displayTrail.length - 1;

              if (entry.type === 'ellipsis') {
                return (
                  <React.Fragment key="trail-ellipsis">
                    <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />
                    <span className="text-slate-400 dark:text-slate-500 shrink-0">…</span>
                  </React.Fragment>
                );
              }

              const { item } = entry;
              return (
                <React.Fragment key={item.id}>
                  {idx > 0 && (
                    <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />
                  )}
                  <span
                    className={
                      isLast
                        ? 'font-semibold text-slate-800 dark:text-slate-100 truncate min-w-[4rem] flex-1'
                        : 'font-normal text-slate-500 dark:text-slate-400 truncate max-w-[95px] sm:max-w-[170px] md:max-w-[240px] shrink'
                    }
                  >
                    {item.text}
                  </span>
                </React.Fragment>
              );
            })}
          </div>

          {/* Indicador de posição no sumário + seta */}
          <div className="flex items-center gap-1 shrink-0 pl-1">
            <span className="hidden sm:inline-block text-[10px] font-medium text-slate-400 dark:text-slate-500 tabular-nums">
              {Math.max(1, activeIndex + 1)}/{headings.length}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 dark:text-slate-500 transition-transform duration-150 ${
                isOpen ? 'rotate-180 text-blue-600 dark:text-blue-400' : ''
              }`}
            />
          </div>
        </button>
      </div>

      {/* Popover / Dropdown com a Lista Completa de Títulos e Subtítulos */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Sumário do documento"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-[calc(100vw-1rem)] sm:w-[460px] md:w-[540px] max-w-2xl bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Cabeçalho do Sumário + Busca Rápida (exibe busca quando há 5+ títulos) */}
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-800/80 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0">
              <ListTree className="w-3.5 h-3.5 text-blue-500" />
              <span>Sumário</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-200/80 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                {headings.length}
              </span>
            </div>

            {headings.length >= 5 && (
              <div className="relative flex-1 max-w-[240px]">
                <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrar títulos..."
                  aria-label="Filtrar títulos no sumário"
                  className="w-full h-6 pl-7 pr-6 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-blue-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 cursor-pointer"
                    title="Limpar filtro"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Lista Hierárquica de Títulos */}
          <div className="max-h-[60vh] sm:max-h-[380px] overflow-y-auto p-1.5 space-y-0.5">
            {filteredHeadings.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                Nenhum título encontrado para "{searchQuery}".
              </div>
            ) : (
              filteredHeadings.map((item) => {
                const isActive = item.index === activeIndex;
                const isAncestor = !isActive && trail.some((t) => t.index === item.index);
                const depth = Math.max(0, item.level - minLevelInDoc);
                const indentPx = Math.min(depth * 14, 64);

                return (
                  <button
                    key={item.id}
                    ref={isActive ? activeItemButtonRef : undefined}
                    type="button"
                    onClick={() => handleSelectHeading(item.index)}
                    style={{ paddingLeft: `${indentPx + 8}px` }}
                    className={`w-full py-1.5 pr-2.5 rounded-lg flex items-center gap-2 text-left text-xs transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                        : isAncestor
                        ? 'text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-100 dark:hover:bg-slate-700/60'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                    }`}
                  >
                    <span
                      className={`inline-flex items-center justify-center px-1 py-0.2 rounded text-[9px] font-mono font-bold uppercase shrink-0 ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : isAncestor
                          ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                          : 'bg-slate-100 dark:bg-slate-700/80 text-slate-400 dark:text-slate-400'
                      }`}
                    >
                      <Hash className="w-2.5 h-2.5 mr-0.5 opacity-70" />
                      {item.level}
                    </span>

                    <span
                      className={`flex-1 truncate ${
                        item.level === 1
                          ? 'font-bold text-slate-900 dark:text-white'
                          : item.level === 2
                          ? 'font-semibold'
                          : 'font-normal'
                      } ${isActive ? '!text-blue-700 dark:!text-blue-300' : ''}`}
                    >
                      {item.text}
                    </span>

                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
