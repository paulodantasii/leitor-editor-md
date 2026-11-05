import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useAppStore } from '../store/useAppStore';
import {
  saveTabScrollPosition,
  getTabScrollPosition,
  pruneTabScrollPositions,
} from '../services/tabScrollMemory';

/** Máximo de frames para estabilizar a posição (ex.: tabelas largas, fontes ou imagens). */
const MAX_RESTORE_FRAMES = 18;
/** Quantidade de frames consecutivos na posição alvo para confirmar estabilização. */
const REQUIRED_STABLE_FRAMES = 2;
/** Tolerância em px para considerar a posição alcançada. */
const SCROLL_TOLERANCE_PX = 2;

const RESTORING_CLASS = 'scroll-restoring';

const scrollWindowTo = (top: number): void => {
  window.scrollTo({ top, left: 0, behavior: 'instant' });
};

/**
 * Mantém a posição de leitura (scroll vertical da janela) independente e determinística para cada aba.
 *
 * Resolve:
 * 1. Transições entre documentos gigantes e pequenos (evita clamping prematuro por `content-visibility: auto`).
 * 2. Desmontagem e remontagem do `TiptapEditor` ao passar pela aba `Início` (`HomeScreen`).
 * 3. Reutilização da mesma aba quando `docId` muda (ex.: abrir arquivo sobre aba em branco).
 * 4. Interrupção imediata caso o usuário role manualmente (wheel / touch / teclado) durante a restauração.
 *
 * IMPORTANTE: deve ser chamado no TiptapEditor DEPOIS do efeito que executa `setContent` por `docId`.
 */
export function useTabScrollRestoration(editor: Editor | null): void {
  const activeTabId = useAppStore((state) => state.activeTabId);
  const docId = useAppStore((state) => state.document?.docId);

  const isRestoringRef = useRef<boolean>(false);
  const lastKnownScrollYRef = useRef<number>(typeof window !== 'undefined' ? window.scrollY : 0);
  const lastHandledKeyRef = useRef<string | null>(null);

  // 1. Rastreamento contínuo e seguro do scroll enquanto o usuário lê a aba ativa.
  //    Ignora eventos de scroll disparados enquanto uma transição/restauração está em andamento,
  //    impedindo que o clamping automático do navegador ao trocar para um documento menor
  //    sobrescreva o scroll salvo do documento maior.
  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      try {
        window.history.scrollRestoration = 'manual';
      } catch {
        // ignore
      }
    }

    const handleWindowScroll = (): void => {
      if (isRestoringRef.current) return;
      const state = useAppStore.getState();
      const currentTabId = state.activeTabId;
      const currentDocId = state.document?.docId;
      if (!currentTabId || !currentDocId) return;

      const currentY = window.scrollY;
      lastKnownScrollYRef.current = currentY;
      saveTabScrollPosition(currentTabId, currentY, currentDocId);
    };

    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleWindowScroll);
    };
  }, []);

  // 2. Captura síncrona na store ANTES do React re-renderizar ou desmontar o TiptapEditor
  //    (ex.: clique em outra aba ou ida para a aba Início).
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      const tabChanged = state.activeTabId !== prevState.activeTabId;
      const docChanged = state.document?.docId !== prevState.document?.docId;

      if ((tabChanged || docChanged) && prevState.activeTabId && prevState.document?.docId) {
        if (!isRestoringRef.current) {
          // Usa window.scrollY se ainda estiver íntegro, ou lastKnownScrollYRef caso o DOM já tenha encolhido
          const currentY = window.scrollY > 0 ? window.scrollY : lastKnownScrollYRef.current;
          saveTabScrollPosition(prevState.activeTabId, currentY, prevState.document.docId);
        }
        // Trava imediatamente novas leituras de scroll até o efeito de restauração assumir
        isRestoringRef.current = true;
      }

      if (state.tabs !== prevState.tabs) {
        pruneTabScrollPositions(state.tabs.map((tab) => tab.id));
      }
    });
    return unsubscribe;
  }, []);

  // 3. Restauração determinística quando (activeTabId, docId) muda ou quando TiptapEditor remonta
  //    após voltar da HomeScreen.
  useEffect(() => {
    if (!editor || !activeTabId || !docId) {
      isRestoringRef.current = false;
      return;
    }

    const compositeKey = `${activeTabId}::${docId}`;
    const previousKey = lastHandledKeyRef.current;
    lastHandledKeyRef.current = compositeKey;

    const savedY = getTabScrollPosition(activeTabId, docId);

    // No primeiro mount absoluto da página (refresh sem scroll prévio salvo na memória em RAM),
    // se não houver posição salva em tabScrollMemory, apenas sincroniza a referência atual.
    if (previousKey === null && savedY === null) {
      isRestoringRef.current = false;
      lastKnownScrollYRef.current = window.scrollY;
      saveTabScrollPosition(activeTabId, window.scrollY, docId);
      return;
    }

    if (previousKey === compositeKey) {
      isRestoringRef.current = false;
      return;
    }

    const targetY = savedY ?? 0;
    isRestoringRef.current = true;

    // Se targetY > 0, desativa temporariamente content-visibility: auto via classe CSS na raiz
    // para que o navegador meça a altura real completa do documento grande imediatamente.
    if (targetY > 0) {
      document.documentElement.classList.add(RESTORING_CLASS);
    }

    let frameId = 0;
    let attempts = 0;
    let stableFrames = 0;
    let cancelledByUser = false;

    const finishRestoration = (finalY: number): void => {
      document.documentElement.classList.remove(RESTORING_CLASS);
      isRestoringRef.current = false;
      lastKnownScrollYRef.current = finalY;
      saveTabScrollPosition(activeTabId, finalY, docId);
    };

    const handleUserInterrupt = (): void => {
      cancelledByUser = true;
      if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
      finishRestoration(window.scrollY);
    };

    const handleKeyInterrupt = (e: KeyboardEvent): void => {
      if (
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'PageDown' ||
        e.key === 'PageUp' ||
        e.key === 'Home' ||
        e.key === 'End' ||
        e.key === ' '
      ) {
        handleUserInterrupt();
      }
    };

    window.addEventListener('wheel', handleUserInterrupt, { passive: true, once: true });
    window.addEventListener('touchmove', handleUserInterrupt, { passive: true, once: true });
    window.addEventListener('keydown', handleKeyInterrupt, { passive: true });

    // Aplica imediatamente de forma síncrona (aproveitando que setContent já rodou no efeito anterior)
    scrollWindowTo(targetY);

    const applyScrollLoop = (): void => {
      if (cancelledByUser) return;

      scrollWindowTo(targetY);
      attempts += 1;

      const currentY = window.scrollY;
      const maxScrollableY = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight
      );
      const reachedTarget = Math.abs(currentY - targetY) <= SCROLL_TOLERANCE_PX;
      // Para targetY === 0, basta chegar em 0. Para targetY > 0, exige que reachedTarget seja true
      // (ou que já tenhamos tentado vários frames e o documento realmente seja menor que targetY).
      const clampedAtBottom =
        attempts >= 6 && maxScrollableY < targetY && Math.abs(currentY - maxScrollableY) <= SCROLL_TOLERANCE_PX;

      if (reachedTarget || clampedAtBottom) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }

      if (stableFrames >= REQUIRED_STABLE_FRAMES || attempts >= MAX_RESTORE_FRAMES) {
        // Remove a classe de medição forçada e aplica um último ajuste fino caso o layout tenha se acomodado
        document.documentElement.classList.remove(RESTORING_CLASS);
        if (Math.abs(window.scrollY - targetY) > SCROLL_TOLERANCE_PX && maxScrollableY >= targetY) {
          scrollWindowTo(targetY);
        }
        finishRestoration(window.scrollY);
        return;
      }

      frameId = requestAnimationFrame(applyScrollLoop);
    };

    frameId = requestAnimationFrame(applyScrollLoop);

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      window.removeEventListener('wheel', handleUserInterrupt);
      window.removeEventListener('touchmove', handleUserInterrupt);
      window.removeEventListener('keydown', handleKeyInterrupt);
      document.documentElement.classList.remove(RESTORING_CLASS);
      isRestoringRef.current = false;
    };
  }, [activeTabId, docId, editor]);
}
