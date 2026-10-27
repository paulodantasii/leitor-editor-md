import { get, set, del } from 'idb-keyval';
import { DocumentState, RecentDocumentItem, DocumentSourceType } from '../types';
import { downloadOneDriveFile, getOneDriveItemMetadata } from './oneDriveService';
import { isBlankUntitledDocument } from './documentUtils';

export const MAX_RECENT_DOCUMENTS = 30;

const RECENTS_INDEX_KEY = 'leitor_md_recents_index_v2';
const RECENTS_INDEX_BACKUP_KEY = 'leitor_md_recents_index_backup_v2';
const DOC_KEY_PREFIX = 'doc:';

const LEGACY_RECENT_DOCS_KEY = 'leitor_md_recent_documents_v1';
const LEGACY_RECENT_DOCS_BACKUP_KEY = 'leitor_md_recent_documents_backup';
const MIGRATION_FLAG_KEY = 'leitor_md_migrated_to_v2';
const BLANK_CLEANUP_FLAG_KEY = 'leitor_md_blank_cleanup_v1';

/**
 * Normaliza o identificador estável de um documento:
 * - OneDrive: onedrive:<itemId>
 * - Arquivo local: file:<uuid>
 * - Rascunho: draft:<uuid>
 */
export function getDocumentIdentifier(doc: Partial<DocumentState> | Partial<RecentDocumentItem>): string {
  if (doc.oneDriveItemId) {
    return `onedrive:${doc.oneDriveItemId}`;
  }
  if ('id' in doc && doc.id) {
    if (doc.id.startsWith('onedrive:') || doc.id.startsWith('draft:') || doc.id.startsWith('file:')) {
      return doc.id;
    }
    if (doc.id.startsWith('onedrive_')) {
      return `onedrive:${doc.id.replace('onedrive_', '')}`;
    }
    if (doc.id.startsWith('local_')) {
      return `draft:${doc.id.replace('local_', '')}`;
    }
    return doc.id;
  }
  if ('docId' in doc && doc.docId) {
    return `draft:${doc.docId}`;
  }
  return `draft:${(doc.title || 'documento').replace(/\s+/g, '_').toLowerCase()}`;
}

/**
 * Determina a origem do documento (OneDrive, Arquivo local ou Rascunho).
 */
export function getDocumentSourceType(doc: Partial<DocumentState> | Partial<RecentDocumentItem>): DocumentSourceType {
  if (doc.oneDriveItemId) return 'onedrive';
  if ('sourceType' in doc && doc.sourceType) return doc.sourceType;
  if ('id' in doc && doc.id?.startsWith('file:')) return 'local_file';
  return 'draft';
}

/**
 * Migração automática do formato v1 para a arquitetura v2 (uma chave por documento + índice leve).
 */
async function ensureMigrated(): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(MIGRATION_FLAG_KEY)) {
      return;
    }

    const existingIndex = await get<RecentDocumentItem[]>(RECENTS_INDEX_KEY);
    if (Array.isArray(existingIndex) && existingIndex.length > 0) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(MIGRATION_FLAG_KEY, '1');
      return;
    }

    // Lê histórico legado do IndexedDB ou do backup no localStorage
    let legacyList = await get<any[]>(LEGACY_RECENT_DOCS_KEY);
    if (!Array.isArray(legacyList) || legacyList.length === 0) {
      if (typeof localStorage !== 'undefined') {
        const backup = localStorage.getItem(LEGACY_RECENT_DOCS_BACKUP_KEY);
        if (backup) {
          try {
            legacyList = JSON.parse(backup);
          } catch {
            legacyList = [];
          }
        }
      }
    }

    if (Array.isArray(legacyList) && legacyList.length > 0) {
      const validItems = legacyList.filter((item) => !isBlankUntitledDocument(item));
      const newIndex: RecentDocumentItem[] = [];

      for (const item of validItems) {
        const id = getDocumentIdentifier(item);
        const sourceType = getDocumentSourceType(item);

        // 1. Grava documento individual com seu conteúdo
        await set(`${DOC_KEY_PREFIX}${id}`, {
          title: item.title,
          content: item.content || '',
          oneDriveItemId: item.oneDriveItemId || null,
          lastSavedAt: item.lastSavedAt || null,
          isDirty: false,
          revision: item.revision ?? 0,
          draftRevision: item.draftRevision ?? 0,
          sourceRevision: item.sourceRevision ?? 0,
          docId: item.docId || id.replace(/^(onedrive:|draft:|file:)/, ''),
          cloudLastModified: item.cloudLastModified || null,
        });

        // 2. Adiciona ao índice leve (sem o conteúdo volumoso)
        newIndex.push({
          id,
          title: item.title,
          content: '',
          sourceType,
          oneDriveItemId: item.oneDriveItemId || null,
          lastSavedAt: item.lastSavedAt || null,
          lastOpenedAt: item.lastOpenedAt || Date.now(),
          lastModifiedAt: item.lastOpenedAt || Date.now(),
          isOneDrive: sourceType === 'onedrive',
          cloudLastModified: item.cloudLastModified || null,
          revision: item.revision ?? 0,
          draftRevision: item.draftRevision ?? 0,
          sourceRevision: item.sourceRevision ?? 0,
        });
      }

      await set(RECENTS_INDEX_KEY, newIndex);
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(RECENTS_INDEX_BACKUP_KEY, JSON.stringify(newIndex));
        } catch {
          // ignore quota
        }
      }
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MIGRATION_FLAG_KEY, '1');
    }
  } catch (err) {
    console.warn('Aviso durante migração para índice v2 de documentos recentes:', err);
  }
}

/**
 * Lê o índice leve de documentos recentes ordenado por data de abertura mais recente.
 */
export async function getRecentDocuments(): Promise<RecentDocumentItem[]> {
  await ensureMigrated();

  try {
    const list = await get<RecentDocumentItem[]>(RECENTS_INDEX_KEY);
    if (Array.isArray(list)) {
      return list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    }
  } catch (err) {
    console.warn('Falha ao ler índice de documentos do IndexedDB. Tentando backup:', err);
  }

  // Fallback para backup no localStorage
  if (typeof localStorage !== 'undefined') {
    try {
      const backup = localStorage.getItem(RECENTS_INDEX_BACKUP_KEY);
      if (backup) {
        const parsed: RecentDocumentItem[] = JSON.parse(backup);
        if (Array.isArray(parsed)) {
          return parsed.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
        }
      }
    } catch (err) {
      console.error('Falha ao ler backup local do índice de documentos:', err);
    }
  }

  return [];
}

/**
 * Lê o conteúdo integral de um documento a partir da sua chave individual `doc:<id>`.
 */
export async function getDocumentFullData(id: string): Promise<DocumentState | null> {
  try {
    const data = await get<DocumentState>(`${DOC_KEY_PREFIX}${id}`);
    if (data) return data;
  } catch (err) {
    console.warn(`Falha ao ler documento individual ${id} do IndexedDB:`, err);
  }
  return null;
}

/**
 * Regra de remoção da Seção 5:
 * Um rascunho só existe no navegador — se for empurrado para fora, é perdido para sempre.
 * Ordem de remoção quando a lista excede a cota (ex: 31º documento):
 * 1. O item mais antigo que tenha fonte permanente (OneDrive ou arquivo local) e esteja sincronizado (sai só do cache do navegador; o arquivo continua na fonte).
 * 2. Itens com alterações pendentes de envio nunca saem.
 * 3. Se todos forem rascunhos, nenhum é apagado silenciosamente.
 */
export function applyRecentsEvictionRule(
  items: RecentDocumentItem[],
  maxCount: number = MAX_RECENT_DOCUMENTS
): { list: RecentDocumentItem[]; evictedIds: string[]; warningAllDrafts: boolean } {
  if (items.length <= maxCount) {
    return { list: items, evictedIds: [], warningAllDrafts: false };
  }

  const result = [...items];
  const evictedIds: string[] = [];

  while (result.length > maxCount) {
    // Procura candidato elegível para remoção (do mais antigo para o mais novo no histórico)
    // Elegível: tem fonte permanente (onedrive ou local_file) E não tem alterações pendentes
    let candidateIndex = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      const item = result[i];
      const hasPendingChanges = (item.draftRevision ?? 0) > (item.sourceRevision ?? 0) ||
                                (item.revision ?? 0) > (item.sourceRevision ?? 0);
      const hasPermanentSource = item.sourceType === 'onedrive' ||
                                 item.sourceType === 'local_file' ||
                                 Boolean(item.oneDriveItemId);

      if (hasPermanentSource && !hasPendingChanges) {
        candidateIndex = i;
        break; // Encontrou o mais antigo elegível com fonte segura
      }
    }

    if (candidateIndex !== -1) {
      const evicted = result.splice(candidateIndex, 1)[0];
      evictedIds.push(evicted.id);
    } else {
      // Todos os itens restantes são rascunhos ou possuem alterações pendentes.
      // Nunca apaga rascunhos silenciosamente!
      return { list: result, evictedIds, warningAllDrafts: true };
    }
  }

  return { list: result, evictedIds, warningAllDrafts: false };
}

/**
 * Salva ou atualiza um documento no IndexedDB.
 *
 * Eficiência da Fase 2:
 * - O conteúdo é gravado exclusivamente na chave individual `doc:<id>`.
 * - O índice leve (`recents_index_v2`) é atualizado apenas com metadados.
 * - Ao editar, `lastOpenedAt` é PRESERVADO (só muda ao abrir).
 * - Rascunhos promovidos (salvos no OneDrive ou disco) têm sua chave antiga removida sem duplicar.
 */
export async function saveRecentDocument(doc: DocumentState): Promise<RecentDocumentItem[]> {
  if (isBlankUntitledDocument(doc)) {
    return await getRecentDocuments();
  }

  await ensureMigrated();

  const id = getDocumentIdentifier(doc);
  const sourceType = getDocumentSourceType(doc);
  const now = Date.now();

  try {
    // 1. Grava o documento completo na sua chave individual no IndexedDB
    await set(`${DOC_KEY_PREFIX}${id}`, {
      ...doc,
      docId: doc.docId || id.replace(/^(onedrive:|draft:|file:)/, ''),
    });

    // 2. Promoção de rascunho: se era draft e agora tem OneDrive/arquivo, descarta o rascunho antigo
    if (doc.oneDriveItemId && doc.docId) {
      const legacyDraftId = `draft:${doc.docId}`;
      if (legacyDraftId !== id) {
        await del(`${DOC_KEY_PREFIX}${legacyDraftId}`).catch(() => {});
      }
    }

    // 3. Atualiza o índice leve
    const existingIndex = await getRecentDocuments();
    const existingIndexItem = existingIndex.find(
      (item) => item.id === id || (doc.oneDriveItemId && item.oneDriveItemId === doc.oneDriveItemId)
    );

    // lastOpenedAt: mantém o horário original se já existia; só define agora se for novo no histórico
    const lastOpenedAt = existingIndexItem?.lastOpenedAt ?? now;

    const updatedIndexItem: RecentDocumentItem = {
      id,
      title: doc.title || 'Sem Título.md',
      content: '', // Índice leve não duplica texto integral em memória/array
      sourceType,
      oneDriveItemId: doc.oneDriveItemId || null,
      lastSavedAt: doc.lastSavedAt || existingIndexItem?.lastSavedAt || null,
      lastOpenedAt,
      lastModifiedAt: now,
      isOneDrive: sourceType === 'onedrive',
      cloudLastModified: doc.cloudLastModified || existingIndexItem?.cloudLastModified || null,
      revision: doc.revision ?? 0,
      draftRevision: doc.draftRevision ?? 0,
      sourceRevision: doc.sourceRevision ?? 0,
    };

    // Remove item antigo da lista (ou rascunho promovido) para reinserir
    const filtered = existingIndex.filter((item) => {
      if (doc.oneDriveItemId && item.oneDriveItemId) {
        return item.oneDriveItemId !== doc.oneDriveItemId;
      }
      if (doc.docId && item.id === `draft:${doc.docId}`) {
        return false;
      }
      return item.id !== id;
    });

    // Aplica a política de remoção segura da Seção 5
    const candidates = [updatedIndexItem, ...filtered];
    const { list: updatedList, evictedIds, warningAllDrafts } = applyRecentsEvictionRule(candidates, MAX_RECENT_DOCUMENTS);

    // Limpa o cache individual dos arquivos com fonte permanente que foram descarregados do índice
    for (const evictedId of evictedIds) {
      await del(`${DOC_KEY_PREFIX}${evictedId}`).catch(() => {});
    }

    if (warningAllDrafts) {
      console.warn('Cota de documentos atingida: todos os itens são rascunhos ou têm alterações pendentes. Nenhum rascunho foi apagado para preservar os dados.');
    }

    await set(RECENTS_INDEX_KEY, updatedList);

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(RECENTS_INDEX_BACKUP_KEY, JSON.stringify(updatedList));
      } catch {
        // ignore quota
      }
    }

    return updatedList;
  } catch (err) {
    console.error('Erro ao atualizar histórico de documentos recentes:', err);
    return await getRecentDocuments();
  }
}

/**
 * Remove um documento específico do histórico e do armazenamento por documento.
 */
export async function deleteRecentDocument(id: string): Promise<RecentDocumentItem[]> {
  try {
    await del(`${DOC_KEY_PREFIX}${id}`).catch(() => {});

    const existing = await getRecentDocuments();
    const updated = existing.filter((item) => item.id !== id);

    await set(RECENTS_INDEX_KEY, updated);

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(RECENTS_INDEX_BACKUP_KEY, JSON.stringify(updated));
      } catch {
        // ignore quota
      }
    }

    return updated;
  } catch (err) {
    console.error('Erro ao excluir documento recente:', err);
    return await getRecentDocuments();
  }
}

/**
 * Limpa todo o histórico de documentos e suas chaves individuais.
 */
export async function clearAllRecentDocuments(): Promise<void> {
  try {
    const list = await getRecentDocuments();
    for (const item of list) {
      await del(`${DOC_KEY_PREFIX}${item.id}`).catch(() => {});
    }
    await set(RECENTS_INDEX_KEY, []);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(RECENTS_INDEX_BACKUP_KEY);
    }
  } catch (err) {
    console.error('Erro ao limpar documentos recentes:', err);
  }
}

/**
 * Limpeza única de documentos em branco do índice.
 */
export async function cleanupBlankRecentDocuments(): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(BLANK_CLEANUP_FLAG_KEY)) {
      return;
    }

    const existing = await getRecentDocuments();
    const cleaned = existing.filter((item) => !isBlankUntitledDocument(item));

    if (cleaned.length !== existing.length) {
      await set(RECENTS_INDEX_KEY, cleaned);
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(RECENTS_INDEX_BACKUP_KEY, JSON.stringify(cleaned));
        } catch {
          // ignore quota
        }
      }
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BLANK_CLEANUP_FLAG_KEY, '1');
    }
  } catch (err) {
    console.warn('Falha na limpeza de entradas em branco do histórico:', err);
  }
}

/**
 * Carregador inteligente ao abrir do histórico:
 * - Atualiza `lastOpenedAt = Date.now()` (ordem de abertura).
 * - Busca versão do OneDrive se online ou resgata do IndexedDB (`doc:<id>`).
 */
export async function loadRecentDocumentWithCloudSync(
  item: RecentDocumentItem
): Promise<{ doc: DocumentState; updatedFromCloud: boolean; warning?: string }> {
  const cachedFullDoc = await getDocumentFullData(item.id);

  // Se não for arquivo do OneDrive (rascunho ou arquivo local)
  if (!item.oneDriveItemId) {
    const rev = cachedFullDoc?.revision ?? item.revision ?? 0;
    const srcRev = cachedFullDoc?.sourceRevision ?? item.sourceRevision ?? rev;
    const doc: DocumentState = {
      title: item.title,
      content: cachedFullDoc?.content || item.content || '',
      oneDriveItemId: null,
      lastSavedAt: item.lastSavedAt,
      isDirty: false,
      revision: rev,
      sourceRevision: srcRev,
      draftRevision: cachedFullDoc?.draftRevision ?? item.draftRevision ?? rev,
      docId: cachedFullDoc?.docId || item.id.replace(/^(draft:|file:|local_)/, ''),
    };

    // Atualiza abertura (bump lastOpenedAt)
    await touchDocumentOpened(item.id);
    return { doc, updatedFromCloud: false };
  }

  // Arquivo do OneDrive: tenta buscar conteúdo mais recente
  try {
    const [freshestContent, metadata] = await Promise.all([
      downloadOneDriveFile(item.oneDriveItemId),
      getOneDriveItemMetadata(item.oneDriveItemId).catch(() => null),
    ]);

    const doc: DocumentState = {
      title: metadata?.name || item.title,
      content: freshestContent,
      oneDriveItemId: item.oneDriveItemId,
      lastSavedAt: new Date().toLocaleTimeString(),
      isDirty: false,
      revision: 0,
      sourceRevision: 0,
      draftRevision: 0,
      docId: `doc-${Date.now()}`,
      cloudLastModified: metadata?.lastModifiedDateTime || item.cloudLastModified || null,
      cloudETag: metadata?.eTag || null,
    };

    // Atualiza cache individual e ordem de abertura
    await saveRecentDocument(doc);
    await touchDocumentOpened(item.id);

    return { doc, updatedFromCloud: true };
  } catch (err: any) {
    console.warn('Não foi possível sincronizar versão da nuvem agora. Carregando versão local do cache:', err);

    const rev = cachedFullDoc?.revision ?? item.revision ?? 0;
    const srcRev = cachedFullDoc?.sourceRevision ?? item.sourceRevision ?? rev;
    const fallbackDoc: DocumentState = {
      title: item.title,
      content: cachedFullDoc?.content || item.content || '',
      oneDriveItemId: item.oneDriveItemId,
      lastSavedAt: item.lastSavedAt,
      isDirty: false,
      revision: rev,
      sourceRevision: srcRev,
      draftRevision: cachedFullDoc?.draftRevision ?? item.draftRevision ?? rev,
      docId: cachedFullDoc?.docId || `doc-${Date.now()}`,
      cloudLastModified: item.cloudLastModified || null,
    };

    await touchDocumentOpened(item.id);

    return {
      doc: fallbackDoc,
      updatedFromCloud: false,
      warning: 'Não foi possível conectar ao OneDrive no momento. Foi carregada a última versão salva no cache local.',
    };
  }
}

/**
 * Atualiza o timestamp `lastOpenedAt` e move o documento para o topo do histórico.
 */
async function touchDocumentOpened(id: string): Promise<void> {
  try {
    const existing = await getRecentDocuments();
    const itemIndex = existing.findIndex((item) => item.id === id);
    if (itemIndex >= 0) {
      const item = { ...existing[itemIndex], lastOpenedAt: Date.now() };
      const reordered = [item, ...existing.filter((_, idx) => idx !== itemIndex)];
      await set(RECENTS_INDEX_KEY, reordered);
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(RECENTS_INDEX_BACKUP_KEY, JSON.stringify(reordered));
        } catch {
          // ignore quota
        }
      }
    }
  } catch {
    // ignore
  }
}
