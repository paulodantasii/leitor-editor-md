export interface SplitDisplayName {
  head: string;
  tail: string;
}

const MIN_LENGTH_TO_SPLIT = 14;
const TAIL_RATIO = 0.45;
const MAX_TAIL_CHARS = 24;
const MIN_TAIL_AFTER_EXTENSION = 6;
const MAX_EXTENSION_LENGTH = 8;
const WORD_BOUNDARY_SEARCH_WINDOW = 6;
const ABBR_BOUNDARY_SEARCH_WINDOW = 8;
const MIN_ABBR_HEAD_CHARS = 4;
const MIN_ABBR_TAIL_BEFORE_EXT = 3;
const WORD_SEPARATORS = new Set([' ', '-', '_']);

function getExtensionLength(name: string): number {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) return 0;
  const length = name.length - dotIndex;
  return length <= MAX_EXTENSION_LENGTH ? length : 0;
}

function getExtensionCharLength(chars: string[]): number {
  const dotIndex = chars.lastIndexOf('.');
  if (dotIndex <= 0) return 0;
  const length = chars.length - dotIndex;
  return length <= MAX_EXTENSION_LENGTH ? length : 0;
}

function adjustCutForSurrogates(name: string, cut: number): number {
  if (cut <= 0 || cut >= name.length) return cut;
  const code = name.charCodeAt(cut);
  if (code >= 0xdc00 && code <= 0xdfff) {
    return cut + 1;
  }
  return cut;
}

function findWordBoundaryCut(
  name: string,
  initialCut: number,
  minTail: number,
  maxTail: number
): number {
  const minIndex = Math.max(1, initialCut - WORD_BOUNDARY_SEARCH_WINDOW);
  for (let i = initialCut - 1; i >= minIndex; i--) {
    if (name[i] === ' ') {
      const candidateCut = i + 1;
      if (name.length - candidateCut <= maxTail) {
        return candidateCut;
      }
    }
  }

  const maxIndex = Math.min(name.length - 1, initialCut + WORD_BOUNDARY_SEARCH_WINDOW);
  for (let i = initialCut; i < maxIndex; i++) {
    if (name[i] === ' ') {
      const candidateCut = i + 1;
      if (name.length - candidateCut >= minTail) {
        return candidateCut;
      }
    }
  }

  return initialCut;
}

export function splitDisplayName(name: string): SplitDisplayName {
  if (name.length < MIN_LENGTH_TO_SPLIT) {
    return { head: name, tail: '' };
  }
  const extensionLength = getExtensionLength(name);
  const minTail = extensionLength + MIN_TAIL_AFTER_EXTENSION;
  const maxTail = Math.max(MAX_TAIL_CHARS, minTail);
  const idealTail = Math.ceil(name.length * TAIL_RATIO);
  const tailLength = Math.min(Math.max(idealTail, minTail), maxTail, name.length - 1);
  const initialCut = name.length - tailLength;
  const wordCut = findWordBoundaryCut(name, initialCut, minTail, maxTail);
  const cut = adjustCutForSurrogates(name, wordCut);
  return {
    head: name.slice(0, cut),
    tail: name.slice(cut),
  };
}

function selectAbbreviatedHead(
  chars: string[],
  headBudget: number
): { head: string; cutAtWord: boolean } {
  const headSlice = chars.slice(0, headBudget);
  const rawHead = headSlice.join('');

  if (WORD_SEPARATORS.has(chars[headBudget])) {
    const cleaned = rawHead.replace(/[\s\-_]+$/, '');
    if (Array.from(cleaned).length >= MIN_ABBR_HEAD_CHARS) {
      return { head: cleaned, cutAtWord: true };
    }
  }

  const searchStart = Math.max(MIN_ABBR_HEAD_CHARS, headSlice.length - ABBR_BOUNDARY_SEARCH_WINDOW);
  for (let i = headSlice.length - 1; i >= searchStart; i--) {
    if (WORD_SEPARATORS.has(headSlice[i])) {
      const cleaned = headSlice.slice(0, i).join('').replace(/[\s\-_]+$/, '');
      if (Array.from(cleaned).length >= MIN_ABBR_HEAD_CHARS) {
        return { head: cleaned, cutAtWord: true };
      }
    }
  }

  return { head: rawHead.trimEnd() || rawHead, cutAtWord: false };
}

function selectAbbreviatedTail(
  chars: string[],
  tailStart: number,
  extLen: number
): { tail: string; cutAtWord: boolean } {
  const tailSlice = chars.slice(tailStart);
  const rawTail = tailSlice.join('');
  const minTailChars = extLen + MIN_ABBR_TAIL_BEFORE_EXT;

  if (tailStart > 0 && WORD_SEPARATORS.has(chars[tailStart - 1])) {
    const cleaned = rawTail.replace(/^[\s\-_]+/, '');
    if (Array.from(cleaned).length >= minTailChars) {
      return { tail: cleaned, cutAtWord: true };
    }
  }

  const searchLimit = Math.min(ABBR_BOUNDARY_SEARCH_WINDOW, tailSlice.length);
  for (let i = 0; i < searchLimit; i++) {
    if (WORD_SEPARATORS.has(tailSlice[i])) {
      const cleaned = tailSlice.slice(i + 1).join('').replace(/^[\s\-_]+/, '');
      if (Array.from(cleaned).length >= minTailChars) {
        return { tail: cleaned, cutAtWord: true };
      }
    }
  }

  return { tail: rawTail.trimStart() || rawTail, cutAtWord: false };
}

/**
 * Abbreviates a display name in the middle when it exceeds `maxChars`,
 * preferring word boundaries and preserving the file extension.
 */
export function abbreviateMiddle(name: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  const chars = Array.from(name);
  if (chars.length <= maxChars) return name;

  if (maxChars < 8) {
    return maxChars === 1 ? '…' : `${chars.slice(0, maxChars - 1).join('')}…`;
  }

  const budget = maxChars - 1;
  const extLen = getExtensionCharLength(chars);
  const rawTailBudget = Math.max(
    Math.ceil(budget * TAIL_RATIO),
    extLen + MIN_TAIL_AFTER_EXTENSION
  );
  const tailBudget = Math.min(rawTailBudget, budget - MIN_ABBR_HEAD_CHARS);
  const headBudget = budget - tailBudget;

  const { head, cutAtWord: headCutAtWord } = selectAbbreviatedHead(chars, headBudget);
  const { tail, cutAtWord: tailCutAtWord } = selectAbbreviatedTail(
    chars,
    chars.length - tailBudget,
    extLen
  );

  const separator = headCutAtWord && tailCutAtWord ? ' … ' : '…';
  return `${head}${separator}${tail}`;
}
