import { describe, it, expect } from 'vitest';
import {
  isInternalAnchorHref,
  isSafeLinkHref,
  slugifyHeadingGitHub,
  normalizeLooseSlug,
  findHeadingIndexByAnchor,
} from './headingAnchorService';
import type { TocHeadingItem } from './tocService';

function makeHeadings(texts: string[]): TocHeadingItem[] {
  return texts.map((text, index) => ({
    id: `h-${index}-2`,
    index,
    level: 2,
    text,
  }));
}

describe('headingAnchorService', () => {
  describe('isInternalAnchorHref', () => {
    it('identifica âncoras internas válidas', () => {
      expect(isInternalAnchorHref('#direito-administrativo')).toBe(true);
      expect(isInternalAnchorHref('  #secao  ')).toBe(true);
    });

    it('rejeita # vazio ou links externos', () => {
      expect(isInternalAnchorHref('#')).toBe(false);
      expect(isInternalAnchorHref('')).toBe(false);
      expect(isInternalAnchorHref('https://example.com#abc')).toBe(false);
    });
  });

  describe('isSafeLinkHref', () => {
    it('permite âncoras e protocolos seguros', () => {
      expect(isSafeLinkHref('#titulo')).toBe(true);
      expect(isSafeLinkHref('https://example.com')).toBe(true);
      expect(isSafeLinkHref('http://localhost:3000')).toBe(true);
      expect(isSafeLinkHref('MAILTO:teste@exemplo.com')).toBe(true);
      expect(isSafeLinkHref('tel:+5511999999999')).toBe(true);
    });

    it('bloqueia protocolos perigosos ou desconhecidos', () => {
      expect(isSafeLinkHref('javascript:alert(1)')).toBe(false);
      expect(isSafeLinkHref('  JaVaScRiPt:void(0)')).toBe(false);
      expect(isSafeLinkHref('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isSafeLinkHref('vbscript:msgbox(1)')).toBe(false);
      expect(isSafeLinkHref('ftp://files.example.com')).toBe(false);
      expect(isSafeLinkHref('')).toBe(false);
    });
  });

  describe('slugifyHeadingGitHub & normalizeLooseSlug', () => {
    it('gera slug GFM preservando acentos e removendo pontuação', () => {
      expect(slugifyHeadingGitHub('Direito Agrário')).toBe('direito-agrário');
      expect(slugifyHeadingGitHub('Direito Econômico')).toBe('direito-econômico');
      expect(
        slugifyHeadingGitHub(
          'Direito da Criança e do Adolescente - Estatuto da Criança e do Adolescente (ECA) - Lei nº 8.069 de 1990'
        )
      ).toBe(
        'direito-da-criança-e-do-adolescente---estatuto-da-criança-e-do-adolescente-eca---lei-n-8069-de-1990'
      );
    });

    it('normaliza slug de forma tolerante sem acentos e sem hífens duplicados', () => {
      expect(normalizeLooseSlug('Direito Agrário')).toBe('direito-agrario');
      expect(normalizeLooseSlug('direito-agr%C3%A1rio')).toBe('direito-agrario');
    });
  });

  describe('findHeadingIndexByAnchor', () => {
    const headings = makeHeadings([
      'Direito Administrativo',
      'Direito Agrário',
      'Direito da Criança e do Adolescente - Estatuto da Criança e do Adolescente (ECA) - Lei nº 8.069 de 1990',
      'Direito Econômico',
      'Direito Empresarial (Comercial)',
      'Introdução',
      'Introdução',
      'Introdução',
    ]);

    it('encontra títulos com acentos exatos e URL-encoded', () => {
      expect(findHeadingIndexByAnchor(headings, '#direito-agrário')).toBe(1);
      expect(findHeadingIndexByAnchor(headings, '#direito-agr%C3%A1rio')).toBe(1);
      expect(findHeadingIndexByAnchor(headings, '#direito-econômico')).toBe(3);
    });

    it('encontra título via fallback sem acento', () => {
      expect(findHeadingIndexByAnchor(headings, '#direito-agrario')).toBe(1);
      expect(findHeadingIndexByAnchor(headings, '#direito-economico')).toBe(3);
    });

    it('encontra título complexo com ordinal e hífens colapsados (caso real ECA)', () => {
      expect(
        findHeadingIndexByAnchor(
          headings,
          '#direito-da-criança-e-do-adolescente-estatuto-da-criança-e-do-adolescente-eca-lei-n-8069-de-1990'
        )
      ).toBe(2);
    });

    it('encontra título com parênteses', () => {
      expect(findHeadingIndexByAnchor(headings, '#direito-empresarial-comercial')).toBe(4);
    });

    it('suporta deduplicação GitHub (-1, -2) para títulos repetidos', () => {
      expect(findHeadingIndexByAnchor(headings, '#introdução')).toBe(5);
      expect(findHeadingIndexByAnchor(headings, '#introdução-1')).toBe(6);
      expect(findHeadingIndexByAnchor(headings, '#introdução-2')).toBe(7);
      expect(findHeadingIndexByAnchor(headings, '#introducao-2')).toBe(7);
    });

    it('retorna -1 quando não encontra correspondência', () => {
      expect(findHeadingIndexByAnchor(headings, '#inexistente')).toBe(-1);
      expect(findHeadingIndexByAnchor([], '#direito-agrário')).toBe(-1);
    });
  });
});
