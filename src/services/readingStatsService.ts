/**
 * Serviço puro e imutável para cálculo de métricas de leitura, mapeamento de seções,
 * estimativa de páginas, duração restante e formatação da data da última modificação.
 */

import { DocumentState } from '../types';
import {
  HIGHLIGHT_COMMENTS_START_MARKER,
  HIGHLIGHT_COMMENTS_END_MARKER,
  parseMarkdownWithHighlightComments,
} from './highlightCommentsService';
import { cleanHeadingText } from './tocService';

export const WORDS_PER_PAGE = 275;
export const DEFAULT_READING_WPM = 130;

export interface TextMetrics {
  readonly wordCount: number;
  readonly charCount: number;
  readonly charCountNoSpaces: number;
}

export interface SectionWordSpan {
  readonly headingIndex: number;
  readonly level: number;
  readonly title: string;
  readonly startWordOffset: number;
  readonly endWordOffset: number;
  readonly wordCount: number;
}

export interface DocumentReadingMap {
  readonly wordCount: number;
  readonly charCount: number;
  readonly charCountNoSpaces: number;
  readonly totalPages: number;
  readonly sections: ReadonlyArray<SectionWordSpan>;
}

export interface ActiveSectionProgressInput {
  readonly sectionStartWord: number;
  readonly sectionEndWord: number;
  readonly sectionRatio: number;
}

export interface ReadingEstimates {
  readonly currentWordOffset: number;
  readonly remainingWords: number;
  readonly currentPage: number;
  readonly totalPages: number;
  readonly totalSeconds: number;
  readonly remainingSeconds: number;
  readonly sectionRemainingSeconds: number | null;
  readonly sectionTitle: string | null;
  readonly estimatedFinishTime: string | null;
}

const PT_BR_INTEGER_FORMATTER = new Intl.NumberFormat('pt-BR');
const WORD_MATCH_REGEX = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function countWordsInCleanText(cleanText: string): number {
  if (!cleanText) return 0;
  const matches = cleanText.match(WORD_MATCH_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Remove a seção oculta de comentários dos grifos do final do Markdown
 * para que não distorça as métricas reais de leitura.
 */
export function extractReadableMarkdownBody(rawMarkdown: string): string {
  if (!rawMarkdown) return '';
  return parseMarkdownWithHighlightComments(rawMarkdown).bodyMarkdown;
}

/**
 * Converte uma linha Markdown em texto legível, removendo tags HTML (ex.: <mark>)
 * e sintaxe de formatação sem alterar o conteúdo textual lido.
 */
export function stripMarkdownLineToReadableText(line: string): string {
  if (!line) return '';

  const trimmed = line.trim();
  if (!trimmed) return '';
  if (/^(`{3,}|~{3,})/.test(trimmed)) return '';
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return '';

  let text = line
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/, '$1')
    .replace(/^\s{0,3}(?:>\s?)+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,;:!?])/g, '$1$2');

  if (/^\|[\s|:\-]+\|$/.test(text.trim())) {
    return '';
  }
  if (text.trim().startsWith('|') && text.trim().endsWith('|')) {
    text = text.replace(/\|/g, ' ');
  }

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Analisa texto plano (como uma seleção do usuário) retornando palavras,
 * caracteres com espaços e caracteres sem espaços.
 */
export function analyzePlainText(text: string): TextMetrics {
  if (!text) {
    return { wordCount: 0, charCount: 0, charCountNoSpaces: 0 };
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return { wordCount: 0, charCount: 0, charCountNoSpaces: 0 };
  }

  const wordCount = countWordsInCleanText(normalized);
  const charCount = normalized.length;
  const charCountNoSpaces = normalized.replace(/\s+/g, '').length;

  return {
    wordCount,
    charCount,
    charCountNoSpaces,
  };
}

/**
 * Mapeia o corpo Markdown em contagens de palavras/caracteres e intervalos de seções,
 * mantendo paridade 1:1 de índices com `extractHeadingsFromMarkdown` em `tocService.ts`.
 */
export function computeDocumentReadingMap(rawMarkdown: string): DocumentReadingMap {
  const bodyMarkdown = extractReadableMarkdownBody(rawMarkdown);
  if (!bodyMarkdown) {
    return {
      wordCount: 0,
      charCount: 0,
      charCountNoSpaces: 0,
      totalPages: 0,
      sections: [],
    };
  }

  const lines = bodyMarkdown.split(/\r?\n/);
  let inCodeFence = false;
  let fenceMarker = '';
  let inCommentsSection = false;

  let totalWords = 0;
  let totalChars = 0;
  let totalCharsNoSpaces = 0;
  let hasReadableLine = false;

  const rawHeadings: Array<{
    headingIndex: number;
    level: number;
    title: string;
    startWordOffset: number;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedStart = line.trimStart();

    if (!inCodeFence) {
      const trimmedFull = trimmedStart.trim();
      if (trimmedFull === HIGHLIGHT_COMMENTS_START_MARKER) {
        inCommentsSection = true;
        continue;
      }
      if (inCommentsSection) {
        if (trimmedFull === HIGHLIGHT_COMMENTS_END_MARKER) {
          inCommentsSection = false;
        }
        continue;
      }
    }

    const fenceMatch = trimmedStart.match(/^(`{3,}|~{3,})/);
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

    if (!inCodeFence) {
      const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = cleanHeadingText(headingMatch[2]);
        if (title.length > 0) {
          rawHeadings.push({
            headingIndex: rawHeadings.length,
            level,
            title,
            startWordOffset: totalWords,
          });
        }
      }
    }

    const cleanLine = inCodeFence
      ? line.trim()
      : stripMarkdownLineToReadableText(line);

    if (cleanLine.length > 0) {
      const lineWords = countWordsInCleanText(cleanLine);
      const lineCharsNoSpaces = cleanLine.replace(/\s+/g, '').length;
      if (hasReadableLine) {
        totalChars += 1; // espaço separador equivalente entre linhas/blocos
      }
      hasReadableLine = true;
      totalWords += lineWords;
      totalChars += cleanLine.length;
      totalCharsNoSpaces += lineCharsNoSpaces;
    }
  }

  const sections: SectionWordSpan[] = rawHeadings.map((h, idx) => {
    const endWordOffset =
      idx + 1 < rawHeadings.length ? rawHeadings[idx + 1].startWordOffset : totalWords;
    return {
      headingIndex: h.headingIndex,
      level: h.level,
      title: h.title,
      startWordOffset: h.startWordOffset,
      endWordOffset,
      wordCount: Math.max(0, endWordOffset - h.startWordOffset),
    };
  });

  const totalPages = totalWords > 0 ? Math.max(1, Math.ceil(totalWords / WORDS_PER_PAGE)) : 0;

  return {
    wordCount: totalWords,
    charCount: totalChars,
    charCountNoSpaces: totalCharsNoSpaces,
    totalPages,
    sections,
  };
}

/**
 * Resolve o intervalo de palavras da seção ativa. Se um título container tiver
 * menos de 15 palavras antes de abrir um subtítulo filho, estende até o fim do bloco pai.
 */
export function resolveActiveSectionRange(
  sections: ReadonlyArray<SectionWordSpan>,
  activeIndex: number
): { readonly title: string; readonly startWordOffset: number; readonly endWordOffset: number } | null {
  if (sections.length === 0 || activeIndex < 0 || activeIndex >= sections.length) {
    return null;
  }

  const current = sections[activeIndex];
  let endWordOffset = current.endWordOffset;

  if (
    current.wordCount < 15 &&
    activeIndex + 1 < sections.length &&
    sections[activeIndex + 1].level > current.level
  ) {
    endWordOffset = sections[sections.length - 1].endWordOffset;
    for (let i = activeIndex + 1; i < sections.length; i++) {
      if (sections[i].level <= current.level) {
        endWordOffset = sections[i].startWordOffset;
        break;
      }
    }
  }

  return {
    title: current.title,
    startWordOffset: current.startWordOffset,
    endWordOffset,
  };
}

/**
 * Estima o deslocamento atual em palavras com base na posição de rolagem
 * e, quando disponível, no progresso proporcional dentro da seção ativa.
 */
export function estimateCurrentWordOffset(
  totalWords: number,
  scrollProgressRatio: number,
  activeSectionProgress?: ActiveSectionProgressInput | null
): number {
  if (totalWords <= 0) return 0;

  const clampedRatio = clamp01(scrollProgressRatio);
  if (clampedRatio <= 0.002) return 0;
  if (clampedRatio >= 0.995) return totalWords;

  if (
    activeSectionProgress &&
    activeSectionProgress.sectionEndWord > activeSectionProgress.sectionStartWord
  ) {
    const span = activeSectionProgress.sectionEndWord - activeSectionProgress.sectionStartWord;
    const interpolated =
      activeSectionProgress.sectionStartWord + clamp01(activeSectionProgress.sectionRatio) * span;
    return Math.min(totalWords, Math.max(0, Math.round(interpolated)));
  }

  return Math.min(totalWords, Math.max(0, Math.round(clampedRatio * totalWords)));
}

/**
 * Calcula página atual, tempo total, tempo restante, tempo da seção atual e horário de término.
 */
export function computeReadingEstimates(params: {
  readonly map: DocumentReadingMap;
  readonly scrollProgress: number;
  readonly scrollRatio: number;
  readonly activeHeadingIndex: number;
  readonly wpm: number;
  readonly nowMs: number;
  readonly activeSectionProgress?: ActiveSectionProgressInput | null;
}): ReadingEstimates {
  const { map, scrollProgress, scrollRatio, activeHeadingIndex, wpm, nowMs, activeSectionProgress } =
    params;

  const safeWpm = Number.isFinite(wpm) && wpm > 0 ? wpm : DEFAULT_READING_WPM;
  const wordsPerSecond = safeWpm / 60;

  const currentWordOffset =
    scrollProgress >= 100
      ? map.wordCount
      : estimateCurrentWordOffset(map.wordCount, scrollRatio, activeSectionProgress);

  const remainingWords = Math.max(0, map.wordCount - currentWordOffset);
  const totalSeconds = map.wordCount > 0 ? Math.round(map.wordCount / wordsPerSecond) : 0;
  const remainingSeconds =
    scrollProgress >= 100 || remainingWords <= 0
      ? 0
      : Math.max(1, Math.round(remainingWords / wordsPerSecond));

  const currentPage =
    map.totalPages === 0
      ? 0
      : scrollProgress >= 100
        ? map.totalPages
        : Math.min(map.totalPages, Math.max(1, Math.floor(currentWordOffset / WORDS_PER_PAGE) + 1));

  const activeSection = resolveActiveSectionRange(map.sections, activeHeadingIndex);
  let sectionRemainingSeconds: number | null = null;
  if (activeSection && scrollProgress < 100) {
    const sectionWordsLeft = Math.max(0, activeSection.endWordOffset - currentWordOffset);
    sectionRemainingSeconds =
      sectionWordsLeft > 0 ? Math.max(1, Math.round(sectionWordsLeft / wordsPerSecond)) : 0;
  }

  let estimatedFinishTime: string | null = null;
  if (remainingSeconds > 0 && Number.isFinite(nowMs)) {
    const finishDate = new Date(nowMs + remainingSeconds * 1000);
    const hours = String(finishDate.getHours()).padStart(2, '0');
    const minutes = String(finishDate.getMinutes()).padStart(2, '0');
    estimatedFinishTime = `${hours}:${minutes}`;
  }

  return {
    currentWordOffset,
    remainingWords,
    currentPage,
    totalPages: map.totalPages,
    totalSeconds,
    remainingSeconds,
    sectionRemainingSeconds,
    sectionTitle: activeSection?.title ?? null,
    estimatedFinishTime,
  };
}

/**
 * Formata uma duração em segundos de forma legível para leitura.
 */
export function formatReadingDuration(
  seconds: number,
  options?: { readonly isAtEnd?: boolean }
): string {
  if (options?.isAtEnd || !Number.isFinite(seconds) || seconds <= 0) {
    return 'Fim';
  }
  if (seconds < 45) {
    return '<1 min';
  }
  if (seconds < 3600) {
    const mins = Math.max(1, Math.round(seconds / 60));
    return `${mins} min`;
  }
  const totalMins = Math.round(seconds / 60);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

function parseFiniteTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * Resolve o timestamp real da última modificação do documento considerando
 * alterações locais pendentes, metadados do OneDrive e arquivo local.
 */
export function resolveDocumentLastModifiedTimestamp(
  doc:
    | Pick<DocumentState, 'isDirty' | 'lastModifiedAt' | 'cloudLastModified' | 'localLastModified'>
    | null
    | undefined
): number | null {
  if (!doc) return null;

  const localEditMs = parseFiniteTimestamp(doc.lastModifiedAt);
  const cloudMs = parseFiniteTimestamp(doc.cloudLastModified);
  const fileMs = parseFiniteTimestamp(doc.localLastModified);

  if (doc.isDirty && localEditMs !== null) {
    return localEditMs;
  }

  return cloudMs ?? fileMs ?? localEditMs;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Formata a data da última modificação de forma compacta para a barra inferior.
 */
export function formatLastModifiedCompact(
  timestampMs: number,
  nowMs: number = Date.now()
): string {
  const date = new Date(timestampMs);
  const now = new Date(nowMs);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');

  if (isSameCalendarDay(date, now)) {
    return `Hoje, ${hh}:${mm}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) {
    return `Ontem, ${hh}:${mm}`;
  }

  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');

  if (date.getFullYear() === now.getFullYear()) {
    return `${dd}/${mo}, ${hh}:${mm}`;
  }

  return `${dd}/${mo}/${date.getFullYear()}`;
}

/**
 * Formata data e hora completas para tooltips e popover de detalhes.
 */
export function formatLastModifiedFull(timestampMs: number): string {
  const date = new Date(timestampMs);
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mo}/${yyyy} às ${hh}:${mm}`;
}

/**
 * Formata inteiros no padrão brasileiro (ex.: 1.240).
 */
export function formatIntegerPtBr(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return PT_BR_INTEGER_FORMATTER.format(Math.max(0, Math.round(value)));
}
