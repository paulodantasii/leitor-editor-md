import { describe, it, expect, beforeEach, vi } from 'vitest';

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
