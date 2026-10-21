export const DEFAULT_DOCUMENT_TITLE = 'Sem Título.md';

interface BlankCheckable {
  title?: string;
  content?: string;
  oneDriveItemId?: string | null;
  storedInDb?: boolean;
}

/**
 * Um documento é "em branco sem título" quando não tem fonte (OneDrive), usa o nome padrão
 * e não possui conteúdo significativo (`trim()` vazio). Esses documentos nunca devem ser
 * persistidos no histórico nem no localStorage.
 *
 * Snapshots leves (`storedInDb`) têm `content` vazio de propósito e nunca são considerados em branco.
 */
export function isBlankUntitledDocument(doc: BlankCheckable | null | undefined): boolean {
  if (!doc) return false;
  if (doc.storedInDb) return false;
  if (doc.oneDriveItemId) return false;
  if (doc.title && doc.title !== DEFAULT_DOCUMENT_TITLE) return false;
  return (doc.content ?? '').trim() === '';
}
