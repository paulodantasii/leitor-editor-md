import type { Editor } from '@tiptap/react';

/**
 * Cache imutável em memória associando cada nó de bloco de topo do ProseMirror
 * à sua representação Markdown já serializada.
 * Como nós ProseMirror são imutáveis, apenas blocos efetivamente editados
 * ganham novas instâncias e precisam ser re-serializados ($O(1)$ por edição).
 */
const blockMarkdownCache = new WeakMap<object, string>();

const WARMUP_BATCH_SIZE = 80;

function serializeSingleTopLevelBlock(
  serializer: { serialize: (content: any) => string },
  doc: any,
  blockNode: any,
  index: number
): string {
  const isOrderedList = blockNode?.type?.name === 'orderedList';

  // Listas ordenadas consecutivas dependem da paridade do índice adjacente (. vs ))
  if (isOrderedList && index > 0 && doc.child(index - 1)?.type?.name === 'orderedList') {
    let adjacentCount = 0;
    for (let k = index - 1; k >= 0; k--) {
      if (doc.child(k)?.type?.name === 'orderedList') {
        adjacentCount++;
      } else {
        break;
      }
    }

    const startOffset = index - adjacentCount;
    const orderedContainer = {
      type: doc.type,
      attrs: doc.attrs,
      childCount: adjacentCount + 1,
      child: (idx: number) => doc.child(startOffset + idx),
      firstChild: doc.child(startOffset),
      lastChild: blockNode,
      forEach: (callback: (node: any, offset: number, idx: number) => void) => {
        callback(blockNode, 0, adjacentCount);
      },
    };

    return String(serializer.serialize(orderedContainer) ?? '');
  }

  const cached = blockMarkdownCache.get(blockNode);
  if (cached !== undefined) {
    return cached;
  }

  const singleBlockContainer = {
    type: doc.type,
    attrs: doc.attrs,
    childCount: 1,
    child: () => blockNode,
    firstChild: blockNode,
    lastChild: blockNode,
    forEach: (callback: (node: any, offset: number, idx: number) => void) => {
      callback(blockNode, 0, 0);
    },
  };

  const blockMd = String(serializer.serialize(singleBlockContainer) ?? '');
  blockMarkdownCache.set(blockNode, blockMd);
  return blockMd;
}

/**
 * Serializa o documento do Tiptap/ProseMirror para Markdown de forma incremental,
 * reutilizando via WeakMap a string Markdown de todos os blocos que não mudaram.
 */
export function serializeDocIncrementally(editor: Editor | null): string {
  if (!editor || editor.isDestroyed) {
    return '';
  }

  const doc = editor.state?.doc as any;
  const markdownStorage = (editor.storage as any)?.markdown;
  const serializer = markdownStorage?.serializer;

  if (!doc || !serializer || typeof serializer.serialize !== 'function') {
    return typeof markdownStorage?.getMarkdown === 'function'
      ? String(markdownStorage.getMarkdown() ?? '')
      : '';
  }

  if (typeof doc.childCount !== 'number' || typeof doc.child !== 'function') {
    return String(serializer.serialize(doc) ?? '');
  }

  const outputParts: string[] = [];
  let prevNonEmptyMd: string | null = null;
  let prevNonEmptyBlockNode: any = null;
  let prevRawBlockNode: any = null;

  for (let i = 0; i < doc.childCount; i++) {
    const blockNode = doc.child(i);
    const blockMd = serializeSingleTopLevelBlock(serializer, doc, blockNode, i);

    if (blockMd.length > 0) {
      if (prevNonEmptyMd !== null) {
        const blockTypeName = blockNode?.type?.name;
        const isAdjacentSameListType =
          prevNonEmptyBlockNode === prevRawBlockNode &&
          prevNonEmptyBlockNode?.type === blockNode?.type &&
          (blockTypeName === 'bulletList' || blockTypeName === 'orderedList');

        // Reproduz exatamente flushClose(3) para listas adjacentes do mesmo tipo e flushClose(2) nos demais casos
        const endsWithNewline = prevNonEmptyMd.endsWith('\n');
        if (isAdjacentSameListType) {
          outputParts.push(endsWithNewline ? '\n\n' : '\n\n\n');
        } else {
          outputParts.push(endsWithNewline ? '\n' : '\n\n');
        }
      }

      outputParts.push(blockMd);
      prevNonEmptyMd = blockMd;
      prevNonEmptyBlockNode = blockNode;
    }

    prevRawBlockNode = blockNode;
  }

  return outputParts.join('');
}

/**
 * Pré-aquece o cache de blocos em fatias ociosas sem bloquear a thread principal,
 * para que a primeira edição em um documento gigante seja imediata.
 */
export function warmUpIncrementalMarkdownCache(editor: Editor | null): () => void {
  if (!editor || editor.isDestroyed) {
    return () => {};
  }

  let cancelled = false;
  let nextIndex = 0;
  let idleId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const scheduleNextBatch = () => {
    if (cancelled || editor.isDestroyed) return;

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = (window as any).requestIdleCallback(runBatch, { timeout: 1000 });
    } else {
      timerId = setTimeout(runBatch, 16);
    }
  };

  const runBatch = () => {
    idleId = null;
    timerId = null;
    if (cancelled || editor.isDestroyed) return;

    const doc = editor.state?.doc as any;
    const serializer = (editor.storage as any)?.markdown?.serializer;
    if (!doc || !serializer || typeof serializer.serialize !== 'function') return;
    if (typeof doc.childCount !== 'number' || typeof doc.child !== 'function') return;

    const end = Math.min(doc.childCount, nextIndex + WARMUP_BATCH_SIZE);
    for (let i = nextIndex; i < end; i++) {
      const blockNode = doc.child(i);
      const isAdjacentOrdered =
        blockNode?.type?.name === 'orderedList' &&
        i > 0 &&
        doc.child(i - 1)?.type?.name === 'orderedList';

      if (!isAdjacentOrdered && !blockMarkdownCache.has(blockNode)) {
        serializeSingleTopLevelBlock(serializer, doc, blockNode, i);
      }
    }

    nextIndex = end;
    if (nextIndex < doc.childCount) {
      scheduleNextBatch();
    }
  };

  scheduleNextBatch();

  return () => {
    cancelled = true;
    if (
      idleId !== null &&
      typeof window !== 'undefined' &&
      'cancelIdleCallback' in window
    ) {
      (window as any).cancelIdleCallback(idleId);
      idleId = null;
    }
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };
}
