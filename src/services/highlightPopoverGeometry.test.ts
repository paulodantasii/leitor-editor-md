import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { resetHighlightIdMemory } from './highlightIdService';
import {
  ActiveHighlightPopoverState,
  ViewportMetrics,
  computePopoverPosition,
  createRemoveHighlightTransaction,
  createUpdateHighlightColorTransaction,
  isAnchorVisibleInViewport,
  isSamePopoverTarget,
  isValidDesktopClick,
  isValidTouchTap,
  parseHighlightColorFromElement,
  resolveHighlightTargetInDoc,
} from './highlightPopoverGeometry';

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

function createMultiParagraphHighlightState(): EditorState {
  const hlA = testSchema.marks.customHighlight.create({ color: 'blue', id: '00001' });
  const hlB = testSchema.marks.customHighlight.create({ color: 'green', id: '00002' });
  const hlSingle = testSchema.marks.customHighlight.create({ color: 'red', id: '00003' });
  const bold = testSchema.marks.bold.create();

  const p1 = testSchema.nodes.paragraph.create(null, [
    testSchema.text('Intro '),
    testSchema.text('inicio grifo longo ', [hlA]),
    testSchema.text('negrito', [hlA, bold]),
    testSchema.text(' fim p1', [hlA]),
  ]);

  const p2 = testSchema.nodes.paragraph.create(null, [
    testSchema.text('continuacao p2', [hlA]),
    testSchema.text(' meio '),
    testSchema.text('segundo grifo', [hlB]),
    testSchema.text(' '),
    testSchema.text('X', [hlSingle]),
  ]);

  const doc = testSchema.nodes.doc.create(null, [p1, p2]);
  return EditorState.create({ doc, schema: testSchema });
}

function collectHighlightRuns(doc: any): Array<{ text: string; color: string; id: string | null }> {
  const runs: Array<{ text: string; color: string; id: string | null }> = [];
  doc.descendants((node: any) => {
    if (!node.isText) return;
    const hl = node.marks.find((m: any) => m.type.name === 'customHighlight');
    if (hl) {
      runs.push({
        text: node.text || '',
        color: hl.attrs.color,
        id: hl.attrs.id ?? null,
      });
    }
  });
  return runs;
}

describe('highlightPopoverGeometry — resolução de grifos e troca de alvos', () => {
  beforeEach(() => {
    resetHighlightIdMemory();
  });

  it('resolve ID, cor e anchorPos no ponto exato clicado (e não no início) em grifo longo multi-linha/bloco', () => {
    const state = createMultiParagraphHighlightState();
    // "Intro " termina em pos 7; "negrito" começa em 26; "continuacao p2" no p2 começa em 42
    let p2Start = -1;
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'continuacao p2') {
        p2Start = pos;
      }
    });

    const clickInsideP2 = p2Start + 5;
    const target = resolveHighlightTargetInDoc(state.doc, {
      candidatePos: clickInsideP2,
      fallbackStartPos: 7,
      domId: '00001',
      domColor: 'yellow',
    });

    expect(target).not.toBeNull();
    expect(target!.highlightId).toBe('00001');
    expect(target!.color).toBe('blue');
    expect(target!.anchorPos).toBe(clickInsideP2);
    expect(target!.range.from).toBe(7);
    expect(target!.range.to).toBe(p2Start + 'continuacao p2'.length);
  });

  it('fecha (toggle) ao clicar novamente no mesmo grifo e troca diretamente de Grifo A para Grifo B em 1 clique', () => {
    const state = createMultiParagraphHighlightState();
    let grifoBPos = -1;
    let grifoAP2Pos = -1;
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'continuacao p2') {
        grifoAP2Pos = pos + 3;
      }
      if (node.isText && node.text === 'segundo grifo') {
        grifoBPos = pos + 4;
      }
    });

    const targetA = resolveHighlightTargetInDoc(state.doc, {
      candidatePos: 12,
      fallbackStartPos: 7,
      domId: '00001',
    })!;

    const activeState: ActiveHighlightPopoverState = {
      highlightId: targetA.highlightId,
      legacyRange: null,
      anchorPos: targetA.anchorPos,
      color: targetA.color,
      isCommentOpen: false,
    };

    // Clicar em outro ponto do mesmo grifo A (inclusive em outro parágrafo) -> mesmo alvo (toggle fecha)
    const targetASameOtherLine = resolveHighlightTargetInDoc(state.doc, {
      candidatePos: grifoAP2Pos,
      fallbackStartPos: 7,
      domId: '00001',
    })!;
    expect(isSamePopoverTarget(activeState, targetASameOtherLine)).toBe(true);

    // Clicar no Grifo B enquanto seleção do editor já poderia estar no Grifo B -> alvo diferente (move direto)
    const stateWithSelectionAlreadyMovedToB = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, grifoBPos))
    );
    const targetB = resolveHighlightTargetInDoc(stateWithSelectionAlreadyMovedToB.doc, {
      candidatePos: grifoBPos,
      fallbackStartPos: grifoBPos - 4,
      domId: '00002',
    })!;

    expect(isSamePopoverTarget(activeState, targetB)).toBe(false);
    expect(targetB.highlightId).toBe('00002');
    expect(targetB.color).toBe('green');
    expect(targetB.anchorPos).toBe(grifoBPos);
  });

  it('suporta grifo de 1 único caractere e formatação bold aninhada sem estourar o intervalo', () => {
    const state = createMultiParagraphHighlightState();
    let singleCharPos = -1;
    let boldPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'X') singleCharPos = pos;
      if (node.isText && node.text === 'negrito') boldPos = pos + 2;
    });

    // Clique na borda direita do caractere único (pos + 1) continua ancorado em singleCharPos
    const singleTarget = resolveHighlightTargetInDoc(state.doc, {
      candidatePos: singleCharPos + 1,
      fallbackStartPos: singleCharPos,
      domId: '00003',
    });
    expect(singleTarget).not.toBeNull();
    expect(singleTarget!.anchorPos).toBe(singleCharPos);
    expect(singleTarget!.range).toEqual({ from: singleCharPos, to: singleCharPos + 1 });

    // Clique dentro do trecho negrito dentro do grifo A
    const boldTarget = resolveHighlightTargetInDoc(state.doc, {
      candidatePos: boldPos,
      fallbackStartPos: 7,
      domId: '00001',
    });
    expect(boldTarget).not.toBeNull();
    expect(boldTarget!.anchorPos).toBe(boldPos);
    expect(boldTarget!.highlightId).toBe('00001');
  });

  it('resolve grifos legados sem data-id mantendo adjacentes de cores distintas separados e detecta toggle', () => {
    const hlYellow = testSchema.marks.customHighlight.create({ color: 'yellow', id: null });
    const hlPink = testSchema.marks.customHighlight.create({ color: 'pink', id: null });
    const bold = testSchema.marks.bold.create();

    const p = testSchema.nodes.paragraph.create(null, [
      testSchema.text('amarelo ', [hlYellow]),
      testSchema.text('forte', [hlYellow, bold]),
      testSchema.text('rosa', [hlPink]),
    ]);
    const doc = testSchema.nodes.doc.create(null, [p]);

    // "amarelo " = [1, 9], "forte" = [9, 14], "rosa" = [14, 18]
    const yellowTarget = resolveHighlightTargetInDoc(doc, {
      candidatePos: 11,
      fallbackStartPos: 1,
      domId: null,
    });
    expect(yellowTarget).not.toBeNull();
    expect(yellowTarget!.highlightId).toBeNull();
    expect(yellowTarget!.color).toBe('yellow');
    expect(yellowTarget!.range).toEqual({ from: 1, to: 14 });
    expect(yellowTarget!.anchorPos).toBe(11);

    const pinkTarget = resolveHighlightTargetInDoc(doc, {
      candidatePos: 15,
      fallbackStartPos: 14,
      domId: null,
    });
    expect(pinkTarget).not.toBeNull();
    expect(pinkTarget!.color).toBe('pink');
    expect(pinkTarget!.range).toEqual({ from: 14, to: 18 });

    const activeYellow: ActiveHighlightPopoverState = {
      highlightId: null,
      legacyRange: yellowTarget!.range,
      anchorPos: yellowTarget!.anchorPos,
      color: 'yellow',
      isCommentOpen: false,
    };

    expect(isSamePopoverTarget(activeYellow, yellowTarget!)).toBe(true);
    expect(isSamePopoverTarget(activeYellow, pinkTarget!)).toBe(false);
  });
});

describe('highlightPopoverGeometry — validação de gestos e parsing de cor DOM', () => {
  it('valida clique esquerdo sem arraste no PC e rejeita arraste ou outros botões', () => {
    expect(isValidDesktopClick(100, 200, 103, 204, 0)).toBe(true); // hypot = 5
    expect(isValidDesktopClick(100, 200, 104, 204, 0)).toBe(false); // hypot > 5
    expect(isValidDesktopClick(100, 200, 100, 200, 2)).toBe(false); // botão direito
    expect(isValidDesktopClick(100, 200, 100, 200, 1)).toBe(false); // botão do meio
  });

  it('valida toque rápido no iPad e rejeita scroll ou long-press', () => {
    expect(isValidTouchTap(50, 50, 56, 58, 120)).toBe(true); // hypot = 10, <= 500ms
    expect(isValidTouchTap(50, 50, 62, 50, 120)).toBe(false); // moveu > 10px (scroll)
    expect(isValidTouchTap(50, 50, 50, 50, 650)).toBe(false); // segurou > 500ms (long-press)
    expect(isValidTouchTap(50, 50, 50, 50, -5)).toBe(false);
  });

  it('extrai cor de data-color, classe direta e prefixo hl-* com fallback para yellow', () => {
    expect(
      parseHighlightColorFromElement({ getAttribute: (k) => (k === 'data-color' ? 'green' : null), className: '' })
    ).toBe('green');
    expect(
      parseHighlightColorFromElement({ getAttribute: () => null, className: 'blue mark-hovered' })
    ).toBe('blue');
    expect(
      parseHighlightColorFromElement({ getAttribute: () => null, className: 'hl-purple' })
    ).toBe('purple');
    expect(
      parseHighlightColorFromElement({ getAttribute: () => null, className: 'desconhecida' })
    ).toBe('yellow');
  });
});

describe('highlightPopoverGeometry — geometria de posicionamento, flip, clamping e scroll', () => {
  const desktopViewport: ViewportMetrics = {
    width: 1280,
    height: 800,
    offsetTop: 0,
    offsetLeft: 0,
    headerBottom: 78,
  };

  it('posiciona acima e centralizado no ponto clicado quando há espaço suficiente', () => {
    const pos = computePopoverPosition(
      { left: 500, right: 500, top: 300, bottom: 322 },
      { width: 280, height: 42 },
      desktopViewport
    );

    expect(pos.placement).toBe('top');
    expect(pos.left).toBe(360); // 500 - 140
    expect(pos.top).toBe(248); // 300 - 42 - 10
  });

  it('faz flip automático para baixo quando encosta no cabeçalho fixo', () => {
    const pos = computePopoverPosition(
      { left: 500, right: 500, top: 96, bottom: 118 },
      { width: 280, height: 42 },
      desktopViewport
    );

    expect(pos.placement).toBe('bottom');
    expect(pos.top).toBe(128); // 118 + 10
  });

  it('faz clamping horizontal dentro das margens esquerda e direita de 8px', () => {
    const leftEdge = computePopoverPosition(
      { left: 10, right: 10, top: 300, bottom: 322 },
      { width: 280, height: 42 },
      desktopViewport
    );
    expect(leftEdge.left).toBe(8);

    const rightEdge = computePopoverPosition(
      { left: 1270, right: 1270, top: 300, bottom: 322 },
      { width: 280, height: 42 },
      desktopViewport
    );
    expect(rightEdge.left).toBe(1280 - 280 - 8);
  });

  it('mantém caixa de comentário expandida dentro da visualViewport quando teclado virtual do iPad reduz a altura', () => {
    const ipadKeyboardViewport: ViewportMetrics = {
      width: 768,
      height: 360,
      offsetTop: 40,
      offsetLeft: 0,
      headerBottom: 78,
    };

    const pos = computePopoverPosition(
      { left: 384, right: 384, top: 240, bottom: 262 },
      { width: 340, height: 220 },
      ipadKeyboardViewport
    );

    const topSafeBound = Math.max(78 + 8, 40 + 8);
    const bottomSafeBound = 40 + 360 - 8;
    expect(pos.top).toBeGreaterThanOrEqual(topSafeBound);
    expect(pos.top + 220).toBeLessThanOrEqual(bottomSafeBound);
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + 340).toBeLessThanOrEqual(768 - 8);
  });

  it('detecta saída da área visível durante rolagem vertical ou horizontal', () => {
    expect(
      isAnchorVisibleInViewport({ left: 200, right: 200, top: 150, bottom: 170 }, desktopViewport)
    ).toBe(true);
    // Saiu por baixo do cabeçalho fixo
    expect(
      isAnchorVisibleInViewport({ left: 200, right: 200, top: 50, bottom: 77 }, desktopViewport)
    ).toBe(false);
    // Saiu abaixo da viewport
    expect(
      isAnchorVisibleInViewport({ left: 200, right: 200, top: 801, bottom: 822 }, desktopViewport)
    ).toBe(false);
    // Saiu horizontalmente (ex.: scroll em tabela)
    expect(
      isAnchorVisibleInViewport({ left: -20, right: -5, top: 200, bottom: 220 }, desktopViewport)
    ).toBe(false);
  });

  it('respeita footerHeight evitando que o popover sobreponha a barra inferior fixa', () => {
    const viewportWithFooter: ViewportMetrics = {
      width: 1280,
      height: 800,
      offsetTop: 0,
      offsetLeft: 0,
      headerBottom: 78,
      footerHeight: 23,
    };

    // Âncora na área coberta pelo footer (top >= 777) é considerada fora da área visível
    expect(
      isAnchorVisibleInViewport(
        { left: 400, right: 420, top: 780, bottom: 798 },
        viewportWithFooter
      )
    ).toBe(false);

    // Popover próximo ao fundo respeita o limite 800 - 23 - 8 = 769
    const pos = computePopoverPosition(
      { left: 500, right: 500, top: 680, bottom: 702 },
      { width: 280, height: 220 },
      viewportWithFooter
    );
    expect(pos.top + 220).toBeLessThanOrEqual(800 - 23 - 8);
  });
});

describe('highlightPopoverGeometry — transações puras de cor e remoção', () => {
  beforeEach(() => {
    resetHighlightIdMemory();
  });

  it('troca a cor de todas as runs do mesmo data-id preservando comentário/id e sem mexer na seleção', () => {
    const initial = createMultiParagraphHighlightState();
    const state = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 2)));

    const result = createUpdateHighlightColorTransaction(
      state,
      { highlightId: '00001', legacyRange: null, anchorPos: 12 },
      'orange',
      'doc-test'
    );

    expect(result).not.toBeNull();
    expect(result!.highlightId).toBe('00001');
    expect(result!.tr).not.toBeNull();

    const nextState = state.apply(result!.tr);
    // Não altera a seleção do editor (protege foco do textarea de comentário!)
    expect(nextState.selection.from).toBe(2);
    expect(nextState.selection.to).toBe(2);

    const runs = collectHighlightRuns(nextState.doc);
    const groupA = runs.filter((r) => r.id === '00001');
    expect(groupA).toHaveLength(4);
    expect(groupA.every((r) => r.color === 'orange')).toBe(true);
    // Grifo vizinho permanece intocado
    expect(runs.find((r) => r.id === '00002')?.color).toBe('green');
  });

  it('promove grifo legado sem data-id ao trocar cor, gerando ID sequencial e pintando todo o bloco contíguo', () => {
    const hlYellow = testSchema.marks.customHighlight.create({ color: 'yellow', id: null });
    const bold = testSchema.marks.bold.create();
    const p = testSchema.nodes.paragraph.create(null, [
      testSchema.text('antes '),
      testSchema.text('parte1 ', [hlYellow]),
      testSchema.text('parte2', [hlYellow, bold]),
    ]);
    const state = EditorState.create({ doc: testSchema.nodes.doc.create(null, [p]), schema: testSchema });

    const result = createUpdateHighlightColorTransaction(
      state,
      { highlightId: null, legacyRange: { from: 7, to: 20 }, anchorPos: 10 },
      'purple',
      'doc-legacy'
    );

    expect(result).not.toBeNull();
    expect(result!.highlightId).toBe('00001');
    const nextState = state.apply(result!.tr);
    const runs = collectHighlightRuns(nextState.doc);
    expect(runs).toEqual([
      { text: 'parte1 ', color: 'purple', id: '00001' },
      { text: 'parte2', color: 'purple', id: '00001' },
    ]);
  });

  it('evita mutação desnecessária quando a cor escolhida já é a mesma em grifo com ID', () => {
    const state = createMultiParagraphHighlightState();
    const result = createUpdateHighlightColorTransaction(
      state,
      { highlightId: '00001', legacyRange: null, anchorPos: 12 },
      'blue',
      'doc-test'
    );

    expect(result).not.toBeNull();
    expect(result!.tr).toBeNull();
    expect(result!.highlightId).toBe('00001');
  });

  it('remove integralmente um grifo por data-id ou legado sem afetar vizinhos', () => {
    const state = createMultiParagraphHighlightState();
    const removeATr = createRemoveHighlightTransaction(state, {
      highlightId: '00001',
      legacyRange: null,
      anchorPos: 12,
    });

    expect(removeATr).not.toBeNull();
    const afterRemoveA = state.apply(removeATr);
    const remainingRuns = collectHighlightRuns(afterRemoveA.doc);
    expect(remainingRuns.some((r) => r.id === '00001')).toBe(false);
    expect(remainingRuns.map((r) => r.id)).toEqual(['00002', '00003']);

    // Testa remoção de grifo legado sem data-id
    const hlLegacy = testSchema.marks.customHighlight.create({ color: 'yellow', id: null });
    const hlKeep = testSchema.marks.customHighlight.create({ color: 'blue', id: '00009' });
    const legacyDoc = testSchema.nodes.doc.create(null, [
      testSchema.nodes.paragraph.create(null, [
        testSchema.text('legado', [hlLegacy]),
        testSchema.text(' '),
        testSchema.text('manter', [hlKeep]),
      ]),
    ]);
    const legacyState = EditorState.create({ doc: legacyDoc, schema: testSchema });
    const removeLegacyTr = createRemoveHighlightTransaction(legacyState, {
      highlightId: null,
      legacyRange: { from: 1, to: 7 },
      anchorPos: 3,
    });
    expect(removeLegacyTr).not.toBeNull();
    const afterRemoveLegacy = legacyState.apply(removeLegacyTr);
    expect(collectHighlightRuns(afterRemoveLegacy.doc)).toEqual([
      { text: 'manter', color: 'blue', id: '00009' },
    ]);
  });
});
