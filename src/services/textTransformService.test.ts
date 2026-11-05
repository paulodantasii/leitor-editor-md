import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import {
  transformTextString,
  detectNextCaseCycleMode,
  createCaseTransformTransaction,
} from './textTransformService';

const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
    },
    text: {
      group: 'inline',
    },
  },
  marks: {
    bold: {
      toDOM: () => ['strong', 0],
    },
    customHighlight: {
      attrs: { color: { default: 'yellow' }, id: { default: null } },
      toDOM: (mark) => ['mark', { class: mark.attrs.color, 'data-id': mark.attrs.id }, 0],
    },
  },
});

describe('textTransformService', () => {
  describe('transformTextString (pt-BR Unicode-aware)', () => {
    it('converte para MAIÚSCULAS e minúsculas preservando acentuação', () => {
      expect(transformTextString('ação de execução cível', 'upper')).toBe('AÇÃO DE EXECUÇÃO CÍVEL');
      expect(transformTextString('CONSTITUIÇÃO FEDERAL § 1º', 'lower')).toBe('constituição federal § 1º');
    });

    it('capitaliza cada palavra corretamente sem quebrar em letras acentuadas (ç, ã, é)', () => {
      expect(transformTextString('ação de indenização por danos morais', 'capitalize')).toBe(
        'Ação De Indenização Por Danos Morais'
      );
      expect(transformTextString('DIREITO PROCESSUAL PÚBLICO', 'capitalize')).toBe(
        'Direito Processual Público'
      );
    });

    it('aplica sentence case (Primeira letra da frase em maiúscula) após pontos, ! e ?', () => {
      expect(
        transformTextString('O RÉU FOI CITADO. NÃO APRESENTOU CONTESTAÇÃO! E AGORA? FIM.', 'sentence')
      ).toBe('O réu foi citado. Não apresentou contestação! E agora? Fim.');
    });

    it('inverte maiúsculas e minúsculas caractere a caractere', () => {
      expect(transformTextString('Art. 5º - Todos São Iguais', 'invert')).toBe(
        'aRT. 5º - tODOS sÃO iGUAIS'
      );
    });
  });

  describe('detectNextCaseCycleMode (Shift+F3)', () => {
    it('cicla corretamente entre lower -> upper -> capitalize -> sentence -> lower', () => {
      expect(detectNextCaseCycleMode('texto tudo minusculo')).toBe('upper');
      expect(detectNextCaseCycleMode('TEXTO TUDO MAIUSCULO')).toBe('capitalize');
      expect(detectNextCaseCycleMode('Texto Capitalizado Por Palavra')).toBe('sentence');
      expect(detectNextCaseCycleMode('Texto apenas com inicial maiúscula')).toBe('lower');
    });
  });

  describe('createCaseTransformTransaction (preservação de Marks e Grifos)', () => {
    it('transforma a caixa preservando marks bold e customHighlight (data-id)', () => {
      const boldMark = testSchema.marks.bold.create();
      const hlMark = testSchema.marks.customHighlight.create({ color: 'blue', id: 'h1' });

      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [
          testSchema.text('direito ', [boldMark]),
          testSchema.text('constitucional', [hlMark]),
        ]),
      ]);

      const state = EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1, doc.content.size - 1),
      });

      const tr = createCaseTransformTransaction(state, 'upper');
      expect(tr).not.toBeNull();

      const nextState = state.apply(tr!);
      expect(nextState.doc.textContent).toBe('DIREITO CONSTITUCIONAL');

      const firstParagraph = nextState.doc.firstChild!;
      expect(firstParagraph.child(0).text).toBe('DIREITO ');
      expect(firstParagraph.child(0).marks[0].type.name).toBe('bold');
      expect(firstParagraph.child(1).text).toBe('CONSTITUCIONAL');
      expect(firstParagraph.child(1).marks[0].type.name).toBe('customHighlight');
      expect(firstParagraph.child(1).marks[0].attrs.id).toBe('h1');
      expect(firstParagraph.child(1).marks[0].attrs.color).toBe('blue');
    });

    it('reinicia a capitalização de frase (sentence case) a cada novo parágrafo selecionado', () => {
      const doc = testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [testSchema.text('PRIMEIRO PARÁGRAFO SEM PONTO FINAL')]),
        testSchema.node('paragraph', null, [testSchema.text('SEGUNDO PARÁGRAFO TAMBÉM')]),
      ]);

      const state = EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1, doc.content.size - 1),
      });

      const tr = createCaseTransformTransaction(state, 'sentence');
      expect(tr).not.toBeNull();

      const nextState = state.apply(tr!);
      expect(nextState.doc.child(0).textContent).toBe('Primeiro parágrafo sem ponto final');
      expect(nextState.doc.child(1).textContent).toBe('Segundo parágrafo também');
    });
  });
});
