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

describe('Interface com Abas: Ciclo de Vida e Gerenciamento no useAppStore', () => {
  beforeEach(() => {
    useAppStore.getState().closeDocument();
  });

  it('permite abrir múltiplas abas com openTab e atualiza tabs e activeTabId', () => {
    const tab1Id = useAppStore.getState().openTab({
      title: 'Doc 1.md',
      content: '# Conteúdo 1',
    });

    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(useAppStore.getState().activeTabId).toBe(tab1Id);
    expect(useAppStore.getState().document?.title).toBe('Doc 1.md');

    const tab2Id = useAppStore.getState().openTab({
      title: 'Doc 2.md',
      content: '# Conteúdo 2',
    });

    expect(useAppStore.getState().tabs).toHaveLength(2);
    expect(useAppStore.getState().activeTabId).toBe(tab2Id);
    expect(useAppStore.getState().document?.title).toBe('Doc 2.md');
    expect(useAppStore.getState().document?.content).toBe('# Conteúdo 2');
  });

  it('reutiliza a aba ativa quando for um rascunho em branco sem edições', () => {
    useAppStore.getState().createNewDocument();
    expect(useAppStore.getState().tabs).toHaveLength(1);
    const blankTabId = useAppStore.getState().activeTabId;

    const openedTabId = useAppStore.getState().openTab({
      title: 'Arquivo Real.md',
      content: '# Texto Real',
    });

    // Não deve criar aba extra duplicada
    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(openedTabId).toBe(blankTabId);
    expect(useAppStore.getState().document?.title).toBe('Arquivo Real.md');
  });

  it('alterna para a aba existente se o mesmo arquivo do OneDrive já estiver aberto', () => {
    const tab1Id = useAppStore.getState().openTab({
      title: 'Nuvem.md',
      content: '# Nuvem',
      oneDriveItemId: 'item-12345',
    });

    useAppStore.getState().openTab({
      title: 'Outro.md',
      content: '# Outro',
    });
    expect(useAppStore.getState().tabs).toHaveLength(2);

    // Tenta abrir o mesmo item do OneDrive
    const duplicateId = useAppStore.getState().openTab({
      title: 'Nuvem.md',
      content: '# Nuvem Modificada',
      oneDriveItemId: 'item-12345',
    });

    expect(duplicateId).toBe(tab1Id);
    expect(useAppStore.getState().tabs).toHaveLength(2);
    expect(useAppStore.getState().activeTabId).toBe(tab1Id);
  });

  it('alterna entre abas com switchTab preservando snapshot e status de dirty', async () => {
    const tab1Id = useAppStore.getState().openTab({
      title: 'Aba 1.md',
      content: '# Conteúdo Inicial 1',
    });

    const tab2Id = useAppStore.getState().openTab({
      title: 'Aba 2.md',
      content: '# Conteúdo Inicial 2',
    });

    // Edita conteúdo da Aba 2
    useAppStore.getState().updateDocumentContent('# Conteúdo Atualizado 2');
    expect(useAppStore.getState().document?.content).toBe('# Conteúdo Atualizado 2');
    expect(useAppStore.getState().document?.isDirty).toBe(true);

    // Alterna para a Aba 1
    await useAppStore.getState().switchTab(tab1Id);
    expect(useAppStore.getState().activeTabId).toBe(tab1Id);
    expect(useAppStore.getState().document?.title).toBe('Aba 1.md');
    expect(useAppStore.getState().document?.content).toBe('# Conteúdo Inicial 1');

    // Alterna de volta para a Aba 2 e verifica preservação
    await useAppStore.getState().switchTab(tab2Id);
    expect(useAppStore.getState().activeTabId).toBe(tab2Id);
    expect(useAppStore.getState().document?.title).toBe('Aba 2.md');
    expect(useAppStore.getState().document?.content).toBe('# Conteúdo Atualizado 2');
    expect(useAppStore.getState().document?.isDirty).toBe(true);
  });

  it('renomeia aba com renameTab normalizando extensão .md e marcando isDirty', () => {
    const tabId = useAppStore.getState().openTab({
      title: 'Meu Relatorio.md',
      content: '# Relatório',
    });

    useAppStore.getState().renameTab(tabId, 'Novo Nome');

    expect(useAppStore.getState().document?.title).toBe('Novo Nome.md');
    expect(useAppStore.getState().tabs[0].title).toBe('Novo Nome.md');
    expect(useAppStore.getState().tabs[0].isDirty).toBe(true);
    expect(useAppStore.getState().document?.isDirty).toBe(true);
  });

  it('closeTab não fecha aba dirty a menos que forceWithoutSaving seja true', () => {
    const tabId = useAppStore.getState().openTab({
      title: 'Aba Suja.md',
      content: '# Inicial',
    });

    useAppStore.getState().markDocumentDirty();
    expect(useAppStore.getState().tabs[0].isDirty).toBe(true);

    // Tentativa sem forçar
    useAppStore.getState().closeTab(tabId, false);
    expect(useAppStore.getState().tabs).toHaveLength(1);

    // Fechamento forçado
    useAppStore.getState().closeTab(tabId, true);
    expect(useAppStore.getState().tabs).toHaveLength(0);
    expect(useAppStore.getState().document).toBeNull();
  });

  it('closeTab na aba ativa seleciona a aba vizinha restante', async () => {
    const tab1Id = useAppStore.getState().openTab({
      title: 'Primeira.md',
      content: '# 1',
    });

    const tab2Id = useAppStore.getState().openTab({
      title: 'Segunda.md',
      content: '# 2',
    });

    const tab3Id = useAppStore.getState().openTab({
      title: 'Terceira.md',
      content: '# 3',
    });

    expect(useAppStore.getState().activeTabId).toBe(tab3Id);

    // Fecha a terceira (ativa)
    useAppStore.getState().closeTab(tab3Id, true);

    expect(useAppStore.getState().tabs).toHaveLength(2);
    // Deve focar a vizinha da esquerda (tab2)
    expect(useAppStore.getState().activeTabId).toBe(tab2Id);
    expect(useAppStore.getState().document?.title).toBe('Segunda.md');

    // Alterna para tab1 e a fecha
    await useAppStore.getState().switchTab(tab1Id);
    expect(useAppStore.getState().activeTabId).toBe(tab1Id);

    useAppStore.getState().closeTab(tab1Id, true);
    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(useAppStore.getState().activeTabId).toBe(tab2Id);
    expect(useAppStore.getState().document?.title).toBe('Segunda.md');

    // Fecha a última
    useAppStore.getState().closeTab(tab2Id, true);
    expect(useAppStore.getState().tabs).toHaveLength(0);
    expect(useAppStore.getState().activeTabId).toBeNull();
    expect(useAppStore.getState().document).toBeNull();
  });
});

describe('Modo Código-Fonte (isSourceMode): Exclusividade Mútua e Ciclo de Vida', () => {
  beforeEach(() => {
    useAppStore.getState().closeDocument();
  });

  it('só permite ativar isSourceMode quando isEditable for true', () => {
    useAppStore.getState().openTab({
      title: 'Doc.md',
      content: '# Teste',
    });

    // Em modo Leitura (isEditable === false), tentar ativar isSourceMode deve manter false
    expect(useAppStore.getState().isEditable).toBe(false);
    useAppStore.getState().setIsSourceMode(true);
    expect(useAppStore.getState().isSourceMode).toBe(false);

    useAppStore.getState().toggleSourceMode();
    expect(useAppStore.getState().isSourceMode).toBe(false);

    // Ao entrar em modo Edição (isEditable === true), permite alternar isSourceMode
    useAppStore.getState().setIsEditable(true);
    useAppStore.getState().toggleSourceMode();
    expect(useAppStore.getState().isSourceMode).toBe(true);
  });

  it('desativa isSourceMode automaticamente ao voltar para Leitura, ativar Grifar ou fechar documento', () => {
    useAppStore.getState().createNewDocument();
    expect(useAppStore.getState().isEditable).toBe(true);

    useAppStore.getState().setIsSourceMode(true);
    expect(useAppStore.getState().isSourceMode).toBe(true);

    // Sair do modo Edição para Leitura desativa isSourceMode
    useAppStore.getState().setIsEditable(false);
    expect(useAppStore.getState().isSourceMode).toBe(false);

    // Reativa Edição + Código-Fonte e aciona Modo Grifar
    useAppStore.getState().setIsEditable(true);
    useAppStore.getState().setIsSourceMode(true);
    expect(useAppStore.getState().isSourceMode).toBe(true);

    useAppStore.getState().toggleHighlightMode();
    expect(useAppStore.getState().isHighlightMode).toBe(true);
    expect(useAppStore.getState().isEditable).toBe(false);
    expect(useAppStore.getState().isSourceMode).toBe(false);

    // Reativa Edição + Código-Fonte e fecha o documento
    useAppStore.getState().setIsEditable(true);
    useAppStore.getState().setIsSourceMode(true);
    useAppStore.getState().closeDocument();
    expect(useAppStore.getState().isSourceMode).toBe(false);
  });
});
