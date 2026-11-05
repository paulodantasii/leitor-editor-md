import {
  extractHeadingsFromMarkdown,
  getStickyTopOffsetPx,
} from './tocService';

/**
 * Representa uma âncora agnóstica de altura entre o Modo Visual (.ProseMirror)
 * e o Modo Código-Fonte (<textarea>).
 */
export interface ScrollSyncAnchor {
  /** Se true, o usuário estava no topo absoluto do documento (acima do primeiro conteúdo rolável). */
  readonly isAtVeryTop: boolean;
  /** Se true, o usuário estava no final absoluto da página. */
  readonly isAtVeryBottom: boolean;
  /**
   * Índice do título (0..N-1) imediatamente anterior ou na linha de leitura (anchorLineY).
   * -1 quando a posição atual está antes do primeiro título ou quando o documento não possui títulos.
   */
  readonly headingIndex: number;
  /**
   * Fração [0..1] percorrida verticalmente entre o título `headingIndex` (ou topo do container se -1)
   * e o próximo título `headingIndex + 1` (ou final do container se não houver próximo).
   */
  readonly segmentProgress: number;
  /**
   * Progresso global [0..1] dentro da área útil do editor/textarea como referência complementar.
   */
  readonly globalProgress: number;
  /**
   * Offset de caractere estimado ou exato no Markdown bruto (quando disponível).
   */
  readonly markdownCharOffset?: number;
}

const MIRROR_STYLE_PROPS = [
  'boxSizing',
  'width',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'textIndent',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
] as const;

/**
 * Interpola linearmente um valor em [0..1] dentro do intervalo [start, end].
 */
export function lerp(start: number, end: number, t: number): number {
  const clampedT = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return start + (end - start) * clampedT;
}

/**
 * Calcula a fração [0..1] que `value` ocupa entre `start` e `end`.
 */
export function inverseLerp(start: number, end: number, value: number): number {
  const span = end - start;
  if (!Number.isFinite(span) || span <= 0) return 0;
  return Math.min(1, Math.max(0, (value - start) / span));
}

/**
 * Dado um array ordenado de coordenadas Y (ex.: topos dos headings no DOM ou no textarea)
 * e os limites [containerTopY, containerBottomY], calcula em qual segmento (headingIndex)
 * a linha de referência `anchorY` se encontra e qual a fração `segmentProgress` [0..1] dentro dele.
 */
export function computePiecewiseAnchorFromStops(
  stopsY: ReadonlyArray<number>,
  containerTopY: number,
  containerBottomY: number,
  anchorY: number
): { headingIndex: number; segmentProgress: number; globalProgress: number } {
  const globalProgress = inverseLerp(containerTopY, containerBottomY, anchorY);

  if (stopsY.length === 0) {
    return {
      headingIndex: -1,
      segmentProgress: globalProgress,
      globalProgress,
    };
  }

  let headingIndex = -1;
  for (let i = 0; i < stopsY.length; i++) {
    if (stopsY[i] <= anchorY) {
      headingIndex = i;
    } else {
      break;
    }
  }

  const segStart = headingIndex === -1 ? containerTopY : stopsY[headingIndex];
  const segEnd =
    headingIndex + 1 < stopsY.length
      ? stopsY[headingIndex + 1]
      : Math.max(containerBottomY, segStart + 1);

  const segmentProgress = inverseLerp(segStart, segEnd, anchorY);

  return {
    headingIndex,
    segmentProgress,
    globalProgress,
  };
}

/**
 * Operação inversa de `computePiecewiseAnchorFromStops`:
 * Dado um conjunto de paradas `stopsY` no modo de destino e os limites [containerTopY, containerBottomY],
 * reconstrói a coordenada Y exata correspondente a `(headingIndex, segmentProgress, globalProgress)`.
 */
export function resolveTargetYFromPiecewiseAnchor(
  stopsY: ReadonlyArray<number>,
  containerTopY: number,
  containerBottomY: number,
  anchor: Pick<ScrollSyncAnchor, 'headingIndex' | 'segmentProgress' | 'globalProgress'>
): number {
  if (stopsY.length === 0) {
    return lerp(containerTopY, containerBottomY, anchor.globalProgress);
  }

  const clampedIdx = Math.min(anchor.headingIndex, stopsY.length - 1);
  const segStart = clampedIdx < 0 ? containerTopY : stopsY[clampedIdx];
  const segEnd =
    clampedIdx + 1 < stopsY.length
      ? stopsY[clampedIdx + 1]
      : Math.max(containerBottomY, segStart);

  return lerp(segStart, segEnd, anchor.segmentProgress);
}

/**
 * Cria um elemento Mirror Div fora da tela com a mesma geometria e tipografia do <textarea>
 * para medir com precisão de sub-pixel a altura vertical renderizada de qualquer substring.
 * Retorna `null` se o ambiente não possuir layout real (ex.: JSDOM em testes unitários).
 */
function createTextareaMirror(textarea: HTMLTextAreaElement): HTMLDivElement | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const clientWidth = textarea.clientWidth;
  if (!clientWidth || clientWidth <= 0) return null;

  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');

  mirror.style.position = 'absolute';
  mirror.style.top = '-99999px';
  mirror.style.left = '-99999px';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.overflow = 'hidden';

  for (const prop of MIRROR_STYLE_PROPS) {
    (mirror.style as any)[prop] = computed[prop];
  }

  mirror.style.width = `${clientWidth}px`;
  mirror.style.height = 'auto';
  mirror.style.minHeight = '0';
  mirror.style.maxHeight = 'none';

  document.body.appendChild(mirror);
  return mirror;
}

/**
 * Mede a distância vertical (px) do topo interno do `<textarea>` até o `charOffset` informado.
 * Usa Mirror Div quando há layout real no navegador e faz fallback proporcional seguro em JSDOM.
 */
export function measureTextareaOffsetTopPx(
  textarea: HTMLTextAreaElement,
  markdown: string,
  charOffset: number
): number {
  const totalLen = markdown.length;
  if (totalLen === 0 || charOffset <= 0) return 0;
  const clampedOffset = Math.min(totalLen, Math.max(0, Math.round(charOffset)));

  const mirror = createTextareaMirror(textarea);
  if (mirror) {
    try {
      mirror.textContent = markdown.slice(0, clampedOffset);
      const marker = document.createElement('span');
      marker.textContent = '\u200b';
      mirror.appendChild(marker);
      const topPx = marker.offsetTop;
      if (Number.isFinite(topPx) && topPx >= 0) {
        return topPx;
      }
    } finally {
      mirror.remove();
    }
  }

  // Fallback proporcional por linhas/caracteres (ambientes sem layout / JSDOM)
  const totalHeight = Math.max(1, textarea.scrollHeight || 480);
  return (clampedOffset / totalLen) * totalHeight;
}

/**
 * Mede em lote (em uma única passagem de DOM/Mirror Div) as coordenadas Y internas no `<textarea>`
 * para múltiplos `charOffsets` ordenados crescentemente.
 * Extremamente rápido mesmo para documentos com centenas de títulos.
 */
export function measureMultipleTextareaOffsetsTopPx(
  textarea: HTMLTextAreaElement,
  markdown: string,
  charOffsets: ReadonlyArray<number>
): ReadonlyArray<number> {
  if (charOffsets.length === 0) return [];
  const totalLen = markdown.length;
  if (totalLen === 0) return charOffsets.map(() => 0);

  const mirror = createTextareaMirror(textarea);
  if (mirror) {
    try {
      const fragment = document.createDocumentFragment();
      const markers: HTMLSpanElement[] = [];
      let prevOffset = 0;

      for (let i = 0; i < charOffsets.length; i++) {
        const clamped = Math.min(totalLen, Math.max(prevOffset, Math.round(charOffsets[i])));
        if (clamped > prevOffset) {
          fragment.appendChild(document.createTextNode(markdown.slice(prevOffset, clamped)));
        }
        const marker = document.createElement('span');
        marker.textContent = '\u200b';
        fragment.appendChild(marker);
        markers.push(marker);
        prevOffset = clamped;
      }

      mirror.appendChild(fragment);
      const heights = markers.map((m) => m.offsetTop);
      if (heights.every((h) => Number.isFinite(h))) {
        return heights;
      }
    } finally {
      mirror.remove();
    }
  }

  const totalHeight = Math.max(1, textarea.scrollHeight || 480);
  return charOffsets.map((offset) => {
    const clamped = Math.min(totalLen, Math.max(0, offset));
    return (clamped / totalLen) * totalHeight;
  });
}

/**
 * Dado um deslocamento vertical `targetLocalY` (px a partir do topo do `<textarea>`),
 * encontra por busca binária o `charOffset` correspondente no Markdown bruto.
 */
export function findMarkdownCharOffsetAtLocalY(
  textarea: HTMLTextAreaElement,
  markdown: string,
  targetLocalY: number
): number {
  const totalLen = markdown.length;
  if (totalLen === 0 || targetLocalY <= 0) return 0;

  const totalScrollHeight = Math.max(1, textarea.scrollHeight || 480);
  if (targetLocalY >= totalScrollHeight) return totalLen;

  // Divide o texto em inícios de linha para busca binária rápida O(log L)
  const lineStarts: number[] = [0];
  for (let i = 0; i < totalLen; i++) {
    if (markdown.charCodeAt(i) === 10 /* \n */ && i + 1 <= totalLen) {
      lineStarts.push(i + 1);
    }
  }

  const mirror = createTextareaMirror(textarea);
  if (!mirror) {
    return Math.round((targetLocalY / totalScrollHeight) * totalLen);
  }

  try {
    let low = 0;
    let high = lineStarts.length - 1;
    let bestLineIdx = 0;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const charPos = lineStarts[mid];
      mirror.textContent = markdown.slice(0, charPos);
      const marker = document.createElement('span');
      marker.textContent = '\u200b';
      mirror.appendChild(marker);
      const currentY = marker.offsetTop;

      if (currentY <= targetLocalY) {
        bestLineIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return lineStarts[bestLineIdx];
  } finally {
    mirror.remove();
  }
}

/**
 * Coleta os elementos DOM de título (`h1`..`h6`) não-vazios dentro do `.ProseMirror`,
 * garantindo correspondência 1:1 com `extractHeadingsFromProseMirrorDoc` e `extractHeadingsFromMarkdown`.
 */
export function getNonEmptyVisualHeadingElements(
  container: HTMLElement | null
): ReadonlyArray<HTMLElement> {
  if (!container) return [];
  const nodeList = container.querySelectorAll(
    '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6'
  );
  const result: HTMLElement[] = [];
  for (let i = 0; i < nodeList.length; i++) {
    const el = nodeList[i] as HTMLElement;
    if ((el.textContent || '').trim().length > 0) {
      result.push(el);
    }
  }
  return result;
}

/**
 * Captura a âncora estrutural de leitura atual a partir do Modo Visual (`.ProseMirror`),
 * ANTES de ocultar o editor visual para exibir o `<textarea>` do Modo Código-Fonte.
 */
export function captureVisualScrollAnchor(
  container: HTMLElement | null,
  markdown: string
): ScrollSyncAnchor {
  if (typeof window === 'undefined' || !container) {
    return {
      isAtVeryTop: true,
      isAtVeryBottom: false,
      headingIndex: -1,
      segmentProgress: 0,
      globalProgress: 0,
      markdownCharOffset: 0,
    };
  }

  const scrollY = window.scrollY;
  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  if (scrollY <= 4) {
    return {
      isAtVeryTop: true,
      isAtVeryBottom: false,
      headingIndex: -1,
      segmentProgress: 0,
      globalProgress: 0,
      markdownCharOffset: 0,
    };
  }

  const isAtVeryBottom = maxScrollY > 20 && scrollY >= maxScrollY - 6;

  const proseMirrorEl = (container.querySelector('.ProseMirror') as HTMLElement | null) || container;
  const pmRect = proseMirrorEl.getBoundingClientRect();
  const containerTopDocY = pmRect.top + scrollY;
  const containerBottomDocY = Math.max(containerTopDocY + 1, pmRect.bottom + scrollY);

  const stickyOffsetPx = getStickyTopOffsetPx();
  const anchorDocY = scrollY + stickyOffsetPx + 8;

  const headingEls = getNonEmptyVisualHeadingElements(container);
  const stopsDocY = headingEls.map((el) => el.getBoundingClientRect().top + scrollY);

  const piecewise = computePiecewiseAnchorFromStops(
    stopsDocY,
    containerTopDocY,
    containerBottomDocY,
    anchorDocY
  );

  // Estima também o charOffset correspondente no Markdown bruto usando os títulos extraídos
  const mdHeadings = extractHeadingsFromMarkdown(markdown);
  let estimatedCharOffset = Math.round(piecewise.globalProgress * markdown.length);

  if (mdHeadings.length > 0 && mdHeadings.length === stopsDocY.length) {
    const idx = piecewise.headingIndex;
    const startChar = idx < 0 ? 0 : (mdHeadings[idx].charOffset ?? 0);
    const endChar =
      idx + 1 < mdHeadings.length
        ? (mdHeadings[idx + 1].charOffset ?? markdown.length)
        : markdown.length;
    estimatedCharOffset = Math.round(lerp(startChar, endChar, piecewise.segmentProgress));
  }

  return {
    isAtVeryTop: false,
    isAtVeryBottom,
    headingIndex: piecewise.headingIndex,
    segmentProgress: piecewise.segmentProgress,
    globalProgress: piecewise.globalProgress,
    markdownCharOffset: estimatedCharOffset,
  };
}

/**
 * Captura a âncora estrutural de leitura atual a partir do Modo Código-Fonte (`<textarea>`),
 * ANTES (ou no exato instante) de voltar para o Modo Visual / Leitura.
 */
export function captureSourceScrollAnchor(
  textarea: HTMLTextAreaElement | null,
  markdown: string
): ScrollSyncAnchor {
  if (typeof window === 'undefined' || !textarea) {
    return {
      isAtVeryTop: true,
      isAtVeryBottom: false,
      headingIndex: -1,
      segmentProgress: 0,
      globalProgress: 0,
      markdownCharOffset: 0,
    };
  }

  const scrollY = window.scrollY;
  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  if (scrollY <= 4) {
    return {
      isAtVeryTop: true,
      isAtVeryBottom: false,
      headingIndex: -1,
      segmentProgress: 0,
      globalProgress: 0,
      markdownCharOffset: 0,
    };
  }

  const isAtVeryBottom = maxScrollY > 20 && scrollY >= maxScrollY - 6;

  const rect = textarea.getBoundingClientRect();
  const textareaTopDocY = rect.top + scrollY;
  const textareaHeight = Math.max(1, textarea.scrollHeight || rect.height || 480);
  const textareaBottomDocY = textareaTopDocY + textareaHeight;

  const stickyOffsetPx = getStickyTopOffsetPx();
  const anchorDocY = scrollY + stickyOffsetPx + 8;

  const mdHeadings = extractHeadingsFromMarkdown(markdown);
  const charOffsets = mdHeadings.map((h) => h.charOffset ?? 0);
  const localOffsetsPx = measureMultipleTextareaOffsetsTopPx(textarea, markdown, charOffsets);
  const stopsDocY = localOffsetsPx.map((localY) => textareaTopDocY + localY);

  const piecewise = computePiecewiseAnchorFromStops(
    stopsDocY,
    textareaTopDocY,
    textareaBottomDocY,
    anchorDocY
  );

  const localTargetY = Math.max(0, anchorDocY - textareaTopDocY);
  const markdownCharOffset = findMarkdownCharOffsetAtLocalY(textarea, markdown, localTargetY);

  return {
    isAtVeryTop: false,
    isAtVeryBottom,
    headingIndex: piecewise.headingIndex,
    segmentProgress: piecewise.segmentProgress,
    globalProgress: piecewise.globalProgress,
    markdownCharOffset,
  };
}

/**
 * Resolve o `window.scrollY` alvo quando o usuário acaba de entrar no Modo Código-Fonte (`<textarea>`).
 */
export function resolveSourceTargetScrollY(
  textarea: HTMLTextAreaElement,
  markdown: string,
  anchor: ScrollSyncAnchor
): number {
  if (typeof window === 'undefined') return 0;
  if (anchor.isAtVeryTop) return 0;

  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  if (anchor.isAtVeryBottom) return maxScrollY;

  const scrollY = window.scrollY;
  const rect = textarea.getBoundingClientRect();
  const textareaTopDocY = rect.top + scrollY;
  const textareaHeight = Math.max(1, textarea.scrollHeight || rect.height || 480);
  const textareaBottomDocY = textareaTopDocY + textareaHeight;

  const stickyOffsetPx = getStickyTopOffsetPx();
  const mdHeadings = extractHeadingsFromMarkdown(markdown);

  let targetAnchorDocY: number;

  if (mdHeadings.length > 0 && anchor.headingIndex >= -1) {
    const charOffsets = mdHeadings.map((h) => h.charOffset ?? 0);
    const localOffsetsPx = measureMultipleTextareaOffsetsTopPx(textarea, markdown, charOffsets);
    const stopsDocY = localOffsetsPx.map((localY) => textareaTopDocY + localY);

    targetAnchorDocY = resolveTargetYFromPiecewiseAnchor(
      stopsDocY,
      textareaTopDocY,
      textareaBottomDocY,
      anchor
    );
  } else if (typeof anchor.markdownCharOffset === 'number' && anchor.markdownCharOffset > 0) {
    const localY = measureTextareaOffsetTopPx(textarea, markdown, anchor.markdownCharOffset);
    targetAnchorDocY = textareaTopDocY + localY;
  } else {
    targetAnchorDocY = lerp(textareaTopDocY, textareaBottomDocY, anchor.globalProgress);
  }

  const rawTargetScrollY = targetAnchorDocY - stickyOffsetPx - 8;
  return Math.max(0, Math.min(Math.round(rawTargetScrollY), maxScrollY));
}

/**
 * Resolve o `window.scrollY` alvo quando o usuário acaba de voltar ao Modo Visual / Leitura (`.ProseMirror`).
 */
export function resolveVisualTargetScrollY(
  container: HTMLElement,
  anchor: ScrollSyncAnchor
): number {
  if (typeof window === 'undefined') return 0;
  if (anchor.isAtVeryTop) return 0;

  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  if (anchor.isAtVeryBottom) return maxScrollY;

  const scrollY = window.scrollY;
  const proseMirrorEl = (container.querySelector('.ProseMirror') as HTMLElement | null) || container;
  const pmRect = proseMirrorEl.getBoundingClientRect();
  const containerTopDocY = pmRect.top + scrollY;
  const containerBottomDocY = Math.max(containerTopDocY + 1, pmRect.bottom + scrollY);

  const stickyOffsetPx = getStickyTopOffsetPx();
  const headingEls = getNonEmptyVisualHeadingElements(container);
  const stopsDocY = headingEls.map((el) => el.getBoundingClientRect().top + scrollY);

  const targetAnchorDocY = resolveTargetYFromPiecewiseAnchor(
    stopsDocY,
    containerTopDocY,
    containerBottomDocY,
    anchor
  );

  const rawTargetScrollY = targetAnchorDocY - stickyOffsetPx - 8;
  return Math.max(0, Math.min(Math.round(rawTargetScrollY), maxScrollY));
}
