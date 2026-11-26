import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_BASELINE_WPM,
  ReadingPaceSessionState,
  clearPersistedReadingPace,
  createReadingPaceSession,
  loadPersistedReadingPace,
  recordPaceActivity,
  recordPaceProgrammaticJump,
  recordPaceScroll,
  recordPaceVisibilityChange,
  savePersistedReadingPace,
  subscribeReadingPaceProgrammaticJump,
} from '../services/readingPaceService';

const SESSION_CACHE = new Map<string, ReadingPaceSessionState>();
const PROGRAMMATIC_JUMP_SUPPRESS_MS = 900;
const MOUSEMOVE_ACTIVITY_THROTTLE_MS = 5000;

export interface UseAdaptiveReadingPaceResult {
  readonly adaptiveWpm: number;
  readonly isCalibrated: boolean;
  readonly docSamples: number;
  readonly totalGlobalSamples: number;
  readonly onScrollWordOffset: (wordOffset: number) => void;
  readonly recalibrate: () => void;
}

function getOrCreateSession(docId: string): ReadingPaceSessionState {
  const existing = SESSION_CACHE.get(docId);
  if (existing) return existing;

  const created = createReadingPaceSession(docId, loadPersistedReadingPace());
  SESSION_CACHE.set(docId, created);
  return created;
}

export function useAdaptiveReadingPace(
  docId: string | undefined,
  isEditable: boolean
): UseAdaptiveReadingPaceResult {
  const resolvedDocId = docId || '__no_doc__';

  const [sessionState, setSessionState] = useState<ReadingPaceSessionState>(() =>
    getOrCreateSession(resolvedDocId)
  );

  const sessionRef = useRef<ReadingPaceSessionState>(sessionState);
  const isEditableRef = useRef<boolean>(isEditable);
  const lastWordOffsetRef = useRef<number>(0);
  const jumpSuppressUntilRef = useRef<number>(0);
  const jumpSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMouseActivityRef = useRef<number>(0);

  isEditableRef.current = isEditable;

  const commitSession = useCallback((next: ReadingPaceSessionState) => {
    sessionRef.current = next;
    SESSION_CACHE.set(next.docId, next);
    setSessionState(next);
  }, []);

  // Sincroniza troca de documento/aba preservando a calibração individual
  useEffect(() => {
    if (jumpSettleTimerRef.current) {
      clearTimeout(jumpSettleTimerRef.current);
      jumpSettleTimerRef.current = null;
    }
    jumpSuppressUntilRef.current = 0;

    const next = getOrCreateSession(resolvedDocId);
    const reanchored = recordPaceProgrammaticJump(next, null, Date.now());
    commitSession(reanchored);
  }, [resolvedDocId, commitSession]);

  // Listeners passivos de visibilidade, atividade e saltos programáticos
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';
      const next = recordPaceVisibilityChange(sessionRef.current, isVisible, Date.now());
      commitSession(next);
    };

    const handleDiscreteActivity = () => {
      const next = recordPaceActivity(sessionRef.current, Date.now());
      if (next !== sessionRef.current) {
        commitSession(next);
      }
    };

    const handleMouseMoveActivity = () => {
      const now = Date.now();
      if (now - lastMouseActivityRef.current < MOUSEMOVE_ACTIVITY_THROTTLE_MS) return;
      lastMouseActivityRef.current = now;
      const next = recordPaceActivity(sessionRef.current, now);
      if (next !== sessionRef.current) {
        commitSession(next);
      }
    };

    const unsubscribeJump = subscribeReadingPaceProgrammaticJump(() => {
      const now = Date.now();
      jumpSuppressUntilRef.current = now + PROGRAMMATIC_JUMP_SUPPRESS_MS;

      if (jumpSettleTimerRef.current) {
        clearTimeout(jumpSettleTimerRef.current);
      }
      jumpSettleTimerRef.current = setTimeout(() => {
        jumpSettleTimerRef.current = null;
        const settled = recordPaceProgrammaticJump(
          sessionRef.current,
          lastWordOffsetRef.current,
          Date.now()
        );
        commitSession(settled);
      }, PROGRAMMATIC_JUMP_SUPPRESS_MS);
    });

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('mousedown', handleDiscreteActivity, { passive: true });
    window.addEventListener('touchstart', handleDiscreteActivity, { passive: true });
    window.addEventListener('keydown', handleDiscreteActivity, { passive: true });
    window.addEventListener('mousemove', handleMouseMoveActivity, { passive: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('mousedown', handleDiscreteActivity);
      window.removeEventListener('touchstart', handleDiscreteActivity);
      window.removeEventListener('keydown', handleDiscreteActivity);
      window.removeEventListener('mousemove', handleMouseMoveActivity);
      unsubscribeJump();
      if (jumpSettleTimerRef.current) {
        clearTimeout(jumpSettleTimerRef.current);
        jumpSettleTimerRef.current = null;
      }
    };
  }, [commitSession]);

  const onScrollWordOffset = useCallback(
    (wordOffset: number) => {
      const safeOffset = Math.max(0, Math.round(wordOffset));
      lastWordOffsetRef.current = safeOffset;

      const now = Date.now();
      const isRestoringScroll =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('scroll-restoring');

      if (isRestoringScroll || now < jumpSuppressUntilRef.current) {
        const reanchored = recordPaceProgrammaticJump(sessionRef.current, safeOffset, now);
        commitSession(reanchored);
        return;
      }

      const result = recordPaceScroll(
        sessionRef.current,
        safeOffset,
        now,
        isEditableRef.current
      );

      if (result.didUpdateWpm) {
        savePersistedReadingPace({
          globalWpm: result.state.globalWpm,
          totalSamples: result.state.totalGlobalSamples,
          updatedAt: now,
        });
      }

      if (result.state !== sessionRef.current) {
        commitSession(result.state);
      }
    },
    [commitSession]
  );

  const recalibrate = useCallback(() => {
    clearPersistedReadingPace();
    SESSION_CACHE.clear();
    const fresh = createReadingPaceSession(resolvedDocId, null);
    const anchored = recordPaceProgrammaticJump(fresh, lastWordOffsetRef.current, Date.now());
    commitSession(anchored);
  }, [resolvedDocId, commitSession]);

  return {
    adaptiveWpm: sessionState.currentWpm || DEFAULT_BASELINE_WPM,
    isCalibrated: sessionState.docSamples > 0 || sessionState.totalGlobalSamples > 0,
    docSamples: sessionState.docSamples,
    totalGlobalSamples: sessionState.totalGlobalSamples,
    onScrollWordOffset,
    recalibrate,
  };
}
