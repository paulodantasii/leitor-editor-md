import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeMarkdownFileName,
  computeNextAvailableFileName,
  createOneDriveFile,
  validateOneDriveName,
  createOneDriveFolder,
  renameOneDriveItem,
  deleteOneDriveItem,
  deleteOneDriveItemsBatch,
  moveOneDriveItem,
  moveOneDriveItemsBatch,
  copyOneDriveFile,
  copyOneDriveFilesBatch,
  searchOneDriveItems,
} from './oneDriveService';
import * as msalService from './msalService';

describe('OneDrive Service — Gerenciamento Completo de Arquivos e Pastas', () => {
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

  describe('validateOneDriveName', () => {
    it('rejeita strings vazias ou compostas apenas por espaços ou pontos', () => {
      expect(validateOneDriveName('').valid).toBe(false);
      expect(validateOneDriveName('   ').valid).toBe(false);
      expect(validateOneDriveName('...').valid).toBe(false);
      expect(validateOneDriveName('. . .').valid).toBe(false);
    });

    it('rejeita caracteres proibidos no OneDrive / Windows (\\ / : * ? " < > |)', () => {
      const invalidChars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
      for (const char of invalidChars) {
        const result = validateOneDriveName(`Pasta${char}Teste`);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('caracteres inválidos');
      }
    });

    it('rejeita nomes reservados de sistema DOS (CON, PRN, AUX, NUL, COM1..9, LPT1..9)', () => {
      const reserved = ['CON', 'con', 'PRN', 'aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt3'];
      for (const name of reserved) {
        const result = validateOneDriveName(name);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('reservado');
      }
      expect(validateOneDriveName('aux.txt').valid).toBe(false);
    });

    it('sanitiza e aceita nomes válidos removendo espaços e pontos do final', () => {
      const result = validateOneDriveName('  Minha Nova Pasta...  ');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('Minha Nova Pasta');
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
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
          });
        }
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

  describe('createOneDriveFolder', () => {
    it('cria pasta na raiz com @microsoft.graph.conflictBehavior=fail', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'folder-root-1',
          name: 'Projetos',
          folder: { childCount: 0 },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await createOneDriveFolder(undefined, 'Projetos');

      expect(result.id).toBe('folder-root-1');
      expect(result.name).toBe('Projetos');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/me/drive/root/children');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.name).toBe('Projetos');
      expect(body['@microsoft.graph.conflictBehavior']).toBe('fail');
    });

    it('cria subpasta quando folderId é fornecido', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'subfolder-2',
          name: '2026',
          folder: { childCount: 0 },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await createOneDriveFolder('parent-folder-id', '2026');
      expect(result.id).toBe('subfolder-2');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/me/drive/items/parent-folder-id/children');
    });

    it('lança erro descritivo em caso de HTTP 409 (pasta duplicada)', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(createOneDriveFolder(undefined, 'Existente')).rejects.toThrow(
        'Já existe uma pasta ou arquivo chamado "Existente" neste local.'
      );
    });

    it('rejeita nome inválido sem fazer chamada de rede', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      await expect(createOneDriveFolder(undefined, 'Pasta?Invalida')).rejects.toThrow(
        'caracteres inválidos'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('renameOneDriveItem', () => {
    it('renomeia pasta sem adicionar .md via PATCH no Graph', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'folder-1',
          name: 'Novo Nome Pasta',
          folder: { childCount: 2 },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await renameOneDriveItem('folder-1', 'Novo Nome Pasta', true);

      expect(result.name).toBe('Novo Nome Pasta');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/me/drive/items/folder-1');
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(options.body).name).toBe('Novo Nome Pasta');
    });

    it('renomeia arquivo normalizando extensão .md', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'file-1',
          name: 'Nota Renomeada.md',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await renameOneDriveItem('file-1', 'Nota Renomeada', false);

      expect(result.name).toBe('Nota Renomeada.md');
      const [, options] = mockFetch.mock.calls[0];
      expect(JSON.parse(options.body).name).toBe('Nota Renomeada.md');
    });

    it('lança erro se nome contiver caracteres proibidos', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      await expect(renameOneDriveItem('item-1', 'Nome*Invalido', false)).rejects.toThrow(
        'caracteres inválidos'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('deleteOneDriveItem e deleteOneDriveItemsBatch', () => {
    it('exclui item com sucesso via DELETE', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(deleteOneDriveItem('item-to-delete')).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/me/drive/items/item-to-delete',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('trata HTTP 404 como sucesso idempotente', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(deleteOneDriveItem('non-existent-item')).resolves.toBeUndefined();
    });

    it('exclui múltiplos itens em lote agrupando sucessos e falhas', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('item-fail')) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Error',
          });
        }
        return Promise.resolve({ ok: true, status: 204 });
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await deleteOneDriveItemsBatch(['item-1', 'item-fail', 'item-2']);

      expect(result.succeeded).toEqual(['item-1', 'item-2']);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe('item-fail');
    });
  });

  describe('moveOneDriveItem e moveOneDriveItemsBatch', () => {
    it('bloqueia mover item para dentro de si mesmo', async () => {
      await expect(moveOneDriveItem('folder-1', 'folder-1')).rejects.toThrow(
        'Não é possível mover uma pasta para dentro de si mesma.'
      );
    });

    it('move item para outra subpasta via PATCH parentReference', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'item-1',
          name: 'Doc.md',
          parentReference: { id: 'target-folder' },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await moveOneDriveItem('item-1', 'target-folder');

      expect(result.id).toBe('item-1');
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/me/drive/items/item-1');
      expect(options.method).toBe('PATCH');
      const body = JSON.parse(options.body);
      expect(body.parentReference.id).toBe('target-folder');
      expect(body['@microsoft.graph.conflictBehavior']).toBe('rename');
    });

    it('resolve ID da raiz quando destino for undefined ou "root"', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/me/drive/root?select=id')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ id: 'root-id-real' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'item-1',
            name: 'Doc.md',
            parentReference: { id: 'root-id-real' },
          }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await moveOneDriveItem('item-1', 'root');

      expect(result.id).toBe('item-1');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, patchOptions] = mockFetch.mock.calls[1];
      expect(JSON.parse(patchOptions.body).parentReference.id).toBe('root-id-real');
    });

    it('move múltiplos itens em lote', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'moved-item',
          parentReference: { id: 'target-folder' },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await moveOneDriveItemsBatch(['item-1', 'item-2'], 'target-folder');

      expect(result.succeeded).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('copyOneDriveFile e copyOneDriveFilesBatch', () => {
    it('baixa conteúdo e cria novo arquivo resolvendo colisão de nomes', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/content') && !url.includes('@microsoft.graph')) {
          // Download
          return Promise.resolve({
            ok: true,
            text: async () => '# Conteudo Original',
          });
        }
        // Upload / Create
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'copied-item-id',
            name: 'Original (1).md',
          }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await copyOneDriveFile('source-id', 'Original.md', 'target-folder', ['Original.md']);

      expect(result.id).toBe('copied-item-id');
      expect(result.name).toBe('Original (1).md');
    });

    it('copia múltiplos arquivos em lote rastreando colisões de nomes sucessivas', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/content') && !url.includes('@microsoft.graph')) {
          return Promise.resolve({
            ok: true,
            text: async () => '# Arquivo',
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'id-copy',
            name: decodeURIComponent(url.split(':/')[1]?.split(':/')[0] || 'Copia.md'),
          }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await copyOneDriveFilesBatch(
        [
          { id: 'f1', name: 'Relatorio.md' },
          { id: 'f2', name: 'Notas.md' },
        ],
        'folder-target',
        []
      );

      expect(result.succeeded).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('searchOneDriveItems', () => {
    it('retorna array vazio imediatamente para consultas vazias', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const res = await searchOneDriveItems('   ');
      expect(res).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('faz busca no Graph API e filtra apenas pastas e arquivos .md/.txt', async () => {
      vi.spyOn(msalService, 'getAccessToken').mockResolvedValue('mock-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          value: [
            { id: '1', name: 'Anotacoes.md', file: { mimeType: 'text/markdown' }, lastModifiedDateTime: '2026-10-01' },
            { id: '2', name: 'Documentos', folder: { childCount: 5 }, lastModifiedDateTime: '2026-10-02' },
            { id: '3', name: 'Foto.png', file: { mimeType: 'image/png' }, lastModifiedDateTime: '2026-10-03' },
            { id: '4', name: 'Relatorio.pdf', file: { mimeType: 'application/pdf' }, lastModifiedDateTime: '2026-10-04' },
            { id: '5', name: 'log.txt', file: { mimeType: 'text/plain' }, lastModifiedDateTime: '2026-10-05' },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const items = await searchOneDriveItems('doc');

      expect(items).toHaveLength(3);
      const names = items.map((i) => i.name);
      expect(names).toContain('Anotacoes.md');
      expect(names).toContain('Documentos');
      expect(names).toContain('log.txt');
      expect(names).not.toContain('Foto.png');
      expect(names).not.toContain('Relatorio.pdf');

      const [calledUrl] = mockFetch.mock.calls[0];
      expect(calledUrl).toContain("search(q='doc')");
    });
  });
});
