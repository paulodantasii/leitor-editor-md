import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_BASELINE_WPM,
  HIDDEN_TAB_RESET_MS,
  IDLE_TIMEOUT_MS,
  MAX_PLAUSIBLE_WPM,
  MIN_PLAUSIBLE_WPM,
  READING_PACE_STORAGE_KEY,
  clearPersistedReadingPace,
  createReadingPaceSession,
  loadPersistedReadingPace,
  recordPaceActivity,
  recordPaceProgrammaticJump,
  recordPaceScroll,
  recordPaceVisibilityChange,
  savePersistedReadingPace,
} from './readingPaceService';

describe('readingPaceService', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => mockStorage[k] ?? null),
      setItem: vi.fn((k: string, v: string) => {
        mockStorage[k] = v;
      }),
      removeItem: vi.fn((k: string) => {
        delete mockStorage[k];
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('converge suavemente para leitura rápida contínua respeitando limite máximo plausível', () => {
    let session = createReadingPaceSession('doc-1');
    expect(session.currentWpm).toBe(DEFAULT_BASELINE_WPM);

    let now = 1_000_000;
    let words = 0;

    // Ancora inicial
    session = recordPaceScroll(session, words, now, false).state;

    // Simula leitura contínua a ~260 ppm em incrementos de 20s (~86 palavras por janela)
    for (let i = 0; i < 6; i++) {
      now += 20_000;
      words += 87;
      session = recordPaceActivity(session, now - 2_000);
      const res = recordPaceScroll(session, words, now, false);
      session = res.state;
      expect(res.didUpdateWpm).toBe(true);
    }

    expect(session.currentWpm).toBeGreaterThan(200);
    expect(session.currentWpm).toBeLessThanOrEqual(MAX_PLAUSIBLE_WPM);
  });

  it('converge para baixo em leitura lenta respeitando limite mínimo plausível', () => {
    let session = createReadingPaceSession('doc-slow', {
      globalWpm: 220,
      totalSamples: 5,
      updatedAt: 1000,
    });

    let now = 1_000_000;
    let words = 0;
    session = recordPaceScroll(session, words, now, false).state;

    // Simula leitura lenta a ~90 ppm (75 palavras em 50s)
    for (let i = 0; i < 6; i++) {
      now += 50_000;
      words += 75;
      session = recordPaceActivity(session, now - 5_000);
      const res = recordPaceScroll(session, words, now, false);
      session = res.state;
      expect(res.didUpdateWpm).toBe(true);
    }

    expect(session.currentWpm).toBeLessThan(160);
    expect(session.currentWpm).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_WPM);
  });

  it('ignora saltos bruscos de rolagem e documentos de consulta esporádica', () => {
    let session = createReadingPaceSession('doc-ref');
    let now = 1_000_000;

    // Início -> salto direto para o final (2000 palavras) -> volta para o início -> vai para o meio
    session = recordPaceScroll(session, 0, now, false).state;

    now += 3_000;
    const jumpEnd = recordPaceScroll(session, 2000, now, false);
    expect(jumpEnd.didUpdateWpm).toBe(false);
    session = jumpEnd.state;

    now += 4_000;
    const jumpBack = recordPaceScroll(session, 50, now, false);
    expect(jumpBack.didUpdateWpm).toBe(false);
    session = jumpBack.state;

    now += 5_000;
    const jumpMiddle = recordPaceScroll(session, 900, now, false);
    expect(jumpMiddle.didUpdateWpm).toBe(false);
    session = jumpMiddle.state;

    expect(session.currentWpm).toBe(DEFAULT_BASELINE_WPM);
    expect(session.docSamples).toBe(0);
  });

  it('não computa ociosidade prolongada nem aba oculta na média', () => {
    let session = createReadingPaceSession('doc-idle');
    let now = 1_000_000;

    session = recordPaceScroll(session, 0, now, false).state;

    // Avança 40 palavras em 15s (ainda acumulando janela)
    now += 15_000;
    session = recordPaceScroll(session, 40, now, false).state;

    // Fica ocioso por mais de IDLE_TIMEOUT_MS
    now += IDLE_TIMEOUT_MS + 10_000;
    const afterIdle = recordPaceScroll(session, 120, now, false);
    expect(afterIdle.didUpdateWpm).toBe(false);
    expect(afterIdle.state.currentWpm).toBe(DEFAULT_BASELINE_WPM);

    // Pausa em aba oculta por > HIDDEN_TAB_RESET_MS descarta janela
    session = recordPaceVisibilityChange(afterIdle.state, false, now);
    expect(session.isPaused).toBe(true);
    session = recordPaceVisibilityChange(session, true, now + HIDDEN_TAB_RESET_MS + 5_000);
    expect(session.isPaused).toBe(false);
    expect(session.anchorWordOffset).toBeNull();
  });

  it('ignora saltos programáticos e modo edição', () => {
    let session = createReadingPaceSession('doc-prog');
    let now = 1_000_000;

    session = recordPaceScroll(session, 100, now, false).state;
    now += 20_000;
    session = recordPaceProgrammaticJump(session, 850, now);
    expect(session.anchorWordOffset).toBe(850);
    expect(session.currentWpm).toBe(DEFAULT_BASELINE_WPM);

    const editRes = recordPaceScroll(session, 980, now + 25_000, true);
    expect(editRes.didUpdateWpm).toBe(false);
    expect(editRes.state.currentWpm).toBe(DEFAULT_BASELINE_WPM);
  });

  it('persiste e limpa ritmo global no localStorage com segurança', () => {
    savePersistedReadingPace({ globalWpm: 195, totalSamples: 4, updatedAt: 123456 });
    const loaded = loadPersistedReadingPace();
    expect(loaded).toEqual({ globalWpm: 195, totalSamples: 4, updatedAt: 123456 });
    expect(mockStorage[READING_PACE_STORAGE_KEY]).toBeDefined();

    clearPersistedReadingPace();
    expect(loadPersistedReadingPace()).toBeNull();
  });
});
