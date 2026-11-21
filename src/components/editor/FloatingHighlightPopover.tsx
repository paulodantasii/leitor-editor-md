/**
 * Camada visual desacoplada para o seletor flutuante de cores e comentários de grifos.
 * Renderiza via React Portal (`position: fixed`) diretamente em `document.body`,
 * substituindo `<BubbleMenu>` / `tippy.js` para garantir posicionamento determinístico no PC e no iPad.
 *
 * @see docs/HIGHLIGHT_POPOVER_GOTCHAS.md
 */

import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { HighlightColor } from '../../types';
import { HighlightPopover } from './HighlightPopover';
import {
  ComputedPopoverPosition,
  ViewportMetrics,
  ViewportRect,
  computePopoverPosition,
  isAnchorVisibleInViewport,
} from '../../services/highlightPopoverGeometry';

export interface FloatingHighlightPopoverProps {
  readonly isOpen: boolean;
  readonly anchorKey: string;
  readonly layoutTriggerKey?: string;
  readonly activeColor?: HighlightColor;
  readonly isCommentOpen: boolean;
  readonly getAnchorViewportRect: () => ViewportRect | null;
  readonly onAutoClose: () => void;
  readonly onSelectColor: (color: HighlightColor) => void;
  readonly onRemoveHighlight: () => void;
  readonly onClose: () => void;
  readonly commentText?: string;
  readonly highlightedText?: string;
  readonly totalCommentsCount?: number;
  readonly onToggleComment?: () => void;
  readonly onChangeComment?: (nextComment: string) => void;
  readonly onDeleteComment?: () => void;
  readonly onCopyAllComments?: () => Promise<number> | number;
}

function readViewportMetrics(): ViewportMetrics {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const width = vv?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1024);
  const height = vv?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 768);
  const offsetTop = vv?.offsetTop ?? 0;
  const offsetLeft = vv?.offsetLeft ?? 0;
  const headerEl = typeof document !== 'undefined' ? document.querySelector('header') : null;
  const headerBottom = headerEl ? Math.max(0, headerEl.getBoundingClientRect().bottom) : 0;

  return {
    width,
    height,
    offsetTop,
    offsetLeft,
    headerBottom,
  };
}

export const FloatingHighlightPopover: React.FC<FloatingHighlightPopoverProps> = ({
  isOpen,
  anchorKey,
  layoutTriggerKey = '',
  activeColor,
  isCommentOpen,
  getAnchorViewportRect,
  onAutoClose,
  onSelectColor,
  onRemoveHighlight,
  onClose,
  commentText = '',
  highlightedText = '',
  totalCommentsCount = 0,
  onToggleComment,
  onChangeComment,
  onDeleteComment,
  onCopyAllComments,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);
  const [position, setPosition] = useState<ComputedPopoverPosition | null>(null);

  const isCommentOpenRef = useRef(isCommentOpen);
  isCommentOpenRef.current = isCommentOpen;

  const getAnchorRectRef = useRef(getAnchorViewportRect);
  getAnchorRectRef.current = getAnchorViewportRect;

  const onAutoCloseRef = useRef(onAutoClose);
  onAutoCloseRef.current = onAutoClose;

  const recalculatePosition = useCallback(() => {
    const wrapperEl = wrapperRef.current;
    if (!wrapperEl) return;

    const anchor = getAnchorRectRef.current();
    const viewport = readViewportMetrics();

    if (!anchor) {
      if (!isCommentOpenRef.current) {
        onAutoCloseRef.current();
      }
      return;
    }

    // Trava inteligente: mantém o balão visível quando a caixa de comentário estiver aberta,
    // protegendo contra rolagem involuntária ou abertura do teclado virtual no iPad.
    if (!isCommentOpenRef.current && !isAnchorVisibleInViewport(anchor, viewport)) {
      onAutoCloseRef.current();
      return;
    }

    const rect = wrapperEl.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : isCommentOpenRef.current ? 320 : 280;
    const height = rect.height > 0 ? rect.height : isCommentOpenRef.current ? 180 : 42;

    const nextPos = computePopoverPosition(anchor, { width, height }, viewport);
    setPosition((prev) => {
      if (
        prev &&
        prev.left === nextPos.left &&
        prev.top === nextPos.top &&
        prev.placement === nextPos.placement
      ) {
        return prev;
      }
      return nextPos;
    });
  }, []);

  const scheduleRecalc = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      recalculatePosition();
    });
  }, [recalculatePosition]);

  // Limpa coordenadas ao fechar para impedir flash de posição antiga na próxima abertura
  useLayoutEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return;
    }
    recalculatePosition();
  }, [isOpen, anchorKey, layoutTriggerKey, recalculatePosition]);

  // Recalcula ao redimensionar o conteúdo (ex.: abrir comentário ou expandir textarea)
  useEffect(() => {
    if (!isOpen) return;
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      scheduleRecalc();
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [isOpen, scheduleRecalc]);

  // Acompanha rolagem da janela, containers internos (tabelas) e redimensionamentos
  useEffect(() => {
    if (!isOpen) return;

    document.addEventListener('scroll', scheduleRecalc, { capture: true, passive: true });
    window.addEventListener('resize', scheduleRecalc, { passive: true });
    window.visualViewport?.addEventListener('scroll', scheduleRecalc);
    window.visualViewport?.addEventListener('resize', scheduleRecalc);

    return () => {
      document.removeEventListener('scroll', scheduleRecalc, { capture: true });
      window.removeEventListener('resize', scheduleRecalc);
      window.visualViewport?.removeEventListener('scroll', scheduleRecalc);
      window.visualViewport?.removeEventListener('resize', scheduleRecalc);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isOpen, scheduleRecalc]);

  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      ref={wrapperRef}
      data-highlight-popover="true"
      data-placement={position?.placement ?? 'top'}
      className="fixed z-20 print:hidden"
      style={{
        left: position ? `${position.left}px` : '-9999px',
        top: position ? `${position.top}px` : '-9999px',
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <HighlightPopover
        activeColor={activeColor}
        onSelectColor={onSelectColor}
        onRemoveHighlight={onRemoveHighlight}
        onClose={onClose}
        commentText={commentText}
        highlightedText={highlightedText}
        totalCommentsCount={totalCommentsCount}
        isCommentOpen={isCommentOpen}
        onToggleComment={onToggleComment}
        onChangeComment={onChangeComment}
        onDeleteComment={onDeleteComment}
        onCopyAllComments={onCopyAllComments}
      />
    </div>,
    document.body
  );
};
