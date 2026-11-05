export interface TocHeadingItem {
  /** Identificador estável por índice e nível (ex.: "h-0-1", "h-1-2") */
  readonly id: string;
  /** Ordem sequencial (0..N-1) do título no documento */
  readonly index: number;
  /** Nível do título Markdown (1 a 6) */
  readonly level: number;
  /** Texto limpo do título para exibição */
  readonly text: string;
  /** Posição no documento ProseMirror (quando extraído do editor) */
  readonly pmPos?: number;
  /** Índice de caractere inicial no Markdown bruto (quando extraído via texto) */
  readonly charOffset?: number;
}

export interface TocStateSnapshot {
  readonly headings: ReadonlyArray<TocHeadingItem>;
  readonly activeIndex: number; // -1 quando antes do primeiro título
}

type TocListener = (snapshot: TocStateSnapshot) => void;
type NavigateToHeadingHandler = (headingIndex: number) => void;

let currentSnapshot: TocStateSnapshot = {
  headings: [],
  activeIndex: -1,
};

let listeners: ReadonlyArray<TocListener> = [];
let navigateHandler: NavigateToHeadingHandler | null = null;
let activeHeadingPulseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Remove tags HTML (como <mark>, <u>, <sub>, <sup>) e marcadores Markdown inline
 * para exibir o título limpo no breadcrumb e no sumário.
 */
export function cleanHeadingText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/<[^>]+>/g, '') // remove tags HTML como <mark ...>
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // imagens ![alt](url) -> alt
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links [texto](url) -> texto
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/~~(.*?)~~/g, '$1') // strikethrough
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrai a lista de títulos diretamente da árvore de documento ProseMirror.
 */
export function extractHeadingsFromProseMirrorDoc(doc: any): ReadonlyArray<TocHeadingItem> {
  if (!doc || typeof doc.descendants !== 'function') return [];

  const result: TocHeadingItem[] = [];
  let index = 0;

  doc.descendants((node: any, pos: number) => {
    if (node?.type?.name === 'heading') {
      const rawLevel = Number(node.attrs?.level) || 1;
      const level = Math.min(6, Math.max(1, rawLevel));
      const text = cleanHeadingText(node.textContent || '');
      if (text.length > 0) {
        result.push({
          id: `h-${index}-${level}`,
          index,
          level,
          text,
          pmPos: pos,
        });
        index += 1;
      }
      return false; // não precisa descer dentro dos filhos do heading
    }
    return true;
  });

  return result;
}

/**
 * Extrai a lista de títulos de uma string Markdown bruta (usado no Modo Código-Fonte ou fallback),
 * ignorando linhas com # dentro de blocos de código cercados (``` ou ~~~).
 */
export function extractHeadingsFromMarkdown(markdown: string): ReadonlyArray<TocHeadingItem> {
  if (!markdown) return [];

  const lines = markdown.split(/\r?\n/);
  const result: TocHeadingItem[] = [];
  let inCodeFence = false;
  let fenceMarker = '';
  let charCursor = 0;
  let index = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStartOffset = charCursor;
    // +1 para o \n (aproximado para posicionamento de scroll em textarea)
    charCursor += line.length + 1;

    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inCodeFence) {
        inCodeFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inCodeFence = false;
        fenceMarker = '';
      }
      continue;
    }

    if (inCodeFence) continue;

    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = cleanHeadingText(headingMatch[2]);
      if (text.length > 0) {
        result.push({
          id: `h-${index}-${level}`,
          index,
          level,
          text,
          charOffset: lineStartOffset,
        });
        index += 1;
      }
    }
  }

  return result;
}

/**
 * Constrói a trilha hierárquica (Breadcrumb) para o título atualmente ativo (`activeIndex`).
 *
 * Exemplo:
 * Se a estrutura for:
 *   [0] H1: Direito das Famílias
 *   [1] H2: 1. Casamento
 *   [2] H3: 1.1 Existência
 *   [3] H2: 2. União Estável
 *
 * - Quando activeIndex = 0 -> retorna [H1]
 * - Quando activeIndex = 1 -> retorna [H1, H2(1. Casamento)]
 * - Quando activeIndex = 2 -> retorna [H1, H2(1. Casamento), H3(1.1 Existência)]
 * - Quando activeIndex = 3 -> retorna [H1, H2(2. União Estável)]
 * - Quando activeIndex = -1 (antes do 1º título, mas há títulos no doc) -> retorna [headings[0]]
 */
export function computeBreadcrumbTrail(
  headings: ReadonlyArray<TocHeadingItem>,
  activeIndex: number
): ReadonlyArray<TocHeadingItem> {
  if (headings.length === 0) return [];

  const safeIndex =
    activeIndex >= 0 && activeIndex < headings.length ? activeIndex : 0;

  const target = headings[safeIndex];
  const reversedChain: TocHeadingItem[] = [target];
  let currentMinLevel = target.level;

  for (let i = safeIndex - 1; i >= 0; i--) {
    const candidate = headings[i];
    if (candidate.level < currentMinLevel) {
      reversedChain.push(candidate);
      currentMinLevel = candidate.level;
      if (currentMinLevel === 1) break;
    }
  }

  return [...reversedChain].reverse();
}

/**
 * Dado um array de coordenadas Y (topo de cada heading no documento ou relativo à viewport)
 * e a linha de corte `thresholdY`, retorna o índice do título ativo no momento.
 */
export function findActiveHeadingIndexByTops(
  headingTops: ReadonlyArray<number>,
  thresholdY: number
): number {
  if (headingTops.length === 0) return -1;

  let activeIdx = -1;
  for (let i = 0; i < headingTops.length; i++) {
    if (headingTops[i] <= thresholdY) {
      activeIdx = i;
    } else {
      break;
    }
  }

  // Se o usuário está no topo do documento logo acima do primeiro título (ex.: título visível na tela inicial da página),
  // seleciona o primeiro título (0) para já localizar o leitor.
  return activeIdx === -1 ? 0 : activeIdx;
}

/**
 * Calcula a altura total ocupada pelas barras fixas no topo (Header + EditorToolbar se visível).
 */
export function getStickyTopOffsetPx(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 84;

  const headerHeightRaw = getComputedStyle(document.documentElement)
    .getPropertyValue('--header-height')
    .trim();
  const parsedHeader = Number.parseFloat(headerHeightRaw);
  const headerPx = Number.isFinite(parsedHeader) && parsedHeader > 0 ? parsedHeader : 84;

  const toolbarEl = document.querySelector('[data-editor-toolbar]') as HTMLElement | null;
  if (toolbarEl) {
    const rect = toolbarEl.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom > headerPx) {
      return Math.round(rect.bottom + 12);
    }
  }

  return Math.round(headerPx + 14);
}

/**
 * Aplica um pulso sutil no elemento de título recém-navegado.
 */
export function pulseHeadingElement(el: HTMLElement | null): void {
  if (!el || typeof document === 'undefined') return;

  if (activeHeadingPulseTimer !== null) {
    clearTimeout(activeHeadingPulseTimer);
    activeHeadingPulseTimer = null;
  }

  document.querySelectorAll('.heading-target-pulse').forEach((node) => {
    node.classList.remove('heading-target-pulse');
  });

  void el.offsetWidth;
  el.classList.add('heading-target-pulse');

  activeHeadingPulseTimer = setTimeout(() => {
    el.classList.remove('heading-target-pulse');
    activeHeadingPulseTimer = null;
  }, 1600);
}

/**
 * Verifica se duas listas de títulos possuem exatamente a mesma estrutura e textos,
 * evitando re-renderizações desnecessárias na UI.
 */
export function areHeadingsEqual(
  a: ReadonlyArray<TocHeadingItem>,
  b: ReadonlyArray<TocHeadingItem>
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].level !== b[i].level || a[i].text !== b[i].text) {
      return false;
    }
  }
  return true;
}

export function getTocSnapshot(): TocStateSnapshot {
  return currentSnapshot;
}

export function updateTocState(
  nextHeadings: ReadonlyArray<TocHeadingItem>,
  nextActiveIndex: number
): void {
  const clampedActive =
    nextHeadings.length === 0
      ? -1
      : Math.min(Math.max(0, nextActiveIndex), nextHeadings.length - 1);

  if (
    areHeadingsEqual(currentSnapshot.headings, nextHeadings) &&
    currentSnapshot.activeIndex === clampedActive
  ) {
    return;
  }

  currentSnapshot = {
    headings: nextHeadings,
    activeIndex: clampedActive,
  };

  listeners.forEach((listener) => listener(currentSnapshot));
}

export function setTocActiveIndex(nextActiveIndex: number): void {
  updateTocState(currentSnapshot.headings, nextActiveIndex);
}

export function resetTocState(): void {
  if (currentSnapshot.headings.length === 0 && currentSnapshot.activeIndex === -1) {
    return;
  }
  currentSnapshot = { headings: [], activeIndex: -1 };
  listeners.forEach((listener) => listener(currentSnapshot));
}

export function subscribeTocState(listener: TocListener): () => void {
  listeners = [...listeners, listener];
  listener(currentSnapshot);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function registerNavigateToHeadingHandler(handler: NavigateToHeadingHandler): () => void {
  navigateHandler = handler;
  return () => {
    if (navigateHandler === handler) {
      navigateHandler = null;
    }
  };
}

export function requestNavigateToHeading(headingIndex: number): void {
  if (navigateHandler) {
    navigateHandler(headingIndex);
  }
}
