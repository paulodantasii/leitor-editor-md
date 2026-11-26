import { describe, it, expect } from 'vitest';
import {
  WORDS_PER_PAGE,
  analyzePlainText,
  computeDocumentReadingMap,
  computeReadingEstimates,
  estimateCurrentWordOffset,
  formatLastModifiedCompact,
  formatLastModifiedFull,
  formatReadingDuration,
  resolveActiveSectionRange,
  resolveDocumentLastModifiedTimestamp,
} from './readingStatsService';
import { extractHeadingsFromMarkdown } from './tocService';

describe('readingStatsService', () => {
  it('conta palavras e caracteres ignorando tags <mark> e o bloco oculto de comentários', () => {
    const md = [
      '# Capítulo Único',
      '',
      'Texto com <mark data-id="00001" class="yellow">acentuação em português</mark> e **negrito**.',
      '',
      'Veja também [este link](https://exemplo.com) agora.',
      '',
      '<!-- HIGHLIGHT_COMMENTS_START -->',
      '---',
      '**Comentários dos Grifos**',
      '',
      '- **[00001]**: Comentário privado que não deve entrar na contagem de leitura',
      '<!-- HIGHLIGHT_COMMENTS_END -->',
    ].join('\n');

    const map = computeDocumentReadingMap(md);

    // "Capítulo Único" (2) + "Texto com acentuação em português e negrito." (7) + "Veja também este link agora." (5) = 14
    expect(map.wordCount).toBe(14);
    expect(map.charCount).toBeGreaterThan(60);
    expect(map.charCountNoSpaces).toBeLessThan(map.charCount);
    expect(map.totalPages).toBe(1);
    expect(map.sections).toHaveLength(1);
    expect(map.sections[0].title).toBe('Capítulo Único');
  });

  it('mantém paridade 1:1 com extractHeadingsFromMarkdown ignorando # dentro de code fences', () => {
    const md = [
      '# Introdução',
      'Primeiro parágrafo com cinco palavras.',
      '',
      '```bash',
      '# comentário em bash não é título',
      'echo "olá"',
      '```',
      '',
      '## Desenvolvimento',
      'Mais conteúdo para desenvolver o tema principal.',
    ].join('\n');

    const map = computeDocumentReadingMap(md);
    const tocHeadings = extractHeadingsFromMarkdown(md);

    expect(map.sections.map((s) => ({ index: s.headingIndex, title: s.title }))).toEqual(
      tocHeadings.map((h) => ({ index: h.index, title: h.text }))
    );
  });

  it('estende seção container curta (< 15 palavras) até o próximo título de mesmo nível ou superior', () => {
    const md = [
      '# Parte 1',
      '## Seção 1.1',
      Array.from({ length: 40 }, (_, i) => `palavra${i}`).join(' '),
      '# Parte 2',
      'Texto final.',
    ].join('\n\n');

    const map = computeDocumentReadingMap(md);
    const range = resolveActiveSectionRange(map.sections, 0);

    expect(range).not.toBeNull();
    expect(range!.title).toBe('Parte 1');
    expect(range!.endWordOffset).toBe(map.sections[2].startWordOffset);
  });

  it('analisa texto selecionado corretamente com e sem espaços', () => {
    const metrics = analyzePlainText('  Olá,   mundo   lindo!  ');
    expect(metrics.wordCount).toBe(3);
    expect(metrics.charCount).toBe('Olá, mundo lindo!'.length);
    expect(metrics.charCountNoSpaces).toBe('Olá,mundolindo!'.length);
  });

  it('calcula páginas estimadas, tempo restante da seção e horário de término', () => {
    const wordsPerSection = WORDS_PER_PAGE * 2; // 550 palavras por seção + 4 dos títulos = 1104 palavras => 5 páginas
    const sec1 = Array.from({ length: wordsPerSection }, () => 'texto').join(' ');
    const sec2 = Array.from({ length: wordsPerSection }, () => 'leitura').join(' ');
    const md = `# Seção A\n\n${sec1}\n\n# Seção B\n\n${sec2}`;

    const map = computeDocumentReadingMap(md);
    expect(map.totalPages).toBe(5);

    // No meio da Seção A (~275 palavras lidas) a 130 ppm
    const nowMs = new Date(2026, 10, 26, 14, 0, 0).getTime();
    const estimates = computeReadingEstimates({
      map,
      scrollProgress: 25,
      scrollRatio: 0.25,
      activeHeadingIndex: 0,
      wpm: 130,
      nowMs,
      activeSectionProgress: {
        sectionStartWord: map.sections[0].startWordOffset,
        sectionEndWord: map.sections[0].endWordOffset,
        sectionRatio: 0.5,
      },
    });

    expect(estimates.currentPage).toBe(2);
    expect(estimates.totalPages).toBe(5);
    expect(estimates.sectionRemainingSeconds).toBeGreaterThan(60);
    expect(estimates.remainingSeconds).toBeGreaterThan(estimates.sectionRemainingSeconds!);
    expect(estimates.estimatedFinishTime).toMatch(/^\d{2}:\d{2}$/);

    // No fim do documento (100%)
    const atEnd = computeReadingEstimates({
      map,
      scrollProgress: 100,
      scrollRatio: 1,
      activeHeadingIndex: 1,
      wpm: 130,
      nowMs,
    });
    expect(atEnd.currentPage).toBe(5);
    expect(atEnd.remainingSeconds).toBe(0);
    expect(atEnd.estimatedFinishTime).toBeNull();
  });

  it('estima offset de palavras nos extremos e no fallback sem seção', () => {
    expect(estimateCurrentWordOffset(1000, 0)).toBe(0);
    expect(estimateCurrentWordOffset(1000, 1)).toBe(1000);
    expect(estimateCurrentWordOffset(1000, 0.5)).toBe(500);
  });

  it('formata durações de leitura corretamente', () => {
    expect(formatReadingDuration(0)).toBe('Fim');
    expect(formatReadingDuration(30, { isAtEnd: true })).toBe('Fim');
    expect(formatReadingDuration(25)).toBe('<1 min');
    expect(formatReadingDuration(180)).toBe('3 min');
    expect(formatReadingDuration(4500)).toBe('1h 15min');
    expect(formatReadingDuration(3600)).toBe('1h');
  });

  it('resolve e formata data da última modificação respeitando isDirty e fontes', () => {
    const cloudIso = '2026-11-25T18:30:00.000Z';
    const localEditMs = new Date(2026, 10, 26, 13, 45, 0).getTime();

    expect(
      resolveDocumentLastModifiedTimestamp({
        isDirty: true,
        lastModifiedAt: localEditMs,
        cloudLastModified: cloudIso,
        localLastModified: 1000,
      })
    ).toBe(localEditMs);

    expect(
      resolveDocumentLastModifiedTimestamp({
        isDirty: false,
        lastModifiedAt: localEditMs,
        cloudLastModified: cloudIso,
        localLastModified: 1000,
      })
    ).toBe(Date.parse(cloudIso));

    const nowMs = new Date(2026, 10, 26, 14, 10, 0).getTime();
    const todayMs = new Date(2026, 10, 26, 9, 5, 0).getTime();
    const yesterdayMs = new Date(2026, 10, 25, 21, 15, 0).getTime();
    const sameYearMs = new Date(2026, 9, 3, 10, 0, 0).getTime();
    const prevYearMs = new Date(2025, 4, 12, 8, 30, 0).getTime();

    expect(formatLastModifiedCompact(todayMs, nowMs)).toBe('Hoje, 09:05');
    expect(formatLastModifiedCompact(yesterdayMs, nowMs)).toBe('Ontem, 21:15');
    expect(formatLastModifiedCompact(sameYearMs, nowMs)).toBe('03/10, 10:00');
    expect(formatLastModifiedCompact(prevYearMs, nowMs)).toBe('12/05/2025');
    expect(formatLastModifiedFull(todayMs)).toBe('26/11/2026 às 09:05');
  });
});
