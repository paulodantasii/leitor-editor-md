import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatSequentialHighlightId,
  parseSequentialHighlightId,
  scanHighlightsInMarkdown,
  scanHighlightsInProseMirrorDoc,
  generateNextHighlightId,
  findLatestHighlightInfo,
  resetHighlightIdMemory,
} from './highlightIdService';

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
});
