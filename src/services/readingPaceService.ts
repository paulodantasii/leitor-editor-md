/**
 * Máquina de estados pura e imutável para estimativa adaptativa de velocidade de leitura (PPM/WPM).
 *
 * Princípios:
 * - Calibra suavemente (EMA) quando o usuário lê continuamente para frente.
 * - Ignora mudanças bruscas de rolagem (saltos > 450 palavras ou > 650 ppm instantâneos).
 * - Ignora rolagem para trás (> 30 palavras) e saltos programáticos (Sumário, Último Grifo/Comentário).
 * - Exclui ociosidade prolongada (> 2 min sem interação) e aba em segundo plano.
 * - Aplica limites plausíveis [80, 380] ppm e winsorização suave após o aquecimento.
 */

export const DEFAULT_BASELINE_WPM = 130;
export const MIN_PLAUSIBLE_WPM = 80;
export const MAX_PLAUSIBLE_WPM = 380;
export const SAMPLE_MIN_ACCEPT_WPM = 60;
export const SAMPLE_MAX_ACCEPT_WPM = 430;
export const MIN_SAMPLE_WORDS = 65;
export const MIN_SAMPLE_ACTIVE_MS = 15_000;
export const MAX_SINGLE_JUMP_WORDS = 450;
export const MAX_INSTANT_STEP_WPM = 650;
export const BACKWARD_RESET_WORDS = 30;
export const IDLE_TIMEOUT_MS = 120_000;
export const MAX_WINDOW_ACTIVE_MS = 300_000;
export const HIDDEN_TAB_RESET_MS = 45_000;
export const WARMUP_SAMPLES = 3;
export const WARMUP_ALPHA = 0.28;
export const STEADY_ALPHA = 0.16;
export const GLOBAL_ALPHA = 0.10;
export const MAX_RELATIVE_SAMPLE_STEP = 0.45;
export const READING_PACE_STORAGE_KEY = 'leitor_md_adaptive_reading_wpm_v1';

export interface PersistedReadingPace {
  readonly globalWpm: number;
  readonly totalSamples: number;
  readonly updatedAt: number;
}

export interface ReadingPaceSessionState {
  readonly docId: string;
  readonly currentWpm: number;
  readonly globalWpm: number;
  readonly docSamples: number;
  readonly totalGlobalSamples: number;
  readonly anchorWordOffset: number | null;
  readonly anchorActiveMs: number;
  readonly lastWordOffset: number | null;
  readonly lastTickMs: number | null;
  readonly lastActivityMs: number | null;
  readonly isPaused: boolean;
  readonly hiddenSinceMs: number | null;
}

export interface ReadingPaceTransitionResult {
  readonly state: ReadingPaceSessionState;
  readonly didUpdateWpm: boolean;
}

type ProgrammaticJumpListener = () => void;
let programmaticJumpListeners: ReadonlyArray<ProgrammaticJumpListener> = [];

export function subscribeReadingPaceProgrammaticJump(
  listener: ProgrammaticJumpListener
): () => void {
  programmaticJumpListeners = [...programmaticJumpListeners, listener];
  return () => {
    programmaticJumpListeners = programmaticJumpListeners.filter((l) => l !== listener);
  };
}

export function notifyReadingPaceProgrammaticJump(): void {
  programmaticJumpListeners.forEach((listener) => listener());
}

export function clampReadingWpm(wpm: number): number {
  if (!Number.isFinite(wpm) || wpm <= 0) return DEFAULT_BASELINE_WPM;
  return Math.min(MAX_PLAUSIBLE_WPM, Math.max(MIN_PLAUSIBLE_WPM, wpm));
}

export function loadPersistedReadingPace(): PersistedReadingPace | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(READING_PACE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const globalWpm = clampReadingWpm(Number(parsed.globalWpm));
    const totalSamples =
      typeof parsed.totalSamples === 'number' && Number.isFinite(parsed.totalSamples) && parsed.totalSamples >= 0
        ? Math.floor(parsed.totalSamples)
        : 0;
    const updatedAt =
      typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : Date.now();
    return { globalWpm, totalSamples, updatedAt };
  } catch (err) {
    console.warn('Falha ao ler ritmo de leitura persistido:', err);
    return null;
  }
}

export function savePersistedReadingPace(pace: PersistedReadingPace): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const safePayload: PersistedReadingPace = {
      globalWpm: Math.round(clampReadingWpm(pace.globalWpm)),
      totalSamples: Math.max(0, Math.floor(pace.totalSamples)),
      updatedAt: Number.isFinite(pace.updatedAt) ? pace.updatedAt : Date.now(),
    };
    localStorage.setItem(READING_PACE_STORAGE_KEY, JSON.stringify(safePayload));
  } catch (err) {
    console.warn('Falha ao salvar ritmo de leitura persistido:', err);
  }
}

export function clearPersistedReadingPace(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(READING_PACE_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('Falha ao limpar ritmo de leitura persistido:', err);
  }
}

export function createReadingPaceSession(
  docId: string,
  persisted?: PersistedReadingPace | null
): ReadingPaceSessionState {
  const initialWpm = persisted ? Math.round(clampReadingWpm(persisted.globalWpm)) : DEFAULT_BASELINE_WPM;
  const totalGlobalSamples = persisted ? Math.max(0, Math.floor(persisted.totalSamples)) : 0;

  return {
    docId,
    currentWpm: initialWpm,
    globalWpm: initialWpm,
    docSamples: 0,
    totalGlobalSamples,
    anchorWordOffset: null,
    anchorActiveMs: 0,
    lastWordOffset: null,
    lastTickMs: null,
    lastActivityMs: null,
    isPaused: false,
    hiddenSinceMs: null,
  };
}

function reanchorSession(
  state: ReadingPaceSessionState,
  wordOffset: number | null,
  nowMs: number
): ReadingPaceSessionState {
  return {
    ...state,
    anchorWordOffset: wordOffset,
    anchorActiveMs: 0,
    lastWordOffset: wordOffset,
    lastTickMs: nowMs,
    lastActivityMs: nowMs,
  };
}

export function recordPaceActivity(
  state: ReadingPaceSessionState,
  nowMs: number
): ReadingPaceSessionState {
  if (state.isPaused) return state;

  if (
    state.lastActivityMs !== null &&
    nowMs - state.lastActivityMs > IDLE_TIMEOUT_MS
  ) {
    return {
      ...state,
      anchorWordOffset: null,
      anchorActiveMs: 0,
      lastTickMs: nowMs,
      lastActivityMs: nowMs,
    };
  }

  return {
    ...state,
    lastActivityMs: nowMs,
  };
}

export function recordPaceVisibilityChange(
  state: ReadingPaceSessionState,
  isVisible: boolean,
  nowMs: number
): ReadingPaceSessionState {
  if (!isVisible) {
    if (state.isPaused) return state;
    return {
      ...state,
      isPaused: true,
      hiddenSinceMs: nowMs,
    };
  }

  const awayMs = state.hiddenSinceMs !== null ? Math.max(0, nowMs - state.hiddenSinceMs) : 0;
  if (awayMs > HIDDEN_TAB_RESET_MS) {
    return {
      ...state,
      anchorWordOffset: null,
      anchorActiveMs: 0,
      lastWordOffset: null,
      lastTickMs: nowMs,
      lastActivityMs: nowMs,
      isPaused: false,
      hiddenSinceMs: null,
    };
  }

  return {
    ...state,
    lastTickMs: nowMs,
    lastActivityMs: nowMs,
    isPaused: false,
    hiddenSinceMs: null,
  };
}

export function recordPaceProgrammaticJump(
  state: ReadingPaceSessionState,
  newWordOffset: number | null,
  nowMs: number
): ReadingPaceSessionState {
  return reanchorSession(state, newWordOffset, nowMs);
}

export function recordPaceScroll(
  state: ReadingPaceSessionState,
  wordOffset: number,
  nowMs: number,
  isEditable: boolean
): ReadingPaceTransitionResult {
  const safeOffset = Math.max(0, Math.round(wordOffset));

  if (isEditable || state.isPaused) {
    return {
      state: reanchorSession(state, safeOffset, nowMs),
      didUpdateWpm: false,
    };
  }

  if (state.anchorWordOffset === null || state.lastTickMs === null) {
    return {
      state: reanchorSession(state, safeOffset, nowMs),
      didUpdateWpm: false,
    };
  }

  const rawDtMs = Math.max(0, nowMs - state.lastTickMs);
  const sinceActivityMs =
    state.lastActivityMs !== null ? Math.max(0, nowMs - state.lastActivityMs) : rawDtMs;

  if (rawDtMs > IDLE_TIMEOUT_MS || sinceActivityMs > IDLE_TIMEOUT_MS) {
    return {
      state: reanchorSession(state, safeOffset, nowMs),
      didUpdateWpm: false,
    };
  }

  const prevWord = state.lastWordOffset ?? state.anchorWordOffset;
  const stepWords = safeOffset - prevWord;

  if (
    stepWords < -BACKWARD_RESET_WORDS ||
    safeOffset < state.anchorWordOffset - BACKWARD_RESET_WORDS
  ) {
    return {
      state: reanchorSession(state, safeOffset, nowMs),
      didUpdateWpm: false,
    };
  }

  if (stepWords > MAX_SINGLE_JUMP_WORDS) {
    return {
      state: reanchorSession(state, safeOffset, nowMs),
      didUpdateWpm: false,
    };
  }

  if (stepWords >= 120 && rawDtMs > 0) {
    const instantWpm = stepWords / (rawDtMs / 60_000);
    if (instantWpm > MAX_INSTANT_STEP_WPM) {
      return {
        state: reanchorSession(state, safeOffset, nowMs),
        didUpdateWpm: false,
      };
    }
  }

  const nextActiveMs = state.anchorActiveMs + rawDtMs;
  const windowWords = safeOffset - state.anchorWordOffset;

  if (windowWords >= MIN_SAMPLE_WORDS && nextActiveMs >= MIN_SAMPLE_ACTIVE_MS) {
    const rawSampleWpm = windowWords / (nextActiveMs / 60_000);

    if (rawSampleWpm < SAMPLE_MIN_ACCEPT_WPM || rawSampleWpm > SAMPLE_MAX_ACCEPT_WPM) {
      return {
        state: reanchorSession(state, safeOffset, nowMs),
        didUpdateWpm: false,
      };
    }

    let boundedSample = clampReadingWpm(rawSampleWpm);
    if (state.docSamples >= WARMUP_SAMPLES) {
      const minStep = state.currentWpm * (1 - MAX_RELATIVE_SAMPLE_STEP);
      const maxStep = state.currentWpm * (1 + MAX_RELATIVE_SAMPLE_STEP);
      boundedSample = clampReadingWpm(Math.min(maxStep, Math.max(minStep, boundedSample)));
    }

    const alpha = state.docSamples < WARMUP_SAMPLES ? WARMUP_ALPHA : STEADY_ALPHA;
    const nextCurrentWpm = Math.round(
      clampReadingWpm(state.currentWpm * (1 - alpha) + boundedSample * alpha)
    );
    const nextGlobalWpm = Math.round(
      clampReadingWpm(state.globalWpm * (1 - GLOBAL_ALPHA) + boundedSample * GLOBAL_ALPHA)
    );

    return {
      state: {
        ...reanchorSession(state, safeOffset, nowMs),
        currentWpm: nextCurrentWpm,
        globalWpm: nextGlobalWpm,
        docSamples: state.docSamples + 1,
        totalGlobalSamples: state.totalGlobalSamples + 1,
      },
      didUpdateWpm: true,
    };
  }

  if (nextActiveMs > MAX_WINDOW_ACTIVE_MS) {
    return {
      state: reanchorSession(state, safeOffset, nowMs),
      didUpdateWpm: false,
    };
  }

  return {
    state: {
      ...state,
      anchorActiveMs: nextActiveMs,
      lastWordOffset: safeOffset,
      lastTickMs: nowMs,
      lastActivityMs: nowMs,
    },
    didUpdateWpm: false,
  };
}
