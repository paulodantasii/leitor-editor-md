import type { TocHeadingItem } from './tocService';

/**
 * Verifica se o href é uma âncora interna de documento (ex.: "#direito-administrativo").
 */
export function isInternalAnchorHref(href: string): boolean {
  const trimmed = (href ?? '').trim();
  return trimmed.startsWith('#') && trimmed.length > 1;
}

/**
 * Valida se um href usa protocolo seguro (âncora interna, http, https, mailto ou tel).
 * Bloqueia javascript:, data:, vbscript: e outros esquemas potencialmente perigosos.
 */
export function isSafeLinkHref(href: string): boolean {
  const trimmed = (href ?? '').trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return true;

  // Permite apenas esquemas seguros explícitos (case-insensitive)
  return /^(https?:|mailto:|tel:)/i.test(trimmed);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Gera slug compatível com o algoritmo de âncoras do GitHub (GFM),
 * preservando acentos/letras Unicode e dígitos, removendo º/ª e pontuação,
 * e convertendo espaços em hífens.
 */
export function slugifyHeadingGitHub(text: string): string {
  return (text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[ºª]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

/**
 * Normaliza um texto ou fragmento para comparação tolerante (sem diacríticos,
 * hífens colapsados e sem hífens nas extremidades).
 */
export function normalizeLooseSlug(raw: string): string {
  return safeDecodeURIComponent(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[ºª]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function collapseHyphensPreservingAccents(raw: string): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Encontra o índice do título (`TocHeadingItem.index`) correspondente a uma âncora `#slug`.
 * Suporta deduplicação GitHub (`-1`, `-2`, ...), acentos, URL encoding e fallback tolerante.
 * Retorna `-1` se nenhum título corresponder.
 */
export function findHeadingIndexByAnchor(
  headings: ReadonlyArray<TocHeadingItem>,
  rawHref: string
): number {
  if (!headings || headings.length === 0 || !isInternalAnchorHref(rawHref)) {
    return -1;
  }

  const rawFragment = rawHref.trim().slice(1);
  const decodedFragment = safeDecodeURIComponent(rawFragment).trim().toLowerCase();
  if (!decodedFragment) return -1;

  const exactCounts = new Map<string, number>();
  const collapsedCounts = new Map<string, number>();
  const looseCounts = new Map<string, number>();

  const candidates = headings.map((heading) => {
    const baseExact = slugifyHeadingGitHub(heading.text);
    const exactOcc = exactCounts.get(baseExact) ?? 0;
    exactCounts.set(baseExact, exactOcc + 1);
    const exactSlug = exactOcc === 0 ? baseExact : `${baseExact}-${exactOcc}`;

    const baseCollapsed = collapseHyphensPreservingAccents(baseExact);
    const collapsedOcc = collapsedCounts.get(baseCollapsed) ?? 0;
    collapsedCounts.set(baseCollapsed, collapsedOcc + 1);
    const collapsedSlug = collapsedOcc === 0 ? baseCollapsed : `${baseCollapsed}-${collapsedOcc}`;

    const baseLoose = normalizeLooseSlug(heading.text);
    const looseOcc = looseCounts.get(baseLoose) ?? 0;
    looseCounts.set(baseLoose, looseOcc + 1);
    const looseSlug = looseOcc === 0 ? baseLoose : `${baseLoose}-${looseOcc}`;

    return {
      index: heading.index,
      exactSlug,
      collapsedSlug,
      looseSlug,
    };
  });

  // 1. Match exato GFM
  const exactMatch = candidates.find((c) => c.exactSlug === decodedFragment);
  if (exactMatch) return exactMatch.index;

  // 2. Match com hífens colapsados mantendo acentos
  const targetCollapsed = collapseHyphensPreservingAccents(decodedFragment);
  if (targetCollapsed) {
    const collapsedMatch = candidates.find((c) => c.collapsedSlug === targetCollapsed);
    if (collapsedMatch) return collapsedMatch.index;
  }

  // 3. Fallback tolerante sem acentos
  const targetLoose = normalizeLooseSlug(decodedFragment);
  if (targetLoose) {
    const looseMatch = candidates.find((c) => c.looseSlug === targetLoose);
    if (looseMatch) return looseMatch.index;
  }

  return -1;
}
