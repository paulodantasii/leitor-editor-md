import { UserPreferences, DocumentState, OpenTabsSession } from '../types';
import { saveRecentDocument } from './recentDocumentsService';

const PREFS_KEY = 'leitor_md_preferences';
const DOC_KEY = 'leitor_md_document';
const OFFLINE_QUEUE_KEY = 'leitor_md_offline_queue';
const TABS_KEY = 'leitor_md_open_tabs_v1';

function readSessionItem(key: string): string | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(key);
    }
  } catch (err) {
    console.warn(`Falha ao ler "${key}" do sessionStorage:`, err);
  }
  return null;
}

function writeSessionItem(key: string, value: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(key, value);
    }
  } catch (err) {
    console.warn(`Falha ao gravar "${key}" no sessionStorage:`, err);
  }
}

function removeStorageItemBoth(key: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  fontSize: 16,
  fontFamily: 'sans',
  textWidth: 'normal',
  autoSync: true,
};

/**
 * Reads user preferences from LocalStorage.
 */
export function loadUserPreferences(): UserPreferences {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(PREFS_KEY);
      if (saved) {
        return { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) };
      }
    }
  } catch (err) {
    console.warn('Failed to load user preferences from localStorage', err);
  }
  return DEFAULT_PREFERENCES;
}

/**
 * Saves user preferences to LocalStorage.
 */
export function saveUserPreferences(prefs: UserPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.error('Failed to save user preferences', err);
  }
}

let pendingSaveDoc: DocumentState | null = null;
let saveDebounceTimer: NodeJS.Timeout | null = null;

function performSaveDoc(docState: DocumentState): void {
  // Evita sobrescrever o conteúdo completo salvo no IndexedDB com um stub vazio
  // caso ocorra um salvamento antes da hidratação assíncrona concluir.
  if (docState.storedInDb && (!docState.content || docState.content.length === 0)) {
    try {
      writeSessionItem(DOC_KEY, JSON.stringify(docState));
    } catch (err) {
      console.warn('Falha ao salvar metadados no sessionStorage:', err);
    }
    return;
  }

  try {
    // Para documentos muito grandes (> 400KB), o payload pode travar a thread síncrona
    // do sessionStorage ou estourar a cota de 5MB. Salvamos o snapshot com storedInDb: true
    // no sessionStorage, enquanto o IndexedDB (assíncrono) retém o conteúdo integral.
    if (docState.content && docState.content.length > 400000) {
      const lightweight: DocumentState = {
        ...docState,
        content: '',
        storedInDb: true,
      };
      writeSessionItem(DOC_KEY, JSON.stringify(lightweight));
    } else {
      const fullLocal: DocumentState = {
        ...docState,
        storedInDb: false,
      };
      writeSessionItem(DOC_KEY, JSON.stringify(fullLocal));
    }
  } catch (err) {
    console.warn('Falha ao salvar backup síncrono no sessionStorage (armazenamento prioritário permanece no IndexedDB):', err);
  }

  // Maintain in IndexedDB recent documents collection
  saveRecentDocument({ ...docState, storedInDb: false }).catch((err) => {
    console.warn('Falha ao salvar documento no histórico do IndexedDB:', err);
  });
}

/**
 * Saves active document state with coalescing (debounce) to prevent I/O saturation.
 * Pass immediate = true to bypass queue and persist synchronously.
 */
export function saveLocalDocument(docState: DocumentState, immediate: boolean = false): void {
  pendingSaveDoc = docState;

  if (immediate) {
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
    performSaveDoc(docState);
    pendingSaveDoc = null;
    return;
  }

  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }

  saveDebounceTimer = setTimeout(() => {
    if (pendingSaveDoc) {
      performSaveDoc(pendingSaveDoc);
      pendingSaveDoc = null;
    }
    saveDebounceTimer = null;
  }, 400);
}

/**
 * Immediately flushes any pending debounced local document save to storage.
 */
export function flushPendingLocalDocumentSave(): void {
  if (saveDebounceTimer && pendingSaveDoc) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
    performSaveDoc(pendingSaveDoc);
    pendingSaveDoc = null;
  }
}

/**
 * Limpa o documento ativo do sessionStorage (e eventual legado no localStorage)
 * e cancela qualquer gravação pendente no debounce.
 */
export function clearLocalDocument(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  pendingSaveDoc = null;
  removeStorageItemBoth(DOC_KEY);
}

/**
 * Loads last active document from sessionStorage fallback.
 */
export function loadLocalDocument(): DocumentState | null {
  try {
    const saved = readSessionItem(DOC_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (err) {
    console.warn('Failed to load local document backup', err);
  }
  return null;
}

/**
 * Adds an item to the offline sync queue when internet is disconnected.
 */
export function addToOfflineQueue(item: { itemId: string; content: string; title: string }): void {
  try {
    const queue = getOfflineQueue();
    queue.push({ ...item, timestamp: Date.now() });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('Failed to add item to offline queue', err);
  }
}

/**
 * Gets pending items in the offline queue.
 */
export function getOfflineQueue(): Array<{ itemId: string; content: string; title: string; timestamp: number }> {
  try {
    const saved = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (err) {
    return [];
  }
}

/**
 * Clears the offline sync queue.
 */
export function clearOfflineQueue(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(OFFLINE_QUEUE_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Persiste os metadados da sessão de abas abertas no sessionStorage.
 */
export function saveOpenTabsSession(session: OpenTabsSession): void {
  try {
    writeSessionItem(TABS_KEY, JSON.stringify(session));
  } catch (err) {
    console.warn('Falha ao salvar sessão de abas no sessionStorage:', err);
  }
}

/**
 * Carrega a sessão de abas abertas salva no sessionStorage.
 */
export function loadOpenTabsSession(): OpenTabsSession | null {
  try {
    const saved = readSessionItem(TABS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (err) {
    console.warn('Falha ao carregar sessão de abas do sessionStorage:', err);
  }
  return null;
}

/**
 * Remove a sessão de abas abertas do sessionStorage e eventual legado do localStorage.
 */
export function clearOpenTabsSession(): void {
  removeStorageItemBoth(TABS_KEY);
}
