import React, { useMemo } from 'react';
import { TextMatchRange } from '../../services/searchReplaceService';

interface SourceSearchBackdropProps {
  readonly content: string;
  readonly matches: ReadonlyArray<TextMatchRange>;
  readonly activeIndex: number;
  readonly fontSizePx: number;
  readonly isOpen: boolean;
}

const MAX_BACKDROP_HIGHLIGHTS = 2500;

/**
 * Camada espelho transparente posicionada atrás do <textarea> do Modo Código-Fonte
 * para destacar todas as ocorrências encontradas e a ocorrência ativa sem deslocar caracteres.
 */
export const SourceSearchBackdrop: React.FC<SourceSearchBackdropProps> = React.memo(({
  content,
  matches,
  activeIndex,
  fontSizePx,
  isOpen,
}) => {
  const segments = useMemo(() => {
    if (!isOpen || !content || matches.length === 0) {
      return null;
    }

    let visibleMatches: ReadonlyArray<{ match: TextMatchRange; originalIndex: number }>;
    if (matches.length <= MAX_BACKDROP_HIGHLIGHTS) {
      visibleMatches = matches.map((match, originalIndex) => ({ match, originalIndex }));
    } else {
      const half = Math.floor(MAX_BACKDROP_HIGHLIGHTS / 2);
      const safeActive = Math.max(0, Math.min(activeIndex, matches.length - 1));
      const startIdx = Math.max(0, Math.min(safeActive - half, matches.length - MAX_BACKDROP_HIGHLIGHTS));
      const endIdx = Math.min(matches.length, startIdx + MAX_BACKDROP_HIGHLIGHTS);
      visibleMatches = matches
        .slice(startIdx, endIdx)
        .map((match, offset) => ({ match, originalIndex: startIdx + offset }));
    }

    const nodes: React.ReactNode[] = [];
    let cursor = 0;

    for (let i = 0; i < visibleMatches.length; i++) {
      const { match, originalIndex } = visibleMatches[i];
      if (match.from < cursor || match.to <= match.from || match.to > content.length) {
        continue;
      }

      if (match.from > cursor) {
        nodes.push(content.slice(cursor, match.from));
      }

      const isActive = originalIndex === activeIndex;
      nodes.push(
        <span
          key={`${match.from}-${match.to}`}
          className={isActive ? 'search-match search-match-active' : 'search-match'}
        >
          {content.slice(match.from, match.to)}
        </span>
      );
      cursor = match.to;
    }

    if (cursor < content.length) {
      nodes.push(content.slice(cursor));
    }

    if (content.endsWith('\n')) {
      nodes.push('\u200b');
    }

    return nodes;
  }, [content, matches, activeIndex, isOpen]);

  if (!segments) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="source-search-backdrop pointer-events-none select-none absolute inset-0 z-0 font-mono leading-relaxed whitespace-pre-wrap break-words text-transparent p-0 m-0 border-none overflow-hidden"
      style={{ fontSize: `${fontSizePx}px` }}
    >
      {segments}
    </div>
  );
});

SourceSearchBackdrop.displayName = 'SourceSearchBackdrop';
