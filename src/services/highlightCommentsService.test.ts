import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import {
  HIGHLIGHT_COMMENTS_START_MARKER,
  HIGHLIGHT_COMMENTS_END_MARKER,
  parseMarkdownWithHighlightComments,
  composeMarkdownWithHighlightComments,
  hydrateDocHighlightComments,
  getDocHighlightComments,
  getHighlightComment,
  setHighlightComment,
  deleteHighlightComment,
  migrateCommentsOnHighlightOverlap,
  collectOrderedHighlightIdsFromProseMirrorDoc,
  collectOrderedHighlightIdsFromMarkdown,
  extractHighlightTextByIdFromProseMirrorDoc,
  extractHighlightTextByIdFromMarkdown,
  formatSingleCommentForCopy,
  extractAllCommentedHighlightsInOrder,
  formatAllCommentsForCopy,
  resetHighlightCommentsMemory,
} from './highlightCommentsService';

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

describe('highlightCommentsService', () => {
  beforeEach(() => {
    resetHighlightCommentsMemory();
  });

  it('omite a seção final quando não há comentários ativos', () => {
    const body = '# Título\n\nTexto com <mark class="yellow" data-id="00001">destaque</mark>.';
    const result = composeMarkdownWithHighlightComments(body, new Map(), ['00001']);

    expect(result).toBe(body);
    expect(result).not.toContain(HIGHLIGHT_COMMENTS_START_MARKER);
    expect(result).not.toContain(HIGHLIGHT_COMMENTS_END_MARKER);
  });

  it('compõe e faz round-trip fiel de comentários simples e multilinha no rodapé', () => {
    const body = 'Primeiro <mark class="yellow" data-id="00001">trecho um</mark> e <mark class="blue" data-id="00002">trecho dois</mark>.';
    const comments = new Map<string, string>([
      ['00001', 'Comentário em linha única'],
      ['00002', 'Primeira linha\n\nParágrafo 2\n- item lista'],
    ]);

    const fullMd = composeMarkdownWithHighlightComments(body, comments, ['00001', '00002']);
    expect(fullMd).toContain(HIGHLIGHT_COMMENTS_START_MARKER);
    expect(fullMd).toContain('- **[00001]**: Comentário em linha única');
    expect(fullMd).toContain('- **[00002]**: Primeira linha\n\n  Parágrafo 2\n  - item lista');
    expect(fullMd.endsWith(HIGHLIGHT_COMMENTS_END_MARKER)).toBe(true);

    const parsed = parseMarkdownWithHighlightComments(fullMd);
    expect(parsed.hasCommentsSection).toBe(true);
    expect(parsed.bodyMarkdown).toBe(body);
    expect(parsed.comments.get('00001')).toBe('Comentário em linha única');
    expect(parsed.comments.get('00002')).toBe('Primeira linha\n\nParágrafo 2\n- item lista');
  });

  it('não duplica a seção final ao compor sobre um markdown que já continha bloco de comentários', () => {
    const body = 'Texto <mark class="yellow" data-id="00001">A</mark>.';
    const map1 = new Map([['00001', 'Nota 1']]);
    const first = composeMarkdownWithHighlightComments(body, map1, ['00001']);

    const map2 = new Map([['00001', 'Nota 1 atualizada']]);
    const second = composeMarkdownWithHighlightComments(first, map2, ['00001']);

    const occurrences = second.split(HIGHLIGHT_COMMENTS_START_MARKER).length - 1;
    expect(occurrences).toBe(1);
    expect(second).toContain('Nota 1 atualizada');
    expect(second).not.toContain('Nota 1\n');
  });

  it('remove comentários órfãos da saída Markdown mas preserva em memória para Ctrl+Z', () => {
    const docId = 'doc-undo';
    setHighlightComment(docId, '00001', 'Nota preservada');
    setHighlightComment(docId, '00002', 'Nota do grifo apagado');

    const body = 'Texto apenas com <mark class="yellow" data-id="00001">um grifo</mark>.';
    // Apenas 00001 está vivo no documento após exclusão do 00002
    const mdAfterDelete = composeMarkdownWithHighlightComments(
      body,
      getDocHighlightComments(docId),
      ['00001']
    );

    expect(mdAfterDelete).toContain('- **[00001]**: Nota preservada');
    expect(mdAfterDelete).not.toContain('00002');
    expect(mdAfterDelete).not.toContain('Nota do grifo apagado');

    // Usuário pressionou Ctrl+Z e o 00002 voltou a ficar vivo no documento
    expect(getHighlightComment(docId, '00002')).toBe('Nota do grifo apagado');
    const mdAfterUndo = composeMarkdownWithHighlightComments(
      body + ' <mark class="yellow" data-id="00002">segundo</mark>',
      getDocHighlightComments(docId),
      ['00001', '00002']
    );
    expect(mdAfterUndo).toContain('- **[00002]**: Nota do grifo apagado');
  });

  it('remove permanentemente o comentário quando excluído explicitamente sem apagar o grifo', () => {
    const docId = 'doc-del-comment';
    setHighlightComment(docId, '00001', 'Comentário temporário');
    expect(getHighlightComment(docId, '00001')).toBe('Comentário temporário');

    deleteHighlightComment(docId, '00001');
    expect(getHighlightComment(docId, '00001')).toBe('');
    expect(getDocHighlightComments(docId).has('00001')).toBe(false);
  });

  it('migra automaticamente comentários ao redimensionar ou mesclar grifos sobrepostos', () => {
    const docId = 'doc-migrate';
    setHighlightComment(docId, '00001', 'Comentário original');
    setHighlightComment(docId, '00002', 'Segundo comentário');

    const migrated = migrateCommentsOnHighlightOverlap(docId, ['00001', '00002'], '00003');
    expect(migrated).toBe(true);
    expect(getHighlightComment(docId, '00001')).toBe('');
    expect(getHighlightComment(docId, '00002')).toBe('');
    expect(getHighlightComment(docId, '00003')).toBe(
      'Comentário original\n\nSegundo comentário'
    );
  });

  it('formata cópia individual e em lote no padrão exato normalizando quebras de linha', () => {
    const formatted = formatSingleCommentForCopy(
      'artigo 5º,\n   inciso II\tda Constituição',
      '  Precisa revisar este ponto  '
    );
    expect(formatted).toBe('Sobre "artigo 5º, inciso II da Constituição": Precisa revisar este ponto');

    const batch = formatAllCommentsForCopy([
      { highlightText: 'trecho A', commentText: 'obs A' },
      { highlightText: 'trecho B', commentText: 'obs B' },
    ]);
    expect(batch).toBe('Sobre "trecho A": obs A\n\nSobre "trecho B": obs B');
  });

  it('extrai IDs ordenados e textos de grifos comentados a partir de árvore ProseMirror real e Markdown', () => {
    const hl1 = testSchema.marks.customHighlight.create({ color: 'yellow', id: '00001' });
    const hl2 = testSchema.marks.customHighlight.create({ color: 'blue', id: '00002' });
    const bold = testSchema.marks.bold.create();

    const doc = testSchema.node('doc', null, [
      testSchema.node('paragraph', null, [
        testSchema.text('Início '),
        testSchema.text('negrito', [bold, hl1]),
        testSchema.text(' simples', [hl1]),
        testSchema.text(' meio '),
        testSchema.text('linha 1', [hl2]),
      ]),
      testSchema.node('paragraph', null, [
        testSchema.text('linha 2', [hl2]),
      ]),
    ]);

    expect(collectOrderedHighlightIdsFromProseMirrorDoc(doc)).toEqual(['00001', '00002']);
    expect(extractHighlightTextByIdFromProseMirrorDoc(doc, '00001')).toBe('negrito simples');
    expect(extractHighlightTextByIdFromProseMirrorDoc(doc, '00002')).toBe('linha 1 linha 2');

    const comments = new Map([
      ['00002', 'Nota dois'],
      ['00001', 'Nota um'],
    ]);
    const ordered = extractAllCommentedHighlightsInOrder(doc, comments);
    expect(ordered).toEqual([
      { id: '00001', highlightText: 'negrito simples', commentText: 'Nota um' },
      { id: '00002', highlightText: 'linha 1 linha 2', commentText: 'Nota dois' },
    ]);

    const rawMd =
      'Início <mark class="yellow" data-id="00001">**negrito** simples</mark> meio <mark class="blue" data-id="00002">linha 1\nlinha 2</mark>';
    expect(collectOrderedHighlightIdsFromMarkdown(rawMd)).toEqual(['00001', '00002']);
    expect(extractHighlightTextByIdFromMarkdown(rawMd, '00001')).toBe('**negrito** simples');
    expect(extractHighlightTextByIdFromMarkdown(rawMd, '00002')).toBe('linha 1 linha 2');
  });

  it('hidrata comentários preservando ou substituindo conforme replaceExisting', () => {
    const docId = 'doc-hydrate';
    setHighlightComment(docId, '00001', 'Sessão antiga');

    hydrateDocHighlightComments(docId, new Map([['00002', 'Do arquivo']]), false);
    expect(getHighlightComment(docId, '00001')).toBe('Sessão antiga');
    expect(getHighlightComment(docId, '00002')).toBe('Do arquivo');

    hydrateDocHighlightComments(docId, new Map([['00003', 'Novo código-fonte']]), true);
    expect(getHighlightComment(docId, '00001')).toBe('');
    expect(getHighlightComment(docId, '00002')).toBe('');
    expect(getHighlightComment(docId, '00003')).toBe('Novo código-fonte');
  });
});
