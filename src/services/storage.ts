import { UserPreferences, DocumentState } from '../types';
import { saveRecentDocument } from './recentDocumentsService';

const PREFS_KEY = 'leitor_md_preferences';
const DOC_KEY = 'leitor_md_document';
const OFFLINE_QUEUE_KEY = 'leitor_md_offline_queue';

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  fontSize: 16,
  fontFamily: 'sans',
  textWidth: 'normal',
};

/**
 * Reads user preferences from LocalStorage.
 */
export function loadUserPreferences(): UserPreferences {
  try {
    const saved = localStorage.getItem(PREFS_KEY);
    if (saved) {
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) };
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

/**
 * Saves active document state to LocalStorage and IndexedDB recent documents (up to 30 files).
 */
export function saveLocalDocument(docState: DocumentState): void {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(docState));
  } catch (err) {
    console.error('Failed to save document to local storage', err);
  }

  // Also maintain in IndexedDB recent documents collection
  saveRecentDocument(docState).catch((err) => {
    console.warn('Failed to save document to recent documents index:', err);
  });
}

/**
 * Loads last active document from LocalStorage fallback.
 */
export function loadLocalDocument(): DocumentState | null {
  try {
    const saved = localStorage.getItem(DOC_KEY);
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
  localStorage.removeItem(OFFLINE_QUEUE_KEY);
}
