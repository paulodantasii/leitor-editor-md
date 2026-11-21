import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import {
  formatSequentialHighlightId,
  parseSequentialHighlightId,
  scanHighlightsInMarkdown,
  scanHighlightsInProseMirrorDoc,
  generateNextHighlightId,
  primeHighlightIdScope,
  findLatestHighlightInfo,
  resetHighlightIdMemory,
  resolveTrimmedHighlightRange,
  createHighlightTransaction,
  ensureHighlightIdAtPos,
} from './highlightIdService';

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

function extractHighlightedRuns(doc: any): Array<{ text: string; color: string; id: string | null; isBold: boolean }> {
  const runs: Array<{ text: string; color: string; id: string | null; isBold: boolean }> = [];
  doc.descendants((node: any) => {
    if (!node.isText) return;
    const hl = node.marks.find((m: any) => m.type.name === 'customHighlight');
    if (hl) {
      runs.push({
        text: node.text || '',
        color: hl.attrs.color,
        id: hl.attrs.id ?? null,
        isBold: node.marks.some((m: any) => m.type.name === 'bold'),
      });
    }
  });
  return runs;
}

function createMockDoc(marks: Array<{ id?: string | null; color?: string; pos?: number }>) {
  return {
    descendants(callback: (node: any, pos: number) => void) {
      marks.forEach((m, index) => {
        const node = {
          isText: true,
          marks: [
            {
              type: { name: 'customHighlight' },
              attrs: { id: m.id ?? null, color: m.color ?? 'yellow' },
            },
          ],
        };
        callback(node, m.pos ?? index * 10);
      });
    },
  };
}

describe('highlightIdService — IDs sequenciais Base-36 e localização do último grifo', () => {
  beforeEach(() => {
    resetHighlightIdMemory();
  });

  it('formata contadores sequenciais com no mínimo 5 dígitos em Base-36', () => {
    expect(formatSequentialHighlightId(1)).toBe('00001');
    expect(formatSequentialHighlightId(9)).toBe('00009');
    expect(formatSequentialHighlightId(10)).toBe('0000a');
    expect(formatSequentialHighlightId(35)).toBe('0000z');
    expect(formatSequentialHighlightId(36)).toBe('00010');
    expect(formatSequentialHighlightId(60466175)).toBe('zzzzz');
    // Expansão automática para 6 dígitos após 60.466.175 grifos
    expect(formatSequentialHighlightId(60466176)).toBe('100000');
  });

  it('distingue estritamente IDs sequenciais novos (5+ dígitos) de IDs legados (4 dígitos)', () => {
    expect(parseSequentialHighlightId('00001')).toBe(1);
    expect(parseSequentialHighlightId('00010')).toBe(36);
    expect(parseSequentialHighlightId('zzzzz')).toBe(60466175);

    // IDs legados de 4 caracteres NUNCA devem ser interpretados como sequenciais
    expect(parseSequentialHighlightId('t3v1')).toBeNull();
    expect(parseSequentialHighlightId('z8q4')).toBeNull();
    expect(parseSequentialHighlightId('9999')).toBeNull();
    expect(parseSequentialHighlightId('')).toBeNull();
    expect(parseSequentialHighlightId(null)).toBeNull();
  });

  it('inicia em 00001 ao grifar em documento vazio ou documento apenas com grifos legados', () => {
    const legacyDoc = createMockDoc([{ id: 't3v1' }, { id: 'z8q4' }]);
    const firstNewId = generateNextHighlightId(legacyDoc, 'doc-1');
    expect(firstNewId).toBe('00001');

    const updatedDoc = createMockDoc([{ id: 't3v1' }, { id: 'z8q4' }, { id: '00001' }]);
    const secondNewId = generateNextHighlightId(updatedDoc, 'doc-1');
    expect(secondNewId).toBe('00002');
  });

  it('prioriza grifos novos (5 dígitos) sobre grifos legados (4 dígitos) mesmo quando legado é "z8q4"', () => {
    const hybridDoc = createMockDoc([
      { id: '00001', pos: 15 },
      { id: 't3v1', pos: 120 },
      { id: 'z8q4', pos: 450 },
    ]);

    const latest = findLatestHighlightInfo(hybridDoc);
    expect(latest).toEqual({
      id: '00001',
      isSequential: true,
      pos: 15,
    });
  });

  it('usa o último grifo do documento como fallback quando o arquivo possui apenas grifos legados', () => {
    const legacyOnlyDoc = createMockDoc([
      { id: 't3v1', pos: 20 },
      { id: 'h7n4', pos: 80 },
      { id: 'z8q4', pos: 300 },
    ]);

    const latest = findLatestHighlightInfo(legacyOnlyDoc);
    expect(latest).toEqual({
      id: 'z8q4',
      isSequential: false,
      pos: 300,
    });
  });

  it('recua para o penúltimo grifo vivo ao apagar o último grifo, sem reutilizar o ID apagado na sessão', () => {
    const doc1 = createMockDoc([{ id: '00001', pos: 10 }, { id: '00002', pos: 50 }]);
    const id3 = generateNextHighlightId(doc1, 'doc-exclusao');
    expect(id3).toBe('00003');

    // Usuário apagou o grifo 00003; restaram 00001 e 00002 vivos
    const docAfterDelete = createMockDoc([{ id: '00001', pos: 10 }, { id: '00002', pos: 50 }]);
    expect(findLatestHighlightInfo(docAfterDelete)).toEqual({
      id: '00002',
      isSequential: true,
      pos: 50,
    });

    // Ao criar um novo grifo na mesma sessão, gera 00004 (não reutiliza 00003)
    const id4 = generateNextHighlightId(docAfterDelete, 'doc-exclusao');
    expect(id4).toBe('00004');
  });

  it('escaneia corretamente tags <mark> no Markdown bruto (Modo Código-Fonte)', () => {
    const md = 'Texto <mark class="yellow" data-id="z8q4">antigo</mark> e <mark class="blue" data-id="0000a">novo</mark>.';
    const summary = scanHighlightsInMarkdown(md);
    expect(summary.hasAnyHighlight).toBe(true);
    expect(summary.sequentialMax).toBe(10);
    expect(summary.latestSequentialId).toBe('0000a');
    expect(summary.latestLegacyId).toBe('z8q4');

    const nextFromMd = generateNextHighlightId(md, 'doc-md');
    expect(nextFromMd).toBe('0000b');
  });

  it('retorna a primeira posição do bloco quando um mesmo grifo abrange múltiplos nós de texto', () => {
    const multiNodeDoc = createMockDoc([
      { id: '00001', pos: 10 },
      { id: '00002', pos: 100 },
      { id: '00002', pos: 115 },
      { id: '00002', pos: 130 },
    ]);

    expect(findLatestHighlightInfo(multiNodeDoc)).toEqual({
      id: '00002',
      isSequential: true,
      pos: 100,
    });
    expect(scanHighlightsInProseMirrorDoc(multiNodeDoc).sequentialMax).toBe(2);
  });

  it('usa caminho rápido O(1) sem varrer doc.descendants após primeHighlightIdScope em árvore ProseMirror real', () => {
    const descendantsSpy = vi.fn();
    const realLikeDoc = {
      nodeSize: 50000,
      descendants: descendantsSpy,
    };

    primeHighlightIdScope('doc-gigante', 42);

    const next1 = generateNextHighlightId(realLikeDoc, 'doc-gigante');
    const next2 = generateNextHighlightId(realLikeDoc, 'doc-gigante');

    expect(next1).toBe(formatSequentialHighlightId(43));
    expect(next2).toBe(formatSequentialHighlightId(44));
    expect(descendantsSpy).not.toHaveBeenCalled();
  });
});

describe('createHighlightTransaction & resolveTrimmedHighlightRange', () => {
  beforeEach(() => {
    resetHighlightIdMemory();
  });

  it('remove espaço(s) em branco no final da seleção ao grifar', () => {
    const doc = testSchema.node('doc', null, [
      testSchema.node('paragraph', null, [testSchema.text('O gato pulou o muro')]),
    ]);
    // "gato " -> positions 3..8 (paragraph opens at 0 -> pos 1 is 'O', 2 is ' ', 3 is 'g', 7 is ' ', 8 is 'p')
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3, 8),
    });

    const result = createHighlightTransaction(state, { scopeKey: 'doc-trim-end', collapseToEnd: true });
    expect(result).not.toBeNull();
    const nextState = state.apply(result!.tr);

    expect(extractHighlightedRuns(nextState.doc)).toEqual([
      { text: 'gato', color: 'yellow', id: '00001', isBold: false },
    ]);
    expect(nextState.selection.empty).toBe(true);
    expect(nextState.selection.from).toBe(7);
  });

  it('remove espaço(s) em branco no início da seleção ao grifar', () => {
    const doc = testSchema.node('doc', null, [
      testSchema.node('paragraph', null, [testSchema.text('O gato pulou')]),
    ]);
    // " gato" -> positions 2..7
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2, 7),
    });

    const result = createHighlightTransaction(state, { scopeKey: 'doc-trim-start' });
    expect(result).not.toBeNull();
    const nextState = state.apply(result!.tr);

    expect(extractHighlightedRuns(nextState.doc)).toEqual([
      { text: 'gato', color: 'yellow', id: '00001', isBold: false },
    ]);
  });

  it('remove simultaneamente espaços, tabs e NBSP (\\u00A0) no início e no fim da seleção', () => {
    const text = 'antes \t\u00A0gato preto \n depois';
    const doc = testSchema.node('doc', null, [
      testSchema.node('paragraph', null, [testSchema.text(text)]),
    ]);
    const selFrom = 1 + 'antes'.length; // começa no primeiro espaço antes de 'gato preto'
    const selTo = 1 + text.indexOf('depois'); // termina logo após o espaço depois de '\n'
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, selFrom, selTo),
    });

    const trimmed = resolveTrimmedHighlightRange(doc, selFrom, selTo);
    expect(trimmed).not.toBeNull();
    expect(doc.textBetween(trimmed!.from, trimmed!.to)).toBe('gato preto');

    const result = createHighlightTransaction(state, { scopeKey: 'doc-trim-both' });
    expect(result).not.toBeNull();
    const nextState = state.apply(result!.tr);

    expect(extractHighlightedRuns(nextState.doc)).toEqual([
      { text: 'gato preto', color: 'yellow', id: '00001', isBold: false },
    ]);
  });

  it('retorna null quando a seleção contém apenas espaços em branco e não consome ID sequencial', () => {
    const doc = testSchema.node('doc', null, [
      testSchema.node('paragraph', null, [testSchema.text('palavra   \t\u00A0 outra')]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 8, 14), // "   \t\u00A0 "
    });

    const result = createHighlightTransaction(state, { scopeKey: 'doc-only-ws' });
    expect(result).toBeNull();

    // Próximo ID gerado na mesma scopeKey deve continuar sendo 00001
    expect(generateNextHighlightId(doc, 'doc-only-ws')).toBe('00001');
  });

  it('ao grifar trecho menor dentro de um grifo antigo (inclusive outra cor), apaga o antigo inteiro e cria 1 grifo amarelo', () => {
    const oldMark = testSchema.marks.customHighlight.create({ color: 'blue', id: '00001' });
    const doc = testSchema.node('doc', null, [
      testSchema.node('paragraph', null, [
        testSchema.text('A '),
        testSchema.text('casa amarela bonita', [oldMark]),
        testSchema.text(' caiu'),
      ]),
    ]);
    // Seleciona "amarela " (posições 8..16)
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 8, 16),
    });

    const result = createHighlightTransaction(state, { color: 'yellow', scopeKey: 'doc-inside' });
    expect(result).not.toBeNull();
    expect(result!.removedIds).toEqual(['00001']);

    const nextState = state.apply(result!.tr);
    expect(extractHighlightedRuns(nextState.doc)).toEqual([
      { text: 'amarela', color: 'yellow', id: '00002', isBold: false },
    ]);
    expect(nextState.doc.textContent).toBe('A casa amarela bonita caiu');
  });

  it('ao grifar trecho parcialmente sobreposto, apaga o grifo antigo inteiro e aplica apenas na nova seleção', () => {
    const oldMark = testSchema.marks.customHighlight.create({ color: 'green', id: '00001' });
    const doc = testSchema.node('doc', null, [
      testSchema.node('paragraph', null, [
        testSchema.text('A '),
        testSchema.text('casa amarela', [oldMark]),
        testSchema.text(' caiu'),
      ]),
    ]);
    // Seleciona "amarela caiu" (posições 8..20)
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 8, 20),
    });

    const result = createHighlightTransaction(state, { scopeKey: 'doc-partial' });
    expect(result).not.toBeNull();
    const nextState = state.apply(result!.tr);

    expect(extractHighlightedRuns(nextState.doc)).toEqual([
      { text: 'amarela caiu', color: 'yellow', id: '00002', isBold: false },
    ]);
  });

  it('ao grifar atravessando dois grifos existentes, apaga ambos por completo e cria apenas 1 novo grifo', () => {
    const mark1 = testSchema.marks.customHighlight.create({ color: 'yellow', id: '00001' });
    const mark2 = testSchema.marks.customHighlight.create({ color: 'purple', id: '00002' });
    const doc = testSchema.node('doc', null, [
      testSchema.node('paragraph', null, [
        testSchema.text('Primeira parte', [mark1]),
        testSchema.text(' meio '),
        testSchema.text('segunda parte', [mark2]),
      ]),
    ]);
    // Seleciona "parte meio segunda" -> 10..28
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 10, 28),
    });

    const result = createHighlightTransaction(state, { scopeKey: 'doc-two' });
    expect(result).not.toBeNull();
    expect(result!.removedIds).toEqual(['00001', '00002']);

    const nextState = state.apply(result!.tr);
    expect(extractHighlightedRuns(nextState.doc)).toEqual([
      { text: 'parte meio segunda', color: 'yellow', id: '00003', isBold: false },
    ]);
  });

  it('ao grifar sobre grifo antigo dividido por múltiplos nós (negrito no meio), remove todas as partes preservando o negrito', () => {
    const oldMark = testSchema.marks.customHighlight.create({ color: 'orange', id: '00001' });
    const boldMark = testSchema.marks.bold.create();
    const doc = testSchema.node('doc', null, [
      testSchema.node('paragraph', null, [
        testSchema.text('Texto ', [oldMark]),
        testSchema.text('muito', [oldMark, boldMark]),
        testSchema.text(' importante', [oldMark]),
      ]),
    ]);
    // Seleciona apenas "muito" (posições 7..12)
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 7, 12),
    });

    const result = createHighlightTransaction(state, { scopeKey: 'doc-multinode' });
    expect(result).not.toBeNull();
    const nextState = state.apply(result!.tr);

    expect(extractHighlightedRuns(nextState.doc)).toEqual([
      { text: 'muito', color: 'yellow', id: '00002', isBold: true },
    ]);

    // Garante que "Texto " e " importante" ficaram sem customHighlight e o negrito em "muito" permaneceu
    const paragraph = nextState.doc.firstChild!;
    expect(paragraph.childCount).toBe(3);
    expect(paragraph.child(0).text).toBe('Texto ');
    expect(paragraph.child(0).marks).toHaveLength(0);
    expect(paragraph.child(1).text).toBe('muito');
    expect(paragraph.child(1).marks.map((m: any) => m.type.name)).toContain('bold');
    expect(paragraph.child(2).text).toBe(' importante');
    expect(paragraph.child(2).marks).toHaveLength(0);
  });

  it('remove integralmente grifo legado sem data-id ao grifar parcialmente por cima dele', () => {
    const legacyNoIdMark = testSchema.marks.customHighlight.create({ color: 'yellow', id: null });
    const boldMark = testSchema.marks.bold.create();
    const doc = testSchema.node('doc', null, [
      testSchema.node('paragraph', null, [
        testSchema.text('Trecho ', [legacyNoIdMark]),
        testSchema.text('legado', [legacyNoIdMark, boldMark]),
        testSchema.text(' antigo', [legacyNoIdMark]),
        testSchema.text(' e '),
        testSchema.text('outro isolado', [legacyNoIdMark]),
      ]),
    ]);
    // Seleciona apenas "legado" (8..14)
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 8, 14),
    });

    const result = createHighlightTransaction(state, { scopeKey: 'doc-idless' });
    expect(result).not.toBeNull();
    const nextState = state.apply(result!.tr);

    expect(extractHighlightedRuns(nextState.doc)).toEqual([
      { text: 'legado', color: 'yellow', id: '00001', isBold: true },
      { text: 'outro isolado', color: 'yellow', id: null, isBold: false },
    ]);
  });

  it('ensureHighlightIdAtPos atribui um ID sequencial a grifo legado sem ID e preserva ID já existente', () => {
    const legacyNoIdMark = testSchema.marks.customHighlight.create({ color: 'blue', id: null });
    const existingMark = testSchema.marks.customHighlight.create({ color: 'yellow', id: '00004' });
    const boldMark = testSchema.marks.bold.create();
    const doc = testSchema.node('doc', null, [
      testSchema.node('paragraph', null, [
        testSchema.text('Início ', [legacyNoIdMark]),
        testSchema.text('negrito', [legacyNoIdMark, boldMark]),
        testSchema.text(' e '),
        testSchema.text('existente', [existingMark]),
      ]),
    ]);

    const state = EditorState.create({ doc });
    // Posição 10 cai dentro de "negrito" (do grifo legado sem ID)
    const assigned = ensureHighlightIdAtPos(state, 10, 'doc-ensure');
    expect(assigned).not.toBeNull();
    expect(assigned!.id).toBe('00005');
    expect(assigned!.tr).not.toBeNull();

    const updatedDoc = state.apply(assigned!.tr).doc;
    expect(extractHighlightedRuns(updatedDoc)).toEqual([
      { text: 'Início ', color: 'blue', id: '00005', isBold: false },
      { text: 'negrito', color: 'blue', id: '00005', isBold: true },
      { text: 'existente', color: 'yellow', id: '00004', isBold: false },
    ]);

    // Posição 20 cai dentro de "existente" (que já possui data-id="00004")
    const alreadyHasId = ensureHighlightIdAtPos(updatedDoc ? EditorState.create({ doc: updatedDoc }) : state, 20, 'doc-ensure');
    expect(alreadyHasId).toEqual({ tr: null, id: '00004' });
  });
});
