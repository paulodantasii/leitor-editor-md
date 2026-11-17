import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { useAppStore } from './useAppStore';

describe('Hidratação de arquivos grandes (storedInDb) contra tela branca', () => {
  const mockLocalStorage: Record<string, string> = {};
  const mockSessionStorage: Record<string, string> = {};

  beforeEach(() => {
    idb.clear();
    for (const key of Object.keys(mockLocalStorage)) {
      delete mockLocalStorage[key];
    }
    for (const key of Object.keys(mockSessionStorage)) {
      delete mockSessionStorage[key];
    }

    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mockLocalStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockLocalStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockLocalStorage[k];
      },
      clear: () => {
        for (const key of Object.keys(mockLocalStorage)) {
          delete mockLocalStorage[key];
        }
      },
    });

    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => mockSessionStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockSessionStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockSessionStorage[k];
      },
      clear: () => {
        for (const key of Object.keys(mockSessionStorage)) {
          delete mockSessionStorage[key];
        }
      },
    });

    useAppStore.getState().closeDocument();
  });

  it('hydrateActiveDocumentFromDb restaura conteúdo integral do IndexedDB quando documento ativo vem como stub storedInDb', async () => {
    const giantText = '# Código Civil\n\n' + 'Art. 1º Toda pessoa é capaz de direitos e deveres.\n\n'.repeat(100);

    idb.set('doc:draft:doc-giant', {
      title: 'Codigo_Civil.md',
      content: giantText,
      oneDriveItemId: null,
      lastSavedAt: '10:00:00',
      isDirty: false,
      revision: 3,
      draftRevision: 3,
      sourceRevision: 3,
      docId: 'doc-giant',
    });

    useAppStore.getState().openTab({
      title: 'Codigo_Civil.md',
      content: '',
      docId: 'doc-giant',
      storedInDb: true,
    });

    expect(useAppStore.getState().document?.content).toBe('');
    expect(useAppStore.getState().document?.storedInDb).toBe(true);

    await useAppStore.getState().hydrateActiveDocumentFromDb();

    const restored = useAppStore.getState().document;
    expect(restored?.content).toBe(giantText);
    expect(restored?.storedInDb).toBe(false);
    expect(useAppStore.getState().tabs[0].snapshot?.content).toBe(giantText);
  });

  it('switchTab restaura conteúdo integral do IndexedDB quando aba restaurada da sessão não tem snapshot em memória', async () => {
    const bigContent = '# CPC Comentado\n\nTexto completo salvo no IndexedDB.';
    idb.set('leitor_md_recents_index_v2', [
      {
        id: 'draft:doc-cpc',
        title: 'CPC.md',
        content: '', // índice leve nunca guarda o conteúdo integral
        sourceType: 'draft',
        oneDriveItemId: null,
        lastSavedAt: '11:00:00',
        lastOpenedAt: Date.now(),
        isOneDrive: false,
        revision: 2,
        draftRevision: 2,
        sourceRevision: 2,
      },
    ]);
    idb.set('doc:draft:doc-cpc', {
      title: 'CPC.md',
      content: bigContent,
      oneDriveItemId: null,
      lastSavedAt: '11:00:00',
      isDirty: false,
      revision: 2,
      draftRevision: 2,
      sourceRevision: 2,
      docId: 'doc-cpc',
    });

    useAppStore.setState({
      tabs: [
        {
          id: 'tab-cpc',
          title: 'CPC.md',
          isDirty: false,
          docId: 'doc-cpc',
          oneDriveItemId: null,
        },
        {
          id: 'tab-other',
          title: 'Outro.md',
          isDirty: false,
          docId: 'doc-other',
          oneDriveItemId: null,
          snapshot: {
            title: 'Outro.md',
            content: 'Outro texto',
            oneDriveItemId: null,
            lastSavedAt: null,
            isDirty: false,
            revision: 0,
            draftRevision: 0,
            sourceRevision: 0,
            docId: 'doc-other',
          },
        },
      ],
      activeTabId: 'tab-other',
      document: {
        title: 'Outro.md',
        content: 'Outro texto',
        oneDriveItemId: null,
        lastSavedAt: null,
        isDirty: false,
        revision: 0,
        draftRevision: 0,
        sourceRevision: 0,
        docId: 'doc-other',
      },
    });

    await useAppStore.getState().switchTab('tab-cpc');

    expect(useAppStore.getState().activeTabId).toBe('tab-cpc');
    expect(useAppStore.getState().document?.content).toBe(bigContent);
    expect(useAppStore.getState().document?.storedInDb).toBe(false);
  });
});
