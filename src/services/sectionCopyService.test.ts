import { describe, it, expect } from 'vitest';
import { extractSectionMarkdownByHeadingIndex } from './sectionCopyService';
import {
  HIGHLIGHT_COMMENTS_START_MARKER,
  HIGHLIGHT_COMMENTS_END_MARKER,
} from './highlightCommentsService';

describe('sectionCopyService', () => {
  const sampleDoc = [
    '# Catálogo Principal',
    '',
    'Introdução geral.',
    '',
    '## Direito Administrativo',
    '',
    'Texto inicial com <mark data-id="hl-1" class="yellow">grifo importante</mark>.',
    '',
    '### Atos Administrativos',
    '',
    '```markdown',
    '# Comentário dentro de bloco de código não é título',
    '```',
    '',
    '- Item 1',
    '- Item 2',
    '',
    '## Direito Agrário',
    '',
    'Conteúdo de Direito Agrário.',
    '',
    HIGHLIGHT_COMMENTS_START_MARKER,
    '<!-- hl-1: nota privada -->',
    HIGHLIGHT_COMMENTS_END_MARKER,
  ].join('\n');

  it('extrai seção H2 incluindo suas subseções H3 e ignora # dentro de blocos de código', () => {
    // Índices: 0 = # Catálogo Principal, 1 = ## Direito Administrativo, 2 = ### Atos Administrativos, 3 = ## Direito Agrário
    const extracted = extractSectionMarkdownByHeadingIndex(sampleDoc, 1);

    expect(extracted).toBe(
      [
        '## Direito Administrativo',
        '',
        'Texto inicial com grifo importante.',
        '',
        '### Atos Administrativos',
        '',
        '```markdown',
        '# Comentário dentro de bloco de código não é título',
        '```',
        '',
        '- Item 1',
        '- Item 2',
      ].join('\n')
    );
  });

  it('extrai a última seção do documento excluindo o bloco oculto de comentários de grifos', () => {
    const extracted = extractSectionMarkdownByHeadingIndex(sampleDoc, 3);

    expect(extracted).toBe(
      ['## Direito Agrário', '', 'Conteúdo de Direito Agrário.'].join('\n')
    );
  });

  it('extrai subseção isolada até o próximo título de nível igual ou superior', () => {
    const extracted = extractSectionMarkdownByHeadingIndex(sampleDoc, 2);

    expect(extracted).toBe(
      [
        '### Atos Administrativos',
        '',
        '```markdown',
        '# Comentário dentro de bloco de código não é título',
        '```',
        '',
        '- Item 1',
        '- Item 2',
      ].join('\n')
    );
  });

  it('retorna null para índice inválido ou documento vazio', () => {
    expect(extractSectionMarkdownByHeadingIndex(sampleDoc, -1)).toBeNull();
    expect(extractSectionMarkdownByHeadingIndex(sampleDoc, 99)).toBeNull();
    expect(extractSectionMarkdownByHeadingIndex('', 0)).toBeNull();
  });
});
