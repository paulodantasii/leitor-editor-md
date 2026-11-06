import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flushMock = vi.fn();
const saveScrollMock = vi.fn();
const storeState: Record<string, unknown> = {};
const setStateMock = vi.fn();

vi.mock('./appUpdateService', () => ({
  flushUserWorkBeforeReload: () => flushMock(),
}));

vi.mock('./tabScrollMemory', () => ({
  saveTabScrollPosition: (...args: unknown[]) => saveScrollMock(...args),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: () => storeState,
    setState: (...args: unknown[]) => setStateMock(...args),
  },
}));

const KEY = 'leitor_md_theme_reload_snapshot_v1';

function createStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function stubBrowser(options: { storage?: ReturnType<typeof createStorage> } = {}) {
  const reload = vi.fn();
  const storage = options.storage ?? createStorage();
  vi.stubGlobal('window', {
    scrollY: 120.4,
    location: { reload },
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('navigator', {});
  return { reload, storage };
}

async function loadService() {
  vi.resetModules();
  return import('./themeReloadService');
}

beforeEach(() => {
  flushMock.mockReset();
  saveScrollMock.mockReset();
  setStateMock.mockReset();
  Object.keys(storeState).forEach((k) => delete storeState[k]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('normalizeEditorModes', () => {
  it('Edição desliga Grifo e mantém Código-Fonte', async () => {
    const { normalizeEditorModes } = await loadService();
    expect(normalizeEditorModes({ isEditable: true, isHighlightMode: true, isSourceMode: true })).toEqual({
      isEditable: true,
      isHighlightMode: false,
      isSourceMode: true,
    });
  });

  it('Fora de Edição desliga Código-Fonte e mantém Grifo', async () => {
    const { normalizeEditorModes } = await loadService();
    expect(normalizeEditorModes({ isEditable: false, isHighlightMode: true, isSourceMode: true })).toEqual({
      isEditable: false,
      isHighlightMode: true,
      isSourceMode: false,
    });
  });
});

describe('parseThemeReloadSnapshot', () => {
  const now = 1_000_000;
  const base = { tabId: 't1', docId: 'd1', scrollY: 10.6, isEditable: true, savedAt: now - 1000 };

  it('retorna null para entrada nula', async () => {
    const { parseThemeReloadSnapshot } = await loadService();
    expect(parseThemeReloadSnapshot(null, now)).toBeNull();
  });

  it('retorna null para JSON inválido e avisa', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { parseThemeReloadSnapshot } = await loadService();
    expect(parseThemeReloadSnapshot('{oops', now)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('retorna null para tabId vazio', async () => {
    const { parseThemeReloadSnapshot } = await loadService();
    expect(parseThemeReloadSnapshot(JSON.stringify({ ...base, tabId: '' }), now)).toBeNull();
  });

  it('aceita snapshot válido e arredonda scrollY', async () => {
    const { parseThemeReloadSnapshot } = await loadService();
    const result = parseThemeReloadSnapshot(JSON.stringify(base), now);
    expect(result?.scrollY).toBe(11);
    expect(result?.docId).toBe('d1');
    expect(result?.isEditable).toBe(true);
  });

  it('rejeita snapshot expirado', async () => {
    const { parseThemeReloadSnapshot } = await loadService();
    expect(parseThemeReloadSnapshot(JSON.stringify({ ...base, savedAt: now - 16_000 }), now)).toBeNull();
  });

  it('rejeita snapshot do futuro', async () => {
    const { parseThemeReloadSnapshot } = await loadService();
    expect(parseThemeReloadSnapshot(JSON.stringify({ ...base, savedAt: now + 5000 }), now)).toBeNull();
  });
});

describe('reloadForThemeChange', () => {
  it('faz flush, grava o snapshot e recarrega uma vez', async () => {
    const { reload, storage } = stubBrowser();
    storeState.activeTabId = 'tab-1';
    storeState.document = { docId: 'doc-1' };
    storeState.isEditable = true;
    storeState.isHighlightMode = false;
    storeState.isSourceMode = false;

    const { reloadForThemeChange } = await loadService();
    reloadForThemeChange();

    expect(flushMock).toHaveBeenCalledTimes(1);
    expect(storage.getItem(KEY)).not.toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('chamadas repetidas não disparam segundo reload', async () => {
    const { reload } = stubBrowser();
    storeState.activeTabId = 'tab-1';

    const { reloadForThemeChange } = await loadService();
    reloadForThemeChange();
    reloadForThemeChange();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(flushMock).toHaveBeenCalledTimes(1);
  });
});

describe('restoreStateAfterThemeReload', () => {
  const snapshot = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      tabId: 'tab-1',
      docId: 'doc-1',
      scrollY: 300,
      isEditable: true,
      isHighlightMode: true,
      isSourceMode: true,
      savedAt: Date.now(),
      ...overrides,
    });

  it('restaura scroll e modos na mesma aba/doc e remove a chave', async () => {
    const storage = createStorage({ [KEY]: snapshot() });
    stubBrowser({ storage });
    storeState.activeTabId = 'tab-1';
    storeState.document = { docId: 'doc-1' };

    const { restoreStateAfterThemeReload } = await loadService();
    expect(restoreStateAfterThemeReload()).toBe(true);
    expect(saveScrollMock).toHaveBeenCalledWith('tab-1', 300, 'doc-1');
    expect(setStateMock).toHaveBeenCalledWith({
      isEditable: true,
      isHighlightMode: false,
      isSourceMode: true,
    });
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('aba ou doc diferentes: retorna false e não altera o estado', async () => {
    const storage = createStorage({ [KEY]: snapshot({ tabId: 'outra' }) });
    stubBrowser({ storage });
    storeState.activeTabId = 'tab-1';
    storeState.document = { docId: 'doc-1' };

    const { restoreStateAfterThemeReload } = await loadService();
    expect(restoreStateAfterThemeReload()).toBe(false);
    expect(setStateMock).not.toHaveBeenCalled();
    expect(saveScrollMock).not.toHaveBeenCalled();
  });
});

describe('shouldReloadForThemeChange', () => {
  it('true com navigator.standalone', async () => {
    stubBrowser();
    vi.stubGlobal('navigator', { standalone: true });
    const { shouldReloadForThemeChange } = await loadService();
    expect(shouldReloadForThemeChange()).toBe(true);
  });

  it('false sem standalone', async () => {
    stubBrowser();
    const { shouldReloadForThemeChange } = await loadService();
    expect(shouldReloadForThemeChange()).toBe(false);
  });
});
