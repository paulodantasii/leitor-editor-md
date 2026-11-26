import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Clock,
  Gauge,
  Highlighter,
  MessageSquareText,
  RotateCcw,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useAdaptiveReadingPace } from '../../hooks/useAdaptiveReadingPace';
import { requestScrollToLatestHighlight } from '../../services/highlightIdService';
import {
  requestScrollToLatestComment,
  subscribeActiveCommentCount,
} from '../../services/highlightCommentsService';
import {
  TocStateSnapshot,
  getActiveHeadingThresholdY,
  getTocSnapshot,
  subscribeTocState,
} from '../../services/tocService';
import {
  ActiveSectionProgressInput,
  DEFAULT_READING_WPM,
  DocumentReadingMap,
  TextMetrics,
  analyzePlainText,
  computeDocumentReadingMap,
  computeReadingEstimates,
  formatIntegerPtBr,
  formatLastModifiedCompact,
  formatLastModifiedFull,
  formatReadingDuration,
  resolveActiveSectionRange,
} from '../../services/readingStatsService';
import { resolveDocumentLastModifiedTimestamp } from '../../services/readingStatsService';
import { ReadingSpeedMode } from '../../types';

const FIXED_WPM_PRESETS: ReadonlyArray<{ readonly label: string; readonly wpm: number }> = [
  { label: 'Estudo', wpm: 130 },
  { label: 'Normal', wpm: 180 },
  { label: 'Rápida', wpm: 240 },
];

const EMPTY_DOC_MAP: DocumentReadingMap = {
  wordCount: 0,
  charCount: 0,
  charCountNoSpaces: 0,
  totalPages: 0,
  sections: [],
};

const EMPTY_SELECTION_METRICS: TextMetrics = {
  wordCount: 0,
  charCount: 0,
  charCountNoSpaces: 0,
};

function readEditorSelectionMetrics(): TextMetrics {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return EMPTY_SELECTION_METRICS;
  }

  const activeEl = document.activeElement;
  if (
    activeEl instanceof HTMLTextAreaElement &&
    activeEl.getAttribute('aria-label') === 'Editor de código-fonte Markdown'
  ) {
    const start = activeEl.selectionStart ?? 0;
    const end = activeEl.selectionEnd ?? 0;
    if (end > start) {
      return analyzePlainText(activeEl.value.slice(start, end));
    }
    return EMPTY_SELECTION_METRICS;
  }

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    return EMPTY_SELECTION_METRICS;
  }

  const anchorNode = sel.anchorNode;
  const anchorEl =
    anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement ?? null;
  if (!anchorEl || !anchorEl.closest('.ProseMirror')) {
    return EMPTY_SELECTION_METRICS;
  }

  const selectedText = sel.toString();
  if (!selectedText || !selectedText.trim()) {
    return EMPTY_SELECTION_METRICS;
  }

  return analyzePlainText(selectedText);
}

function measureActiveSectionProgress(
  map: DocumentReadingMap,
  activeHeadingIndex: number
): ActiveSectionProgressInput | null {
  if (typeof document === 'undefined') return null;

  const activeSection = resolveActiveSectionRange(map.sections, activeHeadingIndex);
  if (!activeSection || activeSection.endWordOffset <= activeSection.startWordOffset) {
    return null;
  }

  const proseMirrorEl = document.querySelector('.ProseMirror') as HTMLElement | null;
  if (!proseMirrorEl) return null;

  const domHeadings = Array.from(
    proseMirrorEl.querySelectorAll('h1, h2, h3, h4, h5, h6')
  ).filter((el) => (el.textContent || '').trim().length > 0) as HTMLElement[];

  if (domHeadings.length === 0 || activeHeadingIndex >= domHeadings.length) {
    return null;
  }

  const startEl = domHeadings[activeHeadingIndex];
  const startTop = startEl.getBoundingClientRect().top + window.scrollY;

  let endTop = proseMirrorEl.getBoundingClientRect().bottom + window.scrollY;
  const targetSectionEndWord = activeSection.endWordOffset;
  const nextSectionIdx = map.sections.findIndex(
    (s, idx) => idx > activeHeadingIndex && s.startWordOffset >= targetSectionEndWord
  );
  if (nextSectionIdx !== -1 && nextSectionIdx < domHeadings.length) {
    endTop = domHeadings[nextSectionIdx].getBoundingClientRect().top + window.scrollY;
  }

  const spanPx = Math.max(1, endTop - startTop);
  const readingLineY = window.scrollY + getActiveHeadingThresholdY();
  const ratio = Math.min(1, Math.max(0, (readingLineY - startTop) / spanPx));

  return {
    sectionStartWord: activeSection.startWordOffset,
    sectionEndWord: activeSection.endWordOffset,
    sectionRatio: ratio,
  };
}

export const ReadingStatusBar: React.FC = () => {
  const {
    docId,
    docContent,
    isDirty,
    lastModifiedAt,
    cloudLastModified,
    localLastModified,
    sourceRevision,
    isEditable,
    highlightCount,
    readingSpeedMode,
    fixedReadingWpm,
    setPreferences,
  } = useAppStore(
    useShallow((state) => ({
      docId: state.document?.docId,
      docContent: state.document?.content,
      isDirty: state.document?.isDirty ?? false,
      lastModifiedAt: state.document?.lastModifiedAt ?? null,
      cloudLastModified: state.document?.cloudLastModified ?? null,
      localLastModified: state.document?.localLastModified ?? null,
      sourceRevision: state.document?.sourceRevision ?? 0,
      isEditable: state.isEditable,
      highlightCount: state.highlightCount,
      readingSpeedMode: (state.preferences.readingSpeedMode ?? 'adaptive') as ReadingSpeedMode,
      fixedReadingWpm: state.preferences.fixedReadingWpm ?? DEFAULT_READING_WPM,
      setPreferences: state.setPreferences,
    }))
  );

  const [docMap, setDocMap] = useState<DocumentReadingMap>(EMPTY_DOC_MAP);
  const [scrollState, setScrollState] = useState<{
    progress: number;
    ratio: number;
    sectionProgress: ActiveSectionProgressInput | null;
  }>({
    progress: 0,
    ratio: 0,
    sectionProgress: null,
  });
  const [toc, setToc] = useState<TocStateSnapshot>(() => getTocSnapshot());
  const [activeCommentCount, setActiveCommentCount] = useState(0);
  const [selectionMetrics, setSelectionMetrics] = useState<TextMetrics>(EMPTY_SELECTION_METRICS);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const footerRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const lastCountedDocIdRef = useRef<string | undefined>(undefined);
  const lastCountedSourceRevRef = useRef<number>(0);
  const docMapRef = useRef<DocumentReadingMap>(EMPTY_DOC_MAP);
  const tocRef = useRef<TocStateSnapshot>(toc);

  docMapRef.current = docMap;
  tocRef.current = toc;

  const {
    adaptiveWpm,
    isCalibrated,
    docSamples,
    totalGlobalSamples,
    onScrollWordOffset,
    recalibrate,
  } = useAdaptiveReadingPace(docId, isEditable);

  const onScrollWordOffsetRef = useRef(onScrollWordOffset);
  onScrollWordOffsetRef.current = onScrollWordOffset;

  const effectiveWpm =
    readingSpeedMode === 'fixed' ? fixedReadingWpm : adaptiveWpm;

  // Assina sumário e contador de comentários
  useEffect(() => {
    const unsubToc = subscribeTocState(setToc);
    const unsubComments = subscribeActiveCommentCount(setActiveCommentCount);
    return () => {
      unsubToc();
      unsubComments();
    };
  }, []);

  // Mantém a variável CSS --footer-height sincronizada para popover e geometria
  useEffect(() => {
    const setRootFooterHeight = (heightPx: number) => {
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--footer-height', `${Math.round(heightPx)}px`);
      }
    };

    if (!docId || !footerRef.current) {
      setRootFooterHeight(0);
      return;
    }

    const updateHeight = () => {
      if (footerRef.current) {
        setRootFooterHeight(footerRef.current.offsetHeight);
      }
    };
    updateHeight();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateHeight);
      ro.observe(footerRef.current);
    }

    return () => {
      ro?.disconnect();
      setRootFooterHeight(0);
    };
  }, [docId]);

  // Fecha o popover ao trocar de documento, clicar fora ou pressionar Escape
  useEffect(() => {
    setIsDetailsOpen(false);
    setSelectionMetrics(EMPTY_SELECTION_METRICS);
  }, [docId]);

  useEffect(() => {
    if (!isDetailsOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setIsDetailsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDetailsOpen(false);
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
  }, [isDetailsOpen]);

  // Atualiza nowMs a cada 30s para manter horário estimado e "Hoje/Ontem" precisos
  useEffect(() => {
    if (!docId) return;
    setNowMs(Date.now());
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => clearInterval(intervalId);
  }, [docId, isDetailsOpen]);

  // Calcula métricas do documento de forma assíncrona durante edição e imediata na abertura
  useEffect(() => {
    if (!docId) {
      setDocMap(EMPTY_DOC_MAP);
      lastCountedDocIdRef.current = undefined;
      return;
    }

    const content = docContent ?? '';
    const isNewDocument = lastCountedDocIdRef.current !== docId;
    const sourceChanged = lastCountedSourceRevRef.current !== sourceRevision;
    lastCountedDocIdRef.current = docId;
    lastCountedSourceRevRef.current = sourceRevision;

    if (isNewDocument || sourceChanged) {
      setDocMap(computeDocumentReadingMap(content));
      return;
    }

    if (!isEditable) {
      return;
    }

    const delay = content.length > 80_000 ? 2500 : 800;
    let idleId: number | null = null;

    const timer = setTimeout(() => {
      const runCount = () => {
        setDocMap(computeDocumentReadingMap(content));
      };

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        idleId = (window as any).requestIdleCallback(runCount, { timeout: 2000 });
      } else {
        runCount();
      }
    }, delay);

    return () => {
      clearTimeout(timer);
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        (window as any).cancelIdleCallback(idleId);
      }
    };
  }, [docId, docContent, isEditable, sourceRevision]);

  // Contagem dinâmica de seleção de texto no editor
  useEffect(() => {
    if (!docId) return;
    let rafId: number | null = null;

    const updateSelection = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setSelectionMetrics(readEditorSelectionMetrics());
      });
    };

    document.addEventListener('selectionchange', updateSelection);
    document.addEventListener('keyup', updateSelection, { passive: true });
    document.addEventListener('mouseup', updateSelection, { passive: true });
    return () => {
      document.removeEventListener('selectionchange', updateSelection);
      document.removeEventListener('keyup', updateSelection);
      document.removeEventListener('mouseup', updateSelection);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [docId]);

  // Rastreia progresso de rolagem, progresso dentro da seção atual e alimenta o motor adaptativo
  useEffect(() => {
    if (!docId) return;
    let scrollRafId: number | null = null;

    const updateScrollAndPace = (notifyPace: boolean) => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      const ratio =
        totalHeight > 0 ? Math.min(1, Math.max(0, window.scrollY / totalHeight)) : 1;
      const progress = Math.round(ratio * 100);
      const currentMap = docMapRef.current;
      const currentActiveIdx = tocRef.current.activeIndex;
      const sectionProgress = measureActiveSectionProgress(currentMap, currentActiveIdx);

      setScrollState({
        progress,
        ratio,
        sectionProgress,
      });

      if (notifyPace && currentMap.wordCount > 0) {
        const estimated = computeReadingEstimates({
          map: currentMap,
          scrollProgress: progress,
          scrollRatio: ratio,
          activeHeadingIndex: currentActiveIdx,
          wpm: DEFAULT_READING_WPM,
          nowMs: Date.now(),
          activeSectionProgress: sectionProgress,
        });
        onScrollWordOffsetRef.current(estimated.currentWordOffset);
      }
    };

    const scheduleScroll = (notifyPace: boolean) => {
      if (scrollRafId !== null) return;
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = null;
        updateScrollAndPace(notifyPace);
      });
    };

    const handleScroll = () => scheduleScroll(true);
    const handleResize = () => scheduleScroll(false);

    window.addEventListener('scroll', handleScroll, { passive: true });
    updateScrollAndPace(false);
    const initialRafId = requestAnimationFrame(() => updateScrollAndPace(false));

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(document.body);
    if (document.documentElement) {
      resizeObserver.observe(document.documentElement);
    }

    return () => {
      cancelAnimationFrame(initialRafId);
      if (scrollRafId !== null) {
        cancelAnimationFrame(scrollRafId);
      }
      window.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    };
  }, [docId, docMap.wordCount]);

  const estimates = useMemo(
    () =>
      computeReadingEstimates({
        map: docMap,
        scrollProgress: scrollState.progress,
        scrollRatio: scrollState.ratio,
        activeHeadingIndex: toc.activeIndex,
        wpm: effectiveWpm,
        nowMs,
        activeSectionProgress: scrollState.sectionProgress,
      }),
    [docMap, scrollState, toc.activeIndex, effectiveWpm, nowMs]
  );

  const lastModifiedTimestamp = useMemo(
    () =>
      resolveDocumentLastModifiedTimestamp({
        isDirty,
        lastModifiedAt,
        cloudLastModified,
        localLastModified,
      }),
    [isDirty, lastModifiedAt, cloudLastModified, localLastModified]
  );

  const handleSpeedModeChange = useCallback(
    (mode: ReadingSpeedMode) => {
      setPreferences({ readingSpeedMode: mode });
    },
    [setPreferences]
  );

  const handleSelectFixedPreset = useCallback(
    (wpm: number) => {
      setPreferences({ readingSpeedMode: 'fixed', fixedReadingWpm: wpm });
    },
    [setPreferences]
  );

  if (!docId) return null;

  const hasSelection = selectionMetrics.wordCount > 0 || selectionMetrics.charCount > 0;
  const isAtEnd = docMap.wordCount > 0 && scrollState.progress >= 100;
  const timeDisplay =
    docMap.wordCount === 0
      ? '0 min'
      : formatReadingDuration(estimates.remainingSeconds, { isAtEnd });

  const lastModifiedCompact =
    lastModifiedTimestamp !== null ? formatLastModifiedCompact(lastModifiedTimestamp, nowMs) : null;
  const lastModifiedFull =
    lastModifiedTimestamp !== null ? formatLastModifiedFull(lastModifiedTimestamp) : null;

  return (
    <footer
      ref={footerRef}
      data-reading-status-bar="true"
      aria-label="Barra de informações de leitura"
      className="fixed bottom-0 inset-x-0 z-30 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/70 dark:border-slate-800/80 px-2.5 sm:px-4 select-none print:hidden footer-safe-area"
    >
      <div className="h-5 sm:h-[22px] max-w-7xl mx-auto w-full flex items-center justify-between gap-2 text-[10px] sm:text-[11px] leading-none text-slate-500 dark:text-slate-400 tabular-nums">
        {/* Lado Esquerdo: Página Estimada (prioritária), Palavras e Caracteres (ou Seleção) */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 truncate">
          {hasSelection ? (
            <>
              <span
                className="text-blue-600 dark:text-blue-400 font-medium truncate"
                title={`Seleção: ${formatIntegerPtBr(selectionMetrics.wordCount)} palavras · ${formatIntegerPtBr(selectionMetrics.charCount)} caracteres (${formatIntegerPtBr(selectionMetrics.charCountNoSpaces)} sem espaços)`}
              >
                <span className="sm:hidden">
                  {formatIntegerPtBr(selectionMetrics.wordCount)}/{formatIntegerPtBr(docMap.wordCount)} pal.
                </span>
                <span className="hidden sm:inline">
                  {formatIntegerPtBr(selectionMetrics.wordCount)} / {formatIntegerPtBr(docMap.wordCount)} palavras ·{' '}
                  {formatIntegerPtBr(selectionMetrics.charCount)} / {formatIntegerPtBr(docMap.charCount)} carac.
                </span>
              </span>

              {estimates.totalPages > 0 && (
                <>
                  <span aria-hidden="true" className="hidden sm:inline text-slate-300 dark:text-slate-700">
                    ·
                  </span>
                  <span
                    className="hidden sm:inline shrink-0"
                    title={`Página estimada ${estimates.currentPage} de ${estimates.totalPages} (base: 275 palavras/página)`}
                  >
                    Pág. {estimates.currentPage}/{estimates.totalPages}
                  </span>
                </>
              )}
            </>
          ) : estimates.totalPages > 0 ? (
            <>
              <span
                className="shrink-0"
                title={`Página estimada ${estimates.currentPage} de ${estimates.totalPages} (base: 275 palavras/página)`}
              >
                Pág. {estimates.currentPage}/{estimates.totalPages}
              </span>
              <span aria-hidden="true" className="hidden sm:inline text-slate-300 dark:text-slate-700">
                ·
              </span>
              <span
                className="hidden sm:inline truncate"
                title={`${formatIntegerPtBr(docMap.wordCount)} palavras · ${formatIntegerPtBr(docMap.charCount)} caracteres (${formatIntegerPtBr(docMap.charCountNoSpaces)} sem espaços)`}
              >
                {formatIntegerPtBr(docMap.wordCount)} palavras · {formatIntegerPtBr(docMap.charCount)} carac.
              </span>
            </>
          ) : (
            <span
              className="truncate"
              title="0 palavras · 0 caracteres"
            >
              0 palavras
            </span>
          )}
        </div>

        {/* Lado Direito: Grifos, Comentários, Modificação, Seção e % / Tempo de Leitura */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Quantidade de Grifos (clique vai ao último grifo) */}
          <button
            type="button"
            disabled={highlightCount === 0}
            onClick={requestScrollToLatestHighlight}
            title={
              highlightCount > 0
                ? `${highlightCount} ${highlightCount === 1 ? 'grifo' : 'grifos'} — Clique para ir ao último (J)`
                : 'Nenhum grifo no documento'
            }
            aria-label={
              highlightCount > 0
                ? `${highlightCount} grifos — ir para o último grifo`
                : '0 grifos'
            }
            className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${
              highlightCount > 0
                ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer'
                : 'text-slate-400 dark:text-slate-500 cursor-default'
            }`}
          >
            <Highlighter className="w-3 h-3 shrink-0" />
            <span>{highlightCount}</span>
          </button>

          {/* Quantidade de Comentários (clique vai ao último comentário) */}
          <button
            type="button"
            disabled={activeCommentCount === 0}
            onClick={requestScrollToLatestComment}
            title={
              activeCommentCount > 0
                ? `${activeCommentCount} ${activeCommentCount === 1 ? 'comentário' : 'comentários'} — Clique para ir ao último (K)`
                : 'Nenhum comentário no documento'
            }
            aria-label={
              activeCommentCount > 0
                ? `${activeCommentCount} comentários — ir para o último comentário`
                : '0 comentários'
            }
            className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${
              activeCommentCount > 0
                ? 'text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 cursor-pointer'
                : 'text-slate-400 dark:text-slate-500 cursor-default'
            }`}
          >
            <MessageSquareText className="w-3 h-3 shrink-0" />
            <span>{activeCommentCount}</span>
          </button>

          {/* Data da Última Modificação */}
          {lastModifiedCompact && (
            <span
              className="hidden md:inline-flex items-center gap-1 text-slate-400 dark:text-slate-500"
              title={`Última modificação: ${lastModifiedFull}`}
            >
              <Clock className="w-3 h-3 shrink-0" />
              <span>{lastModifiedCompact}</span>
            </span>
          )}

          {/* Tempo Restante na Seção Atual */}
          {estimates.sectionRemainingSeconds !== null && !isAtEnd && (
            <span
              className="hidden lg:inline-flex items-center gap-1 text-slate-400 dark:text-slate-500 max-w-[140px] truncate"
              title={
                estimates.sectionTitle
                  ? `Tempo restante na seção "${estimates.sectionTitle}"`
                  : 'Tempo restante na seção atual'
              }
            >
              <span>Seção: {formatReadingDuration(estimates.sectionRemainingSeconds)}</span>
            </span>
          )}

          {/* % + Tempo de Leitura + Popover de Detalhes */}
          <div className="relative flex items-center" ref={popoverRef}>
            <button
              type="button"
              onClick={() => setIsDetailsOpen((prev) => !prev)}
              aria-expanded={isDetailsOpen}
              aria-label="Detalhes de leitura e ritmo"
              title={
                estimates.estimatedFinishTime
                  ? `${scrollState.progress}% lido · ${timeDisplay} restante (~${effectiveWpm} ppm) · Clique para detalhes`
                  : `${scrollState.progress}% lido · Clique para detalhes`
              }
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-colors cursor-pointer ${
                isDetailsOpen
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/80'
              }`}
            >
              <span className="font-semibold">{scrollState.progress}%</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                ·
              </span>
              <span>{timeDisplay}</span>
            </button>

            {isDetailsOpen && (
              <div
                role="dialog"
                aria-label="Detalhes de leitura"
                className="absolute bottom-full right-0 mb-1.5 w-72 max-w-[calc(100vw-1rem)] bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-3 z-50 text-xs text-slate-700 dark:text-slate-200 space-y-2.5 animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 dark:border-slate-700/70">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
                    <Gauge className="w-3.5 h-3.5 text-blue-500" />
                    <span>Detalhes de Leitura</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300">
                    {readingSpeedMode === 'adaptive' ? `~${effectiveWpm} ppm` : `${effectiveWpm} ppm fixo`}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <div>
                    <div className="text-slate-400 dark:text-slate-500 text-[10px]">Restante</div>
                    <div className="font-semibold text-slate-800 dark:text-slate-100">
                      {timeDisplay}
                      {estimates.estimatedFinishTime && (
                        <span className="font-normal text-slate-500 dark:text-slate-400">
                          {' '}
                          (~{estimates.estimatedFinishTime})
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 dark:text-slate-500 text-[10px]">Tempo total</div>
                    <div className="font-semibold text-slate-800 dark:text-slate-100">
                      {docMap.wordCount > 0 ? formatReadingDuration(estimates.totalSeconds) : '0 min'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 dark:text-slate-500 text-[10px]">Página estimada</div>
                    <div className="font-medium text-slate-700 dark:text-slate-200">
                      {estimates.totalPages > 0
                        ? `${estimates.currentPage} de ${estimates.totalPages}`
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 dark:text-slate-500 text-[10px]">Palavras</div>
                    <div className="font-medium text-slate-700 dark:text-slate-200">
                      {formatIntegerPtBr(docMap.wordCount)}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-slate-400 dark:text-slate-500 text-[10px]">Caracteres</div>
                    <div className="font-medium text-slate-700 dark:text-slate-200">
                      {formatIntegerPtBr(docMap.charCount)}{' '}
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        ({formatIntegerPtBr(docMap.charCountNoSpaces)} sem espaços)
                      </span>
                    </div>
                  </div>
                </div>

                {estimates.sectionTitle && (
                  <div className="pt-1.5 border-t border-slate-100 dark:border-slate-700/70 text-[11px] flex items-center justify-between gap-2">
                    <span className="truncate text-slate-500 dark:text-slate-400" title={estimates.sectionTitle}>
                      Seção: <strong className="text-slate-700 dark:text-slate-200">{estimates.sectionTitle}</strong>
                    </span>
                    <span className="shrink-0 font-semibold text-slate-700 dark:text-slate-200">
                      {estimates.sectionRemainingSeconds !== null && !isAtEnd
                        ? formatReadingDuration(estimates.sectionRemainingSeconds)
                        : 'Fim'}
                    </span>
                  </div>
                )}

                {lastModifiedFull && (
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>Modificado em {lastModifiedFull}</span>
                  </div>
                )}

                {/* Controle de Ritmo de Leitura */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-700/70 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Ritmo de Leitura
                    </span>
                    <div className="p-0.5 bg-slate-100 dark:bg-slate-700/70 rounded-lg flex items-center text-[10px]">
                      <button
                        type="button"
                        onClick={() => handleSpeedModeChange('adaptive')}
                        className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                          readingSpeedMode === 'adaptive'
                            ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-xs'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                      >
                        Adaptativo
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSpeedModeChange('fixed')}
                        className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                          readingSpeedMode === 'fixed'
                            ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-xs'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                      >
                        Fixo
                      </button>
                    </div>
                  </div>

                  {readingSpeedMode === 'adaptive' ? (
                    <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                      <span className="leading-snug">
                        {isCalibrated
                          ? `Calibrado (~${adaptiveWpm} ppm). Ignora pausas e saltos.`
                          : `Calibrando conforme você lê (~${adaptiveWpm} ppm).`}
                      </span>
                      {(totalGlobalSamples > 0 || docSamples > 0) && (
                        <button
                          type="button"
                          onClick={recalibrate}
                          title="Resetar calibração do ritmo adaptativo"
                          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200 font-medium transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          <span>Recalibrar</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      {FIXED_WPM_PRESETS.map((preset) => {
                        const isActive = fixedReadingWpm === preset.wpm;
                        return (
                          <button
                            key={preset.wpm}
                            type="button"
                            onClick={() => handleSelectFixedPreset(preset.wpm)}
                            className={`py-1 px-1.5 rounded-lg text-[10px] font-medium transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-blue-600 text-white shadow-xs'
                                : 'bg-slate-100 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                            }`}
                          >
                            {preset.label} {preset.wpm}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
};
