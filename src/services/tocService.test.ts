import { describe, it, expect, beforeEach } from 'vitest';
import {
  cleanHeadingText,
  extractHeadingsFromMarkdown,
  computeBreadcrumbTrail,
  findActiveHeadingIndexByTops,
  updateTocState,
  getTocSnapshot,
  resetTocState,
} from './tocService';

describe('tocService', () => {
  beforeEach(() => {
    resetTocState();
  });

  describe('cleanHeadingText', () => {
    it('remove tags HTML (<mark>, <u>) e formatações Markdown inline mantendo o texto limpo', () => {
      const raw = '1. **Casamento**: <mark class="yellow" data-id="00001">Teoria Geral</mark> e *Validade*';
      expect(cleanHeadingText(raw)).toBe('1. Casamento: Teoria Geral e Validade');
    });
  });

  describe('extractHeadingsFromMarkdown', () => {
    it('extrai títulos H1 a H6 na ordem correta e ignora # dentro de blocos de código', () => {
      const md = [
        '# Direito das Famílias',
        'Texto introdutório.',
        '```python',
        '# Comentário dentro de código que NÃO é título',
        '## Outro comentário',
        '```',
        '## 1. Casamento: Teoria Geral',
        '### 1.1 Existência e Validade',
        '## 2. União Estável',
      ].join('\n');

      const headings = extractHeadingsFromMarkdown(md);
      expect(headings).toHaveLength(4);
      expect(headings.map((h) => ({ level: h.level, text: h.text }))).toEqual([
        { level: 1, text: 'Direito das Famílias' },
        { level: 2, text: '1. Casamento: Teoria Geral' },
        { level: 3, text: '1.1 Existência e Validade' },
        { level: 2, text: '2. União Estável' },
      ]);
    });
  });

  describe('computeBreadcrumbTrail', () => {
    const sampleMd = [
      '# Direito das Famílias',
      '## 1. Casamento',
      '### 1.1 Impedimentos',
      '#### 1.1.1 Causas Suspensivas',
      '## 2. União Estável',
      '### 2.1 Regime de Bens',
      '# Direito das Sucessões',
      '## 1. Sucessão em Geral',
    ].join('\n');

    const headings = extractHeadingsFromMarkdown(sampleMd);

    it('exibe apenas [H1] quando está no primeiro H1', () => {
      const trail = computeBreadcrumbTrail(headings, 0);
      expect(trail.map((h) => h.text)).toEqual(['Direito das Famílias']);
    });

    it('exibe [H1 > H2] quando entra no primeiro H2', () => {
      const trail = computeBreadcrumbTrail(headings, 1);
      expect(trail.map((h) => h.text)).toEqual([
        'Direito das Famílias',
        '1. Casamento',
      ]);
    });

    it('exibe [H1 > H2 > H3 > H4] quando aprofunda em subtítulos', () => {
      const trail = computeBreadcrumbTrail(headings, 3);
      expect(trail.map((h) => h.text)).toEqual([
        'Direito das Famílias',
        '1. Casamento',
        '1.1 Impedimentos',
        '1.1.1 Causas Suspensivas',
      ]);
    });

    it('substitui o H2 anterior quando passa para o próximo H2 do mesmo H1', () => {
      const trail = computeBreadcrumbTrail(headings, 4);
      expect(trail.map((h) => h.text)).toEqual([
        'Direito das Famílias',
        '2. União Estável',
      ]);
    });

    it('atualiza o H1 raiz quando passa para um novo H1 mais adiante no documento', () => {
      const trail = computeBreadcrumbTrail(headings, 7);
      expect(trail.map((h) => h.text)).toEqual([
        'Direito das Sucessões',
        '1. Sucessão em Geral',
      ]);
    });
  });

  describe('findActiveHeadingIndexByTops', () => {
    it('retorna o último título cujo topo já cruzou a linha de leitura (thresholdY)', () => {
      const tops = [120, 450, 900, 1400];
      expect(findActiveHeadingIndexByTops(tops, 80)).toBe(0); // antes do 1º título -> foca no 0
      expect(findActiveHeadingIndexByTops(tops, 150)).toBe(0);
      expect(findActiveHeadingIndexByTops(tops, 450)).toBe(1);
      expect(findActiveHeadingIndexByTops(tops, 700)).toBe(1);
      expect(findActiveHeadingIndexByTops(tops, 1100)).toBe(2);
      expect(findActiveHeadingIndexByTops(tops, 2000)).toBe(3);
    });
  });

  describe('state subscription & immutability', () => {
    it('atualiza e reseta o snapshot de TOC corretamente', () => {
      const headings = extractHeadingsFromMarkdown('# A\n## B');
      updateTocState(headings, 1);
      expect(getTocSnapshot().headings).toHaveLength(2);
      expect(getTocSnapshot().activeIndex).toBe(1);

      resetTocState();
      expect(getTocSnapshot().headings).toHaveLength(0);
      expect(getTocSnapshot().activeIndex).toBe(-1);
    });
  });
});
