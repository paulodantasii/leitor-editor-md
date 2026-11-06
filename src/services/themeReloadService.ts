import { useAppStore } from '../store/useAppStore';
import { flushUserWorkBeforeReload } from './appUpdateService';
import { saveTabScrollPosition } from './tabScrollMemory';

export const THEME_RELOAD_SNAPSHOT_KEY = 'leitor_md_theme_reload_snapshot_v1';

const SNAPSHOT_MAX_AGE_MS = 15_000;

export interface ThemeReloadSnapshot {
  readonly tabId: string;
  readonly docId: string | null;
  readonly scrollY: number;
  readonly isEditable: boolean;
  readonly isHighlightMode: boolean;
  readonly isSourceMode: boolean;
  readonly savedAt: number;
}

let isReloadScheduled = false;

/**
 * Normaliza os modos respeitando os invariantes do store:
 * Edição e Grifo são exclusivos, e o modo Código-Fonte só existe em Edição.
 */
export function normalizeEditorModes(modes: {
  readonly isEditable: boolean;
  readonly isHighlightMode: boolean;
  readonly isSourceMode: boolean;
}): { isEditable: boolean; isHighlightMode: boolean; isSourceMode: boolean } {
  const isEditable = modes.isEditable;
  const isHighlightMode = isEditable ? false : modes.isHighlightMode;
  const isSourceMode = isEditable ? modes.isSourceMode : false;
  return { isEditable, isHighlightMode, isSourceMode };
}

/** Interpreta o JSON do snapshot. Retorna `null` se for inválido ou expirado. */
export function parseThemeReloadSnapshot(
  raw: string | null,
  now: number
): ThemeReloadSnapshot | null {
  if (!raw) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.warn('Snapshot de troca de tema inválido:', err);
    return null;
  }

  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;

  if (
    typeof record.tabId !== 'string' ||
    record.tabId.length === 0 ||
    typeof record.scrollY !== 'number' ||
    !Number.isFinite(record.scrollY) ||
    typeof record.savedAt !== 'number' ||
    now - record.savedAt > SNAPSHOT_MAX_AGE_MS ||
    now < record.savedAt
  ) {
    return null;
  }

  return {
    tabId: record.tabId,
    docId: typeof record.docId === 'string' ? record.docId : null,
    scrollY: Math.max(0, Math.round(record.scrollY)),
    isEditable: record.isEditable === true,
    isHighlightMode: record.isHighlightMode === true,
    isSourceMode: record.isSourceMode === true,
    savedAt: record.savedAt,
  };
}

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
    return false;
  }

  const snapshot = parseThemeReloadSnapshot(raw, Date.now());
  if (!snapshot) return false;

  const state = useAppStore.getState();
  const sameTab = state.activeTabId === snapshot.tabId;
  const sameDoc = (state.document?.docId ?? null) === snapshot.docId;
  if (!sameTab || !sameDoc) return false;

  saveTabScrollPosition(snapshot.tabId, snapshot.scrollY, snapshot.docId ?? undefined);
  useAppStore.setState(normalizeEditorModes(snapshot));
  return true;
}
