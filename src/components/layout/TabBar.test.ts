import { describe, it, expect } from 'vitest';
import {
  resolveTabBarDropTarget,
  HorizontalRect,
  RenderedSegmentRect,
  RenderedTabRect,
  TabDragSource,
} from './TabBar';
import { TabItem } from '../../types';

const makeTab = (id: string, groupId: string | null = null): TabItem => ({
  id,
  title: `${id}.md`,
  isDirty: false,
  docId: `doc-${id}`,
  groupId,
});

const rect = (left: number, right: number): HorizontalRect => ({
  left,
  right,
  width: right - left,
});

describe('TabBar: resolveTabBarDropTarget (reposicionamento contínuo)', () => {
  const tab1 = makeTab('t1');
  const tab2 = makeTab('t2');
  const tab3 = makeTab('t3');
  const allSingleTabs = [tab1, tab2, tab3];

  const singleTabRects: RenderedTabRect[] = [
    { tab: tab1, rect: rect(20, 120) },
    { tab: tab2, rect: rect(126, 226) },
    { tab: tab3, rect: rect(232, 332) },
  ];

  const singleSegmentRects: RenderedSegmentRect[] = singleTabRects.map((tr) => ({
    type: 'single',
    rect: tr.rect,
    firstTab: tr.tab,
    lastTab: tr.tab,
    tabs: [tr.tab],
  }));

  const dragTab3: TabDragSource = { type: 'tab', id: 't3' };

  it('reconhece qualquer posição antes da primeira aba como before da 1ª aba', () => {
    expect(
      resolveTabBarDropTarget({
        clientX: 0,
        source: dragTab3,
        tabs: allSingleTabs,
        tabRects: singleTabRects,
        segmentRects: singleSegmentRects,
      })
    ).toEqual({
      kind: 'tab',
      targetTabId: 't1',
      position: 'before',
      outsideGroup: true,
    });

    expect(
      resolveTabBarDropTarget({
        clientX: 19,
        source: dragTab3,
        tabs: allSingleTabs,
        tabRects: singleTabRects,
        segmentRects: singleSegmentRects,
      })
    ).toEqual({
      kind: 'tab',
      targetTabId: 't1',
      position: 'before',
      outsideGroup: true,
    });
  });

  it('reconhece qualquer posição depois da última aba (botão + ou espaço vazio à direita) como after da última aba', () => {
    const dragTab1: TabDragSource = { type: 'tab', id: 't1' };

    for (const x of [332, 350, 720, 1200]) {
      expect(
        resolveTabBarDropTarget({
          clientX: x,
          source: dragTab1,
          tabs: allSingleTabs,
          tabRects: singleTabRects,
          segmentRects: singleSegmentRects,
        })
      ).toEqual({
        kind: 'tab',
        targetTabId: 't3',
        position: 'after',
        outsideGroup: true,
      });
    }
  });

  it('reconhece borda esquerda (before), centro (group) e borda direita (after) dentro de uma aba', () => {
    // tab2 está em [126..226] (largura 100)
    expect(
      resolveTabBarDropTarget({
        clientX: 135, // ratio 0.09 -> before
        source: dragTab3,
        tabs: allSingleTabs,
        tabRects: singleTabRects,
        segmentRects: singleSegmentRects,
      })
    ).toEqual({
      kind: 'tab',
      targetTabId: 't2',
      position: 'before',
      outsideGroup: false,
    });

    expect(
      resolveTabBarDropTarget({
        clientX: 176, // ratio 0.50 -> group
        source: dragTab3,
        tabs: allSingleTabs,
        tabRects: singleTabRects,
        segmentRects: singleSegmentRects,
      })
    ).toEqual({
      kind: 'tab',
      targetTabId: 't2',
      position: 'group',
      outsideGroup: false,
    });

    expect(
      resolveTabBarDropTarget({
        clientX: 218, // ratio 0.92 -> after
        source: dragTab3,
        tabs: allSingleTabs,
        tabRects: singleTabRects,
        segmentRects: singleSegmentRects,
      })
    ).toEqual({
      kind: 'tab',
      targetTabId: 't2',
      position: 'after',
      outsideGroup: false,
    });
  });

  it('elimina pontos cegos no vão (gap) entre duas abas resolvendo pela metade mais próxima', () => {
    // Gap entre tab1 [20..120] e tab2 [126..226] tem ponto médio em 123
    expect(
      resolveTabBarDropTarget({
        clientX: 122,
        source: dragTab3,
        tabs: allSingleTabs,
        tabRects: singleTabRects,
        segmentRects: singleSegmentRects,
      })
    ).toEqual({
      kind: 'tab',
      targetTabId: 't1',
      position: 'after',
      outsideGroup: true,
    });

    expect(
      resolveTabBarDropTarget({
        clientX: 124,
        source: dragTab3,
        tabs: allSingleTabs,
        tabRects: singleTabRects,
        segmentRects: singleSegmentRects,
      })
    ).toEqual({
      kind: 'tab',
      targetTabId: 't2',
      position: 'before',
      outsideGroup: true,
    });
  });

  it('marca outsideGroup: true antes e depois de grupos nas extremidades e outsideGroup: false nos vãos internos', () => {
    const g1 = makeTab('g1', 'grp-1');
    const g2 = makeTab('g2', 'grp-1');
    const outside = makeTab('out');
    const tabs = [g1, g2, outside];

    // Grupo [20..280]: chip [26..86], g1 [90..180], g2 [184..274]; aba avulsa [286..386]
    const tabRects: RenderedTabRect[] = [
      { tab: g1, rect: rect(90, 180) },
      { tab: g2, rect: rect(184, 274) },
      { tab: outside, rect: rect(286, 386) },
    ];
    const segmentRects: RenderedSegmentRect[] = [
      {
        type: 'group',
        groupId: 'grp-1',
        collapsed: false,
        rect: rect(20, 280),
        chipRect: rect(26, 86),
        firstTab: g1,
        lastTab: g2,
        tabs: [g1, g2],
      },
      {
        type: 'single',
        rect: rect(286, 386),
        firstTab: outside,
        lastTab: outside,
        tabs: [outside],
      },
    ];

    const dragOutside: TabDragSource = { type: 'tab', id: 'out' };
    const dragG1: TabDragSource = { type: 'tab', id: 'g1' };

    // Antes do grupo inicial -> before g1 fora do grupo
    expect(
      resolveTabBarDropTarget({
        clientX: 5,
        source: dragOutside,
        tabs,
        tabRects,
        segmentRects,
      })
    ).toEqual({
      kind: 'tab',
      targetTabId: 'g1',
      position: 'before',
      outsideGroup: true,
    });

    // Sobre o chip do grupo -> group-chip
    expect(
      resolveTabBarDropTarget({
        clientX: 55,
        source: dragOutside,
        tabs,
        tabRects,
        segmentRects,
      })
    ).toEqual({
      kind: 'group-chip',
      groupId: 'grp-1',
    });

    // No vão interno entre g1 [90..180] e g2 [184..274] -> permanece dentro do grupo
    expect(
      resolveTabBarDropTarget({
        clientX: 181,
        source: dragOutside,
        tabs,
        tabRects,
        segmentRects,
      })
    ).toEqual({
      kind: 'tab',
      targetTabId: 'g1',
      position: 'after',
      outsideGroup: false,
    });

    // Na área após a última aba (mesmo se a última aba for de um grupo) -> after fora do grupo
    const groupAtEndSegments: RenderedSegmentRect[] = [
      {
        type: 'single',
        rect: rect(20, 120),
        firstTab: outside,
        lastTab: outside,
        tabs: [outside],
      },
      {
        type: 'group',
        groupId: 'grp-1',
        collapsed: false,
        rect: rect(126, 386),
        chipRect: rect(132, 192),
        firstTab: g1,
        lastTab: g2,
        tabs: [g1, g2],
      },
    ];
    const groupAtEndTabRects: RenderedTabRect[] = [
      { tab: outside, rect: rect(20, 120) },
      { tab: g1, rect: rect(196, 286) },
      { tab: g2, rect: rect(290, 380) },
    ];

    expect(
      resolveTabBarDropTarget({
        clientX: 520,
        source: dragG1,
        tabs: [outside, g1, g2],
        tabRects: groupAtEndTabRects,
        segmentRects: groupAtEndSegments,
      })
    ).toEqual({
      kind: 'tab',
      targetTabId: 'g2',
      position: 'after',
      outsideGroup: true,
    });
  });

  it('resolve corretamente extremidades de grupo recolhido sem abas visíveis', () => {
    const g1 = makeTab('g1', 'grp-col');
    const g2 = makeTab('g2', 'grp-col');
    const other = makeTab('other');
    const tabs = [other, g1, g2];

    const segmentRects: RenderedSegmentRect[] = [
      {
        type: 'single',
        rect: rect(20, 120),
        firstTab: other,
        lastTab: other,
        tabs: [other],
      },
      {
        type: 'group',
        groupId: 'grp-col',
        collapsed: true,
        rect: rect(126, 210),
        chipRect: rect(132, 204),
        firstTab: g1,
        lastTab: g2,
        tabs: [g1, g2],
      },
    ];

    expect(
      resolveTabBarDropTarget({
        clientX: 450,
        source: { type: 'tab', id: 'other' },
        tabs,
        tabRects: [{ tab: other, rect: rect(20, 120) }],
        segmentRects,
      })
    ).toEqual({
      kind: 'tab',
      targetTabId: 'g2',
      position: 'after',
      outsideGroup: true,
    });
  });
});
