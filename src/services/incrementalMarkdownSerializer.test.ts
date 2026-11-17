import { describe, it, expect, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { MarkdownSerializer as PmMarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { serializeDocIncrementally } from './incrementalMarkdownSerializer';

const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
    },
    heading: {
      attrs: { level: { default: 1 } },
      group: 'block',
      content: 'inline*',
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    bulletList: {
      group: 'block',
      content: 'listItem+',
      attrs: { tight: { default: true } },
      toDOM: () => ['ul', 0],
    },
    orderedList: {
      group: 'block',
      content: 'listItem+',
      attrs: { start: { default: 1 }, tight: { default: true } },
      toDOM: () => ['ol', 0],
    },
    listItem: {
      content: 'paragraph block*',
      toDOM: () => ['li', 0],
    },
    blockquote: {
      group: 'block',
      content: 'block+',
      toDOM: () => ['blockquote', 0],
    },
    codeBlock: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      attrs: { language: { default: '' } },
      toDOM: () => ['pre', ['code', 0]],
    },
    horizontalRule: {
      group: 'block',
      toDOM: () => ['hr'],
    },
    text: {
      group: 'inline',
    },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0] },
    italic: { toDOM: () => ['em', 0] },
    customHighlight: {
      attrs: { color: { default: 'yellow' }, id: { default: null } },
      toDOM: (mark) => ['mark', { class: mark.attrs.color, 'data-id': mark.attrs.id }, 0],
    },
  },
});

function createTestSerializer() {
  const pmSerializer = new PmMarkdownSerializer(
    {
      paragraph: defaultMarkdownSerializer.nodes.paragraph,
      heading: defaultMarkdownSerializer.nodes.heading,
      blockquote: defaultMarkdownSerializer.nodes.blockquote,
      horizontalRule: defaultMarkdownSerializer.nodes.horizontal_rule,
      codeBlock(state, node) {
        state.write('```' + (node.attrs.language || '') + '\n');
        state.text(node.textContent, false);
        state.ensureNewLine();
        state.write('```');
        state.closeBlock(node);
      },
      bulletList(state, node) {
        state.renderList(node, '  ', () => '- ');
      },
      orderedList(state, node, parent, index) {
        let adjacentIndex = 0;
        for (; index - adjacentIndex > 0; adjacentIndex++) {
          if (parent.child(index - adjacentIndex - 1).type.name !== node.type.name) {
            break;
          }
        }
        const start = node.attrs.start || 1;
        const maxW = String(start + node.childCount - 1).length;
        const space = state.repeat(' ', maxW + 2);
        const separator = adjacentIndex % 2 ? ') ' : '. ';
        state.renderList(node, space, (i) => {
          const nStr = String(start + i);
          return state.repeat(' ', maxW - nStr.length) + nStr + separator;
        });
      },
      listItem: defaultMarkdownSerializer.nodes.list_item,
      text: defaultMarkdownSerializer.nodes.text,
    },
    {
      bold: defaultMarkdownSerializer.marks.strong,
      italic: defaultMarkdownSerializer.marks.em,
      customHighlight: {
        open(_state: any, mark: any) {
          const color = mark.attrs?.color || 'yellow';
          const id = mark.attrs?.id;
          return `<mark class="${color}"${id ? ` data-id="${id}"` : ''}>`;
        },
        close() {
          return '</mark>';
        },
      },
    }
  );

  return pmSerializer;
}

describe('incrementalMarkdownSerializer', () => {
  it('reutiliza cache WeakMap de blocos não modificados e re-serializa apenas o bloco editado', () => {
    const serializer = createTestSerializer();
    const serializeSpy = vi.spyOn(serializer, 'serialize');

    const p1 = testSchema.node('paragraph', null, [testSchema.text('Parágrafo 1 intacto')]);
    const p2 = testSchema.node('paragraph', null, [testSchema.text('Parágrafo 2 original')]);
    const p3 = testSchema.node('paragraph', null, [testSchema.text('Parágrafo 3 intacto')]);

    const doc1 = testSchema.node('doc', null, [p1, p2, p3]);
    const fakeEditor1: any = {
      isDestroyed: false,
      state: { doc: doc1 },
      storage: { markdown: { serializer } },
    };

    const firstOut = serializeDocIncrementally(fakeEditor1);
    expect(firstOut).toBe('Parágrafo 1 intacto\n\nParágrafo 2 original\n\nParágrafo 3 intacto');
    expect(serializeSpy).toHaveBeenCalledTimes(3);

    // Segunda chamada sem alteração de nós: 0 novas chamadas de serialização
    serializeSpy.mockClear();
    const cachedOut = serializeDocIncrementally(fakeEditor1);
    expect(cachedOut).toBe(firstOut);
    expect(serializeSpy).toHaveBeenCalledTimes(0);

    // Edita apenas o parágrafo 2 (p1 e p3 mantêm a mesma referência de nó)
    const hlMark = testSchema.marks.customHighlight.create({ color: 'blue', id: '00001' });
    const p2Edited = testSchema.node('paragraph', null, [
      testSchema.text('Parágrafo 2 ', [hlMark]),
      testSchema.text('grifado'),
    ]);
    const doc2 = testSchema.node('doc', null, [p1, p2Edited, p3]);
    const fakeEditor2: any = {
      isDestroyed: false,
      state: { doc: doc2 },
      storage: { markdown: { serializer } },
    };

    serializeSpy.mockClear();
    const secondOut = serializeDocIncrementally(fakeEditor2);
    expect(secondOut).toBe(
      'Parágrafo 1 intacto\n\n<mark class="blue" data-id="00001">Parágrafo 2 </mark>grifado\n\nParágrafo 3 intacto'
    );
    // Apenas o bloco editado (p2Edited) foi serializado!
    expect(serializeSpy).toHaveBeenCalledTimes(1);
  });

  it('mantém paridade exata com serialização completa em títulos, listas consecutivas, blocos vazios e citações', () => {
    const serializer = createTestSerializer();

    const doc = testSchema.node('doc', null, [
      testSchema.node('heading', { level: 1 }, [testSchema.text('Título Principal')]),
      testSchema.node('paragraph', null, [
        testSchema.text('Texto com '),
        testSchema.text('negrito', [testSchema.marks.bold.create()]),
        testSchema.text(' e '),
        testSchema.text('itálico', [testSchema.marks.italic.create()]),
        testSchema.text('.'),
      ]),
      testSchema.node('paragraph', null, []), // parágrafo vazio intermediário
      testSchema.node('blockquote', null, [
        testSchema.node('paragraph', null, [testSchema.text('Citação de exemplo')]),
      ]),
      testSchema.node('bulletList', null, [
        testSchema.node('listItem', null, [
          testSchema.node('paragraph', null, [testSchema.text('Item A')]),
        ]),
      ]),
      testSchema.node('bulletList', null, [
        testSchema.node('listItem', null, [
          testSchema.node('paragraph', null, [testSchema.text('Item B')]),
        ]),
      ]),
      testSchema.node('orderedList', null, [
        testSchema.node('listItem', null, [
          testSchema.node('paragraph', null, [testSchema.text('Primeiro')]),
        ]),
      ]),
      testSchema.node('orderedList', null, [
        testSchema.node('listItem', null, [
          testSchema.node('paragraph', null, [testSchema.text('Segundo')]),
        ]),
      ]),
      testSchema.node('codeBlock', { language: 'ts' }, [testSchema.text('const x = 1;')]),
      testSchema.node('horizontalRule'),
      testSchema.node('paragraph', null, []), // parágrafo vazio final
    ]);

    const fakeEditor: any = {
      isDestroyed: false,
      state: { doc },
      storage: { markdown: { serializer } },
    };

    const expected = serializer.serialize(doc);
    const actual = serializeDocIncrementally(fakeEditor);
    expect(actual).toBe(expected);
  });
});
