import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveTabScrollPosition,
  getTabScrollPosition,
  consumeTabScrollPosition,
  clearTabScrollPosition,
  pruneTabScrollPositions,
  resetTabScrollPositions,
} from './tabScrollMemory';

describe('tabScrollMemory — posição de leitura independente por aba', () => {
  beforeEach(() => {
    resetTabScrollPositions();
  });

  it('retorna null para aba sem posição registrada', () => {
    expect(getTabScrollPosition('tab-desconhecida')).toBeNull();
    expect(consumeTabScrollPosition('tab-desconhecida')).toBeNull();
  });

  it('mantém posições independentes entre abas (cenário documento grande vs pequeno)', () => {
    saveTabScrollPosition('tab-pequena', 0, 'doc-small');
    saveTabScrollPosition('tab-grande', 5400, 'doc-large');

    expect(getTabScrollPosition('tab-grande', 'doc-large')).toBe(5400);
    expect(getTabScrollPosition('tab-pequena', 'doc-small')).toBe(0);

    // Leitura não-destrutiva: continua disponível após múltiplas consultas (ex.: ida e volta da aba Início)
    expect(getTabScrollPosition('tab-grande', 'doc-large')).toBe(5400);

    expect(consumeTabScrollPosition('tab-grande')).toBe(5400);
    expect(consumeTabScrollPosition('tab-pequena')).toBe(0);
  });

  it('invalida a posição salva se a mesma aba passou a exibir outro docId', () => {
    saveTabScrollPosition('tab-1', 3200, 'doc-antigo');

    expect(getTabScrollPosition('tab-1', 'doc-antigo')).toBe(3200);
    expect(getTabScrollPosition('tab-1', 'doc-novo')).toBeNull();
  });

  it('consome o valor: a segunda leitura de consumeTabScrollPosition retorna null', () => {
    saveTabScrollPosition('tab-1', 300);
    expect(consumeTabScrollPosition('tab-1')).toBe(300);
    expect(consumeTabScrollPosition('tab-1')).toBeNull();
  });

  it('sobrescreve a posição anterior da mesma aba preservando docId quando omitido', () => {
    saveTabScrollPosition('tab-1', 100, 'doc-1');
    saveTabScrollPosition('tab-1', 900);
    expect(getTabScrollPosition('tab-1', 'doc-1')).toBe(900);
    expect(consumeTabScrollPosition('tab-1', 'doc-1')).toBe(900);
  });

  it('clearTabScrollPosition remove apenas a aba informada', () => {
    saveTabScrollPosition('tab-1', 450, 'doc-1');
    saveTabScrollPosition('tab-2', 1200, 'doc-2');

    clearTabScrollPosition('tab-1');

    expect(getTabScrollPosition('tab-1')).toBeNull();
    expect(getTabScrollPosition('tab-2')).toBe(1200);
  });

  it('normaliza valores inválidos, negativos e fracionados', () => {
    saveTabScrollPosition('tab-nan', Number.NaN);
    saveTabScrollPosition('tab-neg', -50);
    saveTabScrollPosition('tab-frac', 120.6);

    expect(consumeTabScrollPosition('tab-nan')).toBe(0);
    expect(consumeTabScrollPosition('tab-neg')).toBe(0);
    expect(consumeTabScrollPosition('tab-frac')).toBe(121);
  });

  it('ignora tabId vazio', () => {
    saveTabScrollPosition('', 500);
    expect(getTabScrollPosition('')).toBeNull();
    expect(consumeTabScrollPosition('')).toBeNull();
  });

  it('remove posições de abas fechadas e preserva as abertas', () => {
    saveTabScrollPosition('tab-1', 10);
    saveTabScrollPosition('tab-2', 20);
    saveTabScrollPosition('tab-3', 30);

    pruneTabScrollPositions(['tab-1', 'tab-3']);

    expect(consumeTabScrollPosition('tab-2')).toBeNull();
    expect(consumeTabScrollPosition('tab-1')).toBe(10);
    expect(consumeTabScrollPosition('tab-3')).toBe(30);
  });
});
