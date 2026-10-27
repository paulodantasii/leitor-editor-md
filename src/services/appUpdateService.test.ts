import { describe, it, expect, beforeEach, vi } from 'vitest';
import { forceAppUpdate, checkAndApplyAppUpdate } from './appUpdateService';

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
      caches: (globalThis as any).caches,
    });
  });

  it('forceAppUpdate limpa CacheStorage e desregistra SW preservando localStorage intacto', async () => {
    mockLocalStorage['leitor_md_document'] = JSON.stringify({ title: 'Importante.md', content: '# Meu Texto' });

    await forceAppUpdate();

    expect(unregisteredCount).toBe(1);
    expect(deletedCaches).toEqual(['leitor-html-v1', 'leitor-md-v2']);
    expect(mockLocalStorage['leitor_md_document']).toBeDefined();
    expect(replacedUrl).toContain('_v=');
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
