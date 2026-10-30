import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveTabScrollPosition,
  consumeTabScrollPosition,
  pruneTabScrollPositions,
  resetTabScrollPositions,
} from './tabScrollMemory';

describe('tabScrollMemory — posição de leitura independente por aba', () => {
  beforeEach(() => {
    resetTabScrollPositions();
  });

  it('retorna null para aba sem posição registrada', () => {
    expect(consumeTabScrollPosition('tab-desconhecida')).toBeNull();
  });

  it('mantém posições independentes entre abas (cenário do usuário)', () => {
    saveTabScrollPosition('tab-1', 0);
    saveTabScrollPosition('tab-2', 5400);

    expect(consumeTabScrollPosition('tab-2')).toBe(5400);
    expect(consumeTabScrollPosition('tab-1')).toBe(0);
  });

  it('consome o valor: a segunda leitura retorna null', () => {
    saveTabScrollPosition('tab-1', 300);
    expect(consumeTabScrollPosition('tab-1')).toBe(300);
    expect(consumeTabScrollPosition('tab-1')).toBeNull();
  });

  it('sobrescreve a posição anterior da mesma aba', () => {
    saveTabScrollPosition('tab-1', 100);
    saveTabScrollPosition('tab-1', 900);
    expect(consumeTabScrollPosition('tab-1')).toBe(900);
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
