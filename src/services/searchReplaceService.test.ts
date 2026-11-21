import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import {
  DEFAULT_SEARCH_OPTIONS,
  findMatchesInRawText,
  findMatchesInProseMirrorDoc,
  createReplaceTransaction,
  createReplaceAllTransaction,
  replaceSingleInRawText,
  replaceAllInRawText,
} from './searchReplaceService';

const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    hardBreak: {
      inline: true,
      group: 'inline',
      selectable: false,
      toDOM: () => ['br'],
    },
    text: {
      group: 'inline',
    },
  },
  marks: {
    bold: {
      toDOM: () => ['strong', 0],
    },
    italic: {
      toDOM: () => ['em', 0],
    },
    customHighlight: {
      attrs: { color: { default: 'yellow' }, id: { default: null } },
      toDOM: (mark) => ['mark', { class: mark.attrs.color, 'data-id': mark.attrs.id }, 0],
    },
  },
});

describe('searchReplaceService', () => {
  describe('findMatchesInRawText', () => {
    it('realiza busca case-insensitive por padrão e case-sensitive quando ativado', () => {
      const text = 'Direito civil e direito penal. DIREITO constitucional.';
      const insensitive = findMatchesInRawText(text, 'direito', DEFAULT_SEARCH_OPTIONS);
      expect(insensitive.error).toBeNull();
      expect(insensitive.matches).toHaveLength(3);
      expect(insensitive.matches.map((m) => m.text)).toEqual(['Direito', 'direito', 'DIREITO']);

      const sensitive = findMatchesInRawText(text, 'direito', {
        ...DEFAULT_SEARCH_OPTIONS,
        caseSensitive: true,
      });
      expect(sensitive.matches).toHaveLength(1);
      expect(sensitive.matches[0]).toEqual({ from: 16, to: 23, text: 'direito' });
    });

    it('ignora acentos mantendo exatamente os offsets da string original (pt-BR e NFD)', () => {
      const text = 'A ação judicial gerou AÇÕES e uma ac\u0327a\u0303o complementar.';
      const result = findMatchesInRawText(text, 'acao', {
        ...DEFAULT_SEARCH_OPTIONS,
        ignoreAccents: true,
      });

      expect(result.error).toBeNull();
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]).toEqual({ from: 2, to: 6, text: 'ação' });
      expect(result.matches[1]).toEqual({ from: 34, to: 40, text: 'ac\u0327a\u0303o' });
      expect(text.slice(result.matches[1].from, result.matches[1].to)).toBe('ac\u0327a\u0303o');
    });

    it('respeita fronteiras de palavra inteira Unicode com acentuação', () => {
      const text = 'A ética profissional difere de postura antiética e éticas antigas.';
      const result = findMatchesInRawText(text, 'ética', {
        ...DEFAULT_SEARCH_OPTIONS,
        wholeWord: true,
      });

      expect(result.error).toBeNull();
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]).toEqual({ from: 2, to: 7, text: 'ética' });
    });

    it('suporta Expressões Regulares e reporta erro seguro quando a Regex é inválida', () => {
      const text = 'Art. 10, Art. 205 e Art. 3.';
      const valid = findMatchesInRawText(text, 'Art\\.\\s+\\d+', {
        ...DEFAULT_SEARCH_OPTIONS,
        useRegex: true,
      });
      expect(valid.error).toBeNull();
      expect(valid.matches.map((m) => m.text)).toEqual(['Art. 10', 'Art. 205', 'Art. 3']);

      const invalid = findMatchesInRawText(text, '[unclosed', {
        ...DEFAULT_SEARCH_OPTIONS,
        useRegex: true,
      });
      expect(invalid.matches).toEqual([]);
      expect(invalid.error).toBe('Expressão regular inválida');
    });

    it('não entra em loop infinito em regex que casa string vazia (zero-width)', () => {
      const result = findMatchesInRawText('abc', 'a*', {
        ...DEFAULT_SEARCH_OPTIONS,
        useRegex: true,
      });
      expect(result.error).toBeNull();
      expect(result.matches.map((m) => m.text)).toEqual(['a']);
    });
  });

  describe('findMatchesInProseMirrorDoc & preservação de Marks', () => {
    it('encontra frases que atravessam múltiplos nós com negrito e grifo customHighlight', () => {
      const boldMark = testSchema.marks.bold.create();
      const hlMark = testSchema.marks.customHighlight.create({ color: 'yellow', id: 'hl-42' });

      const doc = testSchema.node('doc', null, [
        testSchema.node('heading', { level: 1 }, [testSchema.text('Capítulo Único')]),
        testSchema.node('paragraph', null, [
          testSchema.text('O princípio da '),
          testSchema.text('boa-fé ', [boldMark]),
          testSchema.text('objetiva', [hlMark]),
          testSchema.text(' rege os contratos.'),
        ]),
      ]);

      const result = findMatchesInProseMirrorDoc(doc, 'boa-fe objetiva', {
        ...DEFAULT_SEARCH_OPTIONS,
        ignoreAccents: true,
      });

      expect(result.error).toBeNull();
      expect(result.matches).toHaveLength(1);
      const match = result.matches[0];
      expect(match.text).toBe('boa-fé objetiva');
      expect(doc.textBetween(match.from, match.to)).toBe('boa-fé objetiva');
    });

    it('substitui ocorrência única preservando o mark customHighlight (cor e data-id)', () => {
      const hlMark = testSchema.marks.customHighlight.create({ color: 'blue', id: 'hl-7' });
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('Texto com '),
          testSchema.text('cláusula', [hlMark]),
          testSchema.text(' essencial.'),
        ]),
      ]);

      const state = EditorState.create({ doc });
      const searchRes = findMatchesInProseMirrorDoc(state.doc, 'cláusula', DEFAULT_SEARCH_OPTIONS);
      expect(searchRes.matches).toHaveLength(1);

      const tr = createReplaceTransaction(state, searchRes.matches[0], 'regra');
      expect(tr).not.toBeNull();

      const nextState = state.apply(tr!);
      expect(nextState.doc.textContent).toBe('Texto com regra essencial.');

      const p = nextState.doc.firstChild!;
      expect(p.child(1).text).toBe('regra');
      expect(p.child(1).marks[0].type.name).toBe('customHighlight');
      expect(p.child(1).marks[0].attrs.color).toBe('blue');
      expect(p.child(1).marks[0].attrs.id).toBe('hl-7');
    });

    it('substitui todas as ocorrências em uma única transação preservando marks e aceitando string vazia', () => {
      const boldMark = testSchema.marks.bold.create();
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('Item A, '),
          testSchema.text('Item A', [boldMark]),
          testSchema.text(' e Item A.'),
        ]),
      ]);

      const state = EditorState.create({ doc });
      const { matches } = findMatchesInProseMirrorDoc(state.doc, 'Item A', DEFAULT_SEARCH_OPTIONS);
      expect(matches).toHaveLength(3);

      const trAll = createReplaceAllTransaction(state, matches, 'Item B Completo');
      expect(trAll).not.toBeNull();
      const replacedState = state.apply(trAll!);
      expect(replacedState.doc.textContent).toBe('Item B Completo, Item B Completo e Item B Completo.');

      const p = replacedState.doc.firstChild!;
      expect(p.child(1).marks[0].type.name).toBe('bold');

      // Teste de deleção em lote (replacement = '')
      const matchesDelete = findMatchesInProseMirrorDoc(replacedState.doc, 'Item B Completo', DEFAULT_SEARCH_OPTIONS).matches;
      const trDelete = createReplaceAllTransaction(replacedState, matchesDelete, '');
      const deletedState = replacedState.apply(trDelete!);
      expect(deletedState.doc.textContent).toBe(',  e .');
    });
  });

  describe('Substituição em texto bruto (Modo Código-Fonte)', () => {
    it('substitui uma única ocorrência e retorna o próximo offset do cursor', () => {
      const raw = 'Linha 1: **teste**\nLinha 2: teste';
      const { matches } = findMatchesInRawText(raw, 'teste', DEFAULT_SEARCH_OPTIONS);
      expect(matches).toHaveLength(2);

      const res = replaceSingleInRawText(raw, matches[0], 'exemplo');
      expect(res.nextText).toBe('Linha 1: **exemplo**\nLinha 2: teste');
      expect(res.nextCursorOffset).toBe(11 + 'exemplo'.length);
    });

    it('preserva caracteres especiais como R$ e $& literalmente na substituição', () => {
      const raw = 'Valor: VALOR_ANTIGO e outro VALOR_ANTIGO.';
      const { matches } = findMatchesInRawText(raw, 'VALOR_ANTIGO', DEFAULT_SEARCH_OPTIONS);
      const res = replaceAllInRawText(raw, matches, 'R$ 150,00 ($&)');

      expect(res.replacedCount).toBe(2);
      expect(res.nextText).toBe('Valor: R$ 150,00 ($&) e outro R$ 150,00 ($&).');
    });

    it('substitui todas as ocorrências no Markdown bruto de forma imutável', () => {
      const raw = 'alpha beta alpha gamma alpha';
      const { matches } = findMatchesInRawText(raw, 'alpha', DEFAULT_SEARCH_OPTIONS);
      const res = replaceAllInRawText(raw, matches, 'OMEGA');

      expect(res.replacedCount).toBe(3);
      expect(res.nextText).toBe('OMEGA beta OMEGA gamma OMEGA');
    });
  });
});
