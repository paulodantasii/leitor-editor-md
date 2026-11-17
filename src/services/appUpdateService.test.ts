import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  forceAppUpdate,
  checkAndApplyAppUpdate,
  initAutoUpdateListeners,
} from './appUpdateService';
import { markThemeReloadRestoredOnBoot, THEME_RELOAD_SNAPSHOT_KEY } from './themeReloadSnapshot';

describe('appUpdateService — Invalidação de Cache PWA e Auto-Update', () => {
  const mockSessionStorage: Record<string, string> = {};
  const mockLocalStorage: Record<string, string> = {};
  let deletedCaches: string[] = [];
  let unregisteredCount = 0;
  let replacedUrl = '';

  beforeEach(() => {
    for (const k of Object.keys(mockSessionStorage)) delete mockSessionStorage[k];
    for (const k of Object.keys(mockLocalStorage)) delete mockLocalStorage[k];
    deletedCaches = [];
    unregisteredCount = 0;
    replacedUrl = '';

    vi.stubGlobal('__APP_BUILD_ID__', 'v1.0.0-old');

    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => mockSessionStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockSessionStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockSessionStorage[k];
      },
    });

    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mockLocalStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockLocalStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete mockLocalStorage[k];
      },
    });

    vi.stubGlobal('caches', {
      keys: async () => ['leitor-html-v1', 'leitor-md-v2'],
      delete: async (k: string) => {
        deletedCaches.push(k);
        return true;
      },
    });

    vi.stubGlobal('navigator', {
      onLine: true,
      serviceWorker: {
        register: vi.fn().mockResolvedValue({ update: vi.fn().mockResolvedValue(undefined) }),
        getRegistrations: async () => [
          {
            unregister: async () => {
              unregisteredCount++;
              return true;
            },
          },
        ],
      },
    });

    vi.stubGlobal('window', {
      location: {
        href: 'https://example.com/leitor-editor-md/',
        replace: (url: string) => {
          replacedUrl = url;
        },
      },
      history: {
        replaceState: vi.fn(),
      },
      caches: (globalThis as any).caches,
    });

    vi.stubGlobal('document', { title: 'Leitor MD' });
    markThemeReloadRestoredOnBoot(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forceAppUpdate limpa CacheStorage e desregistra SW preservando localStorage intacto', async () => {
    mockLocalStorage['leitor_md_preferences'] = JSON.stringify({ theme: 'dark' });
    mockLocalStorage['leitor_md_azure_client_id'] = 'client-123';
    mockSessionStorage['leitor_md_document'] = JSON.stringify({
      title: 'Importante.md',
      content: '# Meu Texto',
    });

    await forceAppUpdate();

    expect(unregisteredCount).toBe(1);
    expect(deletedCaches).toEqual(['leitor-html-v1', 'leitor-md-v2']);
    expect(mockLocalStorage['leitor_md_preferences']).toBeDefined();
    expect(mockLocalStorage['leitor_md_azure_client_id']).toBe('client-123');
    expect(mockSessionStorage['leitor_md_document']).toBeDefined();
    expect(replacedUrl).toContain('_v=');
  });

  it('forceAppUpdate({ clearSession: true }) remove chaves de sessão e snapshot mantendo preferências no localStorage', async () => {
    mockLocalStorage['leitor_md_preferences'] = JSON.stringify({ theme: 'dark' });
    mockLocalStorage['leitor_md_azure_client_id'] = 'client-123';
    mockLocalStorage['leitor_md_document'] = JSON.stringify({ title: 'Legado.md' });
    mockLocalStorage['leitor_md_open_tabs_v1'] = JSON.stringify({ tabs: [] });

    mockSessionStorage['leitor_md_document'] = JSON.stringify({ title: 'Ativo.md' });
    mockSessionStorage['leitor_md_open_tabs_v1'] = JSON.stringify({ tabs: [{ id: 't1' }] });
    mockSessionStorage[THEME_RELOAD_SNAPSHOT_KEY] = JSON.stringify({ tabId: 't1' });

    await forceAppUpdate({ clearSession: true });

    expect(unregisteredCount).toBe(1);
    expect(deletedCaches).toEqual(['leitor-html-v1', 'leitor-md-v2']);
    expect(mockSessionStorage['leitor_md_document']).toBeUndefined();
    expect(mockSessionStorage['leitor_md_open_tabs_v1']).toBeUndefined();
    expect(mockSessionStorage[THEME_RELOAD_SNAPSHOT_KEY]).toBeUndefined();
    expect(mockLocalStorage['leitor_md_document']).toBeUndefined();
    expect(mockLocalStorage['leitor_md_open_tabs_v1']).toBeUndefined();
    expect(mockLocalStorage['leitor_md_preferences']).toBeDefined();
    expect(mockLocalStorage['leitor_md_azure_client_id']).toBe('client-123');
    expect(replacedUrl).toContain('_v=');
  });

  it('initAutoUpdateListeners não dispara checkAndApplyAppUpdate quando wasThemeReloadRestoredOnBoot() for true', () => {
    vi.stubEnv('PROD', true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buildId: 'v1.0.0-new' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    markThemeReloadRestoredOnBoot(true);
    initAutoUpdateListeners();

    expect(fetchMock).not.toHaveBeenCalled();

    markThemeReloadRestoredOnBoot(false);
    initAutoUpdateListeners();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('checkAndApplyAppUpdate dispara atualização quando version.json possui buildId diferente e aplica trava anti-loop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ buildId: 'v1.0.0-new-deploy' }),
      })
    );

    const updated = await checkAndApplyAppUpdate();
    expect(updated).toBe(true);
    expect(mockSessionStorage['leitor_md_reloaded_build']).toBe('v1.0.0-new-deploy');
    expect(deletedCaches).toEqual(['leitor-html-v1', 'leitor-md-v2']);

    // Segunda chamada com o mesmo buildId não deve entrar em loop
    const secondCall = await checkAndApplyAppUpdate();
    expect(secondCall).toBe(false);
  });

  it('checkAndApplyAppUpdate não recarrega quando buildId remoto é idêntico ao atual', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ buildId: 'v1.0.0-old' }),
      })
    );

    const updated = await checkAndApplyAppUpdate();
    expect(updated).toBe(false);
    expect(deletedCaches).toHaveLength(0);
    expect(replacedUrl).toBe('');
  });
});
