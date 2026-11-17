import { useAppStore } from '../store/useAppStore';
import { flushUserWorkBeforeReload } from './appUpdateService';
import { saveTabScrollPosition } from './tabScrollMemory';
import {
  THEME_RELOAD_SNAPSHOT_KEY,
  ThemeReloadSnapshot,
  normalizeEditorModes,
  parseThemeReloadSnapshot,
  hasValidThemeReloadSnapshot,
  clearThemeReloadSnapshot,
  markThemeReloadRestoredOnBoot,
  wasThemeReloadRestoredOnBoot,
} from './themeReloadSnapshot';

export {
  THEME_RELOAD_SNAPSHOT_KEY,
  normalizeEditorModes,
  parseThemeReloadSnapshot,
  hasValidThemeReloadSnapshot,
  clearThemeReloadSnapshot,
  wasThemeReloadRestoredOnBoot,
};
export type { ThemeReloadSnapshot };

let isReloadScheduled = false;

/** Verdadeiro apenas no PWA instalado (iOS `navigator.standalone` ou display-mode standalone). */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return iosStandalone || displayStandalone;
}

function captureSnapshot(): ThemeReloadSnapshot | null {
  const state = useAppStore.getState();
  if (!state.activeTabId) return null;

  return {
    tabId: state.activeTabId,
    docId: state.document?.docId ?? null,
    scrollY: window.scrollY,
    isEditable: state.isEditable,
    isHighlightMode: state.isHighlightMode,
    isSourceMode: state.isSourceMode,
    savedAt: Date.now(),
  };
}

function persistSnapshot(): void {
  const snapshot = captureSnapshot();
  if (!snapshot) return;
  try {
    sessionStorage.setItem(THEME_RELOAD_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.warn('Não foi possível gravar o snapshot de troca de tema:', err);
  }
}

/** Indica se a troca de tema precisa recarregar a página para atualizar a barra de status do iOS. */
export function shouldReloadForThemeChange(): boolean {
  return isStandalonePwa();
}

/**
 * Recarrega a página de forma leve após a troca de tema: salva o trabalho pendente e o
 * estado de leitura e faz um `reload()` simples (sem desregistrar Service Worker nem limpar cache).
 */
export function reloadForThemeChange(): void {
  if (isReloadScheduled) return;
  isReloadScheduled = true;

  flushUserWorkBeforeReload();
  persistSnapshot();

  window.location.reload();
}

/**
 * Chamada no boot, antes do React montar: consome o snapshot e restaura scroll e modos.
 * Retorna `true` se algum estado foi restaurado.
 */
export function restoreStateAfterThemeReload(): boolean {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(THEME_RELOAD_SNAPSHOT_KEY);
    sessionStorage.removeItem(THEME_RELOAD_SNAPSHOT_KEY);
  } catch (err) {
    console.warn('Não foi possível ler o snapshot de troca de tema:', err);
    markThemeReloadRestoredOnBoot(false);
    return false;
  }

  const snapshot = parseThemeReloadSnapshot(raw, Date.now());
  if (!snapshot) {
    markThemeReloadRestoredOnBoot(false);
    return false;
  }

  const state = useAppStore.getState();
  const sameTab = state.activeTabId === snapshot.tabId;
  const sameDoc = (state.document?.docId ?? null) === snapshot.docId;
  if (!sameTab || !sameDoc) {
    markThemeReloadRestoredOnBoot(false);
    return false;
  }

  saveTabScrollPosition(snapshot.tabId, snapshot.scrollY, snapshot.docId ?? undefined);
  useAppStore.setState(normalizeEditorModes(snapshot));
  markThemeReloadRestoredOnBoot(true);
  return true;
}
