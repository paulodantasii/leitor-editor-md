import React, { useState, useRef, useEffect } from 'react';
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { Copy, Check } from 'lucide-react';
import { copyTextToClipboard } from '../../services/highlightCommentsService';

export const CodeBlockView: React.FC<NodeViewProps> = ({ node }) => {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const language =
    typeof node.attrs?.language === 'string' && node.attrs.language.trim().length > 0
      ? node.attrs.language.trim()
      : null;

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const ok = await copyTextToClipboard(node.textContent || '');
    if (!ok) return;

    setCopied(true);
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setCopied(false);
      resetTimerRef.current = null;
    }, 2000);
  };

  return (
    <NodeViewWrapper className="code-block-wrapper relative my-5 rounded-lg overflow-hidden bg-slate-900 text-slate-50 border border-slate-800/80">
      <div
        contentEditable={false}
        className="code-block-header flex items-center justify-between px-3 py-1.5 bg-slate-800/90 border-b border-slate-700/70 select-none print:hidden"
      >
        <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
          {language ?? 'código'}
        </span>

        <button
          type="button"
          data-code-copy-btn="true"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleCopy}
          aria-label={copied ? 'Código copiado' : 'Copiar código'}
          title={copied ? 'Copiado!' : 'Copiar bloco de código'}
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer ${
            copied
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'bg-slate-700/70 hover:bg-slate-700 text-slate-200 border border-slate-600/60'
          }`}
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Copiado</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copiar</span>
            </>
          )}
        </button>
      </div>

      <pre className="!my-0 !rounded-none !border-0">
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
};
