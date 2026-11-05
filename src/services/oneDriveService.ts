import { getAccessToken } from './msalService';
import { OneDriveItem } from '../types';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

const INVALID_ONEDRIVE_CHARS = /[\\/:*?"<>|]/;
const RESERVED_DOS_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/**
 * Valida se um nome de pasta ou arquivo é permitido no OneDrive / Windows.
 */
export function validateOneDriveName(rawName: string): {
  valid: boolean;
  sanitized: string;
  error?: string;
} {
  const sanitized = rawName.trim().replace(/\.+$/, '').trim();
  if (!sanitized || /^[.\s]+$/.test(sanitized)) {
    return { valid: false, sanitized: '', error: 'O nome não pode ficar vazio.' };
  }
  if (INVALID_ONEDRIVE_CHARS.test(sanitized)) {
    return {
      valid: false,
      sanitized,
      error: 'O nome contém caracteres inválidos (\\ / : * ? " < > |).',
    };
  }
  if (RESERVED_DOS_NAMES.test(sanitized)) {
    return {
      valid: false,
      sanitized,
      error: 'Este nome é reservado pelo sistema e não pode ser utilizado.',
    };
  }
  return { valid: true, sanitized };
}

/**
 * Verifica se o item retornado pela API do Microsoft Graph é uma pasta ou documento Markdown/texto suportado.
 */
export function isSupportedOneDriveItem(item: OneDriveItem): boolean {
  if (Boolean(item.folder)) return true;
  if (item.file || !item.folder) {
    const name = (item.name || '').toLowerCase();
    return name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt');
  }
  return false;
}

/**
 * Lists items in OneDrive folder (root or specified folderId).
 */
export async function listOneDriveItems(folderId?: string): Promise<OneDriveItem[]> {
  const token = await getAccessToken();
  const endpoint = folderId
    ? `${GRAPH_BASE_URL}/me/drive/items/${folderId}/children`
    : `${GRAPH_BASE_URL}/me/drive/root/children`;

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Graph API Error: ${response.statusText}`);
  }

  const data = await response.json();
  const items: OneDriveItem[] = data.value || [];

  return items.filter(isSupportedOneDriveItem);
}

/**
 * Downloads text content of a file from OneDrive.
 */
export async function downloadOneDriveFile(fileId: string): Promise<string> {
  const token = await getAccessToken();
  const response = await fetch(`${GRAPH_BASE_URL}/me/drive/items/${fileId}/content`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file from OneDrive: ${response.statusText}`);
  }

  return await response.text();
}

/**
 * Gets lightweight metadata (lastModifiedDateTime, eTag) for a specific file in OneDrive.
 */
export async function getOneDriveItemMetadata(fileId: string): Promise<OneDriveItem> {
  const token = await getAccessToken();
  const response = await fetch(`${GRAPH_BASE_URL}/me/drive/items/${fileId}?select=id,name,lastModifiedDateTime,eTag,size`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get OneDrive file metadata: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Overwrites an existing file in OneDrive with new Markdown content and returns updated metadata.
 * Optionally uses eTag with `If-Match` to detect real remote cloud conflicts (HTTP 412).
 */
export async function saveOneDriveFile(fileId: string, content: string, eTag?: string | null): Promise<OneDriveItem> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'text/markdown; charset=utf-8',
  };

  if (eTag) {
    headers['If-Match'] = eTag;
  }

  const response = await fetch(`${GRAPH_BASE_URL}/me/drive/items/${fileId}/content`, {
    method: 'PUT',
    headers,
    body: content,
  });

  if (!response.ok) {
    if (response.status === 412) {
      const err = new Error('412 Precondition Failed - O arquivo foi modificado na nuvem em outro dispositivo.');
      (err as any).status = 412;
      throw err;
    }
    throw new Error(`Failed to save file to OneDrive: ${response.statusText}`);
  }

  try {
    return await response.json();
  } catch {
    return {
      id: fileId,
      name: 'document.md',
      lastModifiedDateTime: new Date().toISOString(),
    };
  }
}

/**
 * Normaliza o nome do arquivo garantindo a extensão .md ou preservando .markdown / .txt.
 */
export function normalizeMarkdownFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Sem Título.md';
  if (/\.(md|markdown|txt)$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.md`;
}

/**
 * Calcula o próximo nome disponível em uma lista de nomes existentes,
 * adicionando ou incrementando sufixo numérico com parênteses: nome (1).md, nome (2).md...
 */
export function computeNextAvailableFileName(desiredName: string, existingNames: string[] = []): string {
  const normalized = normalizeMarkdownFileName(desiredName);
  const existingSet = new Set(existingNames.map((n) => n.toLowerCase().trim()));

  if (!existingSet.has(normalized.toLowerCase())) {
    return normalized;
  }

  // Decompõe em base, número existente e extensão
  const match = normalized.match(/^(.*?)(?: \((\d+)\))?(\.[^.]*)?$/);
  const base = match && match[1] ? match[1] : normalized;
  const currentNum = match && match[2] ? parseInt(match[2], 10) : 0;
  const ext = match && match[3] ? match[3] : '.md';

  let n = currentNum > 0 ? currentNum + 1 : 1;
  while (existingSet.has(`${base} (${n})${ext}`.toLowerCase())) {
    n++;
  }
  return `${base} (${n})${ext}`;
}

/**
 * Cria um novo arquivo no OneDrive via Microsoft Graph API.
 * Suporta resolução automática de colisão com sufixo (1), (2)...
 * Envia @microsoft.graph.conflictBehavior=fail para evitar geração nativa de "nome 1.md".
 * Se houver 409 (outro cliente gravou ao mesmo tempo), tenta o próximo número candidato automaticamente.
 */
export async function createOneDriveFile(
  folderId: string | undefined,
  desiredFileName: string,
  content: string,
  existingFolderNames: string[] = []
): Promise<OneDriveItem> {
  const token = await getAccessToken();

  let candidateName = computeNextAvailableFileName(desiredFileName, existingFolderNames);
  const match = candidateName.match(/^(.*?)(?: \((\d+)\))?(\.[^.]*)?$/);
  const base = match && match[1] ? match[1] : candidateName;
  let currentNum = match && match[2] ? parseInt(match[2], 10) : 0;
  const ext = match && match[3] ? match[3] : '.md';

  const maxRetries = 15;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const encodedName = encodeURIComponent(candidateName);
    const endpoint = folderId && folderId !== 'root'
      ? `${GRAPH_BASE_URL}/me/drive/items/${folderId}:/${encodedName}:/content?@microsoft.graph.conflictBehavior=fail`
      : `${GRAPH_BASE_URL}/me/drive/root:/${encodedName}:/content?@microsoft.graph.conflictBehavior=fail`;

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/markdown; charset=utf-8',
      },
      body: content,
    });

    if (response.ok) {
      return await response.json();
    }

    if (response.status === 409) {
      // Conflito de concorrência com outro dispositivo criando simultaneamente
      currentNum = currentNum > 0 ? currentNum + 1 : 1;
      candidateName = `${base} (${currentNum})${ext}`;
      continue;
    }

    throw new Error(`Falha ao criar arquivo no OneDrive: ${response.statusText}`);
  }

  throw new Error('Não foi possível gerar um nome de arquivo exclusivo no OneDrive.');
}

/**
 * Renomeia um arquivo existente no OneDrive via Microsoft Graph API (PATCH /me/drive/items/{fileId}).
 * Caso ocorra conflito de nome na mesma pasta (HTTP 409), tenta automaticamente sufixos (1), (2)...
 */
export async function renameOneDriveFile(
  fileId: string,
  desiredFileName: string
): Promise<OneDriveItem> {
  const token = await getAccessToken();

  let candidateName = normalizeMarkdownFileName(desiredFileName);
  const match = candidateName.match(/^(.*?)(?: \((\d+)\))?(\.[^.]*)?$/);
  const base = match && match[1] ? match[1] : candidateName;
  let currentNum = match && match[2] ? parseInt(match[2], 10) : 0;
  const ext = match && match[3] ? match[3] : '.md';

  const maxRetries = 15;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(`${GRAPH_BASE_URL}/me/drive/items/${fileId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: candidateName }),
    });

    if (response.ok) {
      return await response.json();
    }

    if (response.status === 409) {
      currentNum = currentNum > 0 ? currentNum + 1 : 1;
      candidateName = `${base} (${currentNum})${ext}`;
      continue;
    }

    throw new Error(`Falha ao renomear arquivo no OneDrive: ${response.statusText}`);
  }

  throw new Error('Não foi possível renomear o arquivo no OneDrive após múltiplas tentativas.');
}

/**
 * Cria uma nova pasta no OneDrive via Microsoft Graph API.
 */
export async function createOneDriveFolder(
  parentFolderId: string | undefined,
  folderName: string
): Promise<OneDriveItem> {
  const validation = validateOneDriveName(folderName);
  if (!validation.valid) {
    throw new Error(validation.error || 'Nome de pasta inválido.');
  }

  const token = await getAccessToken();
  const endpoint =
    parentFolderId && parentFolderId !== 'root'
      ? `${GRAPH_BASE_URL}/me/drive/items/${parentFolderId}/children`
      : `${GRAPH_BASE_URL}/me/drive/root/children`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: validation.sanitized,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  });

  if (response.status === 409) {
    throw new Error(`Já existe uma pasta ou arquivo chamado "${validation.sanitized}" neste local.`);
  }

  if (!response.ok) {
    throw new Error(`Falha ao criar pasta no OneDrive: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Renomeia um arquivo ou pasta no OneDrive via Microsoft Graph API.
 */
export async function renameOneDriveItem(
  itemId: string,
  desiredName: string,
  isFolder: boolean = false
): Promise<OneDriveItem> {
  const validation = validateOneDriveName(desiredName);
  if (!validation.valid) {
    throw new Error(validation.error || 'Nome inválido.');
  }

  if (!isFolder) {
    return renameOneDriveFile(itemId, validation.sanitized);
  }

  const token = await getAccessToken();
  const response = await fetch(`${GRAPH_BASE_URL}/me/drive/items/${itemId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: validation.sanitized }),
  });

  if (response.status === 409) {
    throw new Error(`Já existe uma pasta ou arquivo chamado "${validation.sanitized}" neste local.`);
  }

  if (!response.ok) {
    throw new Error(`Falha ao renomear pasta no OneDrive: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Exclui um item (arquivo ou pasta) no OneDrive movendo para a lixeira.
 * Trata status 404 e 204 como sucesso idempotente.
 */
export async function deleteOneDriveItem(itemId: string): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(`${GRAPH_BASE_URL}/me/drive/items/${itemId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 404 || response.status === 204 || response.ok) {
    return;
  }

  throw new Error(`Falha ao excluir item no OneDrive: ${response.statusText}`);
}

/**
 * Exclui múltiplos itens com concorrência controlada para evitar HTTP 429.
 */
export async function deleteOneDriveItemsBatch(
  itemIds: string[]
): Promise<{ succeeded: string[]; failed: Array<{ id: string; error: string }> }> {
  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const concurrency = 4;

  for (let i = 0; i < itemIds.length; i += concurrency) {
    const chunk = itemIds.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map(async (id) => {
        await deleteOneDriveItem(id);
        return id;
      })
    );
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        succeeded.push(res.value);
      } else {
        failed.push({
          id: chunk[idx],
          error: res.reason?.message || 'Erro ao excluir item.',
        });
      }
    });
  }

  return { succeeded, failed };
}

/**
 * Move um arquivo ou pasta para uma pasta de destino no OneDrive.
 */
export async function moveOneDriveItem(
  itemId: string,
  targetFolderId: string | undefined
): Promise<OneDriveItem> {
  if (targetFolderId && itemId === targetFolderId) {
    throw new Error('Não é possível mover uma pasta para dentro de si mesma.');
  }

  const token = await getAccessToken();
  let destinationId = targetFolderId;

  if (!destinationId || destinationId === 'root') {
    const rootRes = await fetch(`${GRAPH_BASE_URL}/me/drive/root?select=id`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!rootRes.ok) {
      throw new Error(`Falha ao localizar pasta raiz do OneDrive: ${rootRes.statusText}`);
    }
    const rootData = await rootRes.json();
    destinationId = rootData.id;
  }

  if (itemId === destinationId) {
    throw new Error('Não é possível mover uma pasta para dentro de si mesma.');
  }

  const response = await fetch(`${GRAPH_BASE_URL}/me/drive/items/${itemId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parentReference: { id: destinationId },
      '@microsoft.graph.conflictBehavior': 'rename',
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha ao mover item no OneDrive: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Move múltiplos itens com concorrência controlada para evitar HTTP 429.
 */
export async function moveOneDriveItemsBatch(
  itemIds: string[],
  targetFolderId: string | undefined
): Promise<{ succeeded: OneDriveItem[]; failed: Array<{ id: string; error: string }> }> {
  const succeeded: OneDriveItem[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const concurrency = 4;

  for (let i = 0; i < itemIds.length; i += concurrency) {
    const chunk = itemIds.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map((id) => moveOneDriveItem(id, targetFolderId))
    );
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        succeeded.push(res.value);
      } else {
        failed.push({
          id: chunk[idx],
          error: res.reason?.message || 'Erro ao mover item.',
        });
      }
    });
  }

  return { succeeded, failed };
}

/**
 * Duplica/copia um arquivo no OneDrive baixando o conteúdo e criando o arquivo com resolução de nomes.
 */
export async function copyOneDriveFile(
  sourceItemId: string,
  sourceItemName: string,
  targetFolderId: string | undefined,
  existingTargetNames: string[] = []
): Promise<OneDriveItem> {
  const content = await downloadOneDriveFile(sourceItemId);
  return await createOneDriveFile(targetFolderId, sourceItemName, content, existingTargetNames);
}

/**
 * Copia múltiplos arquivos sequencialmente para o destino rastreando colisões de nomes.
 */
export async function copyOneDriveFilesBatch(
  sourceItems: Array<{ id: string; name: string }>,
  targetFolderId: string | undefined,
  existingTargetNames: string[] = []
): Promise<{ succeeded: OneDriveItem[]; failed: Array<{ id: string; error: string }> }> {
  const succeeded: OneDriveItem[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const trackedNames = [...existingTargetNames];

  for (const item of sourceItems) {
    try {
      const created = await copyOneDriveFile(item.id, item.name, targetFolderId, trackedNames);
      trackedNames.push(created.name);
      succeeded.push(created);
    } catch (err: any) {
      failed.push({ id: item.id, error: err?.message || 'Erro ao copiar arquivo.' });
    }
  }

  return { succeeded, failed };
}

/**
 * Pesquisa itens no OneDrive globalmente via Microsoft Graph API e filtra arquivos suportados.
 */
export async function searchOneDriveItems(query: string): Promise<OneDriveItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const token = await getAccessToken();
  const safeQuery = encodeURIComponent(trimmed.replace(/'/g, "''"));
  const endpoint = `${GRAPH_BASE_URL}/me/drive/root/search(q='${safeQuery}')`;

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Falha na pesquisa do OneDrive: ${response.statusText}`);
  }

  const data = await response.json();
  const items: OneDriveItem[] = data.value || [];
  return items.filter(isSupportedOneDriveItem);
}
