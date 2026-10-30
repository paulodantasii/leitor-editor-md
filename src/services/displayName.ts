export interface SplitDisplayName {
  head: string;
  tail: string;
}

const MIN_LENGTH_TO_SPLIT = 14;
const TAIL_RATIO = 0.45;
const MAX_TAIL_CHARS = 24;
const MIN_TAIL_AFTER_EXTENSION = 6;
const MAX_EXTENSION_LENGTH = 8;

function getExtensionLength(name: string): number {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) return 0;
  const length = name.length - dotIndex;
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

export function splitDisplayName(name: string): SplitDisplayName {
  if (name.length < MIN_LENGTH_TO_SPLIT) {
    return { head: name, tail: '' };
  }
  const extensionLength = getExtensionLength(name);
  const minTail = extensionLength + MIN_TAIL_AFTER_EXTENSION;
  const idealTail = Math.ceil(name.length * TAIL_RATIO);
  const tailLength = Math.min(
    Math.max(idealTail, minTail),
    Math.max(MAX_TAIL_CHARS, minTail),
    name.length - 1
  );
  const initialCut = name.length - tailLength;
  const cut = adjustCutForSurrogates(name, initialCut);
  return {
    head: name.slice(0, cut),
    tail: name.slice(cut),
  };
}
