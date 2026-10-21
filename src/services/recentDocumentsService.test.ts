import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentState } from '../types';

const idb = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idb.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.delete(key);
  }),
}));

vi.mock('./oneDriveService', () => ({
  downloadOneDriveFile: vi.fn(),
  getOneDriveItemMetadata: vi.fn(),
}));

import {
  saveRecentDocument,
  getRecentDocuments,
  cleanupBlankRecentDocuments,
  getDocumentFullData,
  loadRecentDocumentWithCloudSync,
  applyRecentsEvictionRule,
} from './recentDocumentsService';
import { isBlankUntitledDocument } from './documentUtils';

const makeDoc = (overrides: Partial<DocumentState>): DocumentState => ({
  title: 'Notas.md',
  content: '# Notas',
  oneDriveItemId: null,
  lastSavedAt: null,
  isDirty: false,
  revision: 0,
  draftRevision: 0,
  sourceRevision: 0,
  docId: 'doc-a',
  ...overrides,
});

describe('recentDocumentsService (Fase 0 & Fase 2)', () => {
  let mockStore: Record<string, string> = {};

  beforeEach(() => {
    idb.clear();
    mockStore = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockStore[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStore[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStore[key];
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('0.6: dois documentos diferentes com o mesmo título coexistem no histórico', async () => {
    await saveRecentDocument(makeDoc({ docId: 'doc-a', content: 'A' }));
    await saveRecentDocument(makeDoc({ docId: 'doc-b', content: 'B' }));

    const list = await getRecentDocuments();
    expect(list).toHaveLength(2);
    expect(list.map((i) => i.id).sort()).toEqual(['draft:doc-a', 'draft:doc-b']);

    // Cada documento gravado em sua própria chave
    const docA = await getDocumentFullData('draft:doc-a');
    const docB = await getDocumentFullData('draft:doc-b');
    expect(docA?.content).toBe('A');
    expect(docB?.content).toBe('B');
  });

  it('0.6: salvar o mesmo documento duas vezes não duplica a entrada', async () => {
    await saveRecentDocument(makeDoc({ docId: 'doc-a', content: 'v1' }));
    await saveRecentDocument(makeDoc({ docId: 'doc-a', content: 'v2' }));

    const list = await getRecentDocuments();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('draft:doc-a');

    const fullDoc = await getDocumentFullData('draft:doc-a');
    expect(fullDoc?.content).toBe('v2');
  });

  it('Fase 2: editar um documento preserva lastOpenedAt original (só muda ao abrir)', async () => {
    await saveRecentDocument(makeDoc({ docId: 'doc-a', content: 'v1' }));
    const firstList = await getRecentDocuments();
    const initialOpenedAt = firstList[0].lastOpenedAt;

    // Aguarda um pequeno intervalo e edita o documento
    await new Promise((r) => setTimeout(r, 10));
    await saveRecentDocument(makeDoc({ docId: 'doc-a', content: 'v2' }));

    const secondList = await getRecentDocuments();
    // lastOpenedAt NÃO muda ao editar
    expect(secondList[0].lastOpenedAt).toBe(initialOpenedAt);
  });

  it('Fase 2: abrir documento atualiza lastOpenedAt e o move para o topo', async () => {
    await saveRecentDocument(makeDoc({ docId: 'doc-1', content: 'Primeiro' }));
    await new Promise((r) => setTimeout(r, 10));
    await saveRecentDocument(makeDoc({ docId: 'doc-2', content: 'Segundo' }));

    const before = await getRecentDocuments();
    expect(before[0].id).toBe('draft:doc-2');

    // Abre o documento doc-1
    await new Promise((r) => setTimeout(r, 10));
    const { doc } = await loadRecentDocumentWithCloudSync(before[1]);
    expect(doc.content).toBe('Primeiro');

    // Agora doc-1 está no topo
    const after = await getRecentDocuments();
    expect(after[0].id).toBe('draft:doc-1');
  });

  it('Fase 2: promoção de rascunho para OneDrive remove a chave draft antiga sem duplicar', async () => {
    // 1. Inicia como rascunho
    await saveRecentDocument(makeDoc({ docId: 'doc-abc', content: 'Texto inicial' }));
    expect(idb.has('doc:draft:doc-abc')).toBe(true);

    // 2. Salva no OneDrive mantendo o mesmo docId
    await saveRecentDocument(makeDoc({
      docId: 'doc-abc',
      oneDriveItemId: 'item-xyz',
      title: 'SalvoNoOneDrive.md',
      content: 'Texto atualizado',
    }));

    const list = await getRecentDocuments();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('onedrive:item-xyz');
    expect(list[0].sourceType).toBe('onedrive');

    // A chave antiga foi descartada
    expect(idb.has('doc:draft:doc-abc')).toBe(false);
    // A chave nova foi criada
    expect(idb.has('doc:onedrive:item-xyz')).toBe(true);
  });

  it('Fase 2: migração automática do formato v1 para v2', async () => {
    idb.set('leitor_md_recent_documents_v1', [
      { id: 'local_1', title: 'Sem Título.md', content: '', oneDriveItemId: null, lastSavedAt: null, lastOpenedAt: 2, isOneDrive: false },
      { id: 'local_2', title: 'Meu Documento.md', content: '# Olá Mundo', oneDriveItemId: null, lastSavedAt: '10:00', lastOpenedAt: 1, isOneDrive: false },
      { id: 'onedrive_cloud1', title: 'Nuvem.md', content: '# Nuvem', oneDriveItemId: 'cloud1', lastSavedAt: '11:00', lastOpenedAt: 3, isOneDrive: true },
    ]);

    const list = await getRecentDocuments();
    // Entrada em branco foi descartada; sobram 2
    expect(list).toHaveLength(2);
    expect(list.map((i) => i.id)).toEqual(['onedrive:cloud1', 'draft:2']);

    // Chaves individuais criadas
    const cloudDoc = await getDocumentFullData('onedrive:cloud1');
    const localDoc = await getDocumentFullData('draft:2');
    expect(cloudDoc?.content).toBe('# Nuvem');
    expect(localDoc?.content).toBe('# Olá Mundo');
  });

  it('0.7: "Sem Título.md" em branco (inclusive só espaços/quebras) não entra no histórico', async () => {
    await saveRecentDocument(makeDoc({ title: 'Sem Título.md', content: '' }));
    await saveRecentDocument(makeDoc({ title: 'Sem Título.md', content: '\n  \n', docId: 'doc-b' }));

    expect(await getRecentDocuments()).toHaveLength(0);
  });

  it('0.7: "Sem Título.md" com texto aparece no histórico como Rascunho', async () => {
    await saveRecentDocument(makeDoc({ title: 'Sem Título.md', content: 'rascunho' }));
    const list = await getRecentDocuments();
    expect(list).toHaveLength(1);
    expect(list[0].sourceType).toBe('draft');
  });

  it('isBlankUntitledDocument: snapshot leve (storedInDb) e arquivos do OneDrive nunca são brancos', () => {
    expect(isBlankUntitledDocument({ title: 'Sem Título.md', content: '', storedInDb: true })).toBe(false);
    expect(isBlankUntitledDocument({ title: 'Sem Título.md', content: '', oneDriveItemId: 'abc' })).toBe(false);
    expect(isBlankUntitledDocument({ title: 'Outro.md', content: '' })).toBe(false);
    expect(isBlankUntitledDocument({ title: 'Sem Título.md', content: '   ' })).toBe(true);
  });

  describe('Fase 5: applyRecentsEvictionRule (Seção 5)', () => {
    it('não remove nenhum item se a lista estiver dentro do limite', () => {
      const items: any[] = [
        { id: 'draft:1', sourceType: 'draft', revision: 0, sourceRevision: 0 },
        { id: 'onedrive:1', sourceType: 'onedrive', revision: 1, sourceRevision: 1 },
      ];
      const { list, evictedIds, warningAllDrafts } = applyRecentsEvictionRule(items, 30);
      expect(list).toHaveLength(2);
      expect(evictedIds).toHaveLength(0);
      expect(warningAllDrafts).toBe(false);
    });

    it('ao atingir 31 itens, descarta primeiro o arquivo com fonte permanente e sincronizado', () => {
      // 30 rascunhos e 1 arquivo do OneDrive
      const items: any[] = [];
      for (let i = 1; i <= 30; i++) {
        items.push({
          id: `draft:${i}`,
          sourceType: 'draft',
          revision: 1,
          draftRevision: 1,
          sourceRevision: 0,
          lastOpenedAt: i,
        });
      }
      // Arquivo do OneDrive adicionado
      items.push({
        id: 'onedrive:nuvem1',
        sourceType: 'onedrive',
        oneDriveItemId: 'nuvem1',
        revision: 1,
        draftRevision: 1,
        sourceRevision: 1,
        lastOpenedAt: 0, // Mais antigo
      });

      const { list, evictedIds, warningAllDrafts } = applyRecentsEvictionRule(items, 30);
      expect(list).toHaveLength(30);
      expect(evictedIds).toEqual(['onedrive:nuvem1']);
      expect(warningAllDrafts).toBe(false);
      // Todos os 30 rascunhos foram protegidos
      expect(list.every((item) => item.sourceType === 'draft')).toBe(true);
    });

    it('protege arquivos com alterações pendentes de envio contra descarte', () => {
      const items: any[] = [
        // OneDrive sincronizado (elegível para descarte)
        {
          id: 'onedrive:sync',
          sourceType: 'onedrive',
          oneDriveItemId: 'sync',
          revision: 2,
          draftRevision: 2,
          sourceRevision: 2,
          lastOpenedAt: 1,
        },
        // OneDrive com pendências locais não enviadas (protegido)
        {
          id: 'onedrive:pending',
          sourceType: 'onedrive',
          oneDriveItemId: 'pending',
          revision: 3,
          draftRevision: 3,
          sourceRevision: 2, // pendente!
          lastOpenedAt: 2,
        },
      ];

      // Limite = 1 para forçar um descarte
      const { list, evictedIds } = applyRecentsEvictionRule(items, 1);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('onedrive:pending');
      expect(evictedIds).toEqual(['onedrive:sync']);
    });

    it('se todos forem rascunhos, não apaga silenciosamente e ativa warningAllDrafts', () => {
      const items: any[] = [];
      for (let i = 1; i <= 31; i++) {
        items.push({
          id: `draft:${i}`,
          sourceType: 'draft',
          revision: 1,
          draftRevision: 1,
          sourceRevision: 0,
        });
      }

      const { list, evictedIds, warningAllDrafts } = applyRecentsEvictionRule(items, 30);
      expect(list).toHaveLength(31);
      expect(evictedIds).toHaveLength(0);
      expect(warningAllDrafts).toBe(true);
    });
  });
});

