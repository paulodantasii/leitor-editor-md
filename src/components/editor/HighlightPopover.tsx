import React, { useRef, useEffect, useState, useCallback } from 'react';
import { HighlightColor, HighlightColorOption } from '../../types';
import {
  Trash2,
  MessageSquareText,
  MessageSquareOff,
  Copy,
  CopyCheck,
  Check,
} from 'lucide-react';
import {
  formatSingleCommentForCopy,
  copyTextToClipboard,
} from '../../services/highlightCommentsService';

export const HIGHLIGHT_COLORS: HighlightColorOption[] = [
  { id: 'yellow', name: 'Amarelo', bgClass: 'bg-[#fef5b8] hover:bg-[#fde68a] dark:bg-yellow-300', borderClass: 'border-amber-400', hex: '#fef5b8' },
  { id: 'blue', name: 'Azul', bgClass: 'bg-sky-200 hover:bg-sky-300 dark:bg-sky-300', borderClass: 'border-sky-400', hex: '#bae6fd' },
  { id: 'red', name: 'Vermelho', bgClass: 'bg-red-200 hover:bg-red-300 dark:bg-red-300', borderClass: 'border-red-400', hex: '#fecaca' },
  { id: 'green', name: 'Verde', bgClass: 'bg-green-200 hover:bg-green-300 dark:bg-green-300', borderClass: 'border-green-400', hex: '#bbf7d0' },
  { id: 'purple', name: 'Roxo', bgClass: 'bg-purple-200 hover:bg-purple-300 dark:bg-purple-300', borderClass: 'border-purple-400', hex: '#e9d5ff' },
  { id: 'orange', name: 'Laranja', bgClass: 'bg-orange-200 hover:bg-orange-300 dark:bg-orange-300', borderClass: 'border-orange-400', hex: '#fed7aa' },
  { id: 'gray', name: 'Cinza', bgClass: 'bg-[#dce4ee] hover:bg-slate-300 dark:bg-slate-400', borderClass: 'border-slate-400', hex: '#dce4ee' },
];

export function getHighlightColorOption(color?: HighlightColor | null): HighlightColorOption {
  return HIGHLIGHT_COLORS.find((c) => c.id === color) || HIGHLIGHT_COLORS[0];
}

interface HighlightColorSwatchesProps {
  activeColor?: HighlightColor;
  onSelectColor: (color: HighlightColor) => void;
  titlePrefix?: string;
  size?: 'sm' | 'md';
}

export const HighlightColorSwatches: React.FC<HighlightColorSwatchesProps> = ({
  activeColor,
  onSelectColor,
  titlePrefix = 'Grifar de',
  size = 'md',
}) => {
  const sizeClass = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const lastTouchTimeRef = useRef(0);

  return (
    <div className="flex items-center gap-1.5">
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (Date.now() - lastTouchTimeRef.current < 350) return;
            onSelectColor(c.id);
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            e.stopPropagation();
            lastTouchTimeRef.current = Date.now();
            onSelectColor(c.id);
          }}
          onMouseDown={(e) => e.preventDefault()}
          title={`${titlePrefix} ${c.name}`}
          className={`${sizeClass} rounded-full border ${c.borderClass} transition-transform hover:scale-110 active:scale-95 cursor-pointer ${c.bgClass} ${
            activeColor === c.id ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-800 scale-110' : ''
          }`}
        />
      ))}
    </div>
  );
};

interface HighlightCommentToggleButtonProps {
  hasComment: boolean;
  isCommentOpen: boolean;
  onToggle: () => void;
}

export const HighlightCommentToggleButton: React.FC<HighlightCommentToggleButtonProps> = ({
  hasComment,
  isCommentOpen,
  onToggle,
}) => {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      onMouseDown={(e) => e.preventDefault()}
      aria-expanded={isCommentOpen}
      aria-label={hasComment ? 'Ver ou editar comentário do grifo' : 'Adicionar comentário ao grifo'}
      title={hasComment ? 'Ver / editar comentário' : 'Adicionar comentário'}
      className={`relative p-1.5 rounded-full transition-colors cursor-pointer ${
        isCommentOpen
          ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-300 ring-1 ring-blue-400/50'
          : hasComment
          ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50'
          : 'text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40'
      }`}
    >
      <MessageSquareText className="w-4 h-4" />
      {hasComment && (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 ring-1 ring-white dark:ring-slate-800"
        />
      )}
    </button>
  );
};

export interface HighlightCommentBubbleProps {
  commentText: string;
  highlightedText: string;
  totalCommentsCount?: number;
  onChangeComment: (nextComment: string) => void;
  onDeleteComment?: () => void;
  onCopyAllComments?: () => Promise<number> | number;
  onClose?: () => void;
}

export const HighlightCommentBubble: React.FC<HighlightCommentBubbleProps> = ({
  commentText,
  highlightedText,
  totalCommentsCount = 0,
  onChangeComment,
  onDeleteComment,
  onCopyAllComments,
  onClose,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyAllFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copiedSingle, setCopiedSingle] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const hasComment = commentText.trim().length > 0;

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(Math.max(el.scrollHeight, 64), 220);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > 220 ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      const endPos = el.value.length;
      try {
        el.setSelectionRange(endPos, endPos);
      } catch {
        // ignore
      }
      adjustTextareaHeight();
    });
    return () => cancelAnimationFrame(rafId);
  }, [adjustTextareaHeight]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [commentText, adjustTextareaHeight]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
      if (copyAllFeedbackTimerRef.current) clearTimeout(copyAllFeedbackTimerRef.current);
    };
  }, []);

  const handleCopySingle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hasComment) return;

    const formatted = formatSingleCommentForCopy(highlightedText, commentText);
    const ok = await copyTextToClipboard(formatted);
    if (!ok) return;

    setCopiedSingle(true);
    if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
    copyFeedbackTimerRef.current = setTimeout(() => {
      setCopiedSingle(false);
      copyFeedbackTimerRef.current = null;
    }, 1500);
  };

  const handleCopyAll = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onCopyAllComments) return;

    const copiedCount = await onCopyAllComments();
    if (copiedCount <= 0) return;

    setCopiedAll(true);
    if (copyAllFeedbackTimerRef.current) clearTimeout(copyAllFeedbackTimerRef.current);
    copyAllFeedbackTimerRef.current = setTimeout(() => {
      setCopiedAll(false);
      copyAllFeedbackTimerRef.current = null;
    }, 1500);
  };

  return (
    <div
      data-highlight-comment-bubble="true"
      className="pt-2 border-t border-slate-100 dark:border-slate-700/80 flex flex-col gap-2 w-full"
    >
      <textarea
        ref={textareaRef}
        value={commentText}
        onChange={(e) => onChangeComment(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
            e.preventDefault();
            onClose?.();
          }
        }}
        onKeyUp={(e) => e.stopPropagation()}
        rows={2}
        placeholder="Escreva um comentário para este grifo..."
        aria-label="Comentário do grifo"
        className="w-full min-h-[64px] max-h-[220px] resize-none rounded-xl border border-slate-200 dark:border-slate-600/80 bg-slate-50/90 dark:bg-slate-900/70 px-2.5 py-2 text-xs leading-relaxed text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 dark:focus:border-blue-500 select-text transition-colors"
      />

      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            disabled={!hasComment}
            onClick={handleCopySingle}
            onMouseDown={(e) => e.preventDefault()}
            title={
              hasComment
                ? 'Copiar no formato: Sobre "[texto grifado]": [comentário]'
                : 'Digite um comentário para copiar'
            }
            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${
              copiedSingle
                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                : 'bg-slate-100 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/50 hover:text-blue-600 dark:hover:text-blue-400'
            }`}
          >
            {copiedSingle ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSingle ? 'Copiado!' : 'Copiar'}</span>
          </button>

          {totalCommentsCount > 0 && onCopyAllComments && (
            <button
              type="button"
              onClick={handleCopyAll}
              onMouseDown={(e) => e.preventDefault()}
              title={`Copiar todos os comentários (${totalCommentsCount})`}
              className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                copiedAll
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                  : 'bg-slate-100 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-950/50 hover:text-blue-600 dark:hover:text-blue-400'
              }`}
            >
              {copiedAll ? <Check className="w-3.5 h-3.5" /> : <CopyCheck className="w-3.5 h-3.5" />}
              <span>{copiedAll ? 'Todos copiados!' : 'Copiar todos'}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {hasComment && onDeleteComment && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDeleteComment();
              }}
              onMouseDown={(e) => e.preventDefault()}
              title="Apagar apenas o comentário (mantém o grifo)"
              aria-label="Apagar comentário"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
            >
              <MessageSquareOff className="w-3.5 h-3.5" />
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              onMouseDown={(e) => e.preventDefault()}
              title="Concluir e fechar (Esc)"
              className="px-2 py-1 rounded-lg text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface HighlightPopoverProps {
  activeColor?: HighlightColor;
  onSelectColor: (color: HighlightColor) => void;
  onRemoveHighlight: () => void;
  onClose?: () => void;
  commentText?: string;
  highlightedText?: string;
  totalCommentsCount?: number;
  isCommentOpen?: boolean;
  onToggleComment?: () => void;
  onChangeComment?: (nextComment: string) => void;
  onDeleteComment?: () => void;
  onCopyAllComments?: () => Promise<number> | number;
}

export const HighlightPopover: React.FC<HighlightPopoverProps> = ({
  activeColor,
  onSelectColor,
  onRemoveHighlight,
  onClose,
  commentText = '',
  highlightedText = '',
  totalCommentsCount = 0,
  isCommentOpen = false,
  onToggleComment,
  onChangeComment,
  onDeleteComment,
  onCopyAllComments,
}) => {
  const hasComment = commentText.trim().length > 0;

  return (
    <div
      data-highlight-popover="true"
      className={`bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 pointer-events-auto select-none transition-all ${
        isCommentOpen
          ? 'rounded-2xl p-2.5 flex flex-col gap-2 w-[312px] sm:w-[340px] max-w-[calc(100vw-16px)]'
          : 'rounded-full px-3 py-1.5 flex items-center gap-1.5'
      }`}
      onMouseDown={(e) => {
        e.stopPropagation();
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
          return;
        }
        e.preventDefault();
      }}
    >
      <div className={`flex items-center gap-1.5 ${isCommentOpen ? 'justify-between w-full' : ''}`}>
        {onToggleComment && (
          <div className="pr-2 border-r border-slate-200 dark:border-slate-700 flex items-center">
            <HighlightCommentToggleButton
              hasComment={hasComment}
              isCommentOpen={isCommentOpen}
              onToggle={onToggleComment}
            />
          </div>
        )}

        <div className="pr-2 border-r border-slate-200 dark:border-slate-700">
          <HighlightColorSwatches
            activeColor={activeColor}
            onSelectColor={onSelectColor}
            titlePrefix="Grifar de"
            size="md"
          />
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemoveHighlight();
          }}
          onMouseDown={(e) => e.preventDefault()}
          title="Remover grifo"
          className="p-1.5 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {isCommentOpen && onChangeComment && (
        <HighlightCommentBubble
          commentText={commentText}
          highlightedText={highlightedText}
          totalCommentsCount={totalCommentsCount}
          onChangeComment={onChangeComment}
          onDeleteComment={onDeleteComment}
          onCopyAllComments={onCopyAllComments}
          onClose={onClose}
        />
      )}
    </div>
  );
};
