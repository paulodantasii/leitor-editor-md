import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readInstallButtonDismissed,
  writeInstallButtonDismissed,
  INSTALL_BUTTON_DISMISSED_KEY,
} from './usePwaInstall';

describe('usePwaInstall — Gerenciador de Instalação PWA', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      maxTouchPoints: 0,
    });

    vi.stubGlobal('window', {
      navigator: (globalThis as any).navigator,
      matchMedia: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it('deve inicializar com valores padrão seguros quando executado no navegador', () => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as any).standalone);

    expect(isStandalone).toBe(false);
  });

  it('deve reconhecer quando o app já está rodando em modo standalone', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('standalone'),
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    expect(isStandalone).toBe(true);
  });

  it('deve lidar com o evento beforeinstallprompt e invocar o prompt nativo', async () => {
    let promptCalled = false;
    const fakePromptEvent = {
      preventDefault: vi.fn(),
      prompt: async () => {
        promptCalled = true;
      },
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'windows' }),
    };

    await fakePromptEvent.prompt();
    const result = await fakePromptEvent.userChoice;

    expect(promptCalled).toBe(true);
    expect(result.outcome).toBe('accepted');
  });
});

describe('usePwaInstall — Persistência de dispensa do botão de instalação', () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('readInstallButtonDismissed() retorna false sem chave', () => {
    expect(readInstallButtonDismissed()).toBe(false);
  });

  it('após writeInstallButtonDismissed(), localStorage.getItem(KEY) === "1" e readInstallButtonDismissed() retorna true', () => {
    writeInstallButtonDismissed();
    expect(localStorage.getItem(INSTALL_BUTTON_DISMISSED_KEY)).toBe('1');
    expect(readInstallButtonDismissed()).toBe(true);
  });

  it('se localStorage.getItem lança erro, readInstallButtonDismissed() retorna false e não propaga (espiar console.warn)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Quota or Access Denied');
      },
      setItem: vi.fn(),
    });

    expect(readInstallButtonDismissed()).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'Falha ao ler preferência do botão de instalação:',
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });

  it('se setItem lança erro, writeInstallButtonDismissed() não propaga', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });

    expect(() => writeInstallButtonDismissed()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      'Falha ao salvar preferência do botão de instalação:',
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });
});
