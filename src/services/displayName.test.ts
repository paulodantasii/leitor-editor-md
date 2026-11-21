import { describe, it, expect } from 'vitest';
import { splitDisplayName, abbreviateMiddle } from './displayName';

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

  it('8. preserva espaço e prefere corte em fronteira de palavra (regressão Direito Digital / Direito das Famílias)', () => {
    const digital = splitDisplayName('Direito Digital');
    expect(digital.head + digital.tail).toBe('Direito Digital');
    expect(digital.head).toBe('Direito ');
    expect(digital.tail).toBe('Digital');

    const familias = splitDisplayName('Direito das Famílias.md');
    expect(familias.head + familias.tail).toBe('Direito das Famílias.md');
    expect(familias.head).toBe('Direito das ');
    expect(familias.tail).toBe('Famílias.md');

    const constitucional = splitDisplayName('Direito Constitucional');
    expect(constitucional.head + constitucional.tail).toBe('Direito Constitucional');
    expect(constitucional.head.endsWith(' ')).toBe(true);
    expect(constitucional.tail).toBe('Constitucional');
  });
});

describe('abbreviateMiddle', () => {
  it('1. retorna nomes que cabem no limite sem abreviação', () => {
    expect(abbreviateMiddle('Aula.md', 18)).toBe('Aula.md');
    expect(abbreviateMiddle('Direito Digital', 18)).toBe('Direito Digital');
    expect(abbreviateMiddle('Direito das Famílias.md', 48)).toBe('Direito das Famílias.md');
    expect(abbreviateMiddle('Direito das Famílias.md', 28)).toBe('Direito das Famílias.md');
  });

  it('2. abrevia nomes longos mantendo início, fim e extensão dentro do limite + 2', () => {
    const longName = 'Direito das Famílias - Mapeamento e Cronograma.md';

    const compact = abbreviateMiddle(longName, 32);
    expect(Array.from(compact).length).toBeLessThanOrEqual(34);
    expect(compact.startsWith('Direito')).toBe(true);
    expect(compact.endsWith('Cronograma.md')).toBe(true);
    expect(compact.includes('…')).toBe(true);

    const active = abbreviateMiddle(longName, 48);
    expect(Array.from(active).length).toBeLessThanOrEqual(50);
    expect(active.startsWith('Direito das Famílias')).toBe(true);
    expect(active.endsWith('Cronograma.md')).toBe(true);
    expect(active.includes('…')).toBe(true);

    const narrow = abbreviateMiddle(longName, 18);
    expect(Array.from(narrow).length).toBeLessThanOrEqual(20);
    expect(narrow.endsWith('.md')).toBe(true);
    expect(narrow.includes('…')).toBe(true);
  });

  it('3. abrevia nomes longos sem espaços respeitando o limite', () => {
    const noSpaces = 'ProjetoDePesquisaSuperLongoParaTestarTruncamentoSemNenhumaExtensao';
    const result = abbreviateMiddle(noSpaces, 28);
    expect(Array.from(result).length).toBeLessThanOrEqual(30);
    expect(result.startsWith('Projeto')).toBe(true);
    expect(result.endsWith('Extensao')).toBe(true);
    expect(result.includes('…')).toBe(true);
  });

  it('4. nomes com emojis não geram surrogates soltos', () => {
    for (let maxChars = 10; maxChars <= 35; maxChars++) {
      const name = 'Relatório 🚀 Financeiro Trimestral 📈 Análise de Investimentos 2026.md';
      const result = abbreviateMiddle(name, maxChars);

      for (let i = 0; i < result.length; i++) {
        const code = result.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = result.charCodeAt(i + 1);
          expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
        }
        if (code >= 0xdc00 && code <= 0xdfff) {
          const prev = result.charCodeAt(i - 1);
          expect(prev >= 0xd800 && prev <= 0xdbff).toBe(true);
        }
      }
    }
  });

  it('5. string vazia retorna string vazia', () => {
    expect(abbreviateMiddle('', 28)).toBe('');
    expect(abbreviateMiddle('', 0)).toBe('');
  });
});
