import { useState, useEffect, useRef, useCallback } from 'react';
import { Editor } from '@tiptap/react';
import { useAppStore } from '../store/useAppStore';
import {
  DEFAULT_SEARCH_OPTIONS,
  SearchOptions,
  TextMatchRange,
  findMatchesInProseMirrorDoc,
  findMatchesInRawText,
  createReplaceTransaction,
  createReplaceAllTransaction,
  replaceSingleInRawText,
  replaceAllInRawText,
} from '../services/searchReplaceService';
import { setSearchHighlightState } from '../components/editor/SearchHighlightExtension';
import { getStickyTopOffsetPx } from '../services/tocService';
import { measureTextareaOffsetTopPx } from '../services/sourceScrollSyncService';

export interface UseDocumentSearchParams {
  readonly editor: Editor | null;
  readonly docId?: string;
  readonly isEditable: boolean;
  readonly isSourceMode: boolean;
  readonly rawContent: string;
  readonly rawTextareaRef: React.RefObject<HTMLTextAreaElement>;
  readonly onApplyRawReplacement: (nextRaw: string, cursorOffset?: number) => void;
  readonly onScheduleDebouncedContent: () => void;
  readonly onUpdateVisualHighlightCount: (editor: Editor | null) => void;
  readonly onUpdateSourceHighlightCount: (rawMarkdown: string) => void;
}

function findFirstMatchIndexAtOrAfter(
  matches: ReadonlyArray<TextMatchRange>,
  minOffset: number
): number {
  if (matches.length === 0) return -1;
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from >= minOffset) {
      return i;
    }
  }
  return 0;
}

function getSafeStickyTopWithSearchBar(): number {
  const baseSticky = getStickyTopOffsetPx();
  if (typeof document === 'undefined') return baseSticky;
  const findBarEl = document.querySelector('[data-find-replace-bar]') as HTMLElement | null;
  if (!findBarEl) return baseSticky;
  const rect = findBarEl.getBoundingClientRect();
  return rect.bottom > baseSticky ? Math.round(rect.bottom + 8) : baseSticky;
}

function isBlockingModalOpen(): boolean {
  const s = useAppStore.getState();
  return Boolean(
    s.isOneDriveModalOpen ||
      s.isSettingsModalOpen ||
      s.isRecentModalOpen ||
      s.isInstallModalOpen ||
      s.isSaveDestinationModalOpen ||
      s.cloudConflict
  );
}

export function useDocumentSearch({
  editor,
  docId,
  isEditable,
  isSourceMode,
  rawContent,
  rawTextareaRef,
  onApplyRawReplacement,
  onScheduleDebouncedContent,
  onUpdateVisualHighlightCount,
  onUpdateSourceHighlightCount,
}: UseDocumentSearchParams) {
  const isSearchOpen = useAppStore((state) => state.isSearchOpen);
  const isReplaceExpanded = useAppStore((state) => state.isReplaceExpanded);
  const openSearch = useAppStore((state) => state.openSearch);
  const closeSearch = useAppStore((state) => state.closeSearch);
  const setIsReplaceExpanded = useAppStore((state) => state.setIsReplaceExpanded);

  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const [matches, setMatches] = useState<ReadonlyArray<TextMatchRange>>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [replaceFeedback, setReplaceFeedback] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const queryRef = useRef(query);
  queryRef.current = query;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const isSourceModeRef = useRef(isSourceMode);
  isSourceModeRef.current = isSourceMode;
  const isEditableRef = useRef(isEditable);
  isEditableRef.current = isEditable;
  const rawContentRef = useRef(rawContent);
  rawContentRef.current = rawContent;

  const suppressNextEditorRecomputeRef = useRef(false);
  const pendingMinOffsetRef = useRef<number | null>(null);
  const pendingScrollAfterRecomputeRef = useRef(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recomputeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTransientFeedback = useCallback((msg: string) => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    setReplaceFeedback(msg);
    feedbackTimerRef.current = setTimeout(() => {
      setReplaceFeedback(null);
      feedbackTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    activeIndexRef.current = -1;
    setActiveIndex(-1);
    setReplaceFeedback(null);
    pendingMinOffsetRef.current = null;
  }, [docId]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (recomputeTimerRef.current) clearTimeout(recomputeTimerRef.current);
    };
  }, []);

  const scrollToMatch = useCallback(
    (match: TextMatchRange | undefined, sourceModeActive: boolean, currentRaw: string) => {
      if (!match || typeof window === 'undefined') return;

      const comfortTop = getSafeStickyTopWithSearchBar() + 18;
      const viewportHeight = window.innerHeight || 720;
      const comfortBottom = Math.max(comfortTop + 80, viewportHeight - 64);

      if (sourceModeActive) {
        const textarea = rawTextareaRef.current;
        if (!textarea) return;

        // Atualiza a seleção interna sem roubar o foco da barra de busca
        if (document.activeElement !== textarea) {
          try {
            textarea.setSelectionRange(match.from, match.to);
          } catch {
            // ignore em ambientes sem suporte
          }
        }

        const localY = measureTextareaOffsetTopPx(textarea, currentRaw, match.from);
        const rect = textarea.getBoundingClientRect();
        const matchViewportTop = rect.top + localY;

        if (matchViewportTop < comfortTop || matchViewportTop > comfortBottom) {
          const targetScrollY = Math.max(
            0,
            window.scrollY +
              matchViewportTop -
              comfortTop -
              Math.round((viewportHeight - comfortTop) * 0.18)
          );
          window.scrollTo({ top: targetScrollY, left: 0, behavior: 'smooth' });
        }
        return;
      }

      if (!editor || editor.isDestroyed) return;

      try {
        const coords = editor.view.coordsAtPos(match.from);
        if (coords.top < comfortTop || coords.bottom > comfortBottom) {
          const targetScrollY = Math.max(
            0,
            window.scrollY +
              coords.top -
              comfortTop -
              Math.round((viewportHeight - comfortTop) * 0.18)
          );
          window.scrollTo({ top: targetScrollY, left: 0, behavior: 'smooth' });
        }
      } catch {
        // Posição pode ficar temporariamente fora do layout em transição
      }
    },
    [editor, rawTextareaRef]
  );

  const runComputeMatches = useCallback(
    (shouldScrollToActive: boolean) => {
      if (!isSearchOpen) {
        setSearchHighlightState(editor, [], -1);
        setMatches([]);
        setActiveIndex(-1);
        setError(null);
        return;
      }

      const currentQuery = queryRef.current;
      const currentOptions = optionsRef.current;
      const sourceMode = isSourceModeRef.current;

      const result = sourceMode
        ? findMatchesInRawText(rawContentRef.current, currentQuery, currentOptions)
        : findMatchesInProseMirrorDoc(editor?.state.doc, currentQuery, currentOptions);

      if (result.error) {
        setError(result.error);
        setMatches([]);
        setActiveIndex(-1);
        if (!sourceMode) {
          setSearchHighlightState(editor, [], -1);
        }
        return;
      }

      setError(null);
      const nextMatches = result.matches;
      let nextIdx = -1;

      if (nextMatches.length > 0) {
        if (pendingMinOffsetRef.current !== null) {
          nextIdx = findFirstMatchIndexAtOrAfter(nextMatches, pendingMinOffsetRef.current);
          pendingMinOffsetRef.current = null;
        } else if (activeIndexRef.current >= 0 && activeIndexRef.current < nextMatches.length) {
          nextIdx = activeIndexRef.current;
        } else if (sourceMode && rawTextareaRef.current) {
          const caretStart = rawTextareaRef.current.selectionStart ?? 0;
          nextIdx = findFirstMatchIndexAtOrAfter(nextMatches, caretStart);
        } else if (!sourceMode && editor && !editor.isDestroyed) {
          const caretStart = editor.state.selection.from;
          nextIdx = findFirstMatchIndexAtOrAfter(nextMatches, caretStart);
        } else {
          nextIdx = 0;
        }
      } else {
        pendingMinOffsetRef.current = null;
      }

      setMatches(nextMatches);
      setActiveIndex(nextIdx);

      if (sourceMode) {
        setSearchHighlightState(editor, [], -1);
      } else {
        setSearchHighlightState(editor, nextMatches, nextIdx);
      }

      if (shouldScrollToActive && nextIdx >= 0 && nextMatches[nextIdx]) {
        requestAnimationFrame(() => {
          scrollToMatch(nextMatches[nextIdx], sourceMode, rawContentRef.current);
        });
      }
    },
    [isSearchOpen, editor, rawTextareaRef, scrollToMatch]
  );

  // Recalcula ocorrências quando a busca abre/fecha, query/opções/modo/conteúdo mudam
  useEffect(() => {
    if (recomputeTimerRef.current) {
      clearTimeout(recomputeTimerRef.current);
      recomputeTimerRef.current = null;
    }

    if (!isSearchOpen) {
      setSearchHighlightState(editor, [], -1);
      setMatches([]);
      setActiveIndex(-1);
      setError(null);
      setReplaceFeedback(null);
      pendingMinOffsetRef.current = null;
      pendingScrollAfterRecomputeRef.current = false;
      return;
    }

    const shouldScroll =
      pendingScrollAfterRecomputeRef.current || pendingMinOffsetRef.current !== null;
    pendingScrollAfterRecomputeRef.current = false;

    const textLen = isSourceMode
      ? rawContent.length
      : editor?.state.doc.content.size ?? 0;
    const delay = textLen > 60000 && query.length === 1 && !shouldScroll ? 75 : 0;

    if (delay === 0) {
      runComputeMatches(shouldScroll);
    } else {
      recomputeTimerRef.current = setTimeout(() => {
        recomputeTimerRef.current = null;
        runComputeMatches(shouldScroll);
      }, delay);
    }
  }, [isSearchOpen, query, options, isSourceMode, rawContent, docId, editor, runComputeMatches]);

  // Recalcula ocorrências automaticamente quando o usuário edita no ProseMirror com a busca aberta
  useEffect(() => {
    if (!editor || editor.isDestroyed || !isSearchOpen || isSourceMode) return;

    const handleTransaction = ({ transaction }: { transaction: any }) => {
      if (!transaction?.docChanged) return;
      if (suppressNextEditorRecomputeRef.current) {
        suppressNextEditorRecomputeRef.current = false;
        return;
      }
      runComputeMatches(false);
    };

    editor.on('transaction', handleTransaction);
    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor, isSearchOpen, isSourceMode, runComputeMatches]);

  const navigateToIndex = useCallback(
    (targetIdx: number) => {
      const currentMatches = matchesRef.current;
      if (currentMatches.length === 0) return;

      const wrappedIdx =
        ((targetIdx % currentMatches.length) + currentMatches.length) %
        currentMatches.length;

      setActiveIndex(wrappedIdx);
      if (!isSourceModeRef.current) {
        setSearchHighlightState(editor, currentMatches, wrappedIdx);
      }
      scrollToMatch(currentMatches[wrappedIdx], isSourceModeRef.current, rawContentRef.current);
    },
    [editor, scrollToMatch]
  );

  const findNext = useCallback(() => {
    const currentMatches = matchesRef.current;
    if (currentMatches.length === 0) return;
    const nextIdx = activeIndexRef.current < 0 ? 0 : activeIndexRef.current + 1;
    navigateToIndex(nextIdx);
  }, [navigateToIndex]);

  const findPrev = useCallback(() => {
    const currentMatches = matchesRef.current;
    if (currentMatches.length === 0) return;
    const prevIdx =
      activeIndexRef.current < 0
        ? currentMatches.length - 1
        : activeIndexRef.current - 1;
    navigateToIndex(prevIdx);
  }, [navigateToIndex]);

  const handleQueryChange = useCallback((nextQuery: string) => {
    setReplaceFeedback(null);
    pendingScrollAfterRecomputeRef.current = true;
    // Ao alterar o texto buscado, reposiciona a partir do início/caret em vez de reutilizar índice antigo
    setActiveIndex(-1);
    setQuery(nextQuery);
  }, []);

  const handleToggleOption = useCallback((key: keyof SearchOptions) => {
    setReplaceFeedback(null);
    pendingScrollAfterRecomputeRef.current = true;
    setActiveIndex(-1);
    setOptions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const handleReplaceCurrent = useCallback(() => {
    const currentMatches = matchesRef.current;
    const idx = activeIndexRef.current;
    if (currentMatches.length === 0 || idx < 0 || idx >= currentMatches.length) {
      return;
    }

    const targetMatch = currentMatches[idx];
    const minNextOffset = targetMatch.from + replacement.length;

    if (isSourceModeRef.current) {
      const { nextText, nextCursorOffset } = replaceSingleInRawText(
        rawContentRef.current,
        targetMatch,
        replacement
      );
      pendingMinOffsetRef.current = minNextOffset;
      pendingScrollAfterRecomputeRef.current = true;
      onApplyRawReplacement(nextText, nextCursorOffset);
      onUpdateSourceHighlightCount(nextText);
      showTransientFeedback('1 ocorrência substituída');
      return;
    }

    if (!editor || editor.isDestroyed) return;
    const tr = createReplaceTransaction(editor.state, targetMatch, replacement);
    if (!tr) return;

    suppressNextEditorRecomputeRef.current = true;
    try {
      editor.view.dispatch(tr);
    } finally {
      suppressNextEditorRecomputeRef.current = false;
    }

    onScheduleDebouncedContent();
    if (replacement.length === 0) {
      onUpdateVisualHighlightCount(editor);
    }

    pendingMinOffsetRef.current = minNextOffset;
    runComputeMatches(true);
    showTransientFeedback('1 ocorrência substituída');
  }, [
    replacement,
    editor,
    onApplyRawReplacement,
    onScheduleDebouncedContent,
    onUpdateSourceHighlightCount,
    onUpdateVisualHighlightCount,
    runComputeMatches,
    showTransientFeedback,
  ]);

  const handleReplaceAll = useCallback(() => {
    const currentMatches = matchesRef.current;
    if (currentMatches.length === 0) return;

    if (isSourceModeRef.current) {
      const { nextText, replacedCount } = replaceAllInRawText(
        rawContentRef.current,
        currentMatches,
        replacement
      );
      if (replacedCount === 0) return;
      pendingMinOffsetRef.current = 0;
      onApplyRawReplacement(nextText, 0);
      onUpdateSourceHighlightCount(nextText);
      showTransientFeedback(
        `${replacedCount} ${replacedCount === 1 ? 'ocorrência substituída' : 'ocorrências substituídas'}`
      );
      return;
    }

    if (!editor || editor.isDestroyed) return;
    const count = currentMatches.length;
    const tr = createReplaceAllTransaction(editor.state, currentMatches, replacement);
    if (!tr) return;

    suppressNextEditorRecomputeRef.current = true;
    try {
      editor.view.dispatch(tr);
    } finally {
      suppressNextEditorRecomputeRef.current = false;
    }

    onScheduleDebouncedContent();
    if (replacement.length === 0) {
      onUpdateVisualHighlightCount(editor);
    }

    pendingMinOffsetRef.current = 0;
    runComputeMatches(false);
    showTransientFeedback(
      `${count} ${count === 1 ? 'ocorrência substituída' : 'ocorrências substituídas'}`
    );
  }, [
    replacement,
    editor,
    onApplyRawReplacement,
    onScheduleDebouncedContent,
    onUpdateSourceHighlightCount,
    onUpdateVisualHighlightCount,
    runComputeMatches,
    showTransientFeedback,
  ]);

  const closeSearchAndRestoreFocus = useCallback(() => {
    const lastMatch =
      activeIndexRef.current >= 0 ? matchesRef.current[activeIndexRef.current] : undefined;

    closeSearch();

    requestAnimationFrame(() => {
      if (isSourceModeRef.current && rawTextareaRef.current) {
        const textarea = rawTextareaRef.current;
        textarea.focus({ preventScroll: true });
        if (lastMatch) {
          const safeStart = Math.min(lastMatch.from, rawContentRef.current.length);
          const safeEnd = Math.min(lastMatch.to, rawContentRef.current.length);
          textarea.setSelectionRange(safeStart, safeEnd);
        }
      } else if (isEditableRef.current && editor && !editor.isDestroyed) {
        if (lastMatch && lastMatch.to <= editor.state.doc.content.size) {
          editor.commands.setTextSelection(lastMatch.to);
        }
        editor.view.focus();
      }
    });
  }, [closeSearch, editor, rawTextareaRef]);

  const getSelectedShortText = useCallback((): string => {
    if (isSourceModeRef.current && rawTextareaRef.current) {
      const { selectionStart, selectionEnd } = rawTextareaRef.current;
      if (selectionStart !== selectionEnd) {
        const sel = rawContentRef.current.slice(selectionStart, selectionEnd);
        if (!sel.includes('\n') && sel.trim().length > 0 && sel.length <= 120) {
          return sel;
        }
      }
      return '';
    }

    if (editor && !editor.isDestroyed) {
      const { from, to, empty } = editor.state.selection;
      if (!empty && from !== to) {
        const sel = editor.state.doc.textBetween(from, to, ' ');
        if (!sel.includes('\n') && sel.trim().length > 0 && sel.length <= 120) {
          return sel;
        }
      }
    }

    return '';
  }, [editor, rawTextareaRef]);

  const focusSearchInput = useCallback(() => {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  // Atalhos globais Ctrl+F / Cmd+F, Ctrl+H / Cmd+H, F3 / Shift+F3 e Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isBlockingModalOpen()) return;
      if (!useAppStore.getState().document) return;

      const isMod = (e.ctrlKey || e.metaKey) && !e.altKey;
      const lowerKey = e.key.toLowerCase();

      if (isMod && !e.shiftKey && lowerKey === 'f') {
        e.preventDefault();
        const selectedText = getSelectedShortText();
        if (selectedText) {
          pendingScrollAfterRecomputeRef.current = true;
          setActiveIndex(-1);
          setQuery(selectedText);
        }
        openSearch();
        focusSearchInput();
        return;
      }

      if (isMod && !e.shiftKey && lowerKey === 'h') {
        e.preventDefault();
        const wasAlreadyOpen = useAppStore.getState().isSearchOpen;
        const selectedText = getSelectedShortText();
        if (selectedText) {
          pendingScrollAfterRecomputeRef.current = true;
          setActiveIndex(-1);
          setQuery(selectedText);
        }
        openSearch({ expandReplace: true });

        if (wasAlreadyOpen && queryRef.current.length > 0 && !selectedText) {
          requestAnimationFrame(() => {
            replaceInputRef.current?.focus();
            replaceInputRef.current?.select();
          });
        } else {
          focusSearchInput();
        }
        return;
      }

      if (!useAppStore.getState().isSearchOpen) return;

      if (e.key === 'F3' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) {
          findPrev();
        } else {
          findNext();
        }
        return;
      }

      if (e.key === 'Escape' && !e.defaultPrevented) {
        const target = e.target as HTMLElement | null;
        if (target?.closest('[role="dialog"]')) return;
        e.preventDefault();
        closeSearchAndRestoreFocus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    openSearch,
    getSelectedShortText,
    focusSearchInput,
    findNext,
    findPrev,
    closeSearchAndRestoreFocus,
  ]);

  // Ao abrir a busca pelo botão do Header, foca automaticamente no campo de busca
  const prevIsSearchOpenRef = useRef(isSearchOpen);
  useEffect(() => {
    const wasOpen = prevIsSearchOpenRef.current;
    prevIsSearchOpenRef.current = isSearchOpen;
    if (!wasOpen && isSearchOpen) {
      const selectedText = getSelectedShortText();
      if (selectedText) {
        pendingScrollAfterRecomputeRef.current = true;
        setActiveIndex(-1);
        setQuery(selectedText);
      }
      focusSearchInput();
    }
  }, [isSearchOpen, getSelectedShortText, focusSearchInput]);

  return {
    isOpen: isSearchOpen,
    isReplaceExpanded,
    query,
    replacement,
    options,
    matches,
    activeIndex,
    error,
    replaceFeedback,
    searchInputRef,
    replaceInputRef,
    onQueryChange: handleQueryChange,
    onReplacementChange: setReplacement,
    onToggleOption: handleToggleOption,
    onToggleReplaceExpanded: () => setIsReplaceExpanded(!isReplaceExpanded),
    onNext: findNext,
    onPrev: findPrev,
    onReplaceCurrent: handleReplaceCurrent,
    onReplaceAll: handleReplaceAll,
    onClose: closeSearchAndRestoreFocus,
  };
}
