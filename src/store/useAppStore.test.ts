import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from './useAppStore';
import { saveCoordinator } from '../services/saveCoordinator';

describe('Fase 4: Fechar e Gestão de DocumentState | null', () => {
  const mockLocalStorage: Record<string, string> = {};
  const mockSessionStorage: Record<string, string> = {};

  beforeEach(() => {
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
  });

  it('permite fechar o documento ativo limpando o estado para null e removendo do sessionStorage e localStorage', () => {
    // Abre um documento
    useAppStore.getState().createNewDocument();
    expect(useAppStore.getState().document).not.toBeNull();

    // Fecha o documento
    useAppStore.getState().closeDocument();

    expect(useAppStore.getState().document).toBeNull();
    expect(useAppStore.getState().fileHandle).toBeNull();
    expect(useAppStore.getState().isEditable).toBe(false);
    expect(useAppStore.getState().isHighlightMode).toBe(false);
    expect(sessionStorage.getItem('leitor_md_document')).toBeNull();
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

describe('Reordenação de Abas e Grupos de Abas com Cores', () => {
  beforeEach(() => {
    useAppStore.getState().closeDocument();
  });

  it('reordena abas horizontalmente (before e after) preservando activeTabId, document e snapshots', () => {
    const tab1Id = useAppStore.getState().openTab({ title: 'Aba 1.md', content: '# Conteúdo 1' });
    const tab2Id = useAppStore.getState().openTab({ title: 'Aba 2.md', content: '# Conteúdo 2' });
    const tab3Id = useAppStore.getState().openTab({ title: 'Aba 3.md', content: '# Conteúdo 3' });

    // Foca na Aba 2
    useAppStore.getState().switchTab(tab2Id);
    expect(useAppStore.getState().activeTabId).toBe(tab2Id);
    expect(useAppStore.getState().document?.title).toBe('Aba 2.md');

    let currentTabs = useAppStore.getState().tabs;
    expect(currentTabs.map((t) => t.id)).toEqual([tab1Id, tab2Id, tab3Id]);

    // Move Aba 3 para antes de Aba 1
    useAppStore.getState().reorderTabs(tab3Id, tab1Id, 'before');
    currentTabs = useAppStore.getState().tabs;
    expect(currentTabs.map((t) => t.id)).toEqual([tab3Id, tab1Id, tab2Id]);

    // activeTabId e documento ativo continuam sendo Aba 2
    expect(useAppStore.getState().activeTabId).toBe(tab2Id);
    expect(useAppStore.getState().document?.title).toBe('Aba 2.md');

    // Move Aba 1 para depois de Aba 2
    useAppStore.getState().reorderTabs(tab1Id, tab2Id, 'after');
    currentTabs = useAppStore.getState().tabs;
    expect(currentTabs.map((t) => t.id)).toEqual([tab3Id, tab2Id, tab1Id]);

    // Reordenar mesma aba sobre ela mesma não altera nada
    useAppStore.getState().reorderTabs(tab2Id, tab2Id, 'before');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual([tab3Id, tab2Id, tab1Id]);
  });

  it('cria grupo com cor da paleta de grifos, associa abas informadas e mantém contiguidade', () => {
    const tabAId = useAppStore.getState().openTab({ title: 'A.md', content: 'A' });
    const tabBId = useAppStore.getState().openTab({ title: 'B.md', content: 'B' });
    const tabCId = useAppStore.getState().openTab({ title: 'C.md', content: 'C' });
    const tabDId = useAppStore.getState().openTab({ title: 'D.md', content: 'D' });

    // Inicialmente: [A, B, C, D]. Cria grupo com A e C (não adjacentes)
    const groupId = useAppStore.getState().createTabGroup([tabAId, tabCId], {
      title: 'Projeto Alpha',
      color: 'purple',
    });

    expect(groupId).toBeTruthy();
    const state = useAppStore.getState();
    expect(state.tabGroups).toHaveLength(1);
    expect(state.tabGroups[0]).toEqual({
      id: groupId,
      title: 'Projeto Alpha',
      color: 'purple',
      collapsed: false,
    });

    // Abas do grupo A e C devem ficar contíguas: [A, C, B, D]
    expect(state.tabs.map((t) => t.id)).toEqual([tabAId, tabCId, tabBId, tabDId]);
    expect(state.tabs.find((t) => t.id === tabAId)?.groupId).toBe(groupId);
    expect(state.tabs.find((t) => t.id === tabCId)?.groupId).toBe(groupId);
    expect(state.tabs.find((t) => t.id === tabBId)?.groupId).toBeNull();
  });

  it('altera cor da borda e título do grupo e persiste na sessão do localStorage', () => {
    const tab1Id = useAppStore.getState().openTab({ title: 'Item 1.md', content: '1' });
    const tab2Id = useAppStore.getState().openTab({ title: 'Item 2.md', content: '2' });

    const groupId = useAppStore.getState().createTabGroup([tab1Id, tab2Id], {
      title: 'Inicial',
      color: 'yellow',
    });

    // Atualiza título, cor e status recolhido
    useAppStore.getState().updateTabGroup(groupId, {
      title: 'Estudos Atualizados',
      color: 'green',
      collapsed: true,
    });

    const updatedGroup = useAppStore.getState().tabGroups.find((g) => g.id === groupId);
    expect(updatedGroup).toBeDefined();
    expect(updatedGroup?.title).toBe('Estudos Atualizados');
    expect(updatedGroup?.color).toBe('green');
    expect(updatedGroup?.collapsed).toBe(true);

    // Verifica persistência no sessionStorage (sem vazar para localStorage)
    const savedRaw = sessionStorage.getItem('leitor_md_open_tabs_v1');
    expect(savedRaw).not.toBeNull();
    expect(localStorage.getItem('leitor_md_open_tabs_v1')).toBeNull();
    const saved = JSON.parse(savedRaw!);
    expect(saved.groups).toHaveLength(1);
    expect(saved.groups[0].title).toBe('Estudos Atualizados');
    expect(saved.groups[0].color).toBe('green');
    expect(saved.groups[0].collapsed).toBe(true);
    expect(saved.tabs[0].groupId).toBe(groupId);
  });

  it('adiciona aba a grupo existente, remove aba com poda automática e desagrupa tudo', () => {
    const tab1Id = useAppStore.getState().openTab({ title: 'T1.md', content: '1' });
    const tab2Id = useAppStore.getState().openTab({ title: 'T2.md', content: '2' });
    const tab3Id = useAppStore.getState().openTab({ title: 'T3.md', content: '3' });

    const groupId = useAppStore.getState().createTabGroup([tab1Id], { title: 'Único', color: 'orange' });
    expect(useAppStore.getState().tabGroups).toHaveLength(1);

    // Adiciona tab2Id ao grupo
    useAppStore.getState().assignTabToGroup(tab2Id, groupId);
    expect(useAppStore.getState().tabs.find((t) => t.id === tab2Id)?.groupId).toBe(groupId);

    // Remove tab2Id do grupo
    useAppStore.getState().assignTabToGroup(tab2Id, null);
    expect(useAppStore.getState().tabs.find((t) => t.id === tab2Id)?.groupId).toBeNull();
    expect(useAppStore.getState().tabGroups).toHaveLength(1);

    // Remove última aba do grupo (tab1Id) -> grupo órfão deve ser podado automaticamente
    useAppStore.getState().assignTabToGroup(tab1Id, null);
    expect(useAppStore.getState().tabGroups).toHaveLength(0);

    // Testa ungroupTabs
    const newGroupId = useAppStore.getState().createTabGroup([tab2Id, tab3Id], { title: 'Dupla', color: 'blue' });
    expect(useAppStore.getState().tabGroups).toHaveLength(1);
    useAppStore.getState().ungroupTabs(newGroupId);
    expect(useAppStore.getState().tabGroups).toHaveLength(0);
    expect(useAppStore.getState().tabs.find((t) => t.id === tab2Id)?.groupId).toBeNull();
    expect(useAppStore.getState().tabs.find((t) => t.id === tab3Id)?.groupId).toBeNull();
  });

  it('moveTabGroup move todas as abas do grupo juntas em bloco', () => {
    const tabAId = useAppStore.getState().openTab({ title: 'A.md', content: 'A' });
    const tabBId = useAppStore.getState().openTab({ title: 'B.md', content: 'B' });
    const tabCId = useAppStore.getState().openTab({ title: 'C.md', content: 'C' });
    const tabDId = useAppStore.getState().openTab({ title: 'D.md', content: 'D' });

    // Cria grupo com [A, B]: lista [A, B, C, D]
    const gId = useAppStore.getState().createTabGroup([tabAId, tabBId], { title: 'Bloco AB', color: 'red' });

    // Move grupo para DEPOIS de D
    useAppStore.getState().moveTabGroup(gId, tabDId, 'after');
    let tabs = useAppStore.getState().tabs.map((t) => t.id);
    expect(tabs).toEqual([tabCId, tabDId, tabAId, tabBId]);

    // Move grupo para ANTES de C
    useAppStore.getState().moveTabGroup(gId, tabCId, 'before');
    tabs = useAppStore.getState().tabs.map((t) => t.id);
    expect(tabs).toEqual([tabAId, tabBId, tabCId, tabDId]);
  });

  it('agrupa na ordem [targetTab, sourceTab] ao soltar no centro e remove do grupo ao arrastar para fora', () => {
    const tab1 = useAppStore.getState().openTab({ title: '1.md', content: '1' });
    const tab2 = useAppStore.getState().openTab({ title: '2.md', content: '2' });
    const tab3 = useAppStore.getState().openTab({ title: '3.md', content: '3' });

    // Usuário arrasta tab3 sobre o centro de tab2 -> cria grupo [tab2, tab3]
    const gId = useAppStore.getState().createTabGroup([tab2, tab3], { title: 'Grupo', color: 'blue' });
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual([tab1, tab2, tab3]);
    expect(useAppStore.getState().tabs.find((t) => t.id === tab2)?.groupId).toBe(gId);
    expect(useAppStore.getState().tabs.find((t) => t.id === tab3)?.groupId).toBe(gId);

    // Usuário arrasta tab3 para antes de tab1 (que está fora de grupo) com adoptTargetGroup = true
    useAppStore.getState().reorderTabs(tab3, tab1, 'before', true);
    expect(useAppStore.getState().tabs.find((t) => t.id === tab3)?.groupId).toBeNull();
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual([tab3, tab1, tab2]);
  });

  it("reorderTabs com adoptTargetGroup = 'ungroup' remove a aba do grupo nas extremidades (inclusive quando arrastada para fora da própria ponta)", () => {
    const tab1 = useAppStore.getState().openTab({ title: '1.md', content: '1' });
    const tab2 = useAppStore.getState().openTab({ title: '2.md', content: '2' });
    const tab3 = useAppStore.getState().openTab({ title: '3.md', content: '3' });

    const gId = useAppStore.getState().createTabGroup([tab1, tab2, tab3], {
      title: 'Grupo Ponta',
      color: 'green',
    });
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual([tab1, tab2, tab3]);

    // Puxa a última aba (tab3) para o espaço externo após ela mesma ('after' + 'ungroup')
    useAppStore.getState().reorderTabs(tab3, tab3, 'after', 'ungroup');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual([tab1, tab2, tab3]);
    expect(useAppStore.getState().tabs.find((t) => t.id === tab3)?.groupId).toBeNull();
    expect(useAppStore.getState().tabs.find((t) => t.id === tab1)?.groupId).toBe(gId);
    expect(useAppStore.getState().tabs.find((t) => t.id === tab2)?.groupId).toBe(gId);

    // Puxa tab2 para o espaço externo depois de tab3 ('after' + 'ungroup')
    useAppStore.getState().reorderTabs(tab2, tab3, 'after', 'ungroup');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual([tab1, tab3, tab2]);
    expect(useAppStore.getState().tabs.find((t) => t.id === tab2)?.groupId).toBeNull();

    // Puxa a única aba restante do grupo (tab1) para o espaço externo antes dela mesma ('before' + 'ungroup') -> poda grupo órfão
    useAppStore.getState().reorderTabs(tab1, tab1, 'before', 'ungroup');
    expect(useAppStore.getState().tabs.find((t) => t.id === tab1)?.groupId).toBeNull();
    expect(useAppStore.getState().tabGroups).toHaveLength(0);
  });
});

describe('Aba Início (Nova Aba)', () => {
  const mockLocalStorage: Record<string, string> = {};
  const mockSessionStorage: Record<string, string> = {};

  beforeEach(() => {
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

  it('openHomeTab cria aba Início ativa e zera o documento', () => {
    const tabAId = useAppStore.getState().openTab({
      title: 'Doc A.md',
      content: '# Conteúdo A',
    });

    const homeId = useAppStore.getState().openHomeTab();
    const state = useAppStore.getState();

    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe(homeId);
    expect(state.tabs[1].id).toBe(homeId);
    expect(state.tabs[1].kind).toBe('home');
    expect(state.document).toBeNull();
    expect(state.fileHandle).toBeNull();
    expect(state.isEditable).toBe(false);

    const docATab = state.tabs.find((t) => t.id === tabAId);
    expect(docATab?.snapshot?.title).toBe('Doc A.md');
    expect(docATab?.snapshot?.content).toBe('# Conteúdo A');
  });

  it('não duplica a aba Início', async () => {
    const docAId = useAppStore.getState().openTab({ title: 'Doc A.md', content: 'A' });
    const homeId1 = useAppStore.getState().openHomeTab();
    const homeId2 = useAppStore.getState().openHomeTab();
    expect(homeId1).toBe(homeId2);

    // Volta para o Doc A antes de abrir o Doc B para manter a aba Início em segundo plano
    await useAppStore.getState().switchTab(docAId);
    const docBId = useAppStore.getState().openTab({ title: 'Doc B.md', content: 'B' });
    expect(useAppStore.getState().activeTabId).toBe(docBId);

    // Ao chamar openHomeTab() com a aba Início já existente em segundo plano, alterna para ela sem duplicar
    const homeId3 = useAppStore.getState().openHomeTab();
    expect(homeId3).toBe(homeId1);

    const homeTabs = useAppStore.getState().tabs.filter((t) => t.kind === 'home');
    expect(homeTabs).toHaveLength(1);
    expect(useAppStore.getState().activeTabId).toBe(homeId1);
  });

  it('voltar a um documento restaura o conteúdo', async () => {
    const tabAId = useAppStore.getState().openTab({
      title: 'Doc A.md',
      content: '# Conteúdo Original',
    });

    useAppStore.getState().openHomeTab();
    expect(useAppStore.getState().document).toBeNull();

    await useAppStore.getState().switchTab(tabAId);
    const state = useAppStore.getState();
    expect(state.activeTabId).toBe(tabAId);
    expect(state.document?.title).toBe('Doc A.md');
    expect(state.document?.content).toBe('# Conteúdo Original');
  });

  it('openTab converte a aba Início', () => {
    useAppStore.getState().openTab({ title: 'Doc A.md', content: 'A' });
    const homeId = useAppStore.getState().openHomeTab();
    const lengthBefore = useAppStore.getState().tabs.length;

    const realTabId = useAppStore.getState().openTab({
      title: 'Real.md',
      content: '# x',
    });

    const state = useAppStore.getState();
    expect(state.tabs).toHaveLength(lengthBefore);
    expect(state.tabs.some((t) => t.kind === 'home')).toBe(false);
    expect(realTabId).toBe(homeId);
    expect(state.activeTabId).toBe(homeId);
    expect(state.document?.title).toBe('Real.md');
    expect(state.document?.content).toBe('# x');
  });

  it('createNewDocument na Início converte a aba em rascunho em branco editável', () => {
    useAppStore.getState().openTab({ title: 'Doc A.md', content: 'A' });
    useAppStore.getState().openHomeTab();

    useAppStore.getState().createNewDocument();
    const state = useAppStore.getState();

    expect(state.isEditable).toBe(true);
    expect(state.document?.title).toBe('Sem Título.md');
    expect(state.tabs.some((t) => t.kind === 'home')).toBe(false);
  });

  it('closeTab da Início ativa volta ao documento vizinho', () => {
    useAppStore.getState().openTab({ title: 'Doc A.md', content: 'A' });
    const homeId = useAppStore.getState().openHomeTab();

    useAppStore.getState().closeTab(homeId, true);
    const state = useAppStore.getState();

    expect(state.document?.title).toBe('Doc A.md');
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(state.tabs[0].id);
  });

  it('closeTab de documento ativo cuja vizinha é a Início', async () => {
    const tabAId = useAppStore.getState().openTab({ title: 'Doc A.md', content: 'A' });
    const homeId = useAppStore.getState().openHomeTab();

    await useAppStore.getState().switchTab(tabAId);
    expect(useAppStore.getState().activeTabId).toBe(tabAId);

    useAppStore.getState().closeTab(tabAId, true);
    const state = useAppStore.getState();

    expect(state.document).toBeNull();
    expect(state.activeTabId).toBe(homeId);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].kind).toBe('home');
  });

  it('renameTab ignora a Nova guia mantendo o título Nova guia', () => {
    useAppStore.getState().openTab({ title: 'Doc A.md', content: 'A' });
    const homeId = useAppStore.getState().openHomeTab();

    useAppStore.getState().renameTab(homeId, 'Outro');
    const homeTab = useAppStore.getState().tabs.find((t) => t.id === homeId);
    expect(homeTab?.title).toBe('Nova guia');
  });

  it('persistência salva aba com kind: home e activeTabId correto', () => {
    useAppStore.getState().openTab({ title: 'Doc A.md', content: 'A' });
    const homeId = useAppStore.getState().openHomeTab();

    const raw = mockSessionStorage['leitor_md_open_tabs_v1'];
    expect(raw).toBeDefined();
    expect(mockLocalStorage['leitor_md_open_tabs_v1']).toBeUndefined();
    const parsed = JSON.parse(raw);
    const savedHome = parsed.tabs.find((t: { id: string }) => t.id === homeId);
    expect(savedHome?.kind).toBe('home');
    expect(parsed.activeTabId).toBe(homeId);
  });

  it('loadCachedDocument não carrega nenhum documento de exemplo quando o cache e histórico estiverem vazios', async () => {
    useAppStore.getState().closeDocument();
    expect(useAppStore.getState().document).toBeNull();
    expect(useAppStore.getState().tabs).toHaveLength(0);

    await useAppStore.getState().loadCachedDocument();

    const state = useAppStore.getState();
    expect(state.document).toBeNull();
    expect(state.tabs).toHaveLength(0);
    expect(state.activeTabId).toBeNull();
  });

  it('gerencia abertura/fechamento da barra de busca e fecha ao ir para a aba Início ou fechar documento', () => {
    useAppStore.getState().openTab({ title: 'Doc Busca.md', content: 'Conteúdo' });
    useAppStore.getState().openSearch({ expandReplace: true });

    expect(useAppStore.getState().isSearchOpen).toBe(true);
    expect(useAppStore.getState().isReplaceExpanded).toBe(true);

    useAppStore.getState().toggleSearch();
    expect(useAppStore.getState().isSearchOpen).toBe(false);

    useAppStore.getState().toggleSearch(false);
    expect(useAppStore.getState().isSearchOpen).toBe(true);
    expect(useAppStore.getState().isReplaceExpanded).toBe(false);

    useAppStore.getState().setIsReplaceExpanded(true);
    expect(useAppStore.getState().isReplaceExpanded).toBe(true);

    useAppStore.getState().openHomeTab();
    expect(useAppStore.getState().isSearchOpen).toBe(false);
    expect(useAppStore.getState().isReplaceExpanded).toBe(false);

    useAppStore.getState().openTab({ title: 'Doc Busca 2.md', content: 'Texto' });
    useAppStore.getState().openSearch({ expandReplace: true });
    useAppStore.getState().closeDocument();
    expect(useAppStore.getState().isSearchOpen).toBe(false);
    expect(useAppStore.getState().isReplaceExpanded).toBe(false);
  });
});

describe('Inicialização Limpa vs Recarga de Tema (Boot Lifecycle)', () => {
  const createStorageStub = (backing: Record<string, string>) => ({
    getItem: (k: string) => backing[k] ?? null,
    setItem: (k: string, v: string) => {
      backing[k] = v;
    },
    removeItem: (k: string) => {
      delete backing[k];
    },
    clear: () => {
      for (const k of Object.keys(backing)) {
        delete backing[k];
      }
    },
  });

  const sampleSession = {
    activeTabId: 'tab-1',
    tabs: [
      {
        id: 'tab-1',
        title: 'Estudo.md',
        docId: 'doc-1',
        oneDriveItemId: null,
        isDirty: false,
        groupId: 'grp-1',
        kind: 'doc',
      },
    ],
    groups: [
      {
        id: 'grp-1',
        title: 'Grupo A',
        color: 'blue',
        collapsed: false,
      },
    ],
  };

  const sampleDoc = {
    title: 'Estudo.md',
    content: '# Estudo',
    oneDriveItemId: null,
    lastSavedAt: '12:00:00',
    isDirty: false,
    revision: 0,
    draftRevision: 0,
    sourceRevision: 0,
    docId: 'doc-1',
  };

  it('Caso 1: sem snapshot de troca de tema, inicia limpo na HomeScreen e purga sessionStorage e localStorage legado', async () => {
    vi.resetModules();
    const localBacking: Record<string, string> = {
      leitor_md_document: JSON.stringify(sampleDoc),
      leitor_md_open_tabs_v1: JSON.stringify(sampleSession),
      leitor_md_preferences: JSON.stringify({ theme: 'dark' }),
    };
    const sessionBacking: Record<string, string> = {
      leitor_md_document: JSON.stringify(sampleDoc),
      leitor_md_open_tabs_v1: JSON.stringify(sampleSession),
    };

    vi.stubGlobal('localStorage', createStorageStub(localBacking));
    vi.stubGlobal('sessionStorage', createStorageStub(sessionBacking));

    const { useAppStore: freshStore } = await import('./useAppStore');
    const state = freshStore.getState();

    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
    expect(state.tabGroups).toEqual([]);
    expect(state.document).toBeNull();
    expect(sessionBacking['leitor_md_document']).toBeUndefined();
    expect(sessionBacking['leitor_md_open_tabs_v1']).toBeUndefined();
    expect(localBacking['leitor_md_document']).toBeUndefined();
    expect(localBacking['leitor_md_open_tabs_v1']).toBeUndefined();
    expect(localBacking['leitor_md_preferences']).toBeDefined();
  });

  it('Caso 2: com snapshot de troca de tema válido e recente, restaura tabs, activeTabId, tabGroups e document', async () => {
    vi.resetModules();
    const localBacking: Record<string, string> = {};
    const sessionBacking: Record<string, string> = {
      leitor_md_document: JSON.stringify(sampleDoc),
      leitor_md_open_tabs_v1: JSON.stringify(sampleSession),
      leitor_md_theme_reload_snapshot_v1: JSON.stringify({
        tabId: 'tab-1',
        docId: 'doc-1',
        scrollY: 100,
        isEditable: false,
        isHighlightMode: false,
        isSourceMode: false,
        savedAt: Date.now(),
      }),
    };

    vi.stubGlobal('localStorage', createStorageStub(localBacking));
    vi.stubGlobal('sessionStorage', createStorageStub(sessionBacking));

    const { useAppStore: freshStore } = await import('./useAppStore');
    const state = freshStore.getState();

    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].id).toBe('tab-1');
    expect(state.activeTabId).toBe('tab-1');
    expect(state.tabGroups).toHaveLength(1);
    expect(state.tabGroups[0].id).toBe('grp-1');
    expect(state.document?.title).toBe('Estudo.md');
    expect(state.document?.content).toBe('# Estudo');
  });

  it('Caso 3: com snapshot de troca de tema expirado, ignora a sessão, limpa as chaves e inicia limpo', async () => {
    vi.resetModules();
    const localBacking: Record<string, string> = {
      leitor_md_document: JSON.stringify(sampleDoc),
      leitor_md_open_tabs_v1: JSON.stringify(sampleSession),
    };
    const sessionBacking: Record<string, string> = {
      leitor_md_document: JSON.stringify(sampleDoc),
      leitor_md_open_tabs_v1: JSON.stringify(sampleSession),
      leitor_md_theme_reload_snapshot_v1: JSON.stringify({
        tabId: 'tab-1',
        docId: 'doc-1',
        scrollY: 100,
        isEditable: false,
        isHighlightMode: false,
        isSourceMode: false,
        savedAt: Date.now() - 20_000,
      }),
    };

    vi.stubGlobal('localStorage', createStorageStub(localBacking));
    vi.stubGlobal('sessionStorage', createStorageStub(sessionBacking));

    const { useAppStore: freshStore } = await import('./useAppStore');
    const state = freshStore.getState();

    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
    expect(state.tabGroups).toEqual([]);
    expect(state.document).toBeNull();
    expect(sessionBacking['leitor_md_document']).toBeUndefined();
    expect(sessionBacking['leitor_md_open_tabs_v1']).toBeUndefined();
    expect(localBacking['leitor_md_document']).toBeUndefined();
    expect(localBacking['leitor_md_open_tabs_v1']).toBeUndefined();
  });
});

describe('Pilha de Navegação de Modais', () => {
  beforeEach(() => {
    useAppStore.getState().closeAllModals();
  });

  it('navega em cadeia (open_source -> onedrive -> settings -> recent) e volta passo a passo com goBackModal', () => {
    useAppStore.getState().setIsOpenSourceModalOpen(true);
    expect(useAppStore.getState().isOpenSourceModalOpen).toBe(true);
    expect(useAppStore.getState().modalHistory).toEqual([]);

    useAppStore.getState().navigateToModal({ modal: 'onedrive', mode: 'open' });
    expect(useAppStore.getState().isOpenSourceModalOpen).toBe(false);
    expect(useAppStore.getState().isOneDriveModalOpen).toBe(true);
    expect(useAppStore.getState().oneDriveModalMode).toBe('open');
    expect(useAppStore.getState().modalHistory).toEqual([{ modal: 'open_source' }]);

    useAppStore.getState().navigateToModal({ modal: 'settings' });
    expect(useAppStore.getState().isOneDriveModalOpen).toBe(false);
    expect(useAppStore.getState().isSettingsModalOpen).toBe(true);
    expect(useAppStore.getState().modalHistory).toEqual([
      { modal: 'open_source' },
      { modal: 'onedrive', mode: 'open', successAction: null },
    ]);

    useAppStore.getState().navigateToModal({ modal: 'recent' });
    expect(useAppStore.getState().isSettingsModalOpen).toBe(false);
    expect(useAppStore.getState().isRecentModalOpen).toBe(true);
    expect(useAppStore.getState().modalHistory).toHaveLength(3);

    expect(useAppStore.getState().goBackModal()).toBe(true);
    expect(useAppStore.getState().isRecentModalOpen).toBe(false);
    expect(useAppStore.getState().isSettingsModalOpen).toBe(true);

    expect(useAppStore.getState().goBackModal()).toBe(true);
    expect(useAppStore.getState().isSettingsModalOpen).toBe(false);
    expect(useAppStore.getState().isOneDriveModalOpen).toBe(true);
    expect(useAppStore.getState().oneDriveModalMode).toBe('open');

    expect(useAppStore.getState().goBackModal()).toBe(true);
    expect(useAppStore.getState().isOneDriveModalOpen).toBe(false);
    expect(useAppStore.getState().isOpenSourceModalOpen).toBe(true);
    expect(useAppStore.getState().modalHistory).toEqual([]);

    expect(useAppStore.getState().goBackModal()).toBe(false);
    expect(useAppStore.getState().isOpenSourceModalOpen).toBe(false);
  });

  it('preserva o modo save_as do OneDrive ao voltar de SettingsModal', () => {
    useAppStore.getState().setIsSaveDestinationModalOpen(true);
    useAppStore.getState().navigateToModal({ modal: 'onedrive', mode: 'save_as', successAction: 'close' });
    useAppStore.getState().navigateToModal({ modal: 'settings' });

    expect(useAppStore.getState().isSettingsModalOpen).toBe(true);
    expect(useAppStore.getState().goBackModal()).toBe(true);

    const state = useAppStore.getState();
    expect(state.isOneDriveModalOpen).toBe(true);
    expect(state.oneDriveModalMode).toBe('save_as');
    expect(state.oneDriveSuccessAction).toBe('close');
  });

  it('closeAllModals fecha todos os modais e limpa o histórico, e abertura direta limpa histórico residual', () => {
    useAppStore.getState().setIsOpenSourceModalOpen(true);
    useAppStore.getState().navigateToModal({ modal: 'onedrive', mode: 'open' });
    useAppStore.getState().navigateToModal({ modal: 'settings' });
    expect(useAppStore.getState().modalHistory).toHaveLength(2);

    useAppStore.getState().closeAllModals();
    let state = useAppStore.getState();
    expect(state.isOpenSourceModalOpen).toBe(false);
    expect(state.isOneDriveModalOpen).toBe(false);
    expect(state.isSettingsModalOpen).toBe(false);
    expect(state.isRecentModalOpen).toBe(false);
    expect(state.isSaveDestinationModalOpen).toBe(false);
    expect(state.isInstallModalOpen).toBe(false);
    expect(state.modalHistory).toEqual([]);

    useAppStore.getState().setIsOpenSourceModalOpen(true);
    useAppStore.getState().navigateToModal({ modal: 'onedrive', mode: 'open' });
    expect(useAppStore.getState().modalHistory).toHaveLength(1);

    // Abertura direta pela raiz deve descartar histórico residual
    useAppStore.getState().setIsSettingsModalOpen(true);
    state = useAppStore.getState();
    expect(state.isSettingsModalOpen).toBe(true);
    expect(state.modalHistory).toEqual([]);
  });
});
