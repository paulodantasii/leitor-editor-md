import { getAccessToken } from './msalService';
import { OneDriveItem } from '../types';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

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

  // Filter only folders and .md files
  return items.filter((item) => {
    if (item.folder) return true;
    if (item.file) {
      const name = item.name.toLowerCase();
      return name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt');
    }
    return false;
  });
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
 * Respeita a Seção 3.4 do plano (evita "nome 1.md" nativo do Graph).
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

