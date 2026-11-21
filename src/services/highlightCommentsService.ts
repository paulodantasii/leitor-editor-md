/**
 * Serviço centralizado de gerenciamento, persistência em Markdown, ciclo de vida
 * e formatação para cópia dos comentários atrelados a grifos (<mark data-id="...">).
 *
 * Formato da seção no final do arquivo Markdown:
 * <!-- HIGHLIGHT_COMMENTS_START -->
 * ---
 * **Comentários dos Grifos**
 *
 * - **[00001]**: Comentário do grifo
 * <!-- HIGHLIGHT_COMMENTS_END -->
 */

export const HIGHLIGHT_COMMENTS_START_MARKER = '<!-- HIGHLIGHT_COMMENTS_START -->';
export const HIGHLIGHT_COMMENTS_END_MARKER = '<!-- HIGHLIGHT_COMMENTS_END -->';
const HIGHLIGHT_COMMENTS_HEADER = '**Comentários dos Grifos**';
const DEFAULT_SCOPE_KEY = '__default_doc__';

/**
 * Memória imutável por documento na sessão atual.
 * Mantém também comentários cujos grifos foram removidos recentemente na sessão,
 * permitindo restauração transparente via Desfazer (Ctrl+Z), enquanto apenas os IDs
 * vivos no documento são serializados na seção final do arquivo Markdown.
 */
let commentsByDocScope: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map();

let activeCommentCountSnapshot = 0;
let activeCommentCountListeners: ReadonlyArray<(count: number) => void> = [];
type CopyAllCommentsHandler = () => Promise<number> | number;
let registeredCopyAllCommentsHandler: CopyAllCommentsHandler | null = null;

export interface ParsedMarkdownCommentsResult {
  readonly bodyMarkdown: string;
  readonly comments: ReadonlyMap<string, string>;
  readonly hasCommentsSection: boolean;
}

export interface CommentedHighlightEntry {
  readonly id: string;
  readonly highlightText: string;
  readonly commentText: string;
}

function resolveScopeKey(scopeKey: string | null | undefined): string {
  return scopeKey && scopeKey.trim() ? scopeKey.trim() : DEFAULT_SCOPE_KEY;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function findLastCommentsSectionRange(
  markdown: string
): { startIdx: number; endIdx: number; blockContent: string } | null {
  if (!markdown || !markdown.includes(HIGHLIGHT_COMMENTS_START_MARKER)) {
    return null;
  }

  const startLineRegex = /(?:^|\n)[ \t]*<!-- HIGHLIGHT_COMMENTS_START -->[ \t]*(?:\n|$)/g;
  let lastStartMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;

  while ((match = startLineRegex.exec(markdown)) !== null) {
    lastStartMatch = match;
  }

  if (!lastStartMatch) return null;

  const markerOffset = lastStartMatch[0].indexOf(HIGHLIGHT_COMMENTS_START_MARKER);
  const startIdx = lastStartMatch.index + markerOffset;
  const contentStart = startIdx + HIGHLIGHT_COMMENTS_START_MARKER.length;

  const endLineRegex = /(?:^|\n)[ \t]*<!-- HIGHLIGHT_COMMENTS_END -->[ \t]*(?=\n|$)/g;
  endLineRegex.lastIndex = contentStart;
  const endMatch = endLineRegex.exec(markdown);
  if (!endMatch) return null;

  const endMarkerOffset = endMatch[0].indexOf(HIGHLIGHT_COMMENTS_END_MARKER);
  const endIdx = endMatch.index + endMarkerOffset;

  return {
    startIdx,
    endIdx,
    blockContent: markdown.slice(contentStart, endIdx),
  };
}

function parseCommentsFromSectionContent(blockContent: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  const lines = normalizeNewlines(blockContent).split('\n');

  let currentId: string | null = null;
  let currentLines: string[] = [];

  const flushCurrent = () => {
    if (!currentId) return;
    while (currentLines.length > 0 && currentLines[currentLines.length - 1] === '') {
      currentLines.pop();
    }
    const text = currentLines.join('\n');
    if (text.trim().length > 0) {
      entries.set(currentId, text);
    }
    currentId = null;
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (currentId === null) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---' || trimmed === HIGHLIGHT_COMMENTS_HEADER) {
        continue;
      }
    }

    const itemMatch = line.match(/^- \*\*\[([^\]]+)\]\*\*:\s?(.*)$/);
    if (itemMatch) {
      flushCurrent();
      const parsedId = itemMatch[1].trim();
      if (parsedId) {
        currentId = parsedId;
        currentLines = [itemMatch[2]];
      }
      continue;
    }

    if (currentId !== null) {
      if (line.startsWith('  ')) {
        currentLines.push(line.slice(2));
      } else if (line.trim() === '') {
        currentLines.push('');
      } else {
        currentLines.push(line);
      }
    }
  }

  flushCurrent();
  return entries;
}

/**
 * Separa o corpo Markdown da seção final de comentários de grifos (se existir),
 * retornando o `bodyMarkdown` limpo e o mapa imutável `id -> comentário`.
 */
export function parseMarkdownWithHighlightComments(
  fullMarkdown: string
): ParsedMarkdownCommentsResult {
  if (!fullMarkdown) {
    return {
      bodyMarkdown: '',
      comments: new Map(),
      hasCommentsSection: false,
    };
  }

  const normalized = normalizeNewlines(fullMarkdown);
  let workingBody = normalized;
  let mergedComments = new Map<string, string>();
  let hasCommentsSection = false;

  // Remove de trás para frente caso haja blocos duplicados por edição manual
  while (true) {
    const range = findLastCommentsSectionRange(workingBody);
    if (!range) break;

    hasCommentsSection = true;
    const sectionComments = parseCommentsFromSectionContent(range.blockContent);
    if (sectionComments.size > 0) {
      const nextMerged = new Map(sectionComments);
      mergedComments.forEach((val, key) => {
        nextMerged.set(key, val);
      });
      mergedComments = nextMerged;
    }

    const before = workingBody.slice(0, range.startIdx).replace(/(?:\n)+$/, '');
    const after = workingBody
      .slice(range.endIdx + HIGHLIGHT_COMMENTS_END_MARKER.length)
      .replace(/^(?:\n)+/, '');

    if (after.trim().length > 0) {
      workingBody = before ? `${before}\n\n${after}` : after;
    } else {
      workingBody = before;
    }
  }

  return {
    bodyMarkdown: workingBody,
    comments: mergedComments,
    hasCommentsSection,
  };
}

/**
 * Compõe o Markdown final anexando a seção de comentários ao rodapé apenas quando
 * houver pelo menos um comentário válido (e vivo no documento, se `activeHighlightIds` for fornecido).
 */
export function composeMarkdownWithHighlightComments(
  bodyMarkdown: string,
  commentsMap: ReadonlyMap<string, string>,
  activeHighlightIds?: ReadonlySet<string> | ReadonlyArray<string>
): string {
  const { bodyMarkdown: cleanBody } = parseMarkdownWithHighlightComments(bodyMarkdown || '');

  const orderedEntries: Array<[string, string]> = [];

  if (activeHighlightIds) {
    const seen = new Set<string>();
    const activeList = Array.isArray(activeHighlightIds)
      ? activeHighlightIds
      : Array.from(activeHighlightIds);

    for (let i = 0; i < activeList.length; i++) {
      const id = activeList[i];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const comment = commentsMap.get(id);
      if (typeof comment === 'string' && comment.trim().length > 0) {
        orderedEntries.push([id, normalizeNewlines(comment).replace(/\n+$/, '')]);
      }
    }
  } else {
    commentsMap.forEach((comment, id) => {
      if (id && typeof comment === 'string' && comment.trim().length > 0) {
        orderedEntries.push([id, normalizeNewlines(comment).replace(/\n+$/, '')]);
      }
    });
  }

  if (orderedEntries.length === 0) {
    return cleanBody;
  }

  const serializedItems = orderedEntries.map(([id, text]) => {
    const lines = text.split('\n');
    const firstLine = `- **[${id}]**: ${lines[0]}`;
    if (lines.length === 1) {
      return firstLine;
    }
    const indentedRest = lines.slice(1).map((line) => (line === '' ? '' : `  ${line}`));
    return `${firstLine}\n${indentedRest.join('\n')}`;
  });

  const footerBlock = [
    HIGHLIGHT_COMMENTS_START_MARKER,
    '---',
    HIGHLIGHT_COMMENTS_HEADER,
    '',
    ...serializedItems,
    HIGHLIGHT_COMMENTS_END_MARKER,
  ].join('\n');

  if (!cleanBody) {
    return footerBlock;
  }

  return `${cleanBody.replace(/\n+$/, '')}\n\n${footerBlock}`;
}

/**
 * Hidrata os comentários de um documento na memória de sessão.
 * - Quando `replaceExisting = true` (ex.: saída do Modo Código-Fonte ou sync externo),
 *   substitui o mapa do escopo pelos comentários recém-lidos.
 * - Quando `replaceExisting = false` (padrão), preserva histórico da sessão e mescla os novos.
 */
export function hydrateDocHighlightComments(
  scopeKey: string | null | undefined,
  parsedComments: ReadonlyMap<string, string>,
  replaceExisting: boolean = false
): ReadonlyMap<string, string> {
  const resolvedScope = resolveScopeKey(scopeKey);
  const existing = commentsByDocScope.get(resolvedScope) ?? new Map<string, string>();
  const nextDocMap = replaceExisting ? new Map<string, string>() : new Map<string, string>(existing);

  parsedComments.forEach((comment, id) => {
    const cleanId = typeof id === 'string' ? id.trim() : '';
    if (cleanId && typeof comment === 'string' && comment.trim().length > 0) {
      nextDocMap.set(cleanId, normalizeNewlines(comment));
    }
  });

  commentsByDocScope = new Map([
    ...commentsByDocScope,
    [resolvedScope, nextDocMap],
  ]);

  return nextDocMap;
}

export function getDocHighlightComments(
  scopeKey: string | null | undefined
): ReadonlyMap<string, string> {
  const resolvedScope = resolveScopeKey(scopeKey);
  return commentsByDocScope.get(resolvedScope) ?? new Map<string, string>();
}

export function getHighlightComment(
  scopeKey: string | null | undefined,
  highlightId: string | null | undefined
): string {
  if (!highlightId) return '';
  const map = getDocHighlightComments(scopeKey);
  return map.get(highlightId.trim()) ?? '';
}

export function setHighlightComment(
  scopeKey: string | null | undefined,
  highlightId: string,
  commentText: string
): ReadonlyMap<string, string> {
  const cleanId = highlightId.trim();
  if (!cleanId) return getDocHighlightComments(scopeKey);

  const resolvedScope = resolveScopeKey(scopeKey);
  const existing = commentsByDocScope.get(resolvedScope) ?? new Map<string, string>();
  const nextDocMap = new Map(existing);

  if (commentText.trim().length === 0) {
    nextDocMap.delete(cleanId);
  } else {
    nextDocMap.set(cleanId, normalizeNewlines(commentText));
  }

  commentsByDocScope = new Map([
    ...commentsByDocScope,
    [resolvedScope, nextDocMap],
  ]);

  return nextDocMap;
}

/**
 * Exclui explicitamente um comentário sem remover o grifo correspondente.
 */
export function deleteHighlightComment(
  scopeKey: string | null | undefined,
  highlightId: string
): ReadonlyMap<string, string> {
  const cleanId = highlightId.trim();
  if (!cleanId) return getDocHighlightComments(scopeKey);

  const resolvedScope = resolveScopeKey(scopeKey);
  const existing = commentsByDocScope.get(resolvedScope);
  if (!existing || !existing.has(cleanId)) {
    return existing ?? new Map<string, string>();
  }

  const nextDocMap = new Map(existing);
  nextDocMap.delete(cleanId);

  commentsByDocScope = new Map([
    ...commentsByDocScope,
    [resolvedScope, nextDocMap],
  ]);

  return nextDocMap;
}

/**
 * Quando um grifo novo substitui/sobrepõe grifos antigos (ex.: ao ajustar o tamanho),
 * migra automaticamente eventuais comentários dos IDs removidos para o novo ID.
 */
export function migrateCommentsOnHighlightOverlap(
  scopeKey: string | null | undefined,
  removedIds: ReadonlyArray<string>,
  newId: string
): boolean {
  const cleanNewId = newId.trim();
  if (!cleanNewId || !removedIds || removedIds.length === 0) return false;

  const resolvedScope = resolveScopeKey(scopeKey);
  const existing = commentsByDocScope.get(resolvedScope);
  if (!existing || existing.size === 0) return false;

  const collectedComments: string[] = [];
  const idsToDelete: string[] = [];

  for (let i = 0; i < removedIds.length; i++) {
    const oldId = removedIds[i]?.trim();
    if (!oldId || oldId === cleanNewId) continue;

    const oldComment = existing.get(oldId);
    if (typeof oldComment === 'string' && oldComment.trim().length > 0) {
      if (!collectedComments.includes(oldComment)) {
        collectedComments.push(oldComment);
      }
      idsToDelete.push(oldId);
    }
  }

  if (collectedComments.length === 0) return false;

  const nextDocMap = new Map(existing);
  const existingNewComment = nextDocMap.get(cleanNewId);
  if (
    typeof existingNewComment === 'string' &&
    existingNewComment.trim().length > 0 &&
    !collectedComments.includes(existingNewComment)
  ) {
    collectedComments.unshift(existingNewComment);
  }

  for (let i = 0; i < idsToDelete.length; i++) {
    nextDocMap.delete(idsToDelete[i]);
  }
  nextDocMap.set(cleanNewId, collectedComments.join('\n\n'));

  commentsByDocScope = new Map([
    ...commentsByDocScope,
    [resolvedScope, nextDocMap],
  ]);

  return true;
}

/**
 * Coleta todos os IDs de grifos vivos no documento ProseMirror na ordem em que aparecem.
 */
export function collectOrderedHighlightIdsFromProseMirrorDoc(doc: any): string[] {
  if (!doc || typeof doc.descendants !== 'function') return [];

  const orderedIds: string[] = [];
  const seen = new Set<string>();

  doc.descendants((node: any) => {
    if (!node?.isText || !Array.isArray(node.marks)) return;
    for (let i = 0; i < node.marks.length; i++) {
      const mark = node.marks[i];
      if (mark?.type?.name !== 'customHighlight') continue;
      const rawId = typeof mark.attrs?.id === 'string' ? mark.attrs.id.trim() : '';
      if (rawId && !seen.has(rawId)) {
        seen.add(rawId);
        orderedIds.push(rawId);
      }
    }
  });

  return orderedIds;
}

/**
 * Coleta os IDs de grifos vivos em uma string Markdown na ordem em que aparecem no corpo.
 */
export function collectOrderedHighlightIdsFromMarkdown(bodyMarkdown: string): string[] {
  if (!bodyMarkdown || !bodyMarkdown.includes('<mark')) return [];

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const markTagRegex = /<mark\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = markTagRegex.exec(bodyMarkdown)) !== null) {
    const attrs = match[1] || '';
    const idMatch = attrs.match(/\b(?:data-id|data-hl-id|id)=["']([^"']+)["']/i);
    const rawId = idMatch?.[1]?.trim() || '';
    if (rawId && !seen.has(rawId)) {
      seen.add(rawId);
      orderedIds.push(rawId);
    }
  }

  return orderedIds;
}

function normalizeQuotedHighlightText(rawText: string): string {
  return rawText.replace(/\s+/g, ' ').trim();
}

function extractHighlightTextsMapFromProseMirrorDoc(
  doc: any,
  targetIds?: ReadonlySet<string>
): Map<string, string> {
  const result = new Map<string, string>();
  if (!doc || typeof doc.descendants !== 'function') return result;

  const buffers = new Map<string, { parts: string[]; lastEndPos: number }>();

  doc.descendants((node: any, pos: number) => {
    if (!node?.isText || typeof node.text !== 'string' || !Array.isArray(node.marks)) {
      return;
    }

    const nodeEndPos = pos + node.nodeSize;
    for (let i = 0; i < node.marks.length; i++) {
      const mark = node.marks[i];
      if (mark?.type?.name !== 'customHighlight') continue;
      const rawId = typeof mark.attrs?.id === 'string' ? mark.attrs.id.trim() : '';
      if (!rawId) continue;
      if (targetIds && !targetIds.has(rawId)) continue;

      let entry = buffers.get(rawId);
      if (!entry) {
        entry = { parts: [node.text], lastEndPos: nodeEndPos };
        buffers.set(rawId, entry);
      } else {
        if (pos > entry.lastEndPos) {
          entry.parts.push(' ');
        }
        entry.parts.push(node.text);
        entry.lastEndPos = nodeEndPos;
      }
    }
  });

  buffers.forEach((entry, id) => {
    result.set(id, normalizeQuotedHighlightText(entry.parts.join('')));
  });

  return result;
}

/**
 * Extrai o texto grifado limpo (sem quebras de linha) pertencente a um ID no ProseMirror.
 */
export function extractHighlightTextByIdFromProseMirrorDoc(
  doc: any,
  highlightId: string
): string {
  const cleanId = highlightId.trim();
  if (!cleanId) return '';
  const map = extractHighlightTextsMapFromProseMirrorDoc(doc, new Set([cleanId]));
  return map.get(cleanId) ?? '';
}

/**
 * Extrai o texto grifado limpo pertencente a um ID diretamente do Markdown bruto.
 */
export function extractHighlightTextByIdFromMarkdown(
  bodyMarkdown: string,
  highlightId: string
): string {
  const cleanId = highlightId.trim();
  if (!bodyMarkdown || !cleanId || !bodyMarkdown.includes('<mark')) return '';

  const escapedId = cleanId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markRegex = new RegExp(
    `<mark\\b[^>]*\\b(?:data-id|data-hl-id|id)=["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/mark>`,
    'gi'
  );

  const chunks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = markRegex.exec(bodyMarkdown)) !== null) {
    const inner = match[1].replace(/<[^>]+>/g, '');
    if (inner) {
      chunks.push(inner);
    }
  }

  return normalizeQuotedHighlightText(chunks.join(' '));
}

/**
 * Formata um único comentário para a área de transferência no padrão:
 * Sobre "[texto grifado]": [meu comentário]
 */
export function formatSingleCommentForCopy(
  highlightText: string,
  commentText: string
): string {
  const cleanHighlight = normalizeQuotedHighlightText(highlightText);
  const cleanComment = commentText.trim();
  return `Sobre "${cleanHighlight}": ${cleanComment}`;
}

/**
 * Coleta todos os grifos comentados vivos no documento na ordem em que aparecem.
 */
export function extractAllCommentedHighlightsInOrder(
  docOrMarkdown: any,
  commentsMap: ReadonlyMap<string, string>
): ReadonlyArray<CommentedHighlightEntry> {
  if (!docOrMarkdown || !commentsMap || commentsMap.size === 0) return [];

  if (typeof docOrMarkdown === 'string') {
    const { bodyMarkdown } = parseMarkdownWithHighlightComments(docOrMarkdown);
    const orderedIds = collectOrderedHighlightIdsFromMarkdown(bodyMarkdown);
    const items: CommentedHighlightEntry[] = [];

    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      const comment = commentsMap.get(id);
      if (typeof comment === 'string' && comment.trim().length > 0) {
        items.push({
          id,
          highlightText: extractHighlightTextByIdFromMarkdown(bodyMarkdown, id),
          commentText: comment.trim(),
        });
      }
    }
    return items;
  }

  const orderedIds = collectOrderedHighlightIdsFromProseMirrorDoc(docOrMarkdown);
  const commentedIds = orderedIds.filter((id) => {
    const comment = commentsMap.get(id);
    return typeof comment === 'string' && comment.trim().length > 0;
  });

  if (commentedIds.length === 0) return [];

  const textMap = extractHighlightTextsMapFromProseMirrorDoc(
    docOrMarkdown,
    new Set(commentedIds)
  );

  return commentedIds.map((id) => ({
    id,
    highlightText: textMap.get(id) ?? '',
    commentText: (commentsMap.get(id) ?? '').trim(),
  }));
}

/**
 * Formata todos os comentários em sequência para colagem única (IA / fichamento).
 */
export function formatAllCommentsForCopy(
  items: ReadonlyArray<Pick<CommentedHighlightEntry, 'highlightText' | 'commentText'>>
): string {
  if (!items || items.length === 0) return '';
  return items
    .filter((item) => item.commentText.trim().length > 0)
    .map((item) => formatSingleCommentForCopy(item.highlightText, item.commentText))
    .join('\n\n');
}

/**
 * Sincroniza o atributo DOM `data-has-comment="true"` nos elementos `<mark>` do container
 * para exibir a borda inferior pontilhada nos grifos comentados.
 */
export function syncCommentedMarksInDom(
  container: HTMLElement | null,
  commentsMap: ReadonlyMap<string, string>
): void {
  if (!container) return;

  const marks = container.querySelectorAll('mark');
  for (let i = 0; i < marks.length; i++) {
    const markEl = marks[i] as HTMLElement;
    const id = markEl.getAttribute('data-id')?.trim() || '';
    const comment = id ? commentsMap.get(id) : undefined;
    const hasComment = typeof comment === 'string' && comment.trim().length > 0;

    if (hasComment) {
      if (markEl.getAttribute('data-has-comment') !== 'true') {
        markEl.setAttribute('data-has-comment', 'true');
      }
    } else if (markEl.hasAttribute('data-has-comment')) {
      markEl.removeAttribute('data-has-comment');
    }
  }
}

/**
 * Copia texto para a área de transferência usando a Clipboard API com fallback seguro
 * preservando o elemento focado atual.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Segue para fallback com execCommand
  }

  if (typeof document === 'undefined') return false;

  const activeEl = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';

  document.body.appendChild(textarea);
  let copied = false;
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    if (activeEl && typeof activeEl.focus === 'function') {
      try {
        activeEl.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    }
  }
  return copied;
}

export function getActiveCommentCount(): number {
  return activeCommentCountSnapshot;
}

export function setActiveCommentCount(count: number): void {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (safeCount === activeCommentCountSnapshot) return;
  activeCommentCountSnapshot = safeCount;
  activeCommentCountListeners.forEach((listener) => listener(activeCommentCountSnapshot));
}

export function subscribeActiveCommentCount(listener: (count: number) => void): () => void {
  activeCommentCountListeners = [...activeCommentCountListeners, listener];
  listener(activeCommentCountSnapshot);
  return () => {
    activeCommentCountListeners = activeCommentCountListeners.filter((l) => l !== listener);
  };
}

export function registerCopyAllCommentsHandler(handler: CopyAllCommentsHandler): () => void {
  registeredCopyAllCommentsHandler = handler;
  return () => {
    if (registeredCopyAllCommentsHandler === handler) {
      registeredCopyAllCommentsHandler = null;
    }
  };
}

export async function requestCopyAllComments(): Promise<number> {
  if (!registeredCopyAllCommentsHandler) return 0;
  return await registeredCopyAllCommentsHandler();
}

/**
 * Limpa estado em memória (uso exclusivo em testes unitários).
 */
export function resetHighlightCommentsMemory(): void {
  commentsByDocScope = new Map();
  activeCommentCountSnapshot = 0;
  activeCommentCountListeners = [];
  registeredCopyAllCommentsHandler = null;
}
