import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from './useAppStore';
import { saveCoordinator } from '../services/saveCoordinator';

describe('Fase 4: Fechar e Gestão de DocumentState | null', () => {
  const mockLocalStorage: Record<string, string> = {};

  beforeEach(() => {
    for (const key of Object.keys(mockLocalStorage)) {
      delete mockLocalStorage[key];
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
  });

  it('permite fechar o documento ativo limpando o estado para null e removendo do localStorage', () => {
    // Abre um documento
    useAppStore.getState().createNewDocument();
    expect(useAppStore.getState().document).not.toBeNull();

    // Fecha o documento
    useAppStore.getState().closeDocument();

    expect(useAppStore.getState().document).toBeNull();
    expect(useAppStore.getState().fileHandle).toBeNull();
    expect(useAppStore.getState().isEditable).toBe(false);
    expect(useAppStore.getState().isHighlightMode).toBe(false);
    expect(localStorage.getItem('leitor_md_document')).toBeNull();
  });

  it('quando document é null, setDocument inicializa um novo documento válido', () => {
    useAppStore.getState().closeDocument();
    expect(useAppStore.getState().document).toBeNull();

    useAppStore.getState().setDocument({
      title: 'Nota Nova.md',
      content: '# Olá Mundo',
    });

    const doc = useAppStore.getState().document;
    expect(doc).not.toBeNull();
    expect(doc?.title).toBe('Nota Nova.md');
    expect(doc?.content).toBe('# Olá Mundo');
    expect(doc?.revision).toBe(1);
    expect(doc?.isDirty).toBe(true);
  });

  it('quando document é null, updateDocumentContent e markDocumentDirty não geram erro', () => {
    useAppStore.getState().closeDocument();
    expect(useAppStore.getState().document).toBeNull();

    expect(() => {
      useAppStore.getState().updateDocumentContent('conteúdo');
    }).not.toThrow();

    expect(() => {
      useAppStore.getState().markDocumentDirty();
    }).not.toThrow();

    expect(useAppStore.getState().document).toBeNull();
  });

  it('saveCoordinator trata estado com document null graciosamente', async () => {
    useAppStore.getState().closeDocument();
    expect(useAppStore.getState().document).toBeNull();

    const saveResult = await saveCoordinator.save({ interactive: false });
    expect(saveResult.status).toBe('ok');
    expect(saveResult.message).toBe('Nenhum documento aberto.');

    await expect(saveCoordinator.saveDraft()).resolves.toBeUndefined();
  });
});
