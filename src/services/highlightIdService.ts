/**
 * Serviço centralizado de geração de IDs sequenciais ordenados (Base-36, 5+ dígitos)
 * e localização/navegação para o grifo (<mark>) mais recente do documento.
 *
 * Regras do formato V2:
 * - Alfabeto: Base-36 ('0'-'9', 'a'-'z'). 100% seguro para atributos HTML e regex Markdown.
 * - Comprimento mínimo: 5 caracteres ('00001' até 'zzzzz' = 60.466.175 combinações;
 *   expande automaticamente para 6+ dígitos se ultrapassar 60,4 milhões).
 * - Retrocompatibilidade: IDs legados (V1) possuem 4 caracteres (ex.: 't3v1', 'z8q4').
 *   IDs sequenciais V2 (5+ caracteres) têm prioridade cronológica estrita sobre IDs V1.
 */

import { TextSelection } from '@tiptap/pm/state';
import { HighlightColor } from '../types';

export const SEQUENTIAL_ID_MIN_LENGTH = 5;
const SEQUENTIAL_ID_REGEX = /^[0-9a-z]{5,}$/;
const DEFAULT_SCOPE_KEY = '__default_doc__';

/**
 * Memória monotônica imutável por documento (evita reutilizar IDs recém-apagados
 * na mesma sessão, protegendo o histórico de Undo/Redo do ProseMirror).
 */
let highWaterMarkByScope: ReadonlyMap<string, number> = new Map();
let scannedDocMaxCache = new WeakMap<object, number>();

export interface HighlightScanSummary {
  readonly sequentialMax: number;
  readonly latestSequentialId: string | null;
  readonly latestLegacyId: string | null;
  readonly hasAnyHighlight: boolean;
}

export interface LatestHighlightTarget {
  readonly id: string | null;
  readonly isSequential: boolean;
  readonly pos: number;
}

type ScrollToLatestHandler = () => void;
let registeredScrollHandler: ScrollToLatestHandler | null = null;
let activePulseCleanupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Formata um contador inteiro positivo (>= 1) em um ID Base-36 de no mínimo 5 dígitos.
 * Ex.: 1 -> "00001", 10 -> "0000a", 36 -> "00010", 60466175 -> "zzzzz".
 */
export function formatSequentialHighlightId(counter: number): string {
  const safeCounter = Number.isFinite(counter) && counter >= 1 ? Math.floor(counter) : 1;
  return safeCounter.toString(36).padStart(SEQUENTIAL_ID_MIN_LENGTH, '0');
}

/**
 * Converte um ID sequencial V2 (5+ caracteres base-36) para seu valor inteiro.
 * Retorna `null` para IDs legados de 4 caracteres (ex.: "z8q4") ou inválidos.
 */
export function parseSequentialHighlightId(id: string | null | undefined): number | null {
  if (typeof id !== 'string') return null;
  const normalized = id.trim();
  if (!SEQUENTIAL_ID_REGEX.test(normalized)) return null;

  const parsed = Number.parseInt(normalized, 36);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Escaneia uma árvore de documento ProseMirror para extrair o maior contador sequencial V2
 * e o último ID legado V1 como fallback.
 */
export function scanHighlightsInProseMirrorDoc(doc: any): HighlightScanSummary {
  if (!doc || typeof doc.descendants !== 'function') {
    return {
      sequentialMax: 0,
      latestSequentialId: null,
      latestLegacyId: null,
      hasAnyHighlight: false,
    };
  }

  let sequentialMax = 0;
  let latestSequentialId: string | null = null;
  let latestLegacyId: string | null = null;
  let hasAnyHighlight = false;

  doc.descendants((node: any) => {
    if (!node?.isText || !Array.isArray(node.marks)) return;
    for (let i = 0; i < node.marks.length; i++) {
      const mark = node.marks[i];
      if (mark?.type?.name !== 'customHighlight') continue;

      hasAnyHighlight = true;
      const rawId = typeof mark.attrs?.id === 'string' ? mark.attrs.id.trim() : '';
      if (!rawId) continue;

      const seqValue = parseSequentialHighlightId(rawId);
      if (seqValue !== null) {
        if (seqValue > sequentialMax) {
          sequentialMax = seqValue;
          latestSequentialId = rawId;
        }
      } else {
        latestLegacyId = rawId;
      }
    }
  });

  return {
    sequentialMax,
    latestSequentialId,
    latestLegacyId,
    hasAnyHighlight,
  };
}

/**
 * Escaneia uma string Markdown bruta em busca de tags <mark ...> para extrair
 * o maior contador sequencial V2 e o último ID legado V1.
 */
export function scanHighlightsInMarkdown(markdown: string): HighlightScanSummary {
  if (!markdown || !markdown.includes('<mark')) {
    return {
      sequentialMax: 0,
      latestSequentialId: null,
      latestLegacyId: null,
      hasAnyHighlight: false,
    };
  }

  let sequentialMax = 0;
  let latestSequentialId: string | null = null;
  let latestLegacyId: string | null = null;
  let hasAnyHighlight = false;

  const markTagRegex = /<mark\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = markTagRegex.exec(markdown)) !== null) {
    hasAnyHighlight = true;
    const attrs = match[1] || '';
    const idMatch = attrs.match(/\b(?:data-id|data-hl-id|id)=["']([^"']+)["']/i);
    const rawId = idMatch?.[1]?.trim() || '';
    if (!rawId) continue;

    const seqValue = parseSequentialHighlightId(rawId);
    if (seqValue !== null) {
      if (seqValue > sequentialMax) {
        sequentialMax = seqValue;
        latestSequentialId = rawId;
      }
    } else {
      latestLegacyId = rawId;
    }
  }

  return {
    sequentialMax,
    latestSequentialId,
    latestLegacyId,
    hasAnyHighlight,
  };
}

/**
 * Inicializa ou atualiza a marca d'água de IDs sequenciais de um documento já escaneado,
 * permitindo que os próximos grifos sejam gerados em tempo constante O(1).
 */
export function primeHighlightIdScope(
  scopeKey: string | null | undefined,
  maxSequentialValue: number
): void {
  const resolvedScope = scopeKey && scopeKey.trim() ? scopeKey.trim() : DEFAULT_SCOPE_KEY;
  const safeMax =
    Number.isFinite(maxSequentialValue) && maxSequentialValue >= 0
      ? Math.floor(maxSequentialValue)
      : 0;
  const previous = highWaterMarkByScope.get(resolvedScope) ?? 0;

  if (safeMax > previous || !highWaterMarkByScope.has(resolvedScope)) {
    highWaterMarkByScope = new Map([
      ...highWaterMarkByScope,
      [resolvedScope, Math.max(previous, safeMax)],
    ]);
  }
}

/**
 * Gera o próximo ID sequencial garantidamente único e maior que todos os existentes no documento.
 */
export function generateNextHighlightId(docOrMarkdown?: any, scopeKey?: string | null): string {
  const resolvedScope = scopeKey && scopeKey.trim() ? scopeKey.trim() : DEFAULT_SCOPE_KEY;
  const previousHighWater = highWaterMarkByScope.get(resolvedScope);

  // Caminho rápido O(1): quando o escopo já foi indexado na abertura/contagem do documento
  // e trata-se de um documento ProseMirror real (possui nodeSize numérico), evita re-varrer a árvore inteira.
  if (
    scopeKey &&
    previousHighWater !== undefined &&
    docOrMarkdown &&
    typeof docOrMarkdown === 'object' &&
    typeof docOrMarkdown.nodeSize === 'number'
  ) {
    const nextCounter = previousHighWater + 1;
    highWaterMarkByScope = new Map([...highWaterMarkByScope, [resolvedScope, nextCounter]]);
    return formatSequentialHighlightId(nextCounter);
  }

  let docMax = 0;
  if (typeof docOrMarkdown === 'string') {
    docMax = scanHighlightsInMarkdown(docOrMarkdown).sequentialMax;
  } else if (docOrMarkdown && typeof docOrMarkdown === 'object') {
    const cached = scannedDocMaxCache.get(docOrMarkdown);
    if (cached !== undefined) {
      docMax = cached;
    } else {
      docMax = scanHighlightsInProseMirrorDoc(docOrMarkdown).sequentialMax;
      scannedDocMaxCache.set(docOrMarkdown, docMax);
    }
  }

  const nextCounter = Math.max(docMax, previousHighWater ?? 0) + 1;

  highWaterMarkByScope = new Map([...highWaterMarkByScope, [resolvedScope, nextCounter]]);
  return formatSequentialHighlightId(nextCounter);
}

export interface HighlightRange {
  readonly from: number;
  readonly to: number;
}

export interface ApplyHighlightOptions {
  readonly from?: number;
  readonly to?: number;
  readonly color?: HighlightColor;
  readonly id?: string | null;
  readonly scopeKey?: string | null;
  readonly collapseToEnd?: boolean;
}

export interface ApplyHighlightResult {
  readonly tr: any;
  readonly range: HighlightRange;
  readonly id: string;
  readonly removedIds: ReadonlyArray<string>;
}

/**
 * Recua as extremidades de um intervalo [from, to] no documento ProseMirror para excluir
 * caracteres de espaço em branco no início e no final da seleção.
 * Retorna `null` se o intervalo for vazio ou contiver apenas espaços em branco.
 */
export function resolveTrimmedHighlightRange(
  doc: any,
  from: number,
  to: number
): HighlightRange | null {
  if (!doc || typeof doc.nodesBetween !== 'function') return null;

  const docSize = typeof doc.content?.size === 'number' ? doc.content.size : to;
  const safeFrom = Math.max(0, Math.min(from, docSize));
  const safeTo = Math.max(0, Math.min(to, docSize));
  if (safeFrom >= safeTo) return null;

  let firstNonWsPos: number | null = null;
  let lastNonWsEndPos: number | null = null;

  doc.nodesBetween(safeFrom, safeTo, (node: any, pos: number) => {
    if (!node?.isText || typeof node.text !== 'string') return;

    const sliceFrom = Math.max(safeFrom, pos);
    const sliceTo = Math.min(safeTo, pos + node.nodeSize);
    if (sliceFrom >= sliceTo) return;

    const startOffset = sliceFrom - pos;
    const length = sliceTo - sliceFrom;

    for (let i = 0; i < length; i++) {
      const ch = node.text[startOffset + i];
      if (!/\s/u.test(ch)) {
        const charPos = sliceFrom + i;
        if (firstNonWsPos === null) {
          firstNonWsPos = charPos;
        }
        lastNonWsEndPos = charPos + 1;
      }
    }
  });

  if (firstNonWsPos === null || lastNonWsEndPos === null || firstNonWsPos >= lastNonWsEndPos) {
    return null;
  }

  return { from: firstNonWsPos, to: lastNonWsEndPos };
}

function collectOverlappedHighlights(
  doc: any,
  from: number,
  to: number
): { overlappedIds: Set<string>; hasOverlappedIdlessMark: boolean } {
  const overlappedIds = new Set<string>();
  let hasOverlappedIdlessMark = false;

  doc.nodesBetween(from, to, (node: any, pos: number) => {
    if (!node?.isText || !Array.isArray(node.marks)) return;
    if (pos + node.nodeSize <= from || pos >= to) return;

    for (let i = 0; i < node.marks.length; i++) {
      const mark = node.marks[i];
      if (mark?.type?.name !== 'customHighlight') continue;

      const rawId = typeof mark.attrs?.id === 'string' ? mark.attrs.id.trim() : '';
      if (rawId) {
        overlappedIds.add(rawId);
      } else {
        hasOverlappedIdlessMark = true;
      }
    }
  });

  return { overlappedIds, hasOverlappedIdlessMark };
}

function removeOverlappedHighlightsFromTr(
  doc: any,
  tr: any,
  markType: any,
  trimmed: HighlightRange,
  overlappedIds: Set<string>,
  hasOverlappedIdlessMark: boolean
): void {
  if (overlappedIds.size === 0 && !hasOverlappedIdlessMark) return;

  const idRangesToRemove: HighlightRange[] = [];
  const idlessRanges: HighlightRange[] = [];

  doc.descendants((node: any, pos: number) => {
    if (!node?.isText || !Array.isArray(node.marks)) return;

    let matchesOverlappedId = false;
    let hasIdlessHighlight = false;

    for (let i = 0; i < node.marks.length; i++) {
      const mark = node.marks[i];
      if (mark?.type?.name !== 'customHighlight') continue;

      const rawId = typeof mark.attrs?.id === 'string' ? mark.attrs.id.trim() : '';
      if (rawId) {
        if (overlappedIds.has(rawId)) {
          matchesOverlappedId = true;
        }
      } else if (hasOverlappedIdlessMark) {
        hasIdlessHighlight = true;
      }
    }

    if (matchesOverlappedId) {
      idRangesToRemove.push({ from: pos, to: pos + node.nodeSize });
    } else if (hasIdlessHighlight) {
      idlessRanges.push({ from: pos, to: pos + node.nodeSize });
    }
  });

  for (let i = 0; i < idRangesToRemove.length; i++) {
    tr.removeMark(idRangesToRemove[i].from, idRangesToRemove[i].to, markType);
  }

  if (idlessRanges.length > 0) {
    const mergedSpans: HighlightRange[] = [];
    for (let i = 0; i < idlessRanges.length; i++) {
      const current = idlessRanges[i];
      const last = mergedSpans[mergedSpans.length - 1];
      if (last && last.to === current.from) {
        mergedSpans[mergedSpans.length - 1] = { from: last.from, to: current.to };
      } else {
        mergedSpans.push(current);
      }
    }

    for (let i = 0; i < mergedSpans.length; i++) {
      const span = mergedSpans[i];
      if (span.from < trimmed.to && span.to > trimmed.from) {
        tr.removeMark(span.from, span.to, markType);
      }
    }
  }
}

/**
 * Cria uma transação ProseMirror única para aplicar um grifo sobre o intervalo selecionado:
 * 1) Recua espaços em branco no início e no final da seleção;
 * 2) Remove integralmente quaisquer grifos antigos que tenham interseção com o intervalo útil;
 * 3) Aplica um único novo grifo estritamente no intervalo ajustado.
 */
export function createHighlightTransaction(
  state: any,
  options?: ApplyHighlightOptions
): ApplyHighlightResult | null {
  const rawFrom = options?.from ?? state?.selection?.from;
  const rawTo = options?.to ?? state?.selection?.to;
  if (!state?.doc || typeof rawFrom !== 'number' || typeof rawTo !== 'number') {
    return null;
  }

  const trimmed = resolveTrimmedHighlightRange(
    state.doc,
    Math.min(rawFrom, rawTo),
    Math.max(rawFrom, rawTo)
  );
  if (!trimmed) return null;

  const markType = state.schema?.marks?.customHighlight;
  if (!markType) return null;

  const { overlappedIds, hasOverlappedIdlessMark } = collectOverlappedHighlights(
    state.doc,
    trimmed.from,
    trimmed.to
  );

  const tr = state.tr;
  removeOverlappedHighlightsFromTr(
    state.doc,
    tr,
    markType,
    trimmed,
    overlappedIds,
    hasOverlappedIdlessMark
  );

  const resolvedId =
    options?.id && options.id.trim()
      ? options.id.trim()
      : generateNextHighlightId(state.doc, options?.scopeKey);
  const resolvedColor: HighlightColor = options?.color || 'yellow';

  tr.addMark(trimmed.from, trimmed.to, markType.create({ color: resolvedColor, id: resolvedId }));

  if (options?.collapseToEnd) {
    const safePos = Math.min(trimmed.to, tr.doc.content.size);
    tr.setSelection(TextSelection.create(tr.doc, safePos));
  }

  return {
    tr,
    range: trimmed,
    id: resolvedId,
    removedIds: Array.from(overlappedIds),
  };
}

/**
 * Garante que um grifo existente na posição `pos` possua um `data-id` válido.
 * Caso seja um grifo legado sem ID, atribui um novo ID sequencial ao trecho contíguo
 * para que um comentário possa ser vinculado a ele.
 */
export function ensureHighlightIdAtPos(
  state: any,
  pos: number,
  scopeKey?: string | null
): { tr: any | null; id: string } | null {
  const doc = state?.doc;
  const markType = state?.schema?.marks?.customHighlight;
  if (!doc || !markType || typeof doc.descendants !== 'function') return null;

  const docSize = typeof doc.content?.size === 'number' ? doc.content.size : 0;
  const safePos = Math.max(0, Math.min(pos, docSize));

  const idlessRuns: Array<{ from: number; to: number; color: HighlightColor }> = [];
  let existingIdAtPos: string | null = null;

  doc.descendants((node: any, nodePos: number) => {
    if (!node?.isText || !Array.isArray(node.marks)) return;
    const nodeEnd = nodePos + node.nodeSize;

    for (let i = 0; i < node.marks.length; i++) {
      const mark = node.marks[i];
      if (mark?.type?.name !== 'customHighlight') continue;

      const rawId = typeof mark.attrs?.id === 'string' ? mark.attrs.id.trim() : '';
      if (rawId) {
        if (nodePos <= safePos && nodeEnd >= safePos) {
          existingIdAtPos = rawId;
        }
      } else {
        idlessRuns.push({
          from: nodePos,
          to: nodeEnd,
          color: (mark.attrs?.color as HighlightColor) || 'yellow',
        });
      }
    }
  });

  if (existingIdAtPos) {
    return { tr: null, id: existingIdAtPos };
  }

  if (idlessRuns.length === 0) return null;

  const mergedSpans: Array<{
    from: number;
    to: number;
    segments: Array<{ from: number; to: number; color: HighlightColor }>;
  }> = [];

  for (let i = 0; i < idlessRuns.length; i++) {
    const run = idlessRuns[i];
    const last = mergedSpans[mergedSpans.length - 1];
    if (last && last.to === run.from) {
      last.to = run.to;
      last.segments.push(run);
    } else {
      mergedSpans.push({
        from: run.from,
        to: run.to,
        segments: [run],
      });
    }
  }

  const targetSpan =
    mergedSpans.find((s) => s.from < safePos && s.to > safePos) ||
    mergedSpans.find((s) => s.from <= safePos && s.to >= safePos);

  if (!targetSpan) return null;

  const newId = generateNextHighlightId(doc, scopeKey);
  const tr = state.tr;

  for (let i = 0; i < targetSpan.segments.length; i++) {
    const seg = targetSpan.segments[i];
    tr.removeMark(seg.from, seg.to, markType);
    tr.addMark(seg.from, seg.to, markType.create({ color: seg.color, id: newId }));
  }

  return { tr, id: newId };
}

/**
 * Localiza o grifo mais recente atualmente vivo na árvore do ProseMirror.
 * Prioriza o maior ID sequencial V2; se não houver nenhum, retorna o último grifo legado do documento.
 */
export function findLatestHighlightInfo(doc: any): LatestHighlightTarget | null {
  if (!doc || typeof doc.descendants !== 'function') return null;

  let bestSequentialValue = 0;
  let bestSequentialId: string | null = null;
  let bestSequentialPos = -1;

  let fallbackLegacyId: string | null = null;
  let fallbackLegacyPos = -1;
  const seenLegacyFirstPos = new Map<string, number>();

  doc.descendants((node: any, pos: number) => {
    if (!node?.isText || !Array.isArray(node.marks)) return;
    for (let i = 0; i < node.marks.length; i++) {
      const mark = node.marks[i];
      if (mark?.type?.name !== 'customHighlight') continue;

      const rawId = typeof mark.attrs?.id === 'string' ? mark.attrs.id.trim() : '';
      const seqValue = parseSequentialHighlightId(rawId);

      if (seqValue !== null) {
        if (seqValue > bestSequentialValue) {
          bestSequentialValue = seqValue;
          bestSequentialId = rawId;
          bestSequentialPos = pos;
        }
      } else {
        if (rawId) {
          if (!seenLegacyFirstPos.has(rawId)) {
            seenLegacyFirstPos.set(rawId, pos);
          }
          fallbackLegacyId = rawId;
          fallbackLegacyPos = seenLegacyFirstPos.get(rawId) ?? pos;
        } else {
          fallbackLegacyId = null;
          fallbackLegacyPos = pos;
        }
      }
    }
  });

  if (bestSequentialPos >= 0 && bestSequentialId !== null) {
    return {
      id: bestSequentialId,
      isSequential: true,
      pos: bestSequentialPos,
    };
  }

  if (fallbackLegacyPos >= 0) {
    return {
      id: fallbackLegacyId,
      isSequential: false,
      pos: fallbackLegacyPos,
    };
  }

  return null;
}

/**
 * Aplica uma animação visual temporária (.mark-latest-pulse) nos elementos <mark> do grifo localizado.
 */
export function pulseHighlightElements(elements: ReadonlyArray<HTMLElement>): void {
  if (typeof document === 'undefined' || elements.length === 0) return;

  if (activePulseCleanupTimer !== null) {
    clearTimeout(activePulseCleanupTimer);
    activePulseCleanupTimer = null;
  }

  document.querySelectorAll('mark.mark-latest-pulse').forEach((el) => {
    el.classList.remove('mark-latest-pulse');
  });

  elements.forEach((el) => {
    // Força reflow leve para reiniciar a animação caso o mesmo grifo seja acionado duas vezes seguidas
    void el.offsetWidth;
    el.classList.add('mark-latest-pulse');
  });

  activePulseCleanupTimer = setTimeout(() => {
    elements.forEach((el) => el.classList.remove('mark-latest-pulse'));
    activePulseCleanupTimer = null;
  }, 1800);
}

/**
 * Encontra os elementos DOM <mark> pertencentes a um `highlightId` dentro do container do editor,
 * calcula a coordenada vertical confortável na viewport e opcionalmente executa o scroll e o pulso visual.
 */
export function scrollToHighlightByIdInContainer(
  container: HTMLElement | null,
  highlightId: string | null | undefined,
  options?: {
    behavior?: ScrollBehavior;
    pulse?: boolean;
    skipScroll?: boolean;
    fallbackToLastMark?: boolean;
  }
): number | null {
  if (typeof window === 'undefined' || !container) {
    return null;
  }

  const allMarks = Array.from(container.querySelectorAll('mark')) as HTMLElement[];
  if (allMarks.length === 0) return null;

  let matchedElements: HTMLElement[] = [];
  const cleanId = typeof highlightId === 'string' ? highlightId.trim() : '';
  if (cleanId) {
    matchedElements = allMarks.filter((el) => el.getAttribute('data-id') === cleanId);
  }

  if (matchedElements.length === 0 && options?.fallbackToLastMark) {
    matchedElements = [allMarks[allMarks.length - 1]];
  }

  if (matchedElements.length === 0) return null;

  const primaryElement = matchedElements[0];
  const rect = primaryElement.getBoundingClientRect();

  const headerHeightRaw = getComputedStyle(document.documentElement)
    .getPropertyValue('--header-height')
    .trim();
  const parsedHeaderHeight = Number.parseFloat(headerHeightRaw);
  const headerOffset = Number.isFinite(parsedHeaderHeight) && parsedHeaderHeight > 0 ? parsedHeaderHeight : 78;

  const usableViewport = Math.max(200, window.innerHeight - headerOffset);
  const comfortableTopOffset = headerOffset + usableViewport * 0.28;

  const rawTargetY = rect.top + window.scrollY - comfortableTopOffset;
  const maxScrollableY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const targetScrollY = Math.max(0, Math.min(Math.round(rawTargetY), maxScrollableY));

  if (!options?.skipScroll) {
    window.scrollTo({
      top: targetScrollY,
      left: 0,
      behavior: options?.behavior ?? 'smooth',
    });
  }

  if (options?.pulse !== false) {
    pulseHighlightElements(matchedElements);
  }

  return targetScrollY;
}

/**
 * Encontra os elementos DOM <mark> do grifo mais recente dentro do container do editor,
 * calcula a coordenada vertical confortável na viewport e opcionalmente executa o scroll e o pulso visual.
 */
export function scrollToLatestHighlightInContainer(
  container: HTMLElement | null,
  editor: any,
  options?: { behavior?: ScrollBehavior; pulse?: boolean; skipScroll?: boolean }
): number | null {
  if (typeof window === 'undefined' || !container || !editor || editor.isDestroyed) {
    return null;
  }

  const targetInfo = findLatestHighlightInfo(editor.state?.doc);
  if (!targetInfo) return null;

  return scrollToHighlightByIdInContainer(container, targetInfo.id, {
    ...options,
    fallbackToLastMark: true,
  });
}

/**
 * Registra o callback do editor ativo para responder ao botão/atalho de ir ao último grifo.
 */
export function registerScrollToLatestHighlightHandler(handler: ScrollToLatestHandler): () => void {
  registeredScrollHandler = handler;
  return () => {
    if (registeredScrollHandler === handler) {
      registeredScrollHandler = null;
    }
  };
}

/**
 * Dispara a navegação até o grifo mais recente no editor ativo.
 */
export function requestScrollToLatestHighlight(): void {
  if (registeredScrollHandler) {
    registeredScrollHandler();
  }
}

/**
 * Limpa a memória de marcas d'água (uso em testes unitários).
 */
export function resetHighlightIdMemory(): void {
  highWaterMarkByScope = new Map();
  scannedDocMaxCache = new WeakMap<object, number>();
}
