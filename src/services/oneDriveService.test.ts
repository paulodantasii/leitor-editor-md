import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeMarkdownFileName,
  computeNextAvailableFileName,
  createOneDriveFile,
} from './oneDriveService';
import * as msalService from './msalService';

describe('Fase 4b: Salvar como no OneDrive e Resolução de Nomes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeMarkdownFileName', () => {
    it('adiciona extensão .md quando ausente', () => {
      expect(normalizeMarkdownFileName('Minhas Notas')).toBe('Minhas Notas.md');
      expect(normalizeMarkdownFileName('Relatorio')).toBe('Relatorio.md');
    });

    it('preserva extensões válidas (.md, .markdown, .txt)', () => {
      expect(normalizeMarkdownFileName('Notas.md')).toBe('Notas.md');
      expect(normalizeMarkdownFileName('Manual.MARKDOWN')).toBe('Manual.MARKDOWN');
      expect(normalizeMarkdownFileName('log.txt')).toBe('log.txt');
    });

    it('retorna "Sem Título.md" para strings vazias ou só espaços', () => {
      expect(normalizeMarkdownFileName('')).toBe('Sem Título.md');
      expect(normalizeMarkdownFileName('   ')).toBe('Sem Título.md');
    });
  });

  describe('computeNextAvailableFileName', () => {
    it('mantém o nome original se não houver colisão', () => {
      expect(computeNextAvailableFileName('Documento.md', [])).toBe('Documento.md');
      expect(computeNextAvailableFileName('Documento.md', ['Outro.md', 'Teste.md'])).toBe('Documento.md');
    });

    it('adiciona (1) quando o nome base já existe na pasta', () => {
      const existing = ['documento.md'];
      expect(computeNextAvailableFileName('Documento.md', existing)).toBe('Documento (1).md');
    });

    it('incrementa sequencialmente (1) para (2) quando ambos existem', () => {
      const existing = ['Documento.md', 'Documento (1).md'];
      expect(computeNextAvailableFileName('Documento.md', existing)).toBe('Documento (2).md');
    });

    it('ignora diferenças de maiúsculas/minúsculas (case-insensitive)', () => {
      const existing = ['DOCUMENTO.MD', 'documento (1).md'];
      expect(computeNextAvailableFileName('documento.md', existing)).toBe('documento (2).md');
    });

    it('incrementa adequadamente quando o próprio nome de entrada já tem numeração', () => {
      const existing = ['Notas (1).md'];
      expect(computeNextAvailableFileName('Notas (1).md', existing)).toBe('Notas (2).md');
    });

    it('preenche primeiro buraco livre na sequência', () => {
      const existing = ['Doc.md', 'Doc (2).md'];
      expect(computeNextAvailableFileName('Doc.md', existing)).toBe('Doc (1).md');
    });

    it('preserva extensões personalizadas como .txt ao adicionar numeração', () => {
      const existing = ['Arquivo.txt'];
      expect(computeNextAvailableFileName('Arquivo.txt', existing)).toBe('Arquivo (1).txt');
    });
  });

  describe('createOneDriveFile', () => {
    it('cria arquivo com sucesso enviando conflito fail para Microsoft Graph', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'item-123',
          name: 'Novo Documento.md',
          lastModifiedDateTime: '2026-10-21T10:00:00Z',
          eTag: 'etag-123',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await createOneDriveFile('folder-abc', 'Novo Documento.md', '# Conteudo', []);

      expect(result.id).toBe('item-123');
      expect(result.name).toBe('Novo Documento.md');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [calledUrl, options] = mockFetch.mock.calls[0];
      expect(calledUrl).toContain('/me/drive/items/folder-abc:/Novo%20Documento.md:/content');
      expect(calledUrl).toContain('@microsoft.graph.conflictBehavior=fail');
      expect(options.headers['Authorization']).toBe('Bearer mock-token');
      expect(options.body).toBe('# Conteudo');
    });

    it('recupera de concorrência com 409 tentando o próximo número até sucesso', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Primeiro envio de Teste.md colide com 409
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
          });
        }
        // Segundo envio de Teste (1).md dá ok
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'item-456',
            name: 'Teste (1).md',
            lastModifiedDateTime: '2026-10-21T10:00:00Z',
            eTag: 'etag-456',
          }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await createOneDriveFile(undefined, 'Teste.md', '# Conteudo', []);

      expect(callCount).toBe(2);
      expect(result.id).toBe('item-456');
      expect(result.name).toBe('Teste (1).md');
    });
  });
});
