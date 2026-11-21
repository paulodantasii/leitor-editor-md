/**
 * Serviço puro e imutável para resolução de alvos de grifo (<mark>), validação de gestos
 * (mouse no PC vs toque no iPad), cálculo geométrico de posicionamento do seletor flutuante
 * e construção de transações ProseMirror para alteração de cor e remoção de grifos.
 *
 * @see docs/HIGHLIGHT_POPOVER_GOTCHAS.md
 */

import { HighlightColor } from '../types';
import { generateNextHighlightId } from './highlightIdService';

export interface HighlightSpanRange {
  readonly from: number;
  readonly to: number;
}

export interface ResolvedHighlightTarget {
  readonly highlightId: string | null;
  readonly color: HighlightColor;
  readonly anchorPos: number;
  readonly range: HighlightSpanRange;
}

export interface ViewportRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface PopoverDimensions {
  readonly width: number;
  readonly height: number;
}

export interface ViewportMetrics {
  readonly width: number;
  readonly height: number;
  readonly offsetTop: number;
  readonly offsetLeft: number;
  readonly headerBottom: number;
}

export interface ComputedPopoverPosition {
  readonly left: number;
  readonly top: number;
  readonly placement: 'top' | 'bottom';
}

export interface ActiveHighlightPopoverState {
  readonly highlightId: string | null;
  readonly legacyRange: HighlightSpanRange | null;
  readonly anchorPos: number;
  readonly color: HighlightColor;
  readonly isCommentOpen: boolean;
}

export interface HighlightMutationTarget {
  readonly highlightId: string | null;
  readonly legacyRange: HighlightSpanRange | null;
  readonly anchorPos: number;
}

export interface ResolveHighlightTargetParams {
  readonly candidatePos: number | null;
  readonly fallbackStartPos: number | null;
  readonly domId?: string | null;
  readonly domColor?: HighlightColor | null;
}

export const DESKTOP_CLICK_MAX_DISTANCE_PX = 5;
export const TOUCH_TAP_MAX_DISTANCE_PX = 10;
export const TOUCH_TAP_MAX_DURATION_MS = 500;
export const POPOVER_VIEWPORT_MARGIN_PX = 8;
export const POPOVER_ANCHOR_GAP_PX = 10;

const RESOLVE_WINDOW_RADIUS = 2500;
const MUTATION_WINDOW_RADIUS = 1500;

const VALID_HIGHLIGHT_COLORS: ReadonlySet<string> = new Set<HighlightColor>([
  'yellow',
  'blue',
  'red',
  'pink',
  'green',
  'purple',
  'orange',
  'gray',
]);

interface TextMarkRun {
  readonly from: number;
  readonly to: number;
  readonly color: HighlightColor;
  readonly mark: any;
  readonly id: string | null;
}

function normalizeHighlightColor(rawColor: string | null | undefined): HighlightColor | null {
  if (!rawColor) return null;
  const normalized = rawColor.trim().toLowerCase();
  return VALID_HIGHLIGHT_COLORS.has(normalized) ? (normalized as HighlightColor) : null;
}

function clampDocPos(pos: number | null | undefined, docSize: number): number | null {
  if (typeof pos !== 'number' || !Number.isFinite(pos)) return null;
  return Math.max(0, Math.min(Math.floor(pos), docSize));
}

function getCustomHighlightMark(node: any): any | null {
  if (!node?.isText || !Array.isArray(node.marks)) return null;
  for (let i = 0; i < node.marks.length; i++) {
    const mark = node.marks[i];
    if (mark?.type?.name === 'customHighlight') {
      return mark;
    }
  }
  return null;
}

function extractMarkId(mark: any): string | null {
  const rawId = typeof mark?.attrs?.id === 'string' ? mark.attrs.id.trim() : '';
  return rawId || null;
}

function extractMarkColor(mark: any, fallbackColor?: HighlightColor | null): HighlightColor {
  return normalizeHighlightColor(mark?.attrs?.color) ?? fallbackColor ?? 'yellow';
}

function clampAnchorPosToRun(preferredPos: number | null, run: { from: number; to: number }): number {
  const maxCharPos = Math.max(run.from, run.to - 1);
  if (preferredPos === null) return run.from;
  return Math.max(run.from, Math.min(preferredPos, maxCharPos));
}

function pickClosestRun<T extends { from: number; to: number }>(
  runs: ReadonlyArray<T>,
  candidatePos: number | null,
  fallbackStartPos: number | null
): T {
  if (candidatePos !== null) {
    const inside = runs.find((r) => candidatePos >= r.from && candidatePos < r.to);
    if (inside) return inside;
    const atRightEdge = runs.find((r) => candidatePos === r.to);
    if (atRightEdge) return atRightEdge;
  }

  if (fallbackStartPos !== null) {
    const atFallback = runs.find((r) => fallbackStartPos >= r.from && fallbackStartPos <= r.to);
    if (atFallback) return atFallback;
  }

  const refPos = candidatePos ?? fallbackStartPos;
  if (refPos === null) return runs[0];

  let bestRun = runs[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const dist =
      refPos < r.from ? r.from - refPos : refPos > r.to ? refPos - r.to : 0;
    if (dist < bestDistance) {
      bestDistance = dist;
      bestRun = r;
    }
  }
  return bestRun;
}

function collectRunsById(doc: any, targetId: string, refPos: number | null): TextMarkRun[] {
  const docSize = doc.content.size as number;

  const scanRange = (from: number, to: number): { runs: TextMarkRun[]; hitEdge: boolean } => {
    const runs: TextMarkRun[] = [];
    let hitEdge = false;
    doc.nodesBetween(from, to, (node: any, pos: number) => {
      const mark = getCustomHighlightMark(node);
      if (!mark) return;
      if (extractMarkId(mark) !== targetId) return;

      const end = pos + node.nodeSize;
      if (pos <= from || end >= to) {
        hitEdge = true;
      }
      runs.push({
        from: pos,
        to: end,
        color: extractMarkColor(mark),
        mark,
        id: targetId,
      });
    });
    return { runs, hitEdge };
  };

  if (refPos !== null && docSize > RESOLVE_WINDOW_RADIUS * 2) {
    const winFrom = Math.max(0, refPos - RESOLVE_WINDOW_RADIUS);
    const winTo = Math.min(docSize, refPos + RESOLVE_WINDOW_RADIUS);
    const partial = scanRange(winFrom, winTo);
    const touchesStart = winFrom > 0 && partial.runs.some((r) => r.from <= winFrom);
    const touchesEnd = winTo < docSize && partial.runs.some((r) => r.to >= winTo);
    if (partial.runs.length > 0 && !touchesStart && !touchesEnd) {
      return partial.runs;
    }
  }

  const allRuns: TextMarkRun[] = [];
  doc.descendants((node: any, pos: number) => {
    const mark = getCustomHighlightMark(node);
    if (!mark || extractMarkId(mark) !== targetId) return;
    allRuns.push({
      from: pos,
      to: pos + node.nodeSize,
      color: extractMarkColor(mark),
      mark,
      id: targetId,
    });
  });
  return allRuns;
}

function findIdAtPosition(doc: any, pos: number | null): string | null {
  if (pos === null) return null;
  const docSize = doc.content.size as number;
  const scanFrom = Math.max(0, pos - 1);
  const scanTo = Math.min(docSize, pos + 1);
  let insideId: string | null = null;
  let edgeId: string | null = null;

  doc.nodesBetween(scanFrom, scanTo, (node: any, nodePos: number) => {
    const mark = getCustomHighlightMark(node);
    if (!mark) return;
    const id = extractMarkId(mark);
    if (!id) return;

    const nodeEnd = nodePos + node.nodeSize;
    if (pos >= nodePos && pos < nodeEnd) {
      insideId = id;
      return false;
    }
    if (pos === nodeEnd && edgeId === null) {
      edgeId = id;
    }
  });

  return insideId ?? edgeId;
}

function collectIdlessRuns(doc: any, refPos: number | null): TextMarkRun[] {
  const docSize = doc.content.size as number;

  if (refPos !== null && docSize > RESOLVE_WINDOW_RADIUS * 2) {
    const winFrom = Math.max(0, refPos - RESOLVE_WINDOW_RADIUS);
    const winTo = Math.min(docSize, refPos + RESOLVE_WINDOW_RADIUS);
    const partial: TextMarkRun[] = [];

    doc.nodesBetween(winFrom, winTo, (node: any, pos: number) => {
      const mark = getCustomHighlightMark(node);
      if (!mark || extractMarkId(mark) !== null) return;
      partial.push({
        from: pos,
        to: pos + node.nodeSize,
        color: extractMarkColor(mark),
        mark,
        id: null,
      });
    });

    const touchesStart = winFrom > 0 && partial.some((r) => r.from <= winFrom);
    const touchesEnd = winTo < docSize && partial.some((r) => r.to >= winTo);
    if (partial.length > 0 && !touchesStart && !touchesEnd) {
      return partial;
    }
  }

  const allRuns: TextMarkRun[] = [];
  doc.descendants((node: any, pos: number) => {
    const mark = getCustomHighlightMark(node);
    if (!mark || extractMarkId(mark) !== null) return;
    allRuns.push({
      from: pos,
      to: pos + node.nodeSize,
      color: extractMarkColor(mark),
      mark,
      id: null,
    });
  });
  return allRuns;
}

function groupContiguousIdlessSpans(
  runs: ReadonlyArray<TextMarkRun>
): Array<{ from: number; to: number; color: HighlightColor; runs: TextMarkRun[] }> {
  const spans: Array<{ from: number; to: number; color: HighlightColor; runs: TextMarkRun[] }> = [];

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const last = spans[spans.length - 1];
    if (last && last.to === run.from && last.color === run.color) {
      spans[spans.length - 1] = {
        from: last.from,
        to: run.to,
        color: last.color,
        runs: [...last.runs, run],
      };
    } else {
      spans.push({
        from: run.from,
        to: run.to,
        color: run.color,
        runs: [run],
      });
    }
  }

  return spans;
}

function findRunsForMutation(doc: any, target: HighlightMutationTarget): TextMarkRun[] {
  const docSize = doc?.content?.size;
  if (typeof docSize !== 'number') return [];

  const targetId = typeof target.highlightId === 'string' ? target.highlightId.trim() : '';
  if (targetId) {
    const center = clampDocPos(target.anchorPos, docSize) ?? 0;
    const winFrom = Math.max(0, center - MUTATION_WINDOW_RADIUS);
    const winTo = Math.min(docSize, center + MUTATION_WINDOW_RADIUS);
    const narrowRuns: TextMarkRun[] = [];
    let touchesBoundary = false;

    doc.nodesBetween(winFrom, winTo, (node: any, pos: number) => {
      const mark = getCustomHighlightMark(node);
      if (!mark || extractMarkId(mark) !== targetId) return;
      const end = pos + node.nodeSize;
      if ((winFrom > 0 && pos <= winFrom) || (winTo < docSize && end >= winTo)) {
        touchesBoundary = true;
      }
      narrowRuns.push({
        from: pos,
        to: end,
        color: extractMarkColor(mark),
        mark,
        id: targetId,
      });
    });

    if (narrowRuns.length > 0 && !touchesBoundary) {
      return narrowRuns;
    }

    return collectRunsById(doc, targetId, null);
  }

  if (target.legacyRange && target.legacyRange.from < target.legacyRange.to) {
    const rangeFrom = Math.max(0, Math.min(target.legacyRange.from, docSize));
    const rangeTo = Math.max(rangeFrom, Math.min(target.legacyRange.to, docSize));
    const legacyRuns: TextMarkRun[] = [];
    doc.nodesBetween(rangeFrom, rangeTo, (node: any, pos: number) => {
      const mark = getCustomHighlightMark(node);
      if (!mark || extractMarkId(mark) !== null) return;
      const clampedFrom = Math.max(rangeFrom, pos);
      const clampedTo = Math.min(rangeTo, pos + node.nodeSize);
      if (clampedFrom < clampedTo) {
        legacyRuns.push({
          from: clampedFrom,
          to: clampedTo,
          color: extractMarkColor(mark),
          mark,
          id: null,
        });
      }
    });
    if (legacyRuns.length > 0) {
      return legacyRuns;
    }
  }

  const resolved = resolveHighlightTargetInDoc(doc, {
    candidatePos: target.anchorPos,
    fallbackStartPos: target.anchorPos,
  });
  if (!resolved) return [];

  if (resolved.highlightId) {
    return collectRunsById(doc, resolved.highlightId, resolved.anchorPos);
  }

  const spans = groupContiguousIdlessSpans(collectIdlessRuns(doc, resolved.anchorPos));
  const matchedSpan = spans.find(
    (s) => s.from === resolved.range.from && s.to === resolved.range.to
  );
  return matchedSpan ? matchedSpan.runs : [];
}

/**
 * Valida se o gesto de mouse no PC foi um clique esquerdo intencional sem arraste.
 */
export function isValidDesktopClick(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  button: number
): boolean {
  if (button !== 0) return false;
  return Math.hypot(endX - startX, endY - startY) <= DESKTOP_CLICK_MAX_DISTANCE_PX;
}

/**
 * Valida se o gesto tátil (iPad/mobile) foi um toque rápido sem rolagem nem long-press.
 */
export function isValidTouchTap(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  durationMs: number
): boolean {
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > TOUCH_TAP_MAX_DURATION_MS) {
    return false;
  }
  return Math.hypot(endX - startX, endY - startY) <= TOUCH_TAP_MAX_DISTANCE_PX;
}

/**
 * Extrai a cor de um elemento DOM `<mark>` com fallback para classes CSS (`yellow`, `hl-yellow`, etc.).
 */
export function parseHighlightColorFromElement(
  markEl: Pick<Element, 'getAttribute' | 'className'> | null | undefined
): HighlightColor {
  if (!markEl) return 'yellow';

  const dataColor = normalizeHighlightColor(markEl.getAttribute('data-color'));
  if (dataColor) return dataColor;

  const className = typeof markEl.className === 'string' ? markEl.className : '';
  const directMatch = className.match(/\b(yellow|blue|red|pink|green|purple|orange|gray)\b/i);
  if (directMatch) {
    return normalizeHighlightColor(directMatch[1]) ?? 'yellow';
  }

  const prefixedMatch = className.match(/\bhl-(\w+)\b/i);
  if (prefixedMatch) {
    return normalizeHighlightColor(prefixedMatch[1]) ?? 'yellow';
  }

  return 'yellow';
}

/**
 * Resolve o grifo alvo diretamente no documento ProseMirror, retornando ID, cor real,
 * intervalo total e `anchorPos` limitado exatamente ao trecho clicado (inclusive para grifos
 * de 1 caractere, formatação aninhada e grifos legados sem `data-id`).
 */
export function resolveHighlightTargetInDoc(
  doc: any,
  params: ResolveHighlightTargetParams
): ResolvedHighlightTarget | null {
  if (!doc || typeof doc.content?.size !== 'number' || typeof doc.nodesBetween !== 'function') {
    return null;
  }

  const docSize = doc.content.size as number;
  const candPos = clampDocPos(params.candidatePos, docSize);
  const fbPos = clampDocPos(params.fallbackStartPos, docSize);
  const refPos = candPos ?? fbPos;

  const normalizedDomId =
    typeof params.domId === 'string' && params.domId.trim() ? params.domId.trim() : null;
  const resolvedId =
    normalizedDomId ?? findIdAtPosition(doc, candPos) ?? findIdAtPosition(doc, fbPos);

  if (resolvedId) {
    const runs = collectRunsById(doc, resolvedId, refPos);
    if (runs.length === 0) return null;

    const clickedRun = pickClosestRun(runs, candPos, fbPos);
    const minFrom = runs[0].from;
    const maxTo = runs[runs.length - 1].to;

    return {
      highlightId: resolvedId,
      color: extractMarkColor(clickedRun.mark, params.domColor),
      anchorPos: clampAnchorPosToRun(refPos, clickedRun),
      range: { from: minFrom, to: maxTo },
    };
  }

  const idlessRuns = collectIdlessRuns(doc, refPos);
  if (idlessRuns.length === 0) return null;

  const spans = groupContiguousIdlessSpans(idlessRuns);
  if (spans.length === 0) return null;

  const clickedSpan = pickClosestRun(spans, candPos, fbPos);
  const clickedSubRun = pickClosestRun(clickedSpan.runs, candPos, fbPos);

  return {
    highlightId: null,
    color: extractMarkColor(clickedSubRun.mark, params.domColor),
    anchorPos: clampAnchorPosToRun(refPos, clickedSubRun),
    range: { from: clickedSpan.from, to: clickedSpan.to },
  };
}

/**
 * Verifica se o grifo recém-clicado é o mesmo já aberto no estado próprio do popover.
 * Nunca depende de `editor.getAttributes()` (que no PC já mudou no `mousedown`).
 */
export function isSamePopoverTarget(
  active: ActiveHighlightPopoverState | null,
  next: ResolvedHighlightTarget
): boolean {
  if (!active) return false;

  if (active.highlightId && next.highlightId) {
    return active.highlightId === next.highlightId;
  }

  if (!active.highlightId && !next.highlightId && active.legacyRange) {
    if (
      active.legacyRange.from === next.range.from &&
      active.legacyRange.to === next.range.to
    ) {
      return true;
    }
    return (
      active.legacyRange.from < next.range.to &&
      active.legacyRange.to > next.range.from
    );
  }

  return false;
}

/**
 * Verifica se a âncora do grifo ainda está dentro da área visível da viewport
 * (abaixo do cabeçalho fixo e dentro dos limites da `visualViewport`).
 */
export function isAnchorVisibleInViewport(
  anchor: ViewportRect,
  viewport: ViewportMetrics
): boolean {
  const minTop = Math.max(viewport.headerBottom, viewport.offsetTop);
  const maxBottom = viewport.offsetTop + viewport.height;
  const minLeft = viewport.offsetLeft;
  const maxRight = viewport.offsetLeft + viewport.width;

  return (
    anchor.bottom >= minTop &&
    anchor.top <= maxBottom &&
    anchor.right >= minLeft &&
    anchor.left <= maxRight
  );
}

/**
 * Calcula a posição `fixed` do popover na viewport: acima por padrão, flip automático
 * para baixo perto do cabeçalho e clamping horizontal/vertical seguro na `visualViewport`.
 */
export function computePopoverPosition(
  anchor: ViewportRect,
  popover: PopoverDimensions,
  viewport: ViewportMetrics
): ComputedPopoverPosition {
  const margin = POPOVER_VIEWPORT_MARGIN_PX;
  const gap = POPOVER_ANCHOR_GAP_PX;

  const minLeft = viewport.offsetLeft + margin;
  const maxLeft = Math.max(
    minLeft,
    viewport.offsetLeft + viewport.width - popover.width - margin
  );
  const anchorCenterX = (anchor.left + anchor.right) / 2;
  const rawLeft = anchorCenterX - popover.width / 2;
  const left = Math.round(Math.min(Math.max(rawLeft, minLeft), maxLeft));

  const topSafeBound = Math.max(viewport.headerBottom + margin, viewport.offsetTop + margin);
  const bottomSafeBound = viewport.offsetTop + viewport.height - margin;
  const maxTop = Math.max(topSafeBound, bottomSafeBound - popover.height);

  const topAbove = anchor.top - popover.height - gap;
  const topBelow = anchor.bottom + gap;
  const fitsAbove = topAbove >= topSafeBound;
  const fitsBelow = topBelow + popover.height <= bottomSafeBound;

  if (fitsAbove) {
    return {
      left,
      top: Math.round(Math.min(topAbove, maxTop)),
      placement: 'top',
    };
  }

  if (fitsBelow) {
    return {
      left,
      top: Math.round(Math.max(topSafeBound, topBelow)),
      placement: 'bottom',
    };
  }

  const spaceAbove = anchor.top - topSafeBound;
  const spaceBelow = bottomSafeBound - anchor.bottom;
  if (spaceBelow > spaceAbove) {
    return {
      left,
      top: Math.round(Math.min(Math.max(topBelow, topSafeBound), maxTop)),
      placement: 'bottom',
    };
  }

  return {
    left,
    top: Math.round(Math.min(Math.max(topAbove, topSafeBound), maxTop)),
    placement: 'top',
  };
}

/**
 * Constrói uma transação ProseMirror pura para trocar a cor de um grifo inteiro
 * (incluindo grifos legados sem `data-id`, aos quais atribui um ID sequencial),
 * sem alterar a seleção atual do editor nem roubar o foco da caixa de comentário.
 */
export function createUpdateHighlightColorTransaction(
  state: any,
  target: HighlightMutationTarget,
  color: HighlightColor,
  scopeKey?: string | null
): { readonly tr: any | null; readonly highlightId: string } | null {
  const doc = state?.doc;
  const markType = state?.schema?.marks?.customHighlight;
  if (!doc || !markType) return null;

  const runs = findRunsForMutation(doc, target);
  if (runs.length === 0) return null;

  const existingId =
    (typeof target.highlightId === 'string' && target.highlightId.trim()) ||
    runs[0].id ||
    null;
  const resolvedId = existingId ?? generateNextHighlightId(doc, scopeKey);

  const needsMutation = runs.some(
    (run) => run.color !== color || run.id !== resolvedId
  );
  if (!needsMutation) {
    return { tr: null, highlightId: resolvedId };
  }

  const tr = state.tr;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    tr.removeMark(run.from, run.to, markType);
    tr.addMark(
      run.from,
      run.to,
      markType.create({ ...run.mark.attrs, color, id: resolvedId })
    );
  }

  return { tr, highlightId: resolvedId };
}

/**
 * Constrói uma transação ProseMirror pura para remover um grifo inteiro
 * (por `data-id` ou bloco contíguo legado), sem alterar a seleção do editor.
 */
export function createRemoveHighlightTransaction(
  state: any,
  target: HighlightMutationTarget
): any | null {
  const doc = state?.doc;
  const markType = state?.schema?.marks?.customHighlight;
  if (!doc || !markType) return null;

  const runs = findRunsForMutation(doc, target);
  if (runs.length === 0) return null;

  const tr = state.tr;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    tr.removeMark(run.from, run.to, markType);
  }

  return tr;
}
