import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useAppStore } from '../store/useAppStore';
import {
  saveTabScrollPosition,
  consumeTabScrollPosition,
  pruneTabScrollPositions,
} from '../services/tabScrollMemory';

/** Máximo de frames para tentar alcançar a posição (ex.: imagens ainda decodificando). */
const MAX_RESTORE_FRAMES = 10;
/** Tolerância em px para considerar a posição alcançada. */
const SCROLL_TOLERANCE_PX = 2;

const scrollWindowTo = (top: number): void => {
  window.scrollTo({ top, left: 0, behavior: 'instant' });
};

/**
 * Mantém a posição de leitura (scroll vertical da janela) independente para cada aba.
 *
 * IMPORTANTE: deve ser chamado no TiptapEditor DEPOIS do efeito que executa `setContent`
 * por `docId`, pois efeitos do React rodam na ordem de declaração e a restauração precisa
 * acontecer depois que o novo conteúdo já está no DOM.
 */
export function useTabScrollRestoration(editor: Editor | null): void {
  const activeTabId = useAppStore((state) => state.activeTabId);
  const lastHandledTabIdRef = useRef<string | null>(null);

  // Captura: o listener do Zustand roda de forma síncrona dentro do set(), ANTES de o React
  // trocar o conteúdo do DOM, então window.scrollY ainda é o da aba que está saindo.
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      if (prevState.activeTabId && state.activeTabId !== prevState.activeTabId) {
        saveTabScrollPosition(prevState.activeTabId, window.scrollY);
      }
      if (state.tabs !== prevState.tabs) {
        pruneTabScrollPositions(state.tabs.map((tab) => tab.id));
      }
    });
    return unsubscribe;
  }, []);

  // Restauração: só quando a aba ativa muda de fato (nunca quando só o docId muda na mesma aba).
  useEffect(() => {
    if (!editor || !activeTabId) return;

    const previousTabId = lastHandledTabIdRef.current;
    lastHandledTabIdRef.current = activeTabId;

    // Primeiro mount (refresh / volta da HomeScreen) ou mesma aba: não mexe no scroll.
    if (previousTabId === null || previousTabId === activeTabId) return;

    const targetY = consumeTabScrollPosition(activeTabId) ?? 0;
    let frameId = 0;
    let attempts = 0;

    const applyScroll = (): void => {
      scrollWindowTo(targetY);
      attempts += 1;
      const reached = Math.abs(window.scrollY - targetY) <= SCROLL_TOLERANCE_PX;
      if (!reached && attempts < MAX_RESTORE_FRAMES) {
        frameId = requestAnimationFrame(applyScroll);
      }
    };

    frameId = requestAnimationFrame(applyScroll);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [activeTabId, editor]);
}
