import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentState, TabItem } from '../types';

const callOrder: string[] = [];
const markBridgeCleanMock = vi.fn(() => {
  callOrder.push('markBridgeClean');
});
const closeDocumentMock = vi.fn(() => {
  callOrder.push('closeDocument');
});
const forceAppUpdateMock = vi.fn(async (options?: { clearSession?: boolean }) => {
  callOrder.push(`forceAppUpdate:${JSON.stringify(options ?? {})}`);
});

vi.mock('./editorContentBridge', () => ({
  markBridgeClean: () => markBridgeCleanMock(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      closeDocument: closeDocumentMock,
    }),
  },
}));

vi.mock('./appUpdateService', () => ({
  forceAppUpdate: (options?: { clearSession?: boolean }) => forceAppUpdateMock(options),
}));

import { executeCleanAppReload, getReloadTabsWarningInfo } from './cleanReloadService';

const makeDoc = (overrides: Partial<DocumentState> = {}): DocumentState => ({
  title: 'Documento.md',
  content: '# Conteúdo',
  oneDriveItemId: null,
  lastSavedAt: null,
  isDirty: false,
  revision: 0,
  draftRevision: 0,
  sourceRevision: 0,
  docId: 'doc-1',
  ...overrides,
});

const makeTab = (overrides: Partial<TabItem> = {}): TabItem => ({
  id: 'tab-1',
  title: 'Documento.md',
  isDirty: false,
  docId: 'doc-1',
  oneDriveItemId: null,
  ...overrides,
});

describe('cleanReloadService — getReloadTabsWarningInfo', () => {
  it('retorna contagem zerada e sem alterações quando não há abas nem documento ativo', () => {
    const info = getReloadTabsWarningInfo([], null, null, false);
    expect(info).toEqual({
      totalTabsCount: 0,
      openDocTabsCount: 0,
      dirtyTabTitles: [],
      hasUnsavedWork: false,
    });
  });

  it('conta corretamente abas limpas e ignora aba Nova guia em openDocTabsCount', () => {
    const tabs: TabItem[] = [
      makeTab({ id: 'tab-home', kind: 'home', title: 'Nova guia', docId: 'home' }),
      makeTab({ id: 'tab-1', title: 'Notas.md', docId: 'doc-1' }),
      makeTab({ id: 'tab-2', title: 'Roteiro.md', docId: 'doc-2' }),
    ];
    const info = getReloadTabsWarningInfo(tabs, 'tab-1', makeDoc({ title: 'Notas.md' }), false);

    expect(info.totalTabsCount).toBe(3);
    expect(info.openDocTabsCount).toBe(2);
    expect(info.dirtyTabTitles).toEqual([]);
    expect(info.hasUnsavedWork).toBe(false);
  });

  it('detecta aba em segundo plano com isDirty true', () => {
    const tabs: TabItem[] = [
      makeTab({ id: 'tab-1', title: 'Ativa.md', isDirty: false }),
      makeTab({ id: 'tab-2', title: 'Fundo.md', isDirty: true }),
    ];
    const info = getReloadTabsWarningInfo(tabs, 'tab-1', makeDoc({ title: 'Ativa.md' }), false);

    expect(info.dirtyTabTitles).toEqual(['Fundo.md']);
    expect(info.hasUnsavedWork).toBe(true);
  });

  it('detecta aba ativa suja apenas por hasPendingBridge === true e evita títulos duplicados', () => {
    const tabs: TabItem[] = [
      makeTab({ id: 'tab-1', title: 'Duplicado.md', isDirty: true }),
      makeTab({ id: 'tab-2', title: 'Duplicado.md', isDirty: false }),
    ];
    const info = getReloadTabsWarningInfo(
      tabs,
      'tab-2',
      makeDoc({ title: 'Duplicado.md', isDirty: false }),
      true
    );

    expect(info.dirtyTabTitles).toEqual(['Duplicado.md']);
    expect(info.hasUnsavedWork).toBe(true);
  });

  it('não marca aba Nova guia ativa como suja quando apenas hasPendingBridge for true', () => {
    const tabs: TabItem[] = [
      makeTab({ id: 'tab-home', kind: 'home', title: 'Nova guia', isDirty: false }),
    ];
    const info = getReloadTabsWarningInfo(tabs, 'tab-home', null, true);

    expect(info.dirtyTabTitles).toEqual([]);
    expect(info.hasUnsavedWork).toBe(true);
  });
});

describe('cleanReloadService — executeCleanAppReload', () => {
  beforeEach(() => {
    callOrder.length = 0;
    markBridgeCleanMock.mockClear();
    closeDocumentMock.mockClear();
    forceAppUpdateMock.mockClear();
  });

  it('executa markBridgeClean -> closeDocument -> forceAppUpdate({ clearSession: true }) em ordem estrita', async () => {
    await executeCleanAppReload();

    expect(markBridgeCleanMock).toHaveBeenCalledTimes(1);
    expect(closeDocumentMock).toHaveBeenCalledTimes(1);
    expect(forceAppUpdateMock).toHaveBeenCalledTimes(1);
    expect(forceAppUpdateMock).toHaveBeenCalledWith({ clearSession: true });
    expect(callOrder).toEqual([
      'markBridgeClean',
      'closeDocument',
      'forceAppUpdate:{"clearSession":true}',
    ]);
  });
});
