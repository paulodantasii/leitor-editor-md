export const THEME_RELOAD_SNAPSHOT_KEY = 'leitor_md_theme_reload_snapshot_v1';

export const SNAPSHOT_MAX_AGE_MS = 15_000;

export interface ThemeReloadSnapshot {
  readonly tabId: string;
  readonly docId: string | null;
  readonly scrollY: number;
  readonly isEditable: boolean;
  readonly isHighlightMode: boolean;
  readonly isSourceMode: boolean;
  readonly savedAt: number;
}

let themeReloadRestoredOnBoot = false;

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

/**
 * Verifica se existe um snapshot de troca de tema válido e não expirado
 * no `sessionStorage` sem removê-lo (para que o boot possa restaurá-lo).
 */
export function hasValidThemeReloadSnapshot(now: number = Date.now()): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(THEME_RELOAD_SNAPSHOT_KEY);
    return parseThemeReloadSnapshot(raw, now) !== null;
  } catch {
    return false;
  }
}

/** Remove qualquer snapshot pendente de troca de tema do `sessionStorage`. */
export function clearThemeReloadSnapshot(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(THEME_RELOAD_SNAPSHOT_KEY);
    }
  } catch {
    // ignore
  }
}

/** Registra se o boot atual restaurou estado a partir de uma recarga de tema. */
export function markThemeReloadRestoredOnBoot(restored: boolean): void {
  themeReloadRestoredOnBoot = restored;
}

/** Indica se o boot atual restaurou estado a partir de uma recarga de tema. */
export function wasThemeReloadRestoredOnBoot(): boolean {
  return themeReloadRestoredOnBoot;
}
