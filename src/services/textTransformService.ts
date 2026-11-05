import { EditorState, TextSelection, Transaction } from '@tiptap/pm/state';
import { Node as PmNode } from '@tiptap/pm/model';

export type TextCaseMode = 'upper' | 'lower' | 'capitalize' | 'sentence' | 'invert';

export interface SentenceCaseContext {
  capitalizeNext: boolean;
}

/**
 * Transforma uma string pura de acordo com o modo de caixa escolhido,
 * respeitando integralmente a acentuação da língua portuguesa (pt-BR).
 */
export function transformTextString(
  text: string,
  mode: TextCaseMode,
  sentenceCtx?: SentenceCaseContext
): string {
  if (!text) return text;

  switch (mode) {
    case 'upper':
      return text.toLocaleUpperCase('pt-BR');

    case 'lower':
      return text.toLocaleLowerCase('pt-BR');

    case 'capitalize': {
      const lowered = text.toLocaleLowerCase('pt-BR');
      // Usa Unicode Property Escapes para nunca quebrar após caracteres acentuados (ç, ã, é, etc.)
      return lowered.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_match, prefix: string, letter: string) => {
        return `${prefix}${letter.toLocaleUpperCase('pt-BR')}`;
      });
    }

    case 'sentence': {
      const ctx: SentenceCaseContext = sentenceCtx ?? { capitalizeNext: true };
      const lowered = text.toLocaleLowerCase('pt-BR');
      let result = '';

      for (let i = 0; i < lowered.length; i++) {
        const ch = lowered[i];
        if (/\p{L}/u.test(ch)) {
          if (ctx.capitalizeNext) {
            result += ch.toLocaleUpperCase('pt-BR');
            ctx.capitalizeNext = false;
          } else {
            result += ch;
          }
        } else {
          result += ch;
          if (/[.!?\n\r]/.test(ch)) {
            ctx.capitalizeNext = true;
          }
        }
      }
      return result;
    }

    case 'invert': {
      let result = '';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const upper = ch.toLocaleUpperCase('pt-BR');
        const lower = ch.toLocaleLowerCase('pt-BR');
        if (ch === upper && ch !== lower) {
          result += lower;
        } else if (ch === lower && ch !== upper) {
          result += upper;
        } else {
          result += ch;
        }
      }
      return result;
    }
  }
}

/**
 * Detecta o próximo modo de caixa para o atalho cíclico Shift+F3 (estilo Microsoft Word):
 * minúsculas -> MAIÚSCULAS -> Cada Palavra Em Maiúscula -> Primeira letra da frase -> minúsculas
 */
export function detectNextCaseCycleMode(sampleText: string): TextCaseMode {
  const trimmed = sampleText.trim();
  if (!trimmed) return 'upper';

  const isAllLower =
    trimmed === trimmed.toLocaleLowerCase('pt-BR') &&
    trimmed !== trimmed.toLocaleUpperCase('pt-BR');
  const isAllUpper =
    trimmed === trimmed.toLocaleUpperCase('pt-BR') &&
    trimmed !== trimmed.toLocaleLowerCase('pt-BR');
  const capitalized = transformTextString(trimmed, 'capitalize');

  if (isAllLower) return 'upper';
  if (isAllUpper) return 'capitalize';
  if (trimmed === capitalized) return 'sentence';
  return 'lower';
}

/**
 * Aplica uma transformação de caixa ao intervalo selecionado no ProseMirror
 * preservando 100% dos Marks inline (negrito, itálico, grifos customHighlight com data-id, etc.)
 * e mantendo a estrutura de múltiplos parágrafos/listas/tabelas intacta.
 */
export function createCaseTransformTransaction(
  state: EditorState,
  mode: TextCaseMode
): Transaction | null {
  const { from, to, empty } = state.selection;
  if (empty || from === to) return null;

  const tr = state.tr;
  const sentenceCtx: SentenceCaseContext = { capitalizeNext: true };
  let lastBlockParent: PmNode | null = null;
  let modified = false;

  const replacements: Array<{ sliceFrom: number; sliceTo: number; newNode: PmNode }> = [];

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock && node !== lastBlockParent) {
      lastBlockParent = node;
      sentenceCtx.capitalizeNext = true;
    }

    if (!node.isText || !node.text) return;

    const nodeStart = pos;
    const nodeEnd = pos + node.nodeSize;
    const sliceFrom = Math.max(from, nodeStart);
    const sliceTo = Math.min(to, nodeEnd);

    if (sliceFrom >= sliceTo) return;

    const relStart = sliceFrom - nodeStart;
    const relEnd = sliceTo - nodeStart;
    const originalSlice = node.text.slice(relStart, relEnd);

    const transformedSlice = transformTextString(originalSlice, mode, sentenceCtx);
    if (transformedSlice !== originalSlice) {
      const newTextNode = state.schema.text(transformedSlice, node.marks);
      replacements.push({ sliceFrom, sliceTo, newNode: newTextNode });
      modified = true;
    }
  });

  if (!modified) return null;

  // Aplica de trás para frente para não deslocar posições caso algum caractere Unicode mude de comprimento
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { sliceFrom, sliceTo, newNode } = replacements[i];
    tr.replaceWith(sliceFrom, sliceTo, newNode);
  }

  const mappedFrom = tr.mapping.map(from, -1);
  const mappedTo = tr.mapping.map(to, 1);
  tr.setSelection(TextSelection.create(tr.doc, mappedFrom, mappedTo));

  return tr;
}
