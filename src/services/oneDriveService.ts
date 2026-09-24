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
 */
export async function saveOneDriveFile(fileId: string, content: string): Promise<OneDriveItem> {
  const token = await getAccessToken();
  const response = await fetch(`${GRAPH_BASE_URL}/me/drive/items/${fileId}/content`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/markdown; charset=utf-8',
    },
    body: content,
  });

  if (!response.ok) {
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
