import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  lerp,
  inverseLerp,
  computePiecewiseAnchorFromStops,
  resolveTargetYFromPiecewiseAnchor,
  captureVisualScrollAnchor,
  resolveVisualTargetScrollY,
} from './sourceScrollSyncService';

describe('sourceScrollSyncService — Mapeamento Bidirecional de Scroll (Piecewise Linear)', () => {
  describe('lerp & inverseLerp', () => {
    it('calcula interpolação linear e inversa com clamping seguro em [0..1]', () => {
      expect(lerp(100, 300, 0)).toBe(100);
      expect(lerp(100, 300, 0.5)).toBe(200);
      expect(lerp(100, 300, 1)).toBe(300);
      expect(lerp(100, 300, -0.5)).toBe(100);
      expect(lerp(100, 300, 1.5)).toBe(300);

      expect(inverseLerp(100, 300, 100)).toBe(0);
      expect(inverseLerp(100, 300, 200)).toBe(0.5);
      expect(inverseLerp(100, 300, 300)).toBe(1);
      expect(inverseLerp(100, 100, 100)).toBe(0);
    });
  });

  describe('computePiecewiseAnchorFromStops & resolveTargetYFromPiecewiseAnchor', () => {
    it('mapeia com exatidão uma posição entre dois títulos apesar de alturas totais muito diferentes', () => {
      // No Modo Visual (.ProseMirror): documento tem 10.000px de altura
      // Títulos estão em Y = [200, 1200, 4200, 8200]
      const visualStops = [200, 1200, 4200, 8200];
      const visualTop = 100;
      const visualBottom = 10100;

      // Usuário está lendo a 25% do caminho entre o Título #1 (1200) e o Título #2 (4200) -> Y = 1950
      const visualAnchorY = 1950;
      const anchor = computePiecewiseAnchorFromStops(
        visualStops,
        visualTop,
        visualBottom,
        visualAnchorY
      );

      expect(anchor.headingIndex).toBe(1);
      expect(anchor.segmentProgress).toBeCloseTo(0.25, 5);

      // No Modo Código-Fonte (<textarea>): a seção 1 tinha tabelas grandes no visual mas poucas linhas em MD,
      // e a seção 2 tem muitos <mark data-id="..."> deixando o MD mais comprido naquela parte.
      // Títulos no textarea estão em Y = [150, 600, 5600, 7000], total = 8000
      const sourceStops = [150, 600, 5600, 7000];
      const sourceTop = 100;
      const sourceBottom = 8000;

      const resolvedSourceY = resolveTargetYFromPiecewiseAnchor(
        sourceStops,
        sourceTop,
        sourceBottom,
        anchor
      );

      // 25% entre 600 e 5600 = 600 + 0.25 * 5000 = 1850
      expect(resolvedSourceY).toBeCloseTo(1850, 5);

      // Caminho inverso (Código-Fonte -> Visual) deve devolver exatamente 1950!
      const reverseAnchor = computePiecewiseAnchorFromStops(
        sourceStops,
        sourceTop,
        sourceBottom,
        resolvedSourceY
      );
      const roundTripVisualY = resolveTargetYFromPiecewiseAnchor(
        visualStops,
        visualTop,
        visualBottom,
        reverseAnchor
      );
      expect(roundTripVisualY).toBeCloseTo(visualAnchorY, 5);
    });

    it('mapeia posição antes do primeiro título (headingIndex = -1)', () => {
      const visualStops = [500, 1500];
      const anchor = computePiecewiseAnchorFromStops(visualStops, 100, 3000, 300);

      expect(anchor.headingIndex).toBe(-1);
      expect(anchor.segmentProgress).toBeCloseTo(0.5, 5); // metade entre 100 e 500

      const sourceStops = [900, 2000];
      const targetY = resolveTargetYFromPiecewiseAnchor(sourceStops, 100, 4000, anchor);
      expect(targetY).toBeCloseTo(500, 5); // metade entre 100 e 900
    });

    it('mapeia posição após o último título até o fim do documento', () => {
      const visualStops = [300, 1000];
      const anchor = computePiecewiseAnchorFromStops(visualStops, 100, 2000, 1500);

      expect(anchor.headingIndex).toBe(1);
      expect(anchor.segmentProgress).toBeCloseTo(0.5, 5); // metade entre 1000 e 2000

      const sourceStops = [250, 800];
      const targetY = resolveTargetYFromPiecewiseAnchor(sourceStops, 100, 1800, anchor);
      expect(targetY).toBeCloseTo(1300, 5); // metade entre 800 e 1800
    });

    it('usa globalProgress quando o documento não possui nenhum título', () => {
      const anchor = computePiecewiseAnchorFromStops([], 100, 2100, 600);
      expect(anchor.headingIndex).toBe(-1);
      expect(anchor.globalProgress).toBeCloseTo(0.25, 5);

      const targetY = resolveTargetYFromPiecewiseAnchor([], 100, 4100, anchor);
      expect(targetY).toBeCloseTo(1100, 5);
    });
  });

  describe('ancoragem exata por bloco (blockCharRanges)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('captura e resolve o charOffset exato do parágrafo mesmo quando blocos anteriores têm alta densidade de tags HTML', () => {
      const scrollY = 1000;
      vi.stubGlobal('window', {
        scrollY,
        innerHeight: 800,
      });
      vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '78px' }));
      vi.stubGlobal('document', {
        documentElement: { scrollHeight: 10000 },
        querySelector: () => null,
      });

      // stickyTopOffsetPx = Math.round(78 + 14) = 92; anchorDocY = 1000 + 92 + 8 = 1100
      // Bloco 0: H1 (docY 100..150, chars 0..20)
      // Bloco 1: parágrafo com dezenas de <mark> (docY 160..600, chars 22..5022 -> 5000 chars!)
      // Bloco 2: Art. 8º (docY 620..1220, chars 5024..5224 -> anchorDocY=1100 está a 80% deste bloco!)
      const blockEls = [
        { getBoundingClientRect: () => ({ top: 100 - scrollY, bottom: 150 - scrollY }), textContent: 'Cap I' },
        { getBoundingClientRect: () => ({ top: 160 - scrollY, bottom: 600 - scrollY }), textContent: 'Art 7' },
        { getBoundingClientRect: () => ({ top: 620 - scrollY, bottom: 1220 - scrollY }), textContent: 'Art 8' },
      ];
      const proseMirrorEl = {
        getBoundingClientRect: () => ({ top: 100 - scrollY, bottom: 1500 - scrollY }),
      };
      const container: any = {
        querySelector: (sel: string) => (sel === '.ProseMirror' ? proseMirrorEl : null),
        querySelectorAll: (sel: string) => {
          if (sel === ':scope .ProseMirror > *') return blockEls;
          return [blockEls[0]];
        },
      };

      const blockCharRanges = [
        { start: 0, end: 20 },
        { start: 22, end: 5022 },
        { start: 5024, end: 5224 },
      ];
      const fakeMd = '# Cap I\n\n' + 'x'.repeat(5000) + '\n\n' + 'y'.repeat(200);

      const anchor = captureVisualScrollAnchor(container, fakeMd, blockCharRanges);
      expect(anchor.hasExactCharOffset).toBe(true);
      // 80% de (5024..5224) = 5024 + 160 = 5184
      expect(anchor.markdownCharOffset).toBe(5184);

      // Caminho de volta (Código-Fonte -> Visual) deve devolver o scrollY exato (1000)
      const resolvedScrollY = resolveVisualTargetScrollY(container, anchor, blockCharRanges);
      expect(resolvedScrollY).toBe(1000);
    });
  });
});
