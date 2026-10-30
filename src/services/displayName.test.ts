import { describe, it, expect } from 'vitest';
import { splitDisplayName } from './displayName';

describe('splitDisplayName', () => {
  it('1. retorna nome curto sem divisão na cauda', () => {
    const result = splitDisplayName('Aula.md');
    expect(result).toEqual({ head: 'Aula.md', tail: '' });
  });

  it('2. garante que head + tail === name para vários tipos de strings', () => {
    const testCases = [
      'Documento de Estudo para Concurso Público de Alto Nível.md',
      'NomeSemExtensaoMuitoLongoParaTesteDeCorteNoMeioComTamanhoGrande',
      'Artigo-Cientifico-Sobre-Estruturas-De-Dados.markdown',
      'Relatório Financeiro Trimestral 🚀 Análise de Investimentos 📈 2026.md',
      '...............',
      'arquivo.txt',
      'a',
      '',
    ];

    for (const name of testCases) {
      const { head, tail } = splitDisplayName(name);
      expect(head + tail).toBe(name);
    }
  });

  it('3. divide corretamente o nome do exemplo da especificação', () => {
    const fullName =
      'Controle da Administração Pública e Tutela Jurisdicional da Fazenda Pública - Mapeamento e Cronograma.md';
    const { head, tail } = splitDisplayName(fullName);

    expect(tail.endsWith('Cronograma.md')).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(24);
    expect(head.length).toBeGreaterThan(0);
    expect(head + tail).toBe(fullName);
  });

  it('4. nome sem extensão longo limita a cauda em 24 caracteres', () => {
    const longNameNoExt = 'ProjetoDePesquisaSuperLongoParaTestarTruncamentoSemNenhumaExtensao';
    const { head, tail } = splitDisplayName(longNameNoExt);

    expect(tail.length).toBeLessThanOrEqual(24);
    expect(tail.length).toBeGreaterThanOrEqual(20);
    expect(head + tail).toBe(longNameNoExt);
  });

  it('5. extensão longa (> 8 chars) não é tratada como extensão de arquivo', () => {
    const nameWithLongExt = 'arquivo-muito-grande-de-teste.umaextensaomuitolonga';
    const { head, tail } = splitDisplayName(nameWithLongExt);

    expect(head + tail).toBe(nameWithLongExt);
    expect(tail.length).toBeLessThanOrEqual(24);
  });

  it('6. emoji na fronteira de corte não gera surrogate solto', () => {
    // Testa vários comprimentos com emoji para garantir que se o corte cair no meio de um surrogate, ele seja preservado
    for (let pad = 0; pad < 30; pad++) {
      const name = `${'A'.repeat(pad)}🚀${'B'.repeat(40)}.md`;
      const { head, tail } = splitDisplayName(name);

      expect(head + tail).toBe(name);

      if (head.length > 0) {
        const lastCode = head.charCodeAt(head.length - 1);
        const isDanglingHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff;
        expect(isDanglingHighSurrogate).toBe(false);
      }

      if (tail.length > 0) {
        const firstCode = tail.charCodeAt(0);
        const isDanglingLowSurrogate = firstCode >= 0xdc00 && firstCode <= 0xdfff;
        expect(isDanglingLowSurrogate).toBe(false);
      }
    }
  });

  it('7. string vazia retorna head e tail vazios', () => {
    const result = splitDisplayName('');
    expect(result).toEqual({ head: '', tail: '' });
  });
});
