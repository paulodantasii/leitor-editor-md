import { get, set } from 'idb-keyval';
import { DocumentState, RecentDocumentItem } from '../types';
import { downloadOneDriveFile, getOneDriveItemMetadata } from './oneDriveService';

const RECENT_DOCS_KEY = 'leitor_md_recent_documents_v1';
const RECENT_DOCS_BACKUP_KEY = 'leitor_md_recent_documents_backup';
export const MAX_RECENT_DOCUMENTS = 30;

/**
 * Normalizes an identifier for a document to prevent duplicates.
 */
function getDocumentIdentifier(doc: Partial<DocumentState> | Partial<RecentDocumentItem>): string {
  if (doc.oneDriveItemId) {
    return `onedrive_${doc.oneDriveItemId}`;
  }
  if ('docId' in doc && doc.docId) {
    return `local_${doc.docId}`;
  }
  if ('id' in doc && doc.id) {
    return doc.id;
  }
  return `local_${(doc.title || 'documento').replace(/\s+/g, '_').toLowerCase()}`;
}

/**
 * Retrieves the list of recent documents stored in IndexedDB (with LocalStorage fallback).
 * Returns documents sorted with the most recently opened first.
 */
export async function getRecentDocuments(): Promise<RecentDocumentItem[]> {
  try {
    const list = await get<RecentDocumentItem[]>(RECENT_DOCS_KEY);
    if (Array.isArray(list) && list.length > 0) {
      return list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    }
  } catch (err) {
    console.warn('Falha ao ler histórico de documentos do IndexedDB. Tentando backup:', err);
  }

  // Fallback to localStorage if IndexedDB is empty or inaccessible
  try {
    const backup = localStorage.getItem(RECENT_DOCS_BACKUP_KEY);
    if (backup) {
      const parsed: RecentDocumentItem[] = JSON.parse(backup);
      if (Array.isArray(parsed)) {
        return parsed.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
      }
    }
  } catch (err) {
    console.error('Falha ao ler backup local de documentos recentes:', err);
  }

  return [];
}

/**
 * Saves or updates a document in the recent documents cache (up to 30 files).
 * Maintains synchronization metadata and updates timestamp.
 */
export async function saveRecentDocument(doc: DocumentState): Promise<RecentDocumentItem[]> {
  // Ignore empty and unnamed initial states
  if (!doc.content && (!doc.title || doc.title === 'Sem Título.md') && !doc.oneDriveItemId) {
    return await getRecentDocuments();
  }

  const id = getDocumentIdentifier(doc);
  const now = Date.now();

  const currentItem: RecentDocumentItem = {
    id,
    title: doc.title || 'Sem Título.md',
    content: doc.content || '',
    oneDriveItemId: doc.oneDriveItemId || null,
    lastSavedAt: doc.lastSavedAt || new Date(now).toLocaleTimeString(),
    lastOpenedAt: now,
    isOneDrive: Boolean(doc.oneDriveItemId),
    cloudLastModified: doc.cloudLastModified || null,
  };

  try {
    const existing = await getRecentDocuments();

    // Remove previous version of this document to re-insert at the top
    const filtered = existing.filter((item) => {
      if (currentItem.oneDriveItemId && item.oneDriveItemId) {
        return item.oneDriveItemId !== currentItem.oneDriveItemId;
      }
      return item.id !== currentItem.id && item.title !== currentItem.title;
    });

    const updatedList = [currentItem, ...filtered].slice(0, MAX_RECENT_DOCUMENTS);

    // Save to IndexedDB (asynchronous, high capacity)
    await set(RECENT_DOCS_KEY, updatedList);

    // Defensive backup to localStorage (metadata & lightweight snapshot)
    try {
      const lightweightBackup = updatedList.map((item) => ({
        ...item,
        // If content is very large, truncate in localStorage backup to preserve quota
        content: item.content.length > 50000 ? item.content.slice(0, 50000) : item.content,
      }));
      localStorage.setItem(RECENT_DOCS_BACKUP_KEY, JSON.stringify(lightweightBackup));
    } catch {
      // Ignore quota warnings on localStorage
    }

    return updatedList;
  } catch (err) {
    console.error('Erro ao salvar documento recente no IndexedDB:', err);
    return [];
  }
}

/**
 * Removes a specific document from the recent cache.
 */
export async function deleteRecentDocument(id: string): Promise<RecentDocumentItem[]> {
  try {
    const existing = await getRecentDocuments();
    const updated = existing.filter((item) => item.id !== id);
    await set(RECENT_DOCS_KEY, updated);
    localStorage.setItem(RECENT_DOCS_BACKUP_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.error('Erro ao excluir documento recente:', err);
    return [];
  }
}

/**
 * Clears all recent documents from cache.
 */
export async function clearAllRecentDocuments(): Promise<void> {
  try {
    await set(RECENT_DOCS_KEY, []);
    localStorage.removeItem(RECENT_DOCS_BACKUP_KEY);
  } catch (err) {
    console.error('Erro ao limpar documentos recentes:', err);
  }
}

/**
 * Smart Loader: When opening a document from cache:
 * - If it originated from OneDrive and the network/session is available,
 *   fetches the freshest version directly from OneDrive and updates the local cache.
 * - If offline or request fails, gracefully falls back to the locally cached version.
 */
export async function loadRecentDocumentWithCloudSync(
  item: RecentDocumentItem
): Promise<{ doc: DocumentState; updatedFromCloud: boolean; warning?: string }> {
  // If not a OneDrive file, load directly from local cache
  if (!item.oneDriveItemId) {
    const doc: DocumentState = {
      title: item.title,
      content: item.content,
      oneDriveItemId: null,
      lastSavedAt: item.lastSavedAt,
      isDirty: false,
      docId: item.id.replace('local_', ''),
    };

    // Bump lastOpenedAt timestamp
    await saveRecentDocument(doc);
    return { doc, updatedFromCloud: false };
  }

  // Attempt to fetch latest version from OneDrive
  try {
    const [freshestContent, metadata] = await Promise.all([
      downloadOneDriveFile(item.oneDriveItemId),
      getOneDriveItemMetadata(item.oneDriveItemId).catch(() => null),
    ]);

    const doc: DocumentState = {
      title: item.title,
      content: freshestContent,
      oneDriveItemId: item.oneDriveItemId,
      lastSavedAt: new Date().toLocaleTimeString(),
      isDirty: false,
      docId: `doc-${Date.now()}`,
      cloudLastModified: metadata?.lastModifiedDateTime || item.cloudLastModified || null,
    };

    // Update the local cache with the newest cloud content
    await saveRecentDocument(doc);

    return { doc, updatedFromCloud: true };
  } catch (err: any) {
    console.warn('Não foi possível sincronizar versão da nuvem agora. Carregando versão local do cache:', err);

    const fallbackDoc: DocumentState = {
      title: item.title,
      content: item.content,
      oneDriveItemId: item.oneDriveItemId,
      lastSavedAt: item.lastSavedAt,
      isDirty: false,
      docId: `doc-${Date.now()}`,
    };

    // Still bump opening order
    await saveRecentDocument(fallbackDoc);

    return {
      doc: fallbackDoc,
      updatedFromCloud: false,
      warning: 'Não foi possível conectar ao OneDrive no momento. Foi carregada a última versão salva no cache local.',
    };
  }
}
