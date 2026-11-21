import { EditorState, TextSelection, Transaction } from '@tiptap/pm/state';
import { Mark, Node as PmNode } from '@tiptap/pm/model';

export interface SearchOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly ignoreAccents: boolean;
  readonly useRegex: boolean;
}

export interface TextMatchRange {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface SearchComputationResult {
  readonly matches: ReadonlyArray<TextMatchRange>;
  readonly error: string | null;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  ignoreAccents: false,
  useRegex: false,
};

const INLINE_LEAF_SENTINEL = '\ufffc';
const COMBINING_MARKS_REGEX = /[\u0300-\u036f]/g;

interface StrippedTextMapping {
  readonly normalized: string;
  /**
   * Mapeia cada índice `k` em `normalized` para o índice inicial correspondente na string original,
   * mais um elemento extra ao final igual a `source.length` para fechar o intervalo `[from, to)`.
   */
  readonly normToOrig: ReadonlyArray<number>;
}

/**
 * Remove diacríticos (acentos) de uma string mantendo um mapa 1:1 de índices
 * da string normalizada de volta para a string original (incluindo pares substitutos UTF-16).
 */
export function stripDiacriticsWithMap(source: string): StrippedTextMapping {
  if (!source) {
    return { normalized: '', normToOrig: [0] };
  }

  let normalized = '';
  const normToOrig: number[] = [];

  for (let i = 0; i < source.length; ) {
    const codePoint = source.codePointAt(i)!;
    const unitLength = codePoint > 0xffff ? 2 : 1;
    const rawUnit = source.slice(i, i + unitLength);
    const stripped = rawUnit.normalize('NFD').replace(COMBINING_MARKS_REGEX, '');

    if (stripped.length > 0) {
      for (let k = 0; k < stripped.length; k++) {
        normToOrig.push(i);
      }
      normalized += stripped;
    }

    i += unitLength;
  }

  normToOrig.push(source.length);
  return { normalized, normToOrig };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeQueryForAccents(query: string): string {
  return query.normalize('NFD').replace(COMBINING_MARKS_REGEX, '');
}

/**
 * Compila a expressão regular segura para a busca com suporte a
 * case-sensitive, palavra inteira Unicode, ignorar acentos e Regex.
 */
export function compileSearchRegExp(
  query: string,
  options: SearchOptions
): { regex: RegExp | null; error: string | null } {
  if (!query) {
    return { regex: null, error: null };
  }

  const effectiveQuery = options.ignoreAccents
    ? normalizeQueryForAccents(query)
    : query;

  if (!effectiveQuery) {
    return { regex: null, error: null };
  }

  let pattern = options.useRegex
    ? effectiveQuery
    : escapeRegExp(effectiveQuery);

  if (options.wholeWord) {
    pattern = `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`;
  }

  const flags = options.caseSensitive ? 'gu' : 'giu';

  try {
    const regex = new RegExp(pattern, flags);
    return { regex, error: null };
  } catch {
    return { regex: null, error: 'Expressão regular inválida' };
  }
}

/**
 * Busca todas as ocorrências da query em uma string pura.
 */
export function findMatchesInRawText(
  text: string,
  query: string,
  options: SearchOptions
): SearchComputationResult {
  const { regex, error } = compileSearchRegExp(query, options);
  if (error) {
    return { matches: [], error };
  }
  if (!regex || !text) {
    return { matches: [], error: null };
  }

  const mapping = options.ignoreAccents ? stripDiacriticsWithMap(text) : null;
  const haystack = mapping ? mapping.normalized : text;
  const matches: TextMatchRange[] = [];

  let execResult: RegExpExecArray | null;
  while ((execResult = regex.exec(haystack)) !== null) {
    const matchedStr = execResult[0];

    if (matchedStr.length === 0) {
      if (regex.lastIndex >= haystack.length) {
        break;
      }
      const nextCodePoint = haystack.codePointAt(regex.lastIndex);
      regex.lastIndex += nextCodePoint !== undefined && nextCodePoint > 0xffff ? 2 : 1;
      continue;
    }

    const normFrom = execResult.index;
    const normTo = normFrom + matchedStr.length;

    const origFrom = mapping ? mapping.normToOrig[normFrom] : normFrom;
    const origTo = mapping ? mapping.normToOrig[normTo] : normTo;
    const originalSlice = text.slice(origFrom, origTo);

    if (!originalSlice.includes(INLINE_LEAF_SENTINEL)) {
      matches.push({
        from: origFrom,
        to: origTo,
        text: originalSlice,
      });
    }
  }

  return { matches, error: null };
}

/**
 * Busca todas as ocorrências em uma árvore de documento ProseMirror.
 * Concatena nós de texto adjacentes dentro de cada `textblock` (parágrafo, título, célula, etc.)
 * para encontrar frases que atravessem formatações inline (negrito, itálico, grifos).
 */
export function findMatchesInProseMirrorDoc(
  doc: PmNode | null | undefined,
  query: string,
  options: SearchOptions
): SearchComputationResult {
  const { regex, error } = compileSearchRegExp(query, options);
  if (error) {
    return { matches: [], error };
  }
  if (!regex || !doc) {
    return { matches: [], error: null };
  }

  const allMatches: TextMatchRange[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }

    let blockText = '';
    const charToPmPos: number[] = [];

    node.descendants((child, relPos) => {
      const childStartPm = pos + 1 + relPos;
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) {
          blockText += child.text[i];
          charToPmPos.push(childStartPm + i);
        }
        return false;
      }

      if (child.isLeaf && !child.isText) {
        blockText += child.type.name === 'hardBreak' ? '\n' : INLINE_LEAF_SENTINEL;
        charToPmPos.push(childStartPm);
        return false;
      }

      return true;
    });

    if (blockText.length > 0) {
      const blockResult = findMatchesInRawText(blockText, query, options);
      for (let i = 0; i < blockResult.matches.length; i++) {
        const m = blockResult.matches[i];
        if (m.from >= 0 && m.to > m.from && m.to <= charToPmPos.length) {
          const pmFrom = charToPmPos[m.from];
          const pmTo = charToPmPos[m.to - 1] + 1;
          allMatches.push({
            from: pmFrom,
            to: pmTo,
            text: m.text,
          });
        }
      }
    }

    return false;
  });

  return { matches: allMatches, error: null };
}

function resolvePreservedMarks(doc: PmNode, from: number, to: number): readonly Mark[] {
  let preservedMarks: readonly Mark[] = [];
  doc.nodesBetween(from, to, (node) => {
    if (node.isText) {
      preservedMarks = node.marks;
      return false;
    }
    return true;
  });
  return preservedMarks;
}

/**
 * Cria uma transação ProseMirror que substitui um único intervalo encontrado,
 * preservando os marks inline existentes (negrito, itálico, grifos customHighlight com data-id, etc.).
 */
export function createReplaceTransaction(
  state: EditorState,
  match: TextMatchRange,
  replacement: string
): Transaction | null {
  const docSize = state.doc.content.size;
  if (match.from < 0 || match.to <= match.from || match.to > docSize) {
    return null;
  }

  const tr = state.tr;
  const marks = resolvePreservedMarks(state.doc, match.from, match.to);

  if (replacement.length === 0) {
    tr.delete(match.from, match.to);
  } else {
    tr.replaceWith(match.from, match.to, state.schema.text(replacement, marks));
  }

  const nextCursor = Math.min(tr.doc.content.size, Math.max(0, match.from + replacement.length));
  tr.setSelection(TextSelection.create(tr.doc, nextCursor));
  return tr;
}

/**
 * Cria uma única transação ProseMirror substituindo todas as ocorrências (de trás para frente),
 * permitindo desfazer todo o lote com um único Ctrl+Z e preservando os marks de cada ocorrência.
 */
export function createReplaceAllTransaction(
  state: EditorState,
  matches: ReadonlyArray<TextMatchRange>,
  replacement: string
): Transaction | null {
  if (matches.length === 0) {
    return null;
  }

  const docSize = state.doc.content.size;
  const sorted = [...matches]
    .filter((m) => m.from >= 0 && m.to > m.from && m.to <= docSize)
    .sort((a, b) => a.from - b.from);

  if (sorted.length === 0) {
    return null;
  }

  const tr = state.tr;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = sorted[i];
    const marks = resolvePreservedMarks(state.doc, m.from, m.to);
    if (replacement.length === 0) {
      tr.delete(m.from, m.to);
    } else {
      tr.replaceWith(m.from, m.to, state.schema.text(replacement, marks));
    }
  }

  return tr;
}

/**
 * Substitui uma única ocorrência em texto Markdown bruto (Modo Código-Fonte).
 */
export function replaceSingleInRawText(
  rawText: string,
  match: TextMatchRange,
  replacement: string
): { nextText: string; nextCursorOffset: number } {
  const safeFrom = Math.max(0, Math.min(match.from, rawText.length));
  const safeTo = Math.max(safeFrom, Math.min(match.to, rawText.length));
  const nextText = rawText.slice(0, safeFrom) + replacement + rawText.slice(safeTo);
  return {
    nextText,
    nextCursorOffset: safeFrom + replacement.length,
  };
}

/**
 * Substitui todas as ocorrências em texto Markdown bruto (Modo Código-Fonte),
 * aplicando de trás para frente de forma imutável.
 */
export function replaceAllInRawText(
  rawText: string,
  matches: ReadonlyArray<TextMatchRange>,
  replacement: string
): { nextText: string; replacedCount: number } {
  if (matches.length === 0) {
    return { nextText: rawText, replacedCount: 0 };
  }

  const sorted = [...matches]
    .filter((m) => m.from >= 0 && m.to > m.from && m.to <= rawText.length)
    .sort((a, b) => a.from - b.from);

  if (sorted.length === 0) {
    return { nextText: rawText, replacedCount: 0 };
  }

  const parts: string[] = [];
  let cursor = 0;

  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.from < cursor) continue;
    parts.push(rawText.slice(cursor, m.from));
    parts.push(replacement);
    cursor = m.to;
  }
  parts.push(rawText.slice(cursor));

  return {
    nextText: parts.join(''),
    replacedCount: sorted.length,
  };
}
