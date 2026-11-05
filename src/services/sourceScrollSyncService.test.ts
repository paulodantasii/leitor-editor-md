import { describe, it, expect } from 'vitest';
import {
  lerp,
  inverseLerp,
  computePiecewiseAnchorFromStops,
  resolveTargetYFromPiecewiseAnchor,
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
});
