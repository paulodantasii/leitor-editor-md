/**
 * Hook controlador do ciclo de vida, gestos (PC mouse / iPad touch), ações e estado
 * do seletor flutuante de cores e comentários de grifos (<mark>).
 *
 * Mantém estado próprio independente de `<BubbleMenu>`, `tippy.js` e `editor.state.selection`
 * para evitar dessincronizações no PC em modo não editável.
 *
 * @see docs/HIGHLIGHT_POPOVER_GOTCHAS.md
 */

import { useState, useRef, useEffect, useCallback, type RefObject, type MutableRefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { HighlightColor } from '../types';
import { ensureHighlightIdAtPos } from '../services/highlightIdService';
import {
  setHighlightComment,
  deleteHighlightComment,
} from '../services/highlightCommentsService';
import {
  ActiveHighlightPopoverState,
  ViewportRect,
  isValidDesktopClick,
  isValidTouchTap,
  parseHighlightColorFromElement,
  resolveHighlightTargetInDoc,
  isSamePopoverTarget,
  createUpdateHighlightColorTransaction,
  createRemoveHighlightTransaction,
} from '../services/highlightPopoverGeometry';

const SYNTHETIC_MOUSE_GUARD_MS = 450;
const POST_HIGHLIGHT_SUPPRESSION_MS = 250;

export interface UseHighlightPopoverControllerOptions {
  readonly editor: Editor | null;
  readonly containerRef: RefObject<HTMLDivElement>;
  readonly docId: string | undefined;
  readonly isEditable: boolean;
  readonly isSourceMode: boolean;
  readonly justAppliedHighlightAtRef: MutableRefObject<number>;
  readonly highlightTimeoutRef: MutableRefObject<NodeJS.Timeout | null>;
  readonly onCommentsVersionBump: () => void;
  readonly onScheduleDebouncedContent: () => void;
  readonly onScheduleCommentDomSync: (ed: Editor | null) => void;
  readonly onScheduleDebouncedHighlightCount: (ed: Editor | null) => void;
}

export interface HighlightPopoverController {
  readonly activePopover: ActiveHighlightPopoverState | null;
  readonly isPopoverOpenRef: MutableRefObject<boolean>;
  readonly isCommentBoxOpenRef: MutableRefObject<boolean>;
  readonly closePopover: () => void;
  readonly getAnchorViewportRect: () => ViewportRect | null;
  readonly handleSelectColor: (color: HighlightColor) => void;
  readonly handleRemoveHighlight: () => void;
  readonly handleToggleComment: () => void;
  readonly handleChangeComment: (nextComment: string) => void;
  readonly handleDeleteComment: () => void;
}

export function useHighlightPopoverController({
  editor,
  containerRef,
  docId,
  isEditable,
  isSourceMode,
  justAppliedHighlightAtRef,
  highlightTimeoutRef,
  onCommentsVersionBump,
  onScheduleDebouncedContent,
  onScheduleCommentDomSync,
  onScheduleDebouncedHighlightCount,
}: UseHighlightPopoverControllerOptions): HighlightPopoverController {
  const [activePopover, setActivePopover] = useState<ActiveHighlightPopoverState | null>(null);
  const activePopoverRef = useRef<ActiveHighlightPopoverState | null>(null);
  const isPopoverOpenRef = useRef(false);
  const isCommentBoxOpenRef = useRef(false);

  const lastTouchTimeRef = useRef(0);
  const mouseDownRef = useRef<{ x: number; y: number; button: number } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const prevDocIdRef = useRef<string | undefined>(docId);

  const commitPopoverState = useCallback((next: ActiveHighlightPopoverState | null) => {
    activePopoverRef.current = next;
    isPopoverOpenRef.current = next !== null;
    isCommentBoxOpenRef.current = next?.isCommentOpen === true;
    setActivePopover(next);
  }, []);

  const closePopover = useCallback(() => {
    if (!activePopoverRef.current && !isPopoverOpenRef.current) return;
    commitPopoverState(null);
  }, [commitPopoverState]);

  const getAnchorViewportRect = useCallback((): ViewportRect | null => {
    const current = activePopoverRef.current;
    if (!current || !editor || editor.isDestroyed) return null;

    try {
      const docSize = editor.state.doc.content.size;
      if (docSize <= 0) return null;

      const safePos = Math.max(0, Math.min(current.anchorPos, docSize));
      const coords = editor.view.coordsAtPos(safePos, 1);
      if (
        !coords ||
        !Number.isFinite(coords.top) ||
        !Number.isFinite(coords.bottom) ||
        !Number.isFinite(coords.left) ||
        !Number.isFinite(coords.right)
      ) {
        return null;
      }

      return {
        left: coords.left,
        right: coords.right,
        top: coords.top,
        bottom: coords.bottom,
      };
    } catch (err) {
      console.debug('Failed to resolve highlight popover anchor coordinates:', err);
      return null;
    }
  }, [editor]);

  const handleMarkActivation = useCallback(
    (markEl: HTMLElement, clientX: number, clientY: number): boolean => {
      if (!editor || editor.isDestroyed) return false;

      let fallbackStartPos: number | null = null;
      try {
        const textNode = markEl.firstChild || markEl;
        fallbackStartPos = editor.view.posAtDOM(textNode, 0);
      } catch (err) {
        console.debug('posAtDOM failed for mark element, trying coords only:', err);
        fallbackStartPos = null;
      }

      let hitPos: number | null = null;
      try {
        const hit = editor.view.posAtCoords({ left: clientX, top: clientY });
        hitPos = hit ? hit.pos : null;
      } catch (err) {
        console.debug('posAtCoords failed for mark element:', err);
        hitPos = null;
      }

      const domId = markEl.getAttribute('data-id') || markEl.getAttribute('data-hl-id');
      const domColor = parseHighlightColorFromElement(markEl);

      const resolved = resolveHighlightTargetInDoc(editor.state.doc, {
        candidatePos: hitPos,
        fallbackStartPos,
        domId,
        domColor,
      });

      if (!resolved) return false;

      if (isSamePopoverTarget(activePopoverRef.current, resolved)) {
        closePopover();
        return true;
      }

      commitPopoverState({
        highlightId: resolved.highlightId,
        legacyRange: resolved.highlightId ? null : resolved.range,
        anchorPos: resolved.anchorPos,
        color: resolved.color,
        isCommentOpen: false,
      });
      return true;
    },
    [editor, closePopover, commitPopoverState]
  );

  // Fecha automaticamente ao entrar em Modo Edição ou Código-Fonte
  useEffect(() => {
    if (isEditable || isSourceMode) {
      closePopover();
    }
  }, [isEditable, isSourceMode, closePopover]);

  // Fecha automaticamente ao trocar de documento/aba
  useEffect(() => {
    if (prevDocIdRef.current !== docId) {
      prevDocIdRef.current = docId;
      closePopover();
    }
  }, [docId, closePopover]);

  // Fecha imediatamente ao pressionar Escape enquanto o seletor estiver aberto
  useEffect(() => {
    if (!activePopover) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePopover();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activePopover, closePopover]);

  // Gerencia clique do mouse (PC) e toque rápido (iPad/mobile)
  useEffect(() => {
    if (!editor || editor.isDestroyed || isEditable || isSourceMode) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (!editor || editor.isDestroyed || isEditable || isSourceMode) return;
      if (Date.now() - lastTouchTimeRef.current < SYNTHETIC_MOUSE_GUARD_MS) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (target.closest('[data-highlight-popover]')) return;

      if (e.button === 0) {
        mouseDownRef.current = { x: e.clientX, y: e.clientY, button: e.button };
      } else {
        mouseDownRef.current = null;
      }

      const markEl = target.closest('mark');
      if (markEl && containerRef.current?.contains(markEl)) {
        return;
      }

      if (activePopoverRef.current) {
        closePopover();
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!editor || editor.isDestroyed || isEditable || isSourceMode) return;
      if (Date.now() - lastTouchTimeRef.current < SYNTHETIC_MOUSE_GUARD_MS) return;

      const down = mouseDownRef.current;
      mouseDownRef.current = null;

      if (Date.now() - justAppliedHighlightAtRef.current < POST_HIGHLIGHT_SUPPRESSION_MS) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (!target || target.closest('[data-highlight-popover]')) return;
      if (!down) return;

      if (!isValidDesktopClick(down.x, down.y, e.clientX, e.clientY, e.button)) {
        if (down.button === 0 && activePopoverRef.current) {
          closePopover();
        }
        return;
      }

      if (e.shiftKey) return;

      const domSel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (domSel && !domSel.isCollapsed) {
        if (activePopoverRef.current) {
          closePopover();
        }
        return;
      }

      const markEl = target.closest('mark');
      if (markEl && containerRef.current?.contains(markEl)) {
        handleMarkActivation(markEl, e.clientX, e.clientY);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (!editor || editor.isDestroyed || isEditable || isSourceMode) return;
      if (e.touches.length !== 1) {
        touchStartRef.current = null;
        return;
      }
      const touch = e.touches[0];
      if (!touch) return;

      const now = Date.now();
      lastTouchTimeRef.current = now;
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: now };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!editor || editor.isDestroyed || isEditable || isSourceMode) return;
      const now = Date.now();
      lastTouchTimeRef.current = now;

      const start = touchStartRef.current;
      touchStartRef.current = null;

      if (now - justAppliedHighlightAtRef.current < POST_HIGHLIGHT_SUPPRESSION_MS) return;
      if (!start) return;

      const touch = e.changedTouches[0];
      if (!touch) return;
      if (!isValidTouchTap(start.x, start.y, touch.clientX, touch.clientY, now - start.time)) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (!target || target.closest('[data-highlight-popover]')) return;

      const domSel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (domSel && !domSel.isCollapsed) {
        if (activePopoverRef.current) {
          closePopover();
        }
        return;
      }

      const markEl = target.closest('mark');
      if (markEl && containerRef.current?.contains(markEl)) {
        if (handleMarkActivation(markEl, touch.clientX, touch.clientY)) return;
      }

      if (activePopoverRef.current) {
        closePopover();
      }
    };

    const handleTouchCancel = () => {
      touchStartRef.current = null;
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchCancel);
      mouseDownRef.current = null;
      touchStartRef.current = null;
    };
  }, [
    editor,
    containerRef,
    isEditable,
    isSourceMode,
    justAppliedHighlightAtRef,
    closePopover,
    handleMarkActivation,
  ]);

  const handleSelectColor = useCallback(
    (color: HighlightColor) => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }

      const current = activePopoverRef.current;
      if (!editor || editor.isDestroyed || !current) return;

      const result = createUpdateHighlightColorTransaction(
        editor.state,
        current,
        color,
        docId
      );

      if (result?.tr) {
        editor.view.dispatch(result.tr);
        onScheduleCommentDomSync(editor);
      }

      if (current.isCommentOpen) {
        commitPopoverState({
          ...current,
          color,
          highlightId: result?.highlightId ?? current.highlightId,
          legacyRange: result?.highlightId ? null : current.legacyRange,
        });
        return;
      }

      closePopover();
      window.getSelection()?.removeAllRanges();
    },
    [editor, docId, highlightTimeoutRef, onScheduleCommentDomSync, commitPopoverState, closePopover]
  );

  const handleRemoveHighlight = useCallback(() => {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }

    const current = activePopoverRef.current;
    if (!editor || editor.isDestroyed || !current) return;

    closePopover();

    const tr = createRemoveHighlightTransaction(editor.state, current);
    if (tr) {
      editor.view.dispatch(tr);
    }

    window.getSelection()?.removeAllRanges();
    onScheduleCommentDomSync(editor);
    onScheduleDebouncedHighlightCount(editor);
  }, [
    editor,
    highlightTimeoutRef,
    closePopover,
    onScheduleCommentDomSync,
    onScheduleDebouncedHighlightCount,
  ]);

  const handleToggleComment = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    const current = activePopoverRef.current;
    if (!current) return;

    let targetId = current.highlightId;
    if (!targetId) {
      const ensured = ensureHighlightIdAtPos(editor.state, current.anchorPos, docId);
      if (!ensured) return;

      if (ensured.tr) {
        editor.view.dispatch(ensured.tr);
        onScheduleDebouncedContent();
      }
      targetId = ensured.id;
    }

    commitPopoverState({
      ...current,
      highlightId: targetId,
      legacyRange: null,
      isCommentOpen: !current.isCommentOpen,
    });
  }, [editor, docId, onScheduleDebouncedContent, commitPopoverState]);

  const handleChangeComment = useCallback(
    (nextComment: string) => {
      const targetId = activePopoverRef.current?.highlightId;
      if (!targetId) return;

      setHighlightComment(docId, targetId, nextComment);
      onCommentsVersionBump();
      onScheduleDebouncedContent();
    },
    [docId, onCommentsVersionBump, onScheduleDebouncedContent]
  );

  const handleDeleteComment = useCallback(() => {
    const targetId = activePopoverRef.current?.highlightId;
    if (!targetId) return;

    deleteHighlightComment(docId, targetId);
    onCommentsVersionBump();
    onScheduleDebouncedContent();
  }, [docId, onCommentsVersionBump, onScheduleDebouncedContent]);

  return {
    activePopover,
    isPopoverOpenRef,
    isCommentBoxOpenRef,
    closePopover,
    getAnchorViewportRect,
    handleSelectColor,
    handleRemoveHighlight,
    handleToggleComment,
    handleChangeComment,
    handleDeleteComment,
  };
}
