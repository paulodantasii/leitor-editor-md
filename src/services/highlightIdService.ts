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

export const SEQUENTIAL_ID_MIN_LENGTH = 5;
const SEQUENTIAL_ID_REGEX = /^[0-9a-z]{5,}$/;
const DEFAULT_SCOPE_KEY = '__default_doc__';

/**
 * Memória monotônica imutável por documento (evita reutilizar IDs recém-apagados
 * na mesma sessão, protegendo o histórico de Undo/Redo do ProseMirror).
 */
let highWaterMarkByScope: ReadonlyMap<string, number> = new Map();

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
 * Gera o próximo ID sequencial garantidamente único e maior que todos os existentes no documento.
 */
export function generateNextHighlightId(docOrMarkdown?: any, scopeKey?: string | null): string {
  const resolvedScope = scopeKey && scopeKey.trim() ? scopeKey.trim() : DEFAULT_SCOPE_KEY;

  const scan =
    typeof docOrMarkdown === 'string'
      ? scanHighlightsInMarkdown(docOrMarkdown)
      : scanHighlightsInProseMirrorDoc(docOrMarkdown);

  const previousHighWater = highWaterMarkByScope.get(resolvedScope) ?? 0;
  const nextCounter = Math.max(scan.sequentialMax, previousHighWater) + 1;

  highWaterMarkByScope = new Map([...highWaterMarkByScope, [resolvedScope, nextCounter]]);
  return formatSequentialHighlightId(nextCounter);
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

  let matchedElements: HTMLElement[] = [];

  if (targetInfo.id) {
    const allMarks = Array.from(container.querySelectorAll('mark')) as HTMLElement[];
    matchedElements = allMarks.filter((el) => el.getAttribute('data-id') === targetInfo.id);
  }

  if (matchedElements.length === 0) {
    const allMarks = Array.from(container.querySelectorAll('mark')) as HTMLElement[];
    if (allMarks.length > 0) {
      matchedElements = [allMarks[allMarks.length - 1]];
    }
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
}
