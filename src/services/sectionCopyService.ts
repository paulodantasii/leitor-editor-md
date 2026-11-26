import {
  HIGHLIGHT_COMMENTS_START_MARKER,
  HIGHLIGHT_COMMENTS_END_MARKER,
  parseMarkdownWithHighlightComments,
} from './highlightCommentsService';

/**
 * Extrai o Markdown completo da seção iniciada pelo título de índice `headingIndex`
 * (0-based, mesma ordem de `extractHeadingsFromMarkdown`), indo até a linha anterior
 * ao próximo título de nível igual ou inferior (`level <= targetLevel`).
 *
 * Exclui o bloco oculto de comentários de grifos e remove tags `<mark>` para entregar
 * texto limpo pronto para cópia.
 */
export function extractSectionMarkdownByHeadingIndex(
  rawMarkdown: string,
  headingIndex: number
): string | null {
  if (!rawMarkdown || headingIndex < 0) return null;

  const { bodyMarkdown } = parseMarkdownWithHighlightComments(rawMarkdown);
  if (!bodyMarkdown) return null;

  const lines = bodyMarkdown.split(/\r?\n/);
  let inCodeFence = false;
  let fenceMarker = '';
  let inCommentsSection = false;

  let currentHeadingIdx = 0;
  let startLineIdx = -1;
  let targetLevel = 0;
  let endLineIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!inCodeFence) {
      const trimmedLine = trimmed.trim();
      if (trimmedLine === HIGHLIGHT_COMMENTS_START_MARKER) {
        inCommentsSection = true;
        continue;
      }
      if (inCommentsSection) {
        if (trimmedLine === HIGHLIGHT_COMMENTS_END_MARKER) {
          inCommentsSection = false;
        }
        continue;
      }
    }

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
    if (!headingMatch) continue;

    const level = headingMatch[1].length;

    if (startLineIdx === -1) {
      if (currentHeadingIdx === headingIndex) {
        startLineIdx = i;
        targetLevel = level;
      }
      currentHeadingIdx += 1;
    } else if (level <= targetLevel) {
      endLineIdx = i;
      break;
    }
  }

  if (startLineIdx === -1) return null;

  const sectionText = lines
    .slice(startLineIdx, endLineIdx)
    .join('\n')
    .replace(/<\/?mark\b[^>]*>/gi, '')
    .trimEnd();

  return sectionText;
}
