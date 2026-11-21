import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import { Markdown } from 'tiptap-markdown';
import TextAlign from '@tiptap/extension-text-align';
import Table, { createColGroup } from '@tiptap/extension-table';
import { mergeAttributes } from '@tiptap/core';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

import { useAppStore } from '../../store/useAppStore';
import { CustomHighlight } from './CustomHighlight';
import { FloatingHighlightPopover } from './FloatingHighlightPopover';
import { EditorToolbar } from './EditorToolbar';
import { SearchHighlightExtension } from './SearchHighlightExtension';
import { FindReplaceBar } from './FindReplaceBar';
import { SourceSearchBackdrop } from './SourceSearchBackdrop';
import { useDocumentSearch } from '../../hooks/useDocumentSearch';
import {
  useHighlightPopoverController,
  type HighlightPopoverController,
} from '../../hooks/useHighlightPopoverController';
import {
  registerEditorFlushHandler,
  markBridgeDirty,
  markBridgeClean,
  hasPendingBridgeChanges,
} from '../../services/editorContentBridge';
import { useTabScrollRestoration } from '../../hooks/useTabScrollRestoration';
import {
  createHighlightTransaction,
  parseSequentialHighlightId,
  primeHighlightIdScope,
  registerScrollToLatestHighlightHandler,
  scrollToHighlightByIdInContainer,
  scrollToLatestHighlightInContainer,
  scanHighlightsInMarkdown,
} from '../../services/highlightIdService';
import {
  HIGHLIGHT_COMMENTS_START_MARKER,
  parseMarkdownWithHighlightComments,
  composeMarkdownWithHighlightComments,
  hydrateDocHighlightComments,
  getDocHighlightComments,
  getHighlightComment,
  migrateCommentsOnHighlightOverlap,
  collectOrderedHighlightIdsFromProseMirrorDoc,
  collectOrderedHighlightIdsFromMarkdown,
  extractHighlightTextByIdFromProseMirrorDoc,
  extractAllCommentedHighlightsInOrder,
  findLatestCommentedHighlightId,
  formatAllCommentsForCopy,
  syncCommentedMarksInDom,
  copyTextToClipboard,
  getActiveCommentCount,
  setActiveCommentCount,
  registerCopyAllCommentsHandler,
  registerScrollToLatestCommentHandler,
} from '../../services/highlightCommentsService';
import {
  TocHeadingItem,
  extractHeadingsFromProseMirrorDoc,
  extractHeadingsFromMarkdown,
  findActiveHeadingIndexByTops,
  getStickyTopOffsetPx,
  getActiveHeadingThresholdY,
  getTocSnapshot,
  setTocActiveIndex,
  updateTocState,
  resetTocState,
  registerNavigateToHeadingHandler,
  pulseHeadingElement,
} from '../../services/tocService';
import {
  getTopLevelBlockCharRanges,
  serializeDocIncrementally,
  warmUpIncrementalMarkdownCache,
} from '../../services/incrementalMarkdownSerializer';
import {
  ScrollSyncAnchor,
  captureVisualScrollAnchor,
  captureSourceScrollAnchor,
  resolveSourceTargetScrollY,
  resolveVisualTargetScrollY,
  measureMultipleTextareaOffsetsTopPx,
  measureTextareaOffsetTopPx,
} from '../../services/sourceScrollSyncService';
import { saveTabScrollPosition } from '../../services/tabScrollMemory';
import {
  detectNextCaseCycleMode,
  createCaseTransformTransaction,
} from '../../services/textTransformService';

/**
 * Conta grifos (<mark ...>) diretamente no Markdown bruto quando em Modo Código-Fonte.
 * Agrupa múltiplos <mark> com o mesmo data-id como 1 único grifo, idêntico ao ProseMirror.
 */
function countHighlightsInRawMarkdown(markdown: string): number {
  if (!markdown || !markdown.includes('<mark')) return 0;
  const uniqueIds = new Set<string>();
  let unassignedCount = 0;
  const markTagRegex = /<mark\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = markTagRegex.exec(markdown)) !== null) {
    const attrs = match[1] || '';
    const idMatch = attrs.match(/\b(?:data-id|data-hl-id|id)=["']([^"']+)["']/i);
    if (idMatch && idMatch[1]) {
      uniqueIds.add(idMatch[1]);
    } else {
      unassignedCount++;
    }
  }

  return uniqueIds.size + unassignedCount;
}

/**
 * Seleciona e rola até a tag <mark> correspondente a um ID no textarea de Modo Código-Fonte.
 */
function scrollToMarkIdInSourceTextarea(
  textarea: HTMLTextAreaElement,
  markdown: string,
  targetId: string
): void {
  const escapedId = targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<mark\\b[^>]*\\b(?:data-id|data-hl-id|id)=["']${escapedId}["'][^>]*>`, 'i');
  const match = regex.exec(markdown);
  if (match && typeof match.index === 'number') {
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(match.index, match.index + match[0].length);
    const ratio = markdown.length > 0 ? match.index / markdown.length : 0;
    const rect = textarea.getBoundingClientRect();
    const estimatedY = Math.max(
      0,
      rect.top + window.scrollY + textarea.scrollHeight * ratio - window.innerHeight * 0.3
    );
    window.scrollTo({ top: estimatedY, left: 0, behavior: 'smooth' });
  }
}

/**
 * Verifica em tempo O(steps) se uma transação ProseMirror tocou em algum título (heading)
 * ou alterou a estrutura de blocos do documento, evitando re-extrair o sumário a cada tecla/grifo.
 */
function transactionTouchesHeading(tr: any): boolean {
  if (!tr || !tr.docChanged) return false;
  if (tr.before && tr.doc && tr.before.childCount !== tr.doc.childCount) {
    return true;
  }

  const steps = Array.isArray(tr.steps) ? tr.steps : [];
  if (steps.length === 0) return true;

  let hasStructuralOrTextStep = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if ('slice' in step || 'structure' in step || 'attr' in step) {
      hasStructuralOrTextStep = true;
      break;
    }
  }
  if (!hasStructuralOrTextStep) return false;

  let touchedHeading = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const map = typeof step?.getMap === 'function' ? step.getMap() : null;
    if (!map || typeof map.forEach !== 'function') {
      return true;
    }

    let hadMappedRange = false;
    map.forEach((oldStart: number, oldEnd: number, newStart: number, newEnd: number) => {
      hadMappedRange = true;
      if (touchedHeading) return;
      if (tr.before && typeof tr.before.nodesBetween === 'function') {
        const safeOldStart = Math.max(0, Math.min(oldStart, tr.before.content.size));
        const safeOldEnd = Math.max(safeOldStart, Math.min(oldEnd, tr.before.content.size));
        tr.before.nodesBetween(safeOldStart, safeOldEnd, (node: any) => {
          if (node?.type?.name === 'heading') {
            touchedHeading = true;
            return false;
          }
          return true;
        });
      }
      if (!touchedHeading && tr.doc && typeof tr.doc.nodesBetween === 'function') {
        const safeNewStart = Math.max(0, Math.min(newStart, tr.doc.content.size));
        const safeNewEnd = Math.max(safeNewStart, Math.min(newEnd, tr.doc.content.size));
        tr.doc.nodesBetween(safeNewStart, safeNewEnd, (node: any) => {
          if (node?.type?.name === 'heading') {
            touchedHeading = true;
            return false;
          }
          return true;
        });
      }
    });

    if (!hadMappedRange && typeof step?.pos === 'number') {
      const nodeAtPos = tr.doc?.nodeAt?.(step.pos);
      if (nodeAtPos?.type?.name === 'heading') {
        return true;
      }
    }

    if (touchedHeading) return true;
  }

  return touchedHeading;
}

export const TiptapEditor: React.FC = () => {
  // Fine-grained selectors: avoids re-rendering TiptapEditor on every content change / sync update
  const docId = useAppStore((state) => state.document?.docId);
  const isHighlightMode = useAppStore((state) => state.isHighlightMode);
  const isEditable = useAppStore((state) => state.isEditable);
  const isSourceMode = useAppStore((state) => state.isSourceMode);
  const toggleSourceMode = useAppStore((state) => state.toggleSourceMode);
  const preferences = useAppStore(
    useShallow((state) => ({
      fontSize: state.preferences.fontSize,
      fontFamily: state.preferences.fontFamily,
      textWidth: state.preferences.textWidth,
    }))
  );
  const updateDocumentContent = useAppStore((state) => state.updateDocumentContent);
  const markDocumentDirty = useAppStore((state) => state.markDocumentDirty);
  const setHighlightCount = useAppStore((state) => state.setHighlightCount);

  const containerRef = useRef<HTMLDivElement>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isMouseDownRef = useRef(false);
  const isTouchSelectingRef = useRef(false);
  const justAppliedHighlightAtRef = useRef<number>(0);
  const cachedDomHeadingsRef = useRef<HTMLElement[]>([]);
  const warmUpCancelRef = useRef<(() => void) | null>(null);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastEmittedMarkdownRef = useRef<string | null>(null);
  const currentLoadedDocIdRef = useRef<string | null | undefined>(null);
  const markdownDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const markdownIdleCallbackRef = useRef<number | null>(null);
  const highlightCountDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tocExtractTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tocScrollRafRef = useRef<number | null>(null);
  const navigationLockRef = useRef<number | null>(null);

  // Estado e refs do Modo Código-Fonte (Markdown puro)
  const [rawContent, setRawContent] = useState<string>(() => useAppStore.getState().document?.content || '');
  const rawContentRef = useRef<string>(rawContent);
  const isSourceModeRef = useRef<boolean>(isSourceMode);
  const prevIsSourceModeRef = useRef<boolean>(isSourceMode);
  const isRawDirtyRef = useRef<boolean>(false);

  const [commentsVersion, setCommentsVersion] = useState(0);
  // Referência estável ao controlador desacoplado do seletor flutuante de grifos (@see docs/HIGHLIGHT_POPOVER_GOTCHAS.md)
  const popoverControllerRef = useRef<HighlightPopoverController | null>(null);

  // Track global mouse/touch active state to avoid premature auto-highlight while dragging selection
  useEffect(() => {
    const handleDown = () => (isMouseDownRef.current = true);
    const handleUp = () => (isMouseDownRef.current = false);
    const handleTouchStartGlobal = () => (isTouchSelectingRef.current = true);
    const handleTouchEndGlobal = () => (isTouchSelectingRef.current = false);

    window.addEventListener('mousedown', handleDown);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchstart', handleTouchStartGlobal, { passive: true });
    window.addEventListener('touchend', handleTouchEndGlobal, { passive: true });
    window.addEventListener('touchcancel', handleTouchEndGlobal, { passive: true });

    return () => {
      window.removeEventListener('mousedown', handleDown);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchstart', handleTouchStartGlobal);
      window.removeEventListener('touchend', handleTouchEndGlobal);
      window.removeEventListener('touchcancel', handleTouchEndGlobal);
    };
  }, []);

  const editorRef = useRef<Editor | null>(null);
  const scheduleDebouncedContentRef = useRef<() => void>(() => {});
  const postponePendingContentFlushRef = useRef<() => void>(() => {});
  const scheduleDebouncedTocRefreshRef = useRef<(ed: Editor | null) => void>(() => {});
  const commentDomSyncRafRef = useRef<number | null>(null);

  const syncCommentVisualsAndCount = useCallback((ed: Editor | null) => {
    const currentDocId = useAppStore.getState().document?.docId;

    if (isSourceModeRef.current) {
      const parsed = parseMarkdownWithHighlightComments(rawContentRef.current);
      const liveIds = collectOrderedHighlightIdsFromMarkdown(parsed.bodyMarkdown);
      let count = 0;
      for (let i = 0; i < liveIds.length; i++) {
        const c = parsed.comments.get(liveIds[i]);
        if (typeof c === 'string' && c.trim().length > 0) {
          count++;
        }
      }
      setActiveCommentCount(count);
      return;
    }

    if (!ed || ed.isDestroyed) {
      setActiveCommentCount(0);
      return;
    }

    const commentsMap = getDocHighlightComments(currentDocId);
    const liveIds = collectOrderedHighlightIdsFromProseMirrorDoc(ed.state.doc);
    let count = 0;
    for (let i = 0; i < liveIds.length; i++) {
      const c = commentsMap.get(liveIds[i]);
      if (typeof c === 'string' && c.trim().length > 0) {
        count++;
      }
    }
    setActiveCommentCount(count);
    syncCommentedMarksInDom(containerRef.current, commentsMap);
  }, []);

  const scheduleCommentDomSync = useCallback(
    (ed: Editor | null) => {
      if (commentDomSyncRafRef.current !== null) return;
      commentDomSyncRafRef.current = requestAnimationFrame(() => {
        commentDomSyncRafRef.current = null;
        syncCommentVisualsAndCount(ed);
      });
    },
    [syncCommentVisualsAndCount]
  );

  // High-performance highlight counting directly from in-memory ProseMirror doc tree
  const updateHighlightCount = useCallback(
    (ed: Editor | null) => {
      if (!ed || ed.isDestroyed) return;

      const runCount = () => {
        if (!ed || ed.isDestroyed) return;
        const uniqueIds = new Set<string>();
        let unassignedCount = 0;
        let maxSeq = 0;

        ed.state.doc.descendants((node) => {
          if (!node.isText) return;
          for (let i = 0; i < node.marks.length; i++) {
            const mark = node.marks[i];
            if (mark.type.name === 'customHighlight') {
              const rawId = typeof mark.attrs.id === 'string' ? mark.attrs.id.trim() : '';
              if (rawId) {
                uniqueIds.add(rawId);
                const seq = parseSequentialHighlightId(rawId);
                if (seq !== null && seq > maxSeq) {
                  maxSeq = seq;
                }
              } else {
                unassignedCount++;
              }
            }
          }
        });

        const currentDocId = useAppStore.getState().document?.docId;
        primeHighlightIdScope(currentDocId, maxSeq);
        setHighlightCount(uniqueIds.size + unassignedCount);

        const commentsMap = getDocHighlightComments(currentDocId);
        let liveCommentCount = 0;
        uniqueIds.forEach((id) => {
          const comment = commentsMap.get(id);
          if (typeof comment === 'string' && comment.trim().length > 0) {
            liveCommentCount++;
          }
        });
        setActiveCommentCount(liveCommentCount);
        syncCommentedMarksInDom(containerRef.current, commentsMap);
      };

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as any).requestIdleCallback(runCount, { timeout: 2000 });
      } else {
        setTimeout(runCount, 150);
      }
    },
    [setHighlightCount]
  );

  const scheduleDebouncedHighlightCount = useCallback(
    (ed: Editor | null) => {
      if (highlightCountDebounceTimerRef.current) {
        clearTimeout(highlightCountDebounceTimerRef.current);
      }
      const docSize = (lastEmittedMarkdownRef.current || '').length;
      const delay = docSize > 80000 ? 2500 : 1000;
      highlightCountDebounceTimerRef.current = setTimeout(() => {
        updateHighlightCount(ed);
      }, delay);
    },
    [updateHighlightCount]
  );

  const resolveSelectionRange = useCallback(
    (currentEditor: Editor, preferDomSelection: boolean): { from: number; to: number } => {
      if (preferDomSelection && typeof window !== 'undefined') {
        const domSel = window.getSelection();
        if (
          domSel &&
          domSel.rangeCount > 0 &&
          !domSel.isCollapsed &&
          domSel.anchorNode &&
          domSel.focusNode &&
          currentEditor.view.dom.contains(domSel.anchorNode) &&
          currentEditor.view.dom.contains(domSel.focusNode)
        ) {
          try {
            const range = domSel.getRangeAt(0);
            const posA = currentEditor.view.posAtDOM(range.startContainer, range.startOffset);
            const posB = currentEditor.view.posAtDOM(range.endContainer, range.endOffset);
            const docSize = currentEditor.state.doc.content.size;
            const domFrom = Math.max(0, Math.min(posA, posB, docSize));
            const domTo = Math.max(0, Math.min(Math.max(posA, posB), docSize));
            if (domFrom !== domTo) {
              return { from: domFrom, to: domTo };
            }
          } catch (err) {
            console.debug('Failed to resolve DOM selection positions for highlight:', err);
          }
        }
      }

      const { from, to } = currentEditor.state.selection;
      return { from, to };
    },
    []
  );

  const applyHighlightFromCurrentSelection = useCallback(
    (currentEditor: Editor, preferDomSelection: boolean): boolean => {
      if (!currentEditor || currentEditor.isDestroyed) return false;

      const { from, to } = resolveSelectionRange(currentEditor, preferDomSelection);
      if (from === to) return false;

      const activeDocId = useAppStore.getState().document?.docId;
      const result = createHighlightTransaction(currentEditor.state, {
        from,
        to,
        color: 'yellow',
        scopeKey: activeDocId,
        collapseToEnd: true,
      });

      if (!result) {
        const safePos = Math.min(Math.max(from, to), currentEditor.state.doc.content.size);
        currentEditor.commands.setTextSelection(safePos);
        window.getSelection()?.removeAllRanges();
        return false;
      }

      if (result.removedIds.length > 0) {
        migrateCommentsOnHighlightOverlap(activeDocId, result.removedIds, result.id);
      }

      justAppliedHighlightAtRef.current = Date.now();
      popoverControllerRef.current?.closePopover();
      currentEditor.view.dispatch(result.tr);
      window.getSelection()?.removeAllRanges();
      scheduleDebouncedHighlightCount(currentEditor);
      if (result.removedIds.length > 0) {
        scheduleCommentDomSync(currentEditor);
      }
      return true;
    },
    [resolveSelectionRange, scheduleDebouncedHighlightCount, scheduleCommentDomSync]
  );

  // Initialize Tiptap Editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Image.configure({ inline: true, allowBase64: true }),
      Table.extend({
        renderHTML({ node, HTMLAttributes }) {
          const { colgroup, tableWidth, tableMinWidth } = createColGroup(node, this.options.cellMinWidth);
          return [
            'div',
            { class: 'tableWrapper' },
            [
              'table',
              mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
                style: tableWidth
                  ? `width: ${tableWidth}`
                  : `min-width: ${tableMinWidth}`,
              }),
              colgroup,
              ['tbody', 0],
            ],
          ];
        },
      }).configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({ types: ['heading', 'paragraph', 'blockquote', 'tableCell', 'tableHeader'] }),
      Underline.extend({
        addStorage() {
          return {
            markdown: {
              serialize: { open: '<u>', close: '</u>' },
            },
          };
        },
      }),
      Subscript.extend({
        addStorage() {
          return {
            markdown: {
              serialize: { open: '<sub>', close: '</sub>' },
            },
          };
        },
      }),
      Superscript.extend({
        addStorage() {
          return {
            markdown: {
              serialize: { open: '<sup>', close: '</sup>' },
            },
          };
        },
      }),
      TextStyle,
      Color,
      CustomHighlight,
      SearchHighlightExtension,
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true, breaks: true }),
    ],
    shouldRerenderOnTransaction: false,
    content: parseMarkdownWithHighlightComments(useAppStore.getState().document?.content || '').bodyMarkdown,
    editable: isEditable,
    onUpdate: ({ transaction }) => {
      if (!transaction.docChanged) return;
      scheduleDebouncedContentRef.current();
      scheduleCommentDomSync(editorRef.current);
      if (transactionTouchesHeading(transaction)) {
        scheduleDebouncedTocRefreshRef.current(editorRef.current);
      }
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      if (!currentEditor) return;

      // Se houver edições pendentes no buffer, qualquer movimento de cursor ou seleção
      // indica que o usuário continua ativo no documento — adia a serialização.
      postponePendingContentFlushRef.current();

      const { from, to } = currentEditor.state.selection;

      // User selected a text range in Highlight Mode -> APPLY HIGHLIGHT
      if (isHighlightMode && !currentEditor.isDestroyed && from !== to) {
        // Prevent instant highlight while dragging on PC or adjusting selection on touch devices
        if (isMouseDownRef.current || isTouchSelectingRef.current) return;

        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }

        highlightTimeoutRef.current = setTimeout(() => {
          applyHighlightFromCurrentSelection(currentEditor, false);
        }, 200);
      }
    },
  });

  editorRef.current = editor;

  const clearPendingContentTimers = useCallback(() => {
    if (markdownDebounceTimerRef.current) {
      clearTimeout(markdownDebounceTimerRef.current);
      markdownDebounceTimerRef.current = null;
    }
    if (
      markdownIdleCallbackRef.current !== null &&
      typeof window !== 'undefined' &&
      'cancelIdleCallback' in window
    ) {
      (window as any).cancelIdleCallback(markdownIdleCallbackRef.current);
      markdownIdleCallbackRef.current = null;
    }
  }, []);

  // Flushes pending in-memory editor changes immediately to store and local storage
  const flushContent = useCallback(() => {
    clearPendingContentTimers();

    // Skip heavy serialization if there are no pending unsaved changes
    if (!hasPendingBridgeChanges()) {
      return;
    }

    // Blindagem contra vazamento entre abas: nunca grava se a store já mudou para outro docId
    const activeStoreDocId = useAppStore.getState().document?.docId;
    if (
      !activeStoreDocId ||
      (currentLoadedDocIdRef.current && currentLoadedDocIdRef.current !== activeStoreDocId)
    ) {
      markBridgeClean();
      return;
    }

    if (isSourceModeRef.current) {
      const rawMarkdown = rawContentRef.current;
      lastEmittedMarkdownRef.current = rawMarkdown;
      markBridgeClean();
      updateDocumentContent(rawMarkdown);
      const parsedRaw = parseMarkdownWithHighlightComments(rawMarkdown);
      setHighlightCount(countHighlightsInRawMarkdown(parsedRaw.bodyMarkdown));
      syncCommentVisualsAndCount(null);
      return;
    }

    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) return;

    const bodyMarkdown = serializeDocIncrementally(currentEditor);
    const liveIds = collectOrderedHighlightIdsFromProseMirrorDoc(currentEditor.state.doc);
    const commentsMap = getDocHighlightComments(activeStoreDocId);
    const rawMarkdown = composeMarkdownWithHighlightComments(bodyMarkdown, commentsMap, liveIds);
    lastEmittedMarkdownRef.current = rawMarkdown;
    markBridgeClean();
    updateDocumentContent(rawMarkdown);
    updateHighlightCount(currentEditor);
  }, [clearPendingContentTimers, updateDocumentContent, updateHighlightCount, setHighlightCount, syncCommentVisualsAndCount]);

  const armIdleFlushTimer = useCallback(() => {
    clearPendingContentTimers();

    // Com serialização incremental O(1) por bloco, o flush leva < 2ms;
    // usamos debounce curto sem travar a interface.
    const docSize = (lastEmittedMarkdownRef.current || '').length;
    const delay = docSize > 200000 ? 1500 : 1000;

    markdownDebounceTimerRef.current = setTimeout(() => {
      markdownDebounceTimerRef.current = null;

      // Enquanto o popover de cor/exclusão (sem caixa de comentário aberta) estiver aberto, adia a serialização
      const isCompactPopoverOpen = Boolean(
        popoverControllerRef.current?.isPopoverOpenRef.current &&
          !popoverControllerRef.current?.isCommentBoxOpenRef.current
      );
      if (isCompactPopoverOpen && hasPendingBridgeChanges()) {
        armIdleFlushTimer();
        return;
      }

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        markdownIdleCallbackRef.current = (window as any).requestIdleCallback(
          () => {
            markdownIdleCallbackRef.current = null;
            const stillCompactOpen = Boolean(
              popoverControllerRef.current?.isPopoverOpenRef.current &&
                !popoverControllerRef.current?.isCommentBoxOpenRef.current
            );
            if (stillCompactOpen && hasPendingBridgeChanges()) {
              armIdleFlushTimer();
              return;
            }
            flushContent();
          },
          { timeout: 2000 }
        );
      } else {
        flushContent();
      }
    }, delay);
  }, [clearPendingContentTimers, flushContent]);

  const scheduleDebouncedContent = useCallback(() => {
    // Só dispara mutação na store Zustand na transição inicial para dirty,
    // evitando clonar o documento e o array de abas a cada tecla pressionada.
    if (!useAppStore.getState().document?.isDirty) {
      markDocumentDirty();
    }
    markBridgeDirty();
    armIdleFlushTimer();
  }, [armIdleFlushTimer, markDocumentDirty]);

  const postponePendingContentFlush = useCallback(() => {
    if (!hasPendingBridgeChanges()) return;
    armIdleFlushTimer();
  }, [armIdleFlushTimer]);

  scheduleDebouncedContentRef.current = scheduleDebouncedContent;
  postponePendingContentFlushRef.current = postponePendingContentFlush;

  const computeActiveHeadingInDom = useCallback(
    (headingsCount: number, precomputedHeadings?: ReadonlyArray<TocHeadingItem>): number => {
      if (headingsCount === 0) return -1;

      const lockedIdx = navigationLockRef.current;
      if (lockedIdx !== null && lockedIdx >= 0 && lockedIdx < headingsCount) {
        return lockedIdx;
      }

      const thresholdY = getActiveHeadingThresholdY();

      // Quando em Modo Código-Fonte (textarea visível), mede a posição Y real de cada título no textarea
      if (isSourceModeRef.current && rawTextareaRef.current) {
        const textarea = rawTextareaRef.current;
        const rect = textarea.getBoundingClientRect();
        const md = rawContentRef.current;
        const mdHeadings = precomputedHeadings ?? getTocSnapshot().headings;
        if (mdHeadings.length === 0) return -1;

        const charOffsets = mdHeadings.map((h) => h.charOffset ?? 0);
        const localTops = measureMultipleTextareaOffsetsTopPx(textarea, md, charOffsets);
        const estimatedTops = localTops.map((localY) => rect.top + localY);
        return findActiveHeadingIndexByTops(estimatedTops, thresholdY);
      }

      const queryValidHeadingEls = (): HTMLElement[] => {
        const container = containerRef.current;
        if (!container) return [];
        const domHeadings = container.querySelectorAll(
          '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6'
        );
        const validEls: HTMLElement[] = [];
        for (let i = 0; i < domHeadings.length; i++) {
          const el = domHeadings[i] as HTMLElement;
          if ((el.textContent || '').trim().length > 0) {
            validEls.push(el);
          }
        }
        cachedDomHeadingsRef.current = validEls;
        return validEls;
      };

      let headingEls = cachedDomHeadingsRef.current;
      if (
        headingEls.length === 0 ||
        headingEls.length !== headingsCount ||
        !headingEls[0].isConnected ||
        !headingEls[headingEls.length - 1].isConnected
      ) {
        headingEls = queryValidHeadingEls();
      }

      if (headingEls.length === 0) return 0;

      // Busca binária O(log H): lê getBoundingClientRect().top apenas dos nós pivô
      let low = 0;
      let high = headingEls.length - 1;
      let activeIdx = -1;
      let refreshed = false;

      while (low <= high) {
        const mid = (low + high) >>> 1;
        if (!headingEls[mid].isConnected && !refreshed) {
          refreshed = true;
          headingEls = queryValidHeadingEls();
          if (headingEls.length === 0) return 0;
          low = 0;
          high = headingEls.length - 1;
          activeIdx = -1;
          continue;
        }
        const top = headingEls[mid].getBoundingClientRect().top;
        if (top <= thresholdY) {
          activeIdx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      return activeIdx === -1 ? 0 : activeIdx;
    },
    []
  );

  const refreshTocStructure = useCallback(
    (ed: Editor | null) => {
      if (isSourceModeRef.current) {
        cachedDomHeadingsRef.current = [];
        const headings = extractHeadingsFromMarkdown(rawContentRef.current);
        const activeIdx = computeActiveHeadingInDom(headings.length, headings);
        updateTocState(headings, activeIdx);
        return;
      }

      const headings =
        ed && !ed.isDestroyed ? extractHeadingsFromProseMirrorDoc(ed.state.doc) : [];

      const container = containerRef.current;
      if (container) {
        const domHeadings = container.querySelectorAll(
          '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6'
        );
        const validEls: HTMLElement[] = [];
        for (let i = 0; i < domHeadings.length; i++) {
          const el = domHeadings[i] as HTMLElement;
          // Ignora headings vazios para manter paridade 1:1 com extractHeadingsFromProseMirrorDoc
          if ((el.textContent || '').trim().length > 0) {
            validEls.push(el);
          }
        }
        cachedDomHeadingsRef.current = validEls;
      } else {
        cachedDomHeadingsRef.current = [];
      }

      const activeIdx = computeActiveHeadingInDom(headings.length, headings);
      updateTocState(headings, activeIdx);
    },
    [computeActiveHeadingInDom]
  );

  const scheduleDebouncedTocRefresh = useCallback(
    (ed: Editor | null) => {
      if (tocExtractTimerRef.current) {
        clearTimeout(tocExtractTimerRef.current);
      }
      tocExtractTimerRef.current = setTimeout(() => {
        tocExtractTimerRef.current = null;
        refreshTocStructure(ed);
      }, 250);
    },
    [refreshTocStructure]
  );

  scheduleDebouncedTocRefreshRef.current = scheduleDebouncedTocRefresh;

  const handleApplyRawReplacement = useCallback(
    (nextRaw: string, cursorOffset?: number) => {
      rawContentRef.current = nextRaw;
      isRawDirtyRef.current = true;
      setRawContent(nextRaw);
      scheduleDebouncedContent();
      scheduleDebouncedTocRefresh(editorRef.current);

      if (typeof cursorOffset === 'number') {
        requestAnimationFrame(() => {
          const el = rawTextareaRef.current;
          if (el && document.activeElement === el) {
            const safePos = Math.max(0, Math.min(cursorOffset, nextRaw.length));
            el.setSelectionRange(safePos, safePos);
          }
        });
      }
    },
    [scheduleDebouncedContent, scheduleDebouncedTocRefresh]
  );

  const handleUpdateSourceHighlightCount = useCallback(
    (rawMarkdown: string) => {
      setHighlightCount(countHighlightsInRawMarkdown(rawMarkdown));
    },
    [setHighlightCount]
  );

  const documentSearch = useDocumentSearch({
    editor,
    docId,
    isEditable,
    isSourceMode,
    rawContent,
    rawTextareaRef,
    onApplyRawReplacement: handleApplyRawReplacement,
    onScheduleDebouncedContent: scheduleDebouncedContent,
    onUpdateVisualHighlightCount: updateHighlightCount,
    onUpdateSourceHighlightCount: handleUpdateSourceHighlightCount,
  });

  // Register bridge flush handler & window lifecycle guards (background/close)
  useEffect(() => {
    const unregister = registerEditorFlushHandler(() => {
      flushContent();
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushContent();
      }
    };

    const handlePageHide = () => {
      flushContent();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      unregister();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      clearPendingContentTimers();
      if (highlightCountDebounceTimerRef.current) {
        clearTimeout(highlightCountDebounceTimerRef.current);
      }
      if (tocExtractTimerRef.current) {
        clearTimeout(tocExtractTimerRef.current);
        tocExtractTimerRef.current = null;
      }
      if (tocScrollRafRef.current !== null) {
        cancelAnimationFrame(tocScrollRafRef.current);
        tocScrollRafRef.current = null;
      }
      if (commentDomSyncRafRef.current !== null) {
        cancelAnimationFrame(commentDomSyncRafRef.current);
        commentDomSyncRafRef.current = null;
      }
      if (warmUpCancelRef.current) {
        warmUpCancelRef.current();
        warmUpCancelRef.current = null;
      }
      setActiveCommentCount(0);
      resetTocState();
    };
  }, [flushContent, clearPendingContentTimers]);

  // Update content when document switches externally (docId) or initial mount
  useEffect(() => {
    if (!editor) return;

    if (currentLoadedDocIdRef.current === docId) {
      return;
    }

    clearPendingContentTimers();
    markBridgeClean();

    currentLoadedDocIdRef.current = docId;
    isRawDirtyRef.current = false;
    const currentDoc = useAppStore.getState().document;
    const nextContent = currentDoc?.content || '';
    const parsed = parseMarkdownWithHighlightComments(nextContent);
    hydrateDocHighlightComments(docId, parsed.comments, true);

    lastEmittedMarkdownRef.current = nextContent;
    rawContentRef.current = nextContent;
    setRawContent(nextContent);

    if (!parsed.bodyMarkdown) {
      warmUpCancelRef.current?.();
      warmUpCancelRef.current = null;
      editor.commands.clearContent(false);
      updateHighlightCount(editor);
      syncCommentVisualsAndCount(editor);
      refreshTocStructure(editor);
      return;
    }

    warmUpCancelRef.current?.();
    editor.commands.setContent(parsed.bodyMarkdown, false);
    warmUpCancelRef.current = warmUpIncrementalMarkdownCache(editor);
    updateHighlightCount(editor);
    syncCommentVisualsAndCount(editor);
    requestAnimationFrame(() => {
      refreshTocStructure(editor);
    });
  }, [docId, editor, updateHighlightCount, syncCommentVisualsAndCount, refreshTocStructure, clearPendingContentTimers]);

  // Escuta atualizações externas de conteúdo na mesma aba (ex.: resolução de conflito, hidratação do IndexedDB ou sync silencioso do OneDrive)
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      const nextDoc = state.document;
      const prevDoc = prevState.document;
      if (!nextDoc || !prevDoc) return;
      if (nextDoc.docId !== prevDoc.docId) return;
      if (nextDoc.content === prevDoc.content) return;
      if (nextDoc.content === lastEmittedMarkdownRef.current) return;

      clearPendingContentTimers();
      markBridgeClean();
      popoverControllerRef.current?.closePopover();
      const parsed = parseMarkdownWithHighlightComments(nextDoc.content);
      hydrateDocHighlightComments(nextDoc.docId, parsed.comments, true);

      lastEmittedMarkdownRef.current = nextDoc.content;
      rawContentRef.current = nextDoc.content;
      isRawDirtyRef.current = false;
      setRawContent(nextDoc.content);

      const currentEditor = editorRef.current;
      if (currentEditor && !currentEditor.isDestroyed) {
        warmUpCancelRef.current?.();
        currentEditor.commands.setContent(parsed.bodyMarkdown, false);
        warmUpCancelRef.current = warmUpIncrementalMarkdownCache(currentEditor);
        updateHighlightCount(currentEditor);
        setCommentsVersion((v) => v + 1);
        requestAnimationFrame(() => {
          refreshTocStructure(currentEditor);
        });
      } else if (isSourceModeRef.current) {
        syncCommentVisualsAndCount(null);
        refreshTocStructure(null);
      }
    });
    return unsubscribe;
  }, [updateHighlightCount, syncCommentVisualsAndCount, refreshTocStructure, clearPendingContentTimers]);

  const lastScrollSyncAnchorRef = useRef<ScrollSyncAnchor | null>(null);
  const isTransitioningSourceModeRef = useRef<boolean>(false);

  const captureCurrentScrollAnchorSnapshot = useCallback((): ScrollSyncAnchor => {
    if (isSourceModeRef.current && rawTextareaRef.current) {
      return captureSourceScrollAnchor(rawTextareaRef.current, rawContentRef.current);
    }
    const md =
      lastEmittedMarkdownRef.current ??
      useAppStore.getState().document?.content ??
      '';
    const blockRanges = getTopLevelBlockCharRanges(editorRef.current);
    return captureVisualScrollAnchor(containerRef.current, md, blockRanges);
  }, []);

  const handleToggleSourceModeWithScrollSync = useCallback(() => {
    if (hasPendingBridgeChanges()) {
      flushContent();
    }
    if (!isSourceModeRef.current) {
      const latestMd = useAppStore.getState().document?.content ?? '';
      if (latestMd !== rawContentRef.current) {
        rawContentRef.current = latestMd;
        setRawContent(latestMd);
      }
    }
    lastScrollSyncAnchorRef.current = captureCurrentScrollAnchorSnapshot();
    toggleSourceMode();
  }, [captureCurrentScrollAnchorSnapshot, flushContent, toggleSourceMode]);

  // Gerencia a transição sem perda (conteúdo + posição vertical) entre Editor Visual <-> Modo Código-Fonte
  useEffect(() => {
    const wasSourceMode = prevIsSourceModeRef.current;
    prevIsSourceModeRef.current = isSourceMode;

    if (wasSourceMode === isSourceMode) return;

    const anchorToRestore: ScrollSyncAnchor =
      lastScrollSyncAnchorRef.current ?? {
        isAtVeryTop: window.scrollY <= 4,
        isAtVeryBottom: false,
        headingIndex: -1,
        segmentProgress: 0,
        globalProgress: 0,
        markdownCharOffset: 0,
      };

    isTransitioningSourceModeRef.current = true;
    document.documentElement.classList.add('scroll-restoring');

    if (isSourceMode) {
      // Transição: Visual -> Código-Fonte
      if (hasPendingBridgeChanges()) {
        flushContent();
      }
      isSourceModeRef.current = true;
      isRawDirtyRef.current = false;
      const latestMarkdown = useAppStore.getState().document?.content ?? '';
      rawContentRef.current = latestMarkdown;
      setRawContent(latestMarkdown);
      popoverControllerRef.current?.closePopover();

      const raf1 = requestAnimationFrame(() => {
        const el = rawTextareaRef.current;
        if (el) {
          el.style.height = 'auto';
          el.style.height = `${Math.max(el.scrollHeight, 480)}px`;

          const targetScrollY = resolveSourceTargetScrollY(
            el,
            latestMarkdown,
            anchorToRestore
          );
          window.scrollTo({ top: targetScrollY, left: 0, behavior: 'instant' });

          // Posiciona o cursor no charOffset correspondente sem causar salto de scroll
          if (typeof anchorToRestore.markdownCharOffset === 'number') {
            const safeCaret = Math.min(
              latestMarkdown.length,
              Math.max(0, anchorToRestore.markdownCharOffset)
            );
            el.setSelectionRange(safeCaret, safeCaret);
          }
          el.focus({ preventScroll: true });

          const state = useAppStore.getState();
          if (state.activeTabId && state.document?.docId) {
            saveTabScrollPosition(state.activeTabId, window.scrollY, state.document.docId);
          }
        }

        document.documentElement.classList.remove('scroll-restoring');
        isTransitioningSourceModeRef.current = false;
        lastScrollSyncAnchorRef.current = captureCurrentScrollAnchorSnapshot();
        refreshTocStructure(null);
      });

      return () => {
        cancelAnimationFrame(raf1);
        document.documentElement.classList.remove('scroll-restoring');
        isTransitioningSourceModeRef.current = false;
      };
    } else {
      // Transição: Código-Fonte -> Visual (ou saída para Modo Leitura / Grifar)
      if (hasPendingBridgeChanges()) {
        flushContent();
      }
      isSourceModeRef.current = false;

      if (editor && !editor.isDestroyed && isRawDirtyRef.current) {
        const latestRaw = rawContentRef.current;
        const parsed = parseMarkdownWithHighlightComments(latestRaw);
        hydrateDocHighlightComments(useAppStore.getState().document?.docId, parsed.comments, true);
        lastEmittedMarkdownRef.current = latestRaw;
        warmUpCancelRef.current?.();
        editor.commands.setContent(parsed.bodyMarkdown, false);
        warmUpCancelRef.current = warmUpIncrementalMarkdownCache(editor);
        updateHighlightCount(editor);
        setCommentsVersion((v) => v + 1);
        isRawDirtyRef.current = false;
      }

      const raf1 = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container) {
          const blockRanges = getTopLevelBlockCharRanges(editor);
          const targetScrollY = resolveVisualTargetScrollY(container, anchorToRestore, blockRanges);
          window.scrollTo({ top: targetScrollY, left: 0, behavior: 'instant' });

          const state = useAppStore.getState();
          if (state.activeTabId && state.document?.docId) {
            saveTabScrollPosition(state.activeTabId, window.scrollY, state.document.docId);
          }
        }

        document.documentElement.classList.remove('scroll-restoring');
        isTransitioningSourceModeRef.current = false;
        lastScrollSyncAnchorRef.current = captureCurrentScrollAnchorSnapshot();
        refreshTocStructure(editor);
      });

      return () => {
        cancelAnimationFrame(raf1);
        document.documentElement.classList.remove('scroll-restoring');
        isTransitioningSourceModeRef.current = false;
      };
    }
  }, [
    isSourceMode,
    editor,
    flushContent,
    updateHighlightCount,
    refreshTocStructure,
    captureCurrentScrollAnchorSnapshot,
  ]);

  // Ajusta a altura do textarea automaticamente enquanto o usuário edita no Modo Código-Fonte,
  // sem interferir quando a transição inicial de modo estiver posicionando o scroll.
  useEffect(() => {
    if (!isSourceMode) return;
    if (isTransitioningSourceModeRef.current) return;
    const el = rawTextareaRef.current;
    if (!el) return;
    const isRestoringTabScroll = document.documentElement.classList.contains('scroll-restoring');
    const savedScrollY = window.scrollY;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 480)}px`;
    if (!isRestoringTabScroll) {
      window.scrollTo({ top: savedScrollY, left: 0, behavior: 'instant' });
    }
  }, [rawContent, isSourceMode, preferences.fontSize, preferences.textWidth]);

  // Garante que a impressão/PDF (window.print) a partir do Modo Código-Fonte reflita o texto mais recente no ProseMirror
  useEffect(() => {
    const handleBeforePrint = () => {
      if (isSourceModeRef.current && editor && !editor.isDestroyed) {
        if (hasPendingBridgeChanges()) {
          flushContent();
        }
        if (isRawDirtyRef.current) {
          const parsed = parseMarkdownWithHighlightComments(rawContentRef.current);
          hydrateDocHighlightComments(useAppStore.getState().document?.docId, parsed.comments, true);
          editor.commands.setContent(parsed.bodyMarkdown, false);
          isRawDirtyRef.current = false;
        }
      }
    };
    window.addEventListener('beforeprint', handleBeforePrint);
    return () => window.removeEventListener('beforeprint', handleBeforePrint);
  }, [editor, flushContent]);

  // Atalhos de teclado quando em Modo Edição:
  // - Ctrl+; (ou Cmd+;): alternar Modo Código-Fonte
  // - Shift+F3: alternar ciclicamente Maiúsculas / Minúsculas / Capitalização (estilo Word)
  useEffect(() => {
    if (!isEditable) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === ';') {
        e.preventDefault();
        handleToggleSourceModeWithScrollSync();
        return;
      }

      if (isSourceModeRef.current) return;
      if (e.defaultPrevented || useAppStore.getState().isSearchOpen) return;
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'F3') {
        const currentEditor = editorRef.current;
        if (!currentEditor || currentEditor.isDestroyed) return;
        const { from, to, empty } = currentEditor.state.selection;
        if (!empty && from !== to) {
          e.preventDefault();
          const selectedText = currentEditor.state.doc.textBetween(from, to, ' ');
          const nextMode = detectNextCaseCycleMode(selectedText);
          const tr = createCaseTransformTransaction(currentEditor.state, nextMode);
          if (tr) {
            currentEditor.view.dispatch(tr);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditable, handleToggleSourceModeWithScrollSync]);

  // Preserva a posição de leitura (scroll) independente por aba.
  // Deve ficar APÓS o efeito de setContent acima (ordem de efeitos do React).
  useTabScrollRestoration(editor, containerRef);

  // Registra o comando de rolar até o grifo mais recente (acionado pelo Header ou tecla J)
  useEffect(() => {
    const unregister = registerScrollToLatestHighlightHandler(() => {
      popoverControllerRef.current?.closePopover();
      if (isSourceModeRef.current && rawTextareaRef.current) {
        const md = rawContentRef.current;
        const summary = scanHighlightsInMarkdown(md);
        const targetId = summary.latestSequentialId || summary.latestLegacyId;
        if (!targetId) return;

        scrollToMarkIdInSourceTextarea(rawTextareaRef.current, md, targetId);
        return;
      }

      scrollToLatestHighlightInContainer(containerRef.current, editorRef.current, {
        behavior: 'smooth',
        pulse: true,
      });
    });

    return unregister;
  }, []);

  // Registra o comando de rolar até o comentário mais recente (acionado pelo Header ou tecla K)
  useEffect(() => {
    const unregister = registerScrollToLatestCommentHandler(() => {
      popoverControllerRef.current?.closePopover();
      if (isSourceModeRef.current && rawTextareaRef.current) {
        const md = rawContentRef.current;
        const parsed = parseMarkdownWithHighlightComments(md);
        const targetId = findLatestCommentedHighlightId(md, parsed.comments);
        if (!targetId) return;

        scrollToMarkIdInSourceTextarea(rawTextareaRef.current, md, targetId);
        return;
      }

      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed) return;

      const currentDocId = useAppStore.getState().document?.docId;
      const commentsMap = getDocHighlightComments(currentDocId);
      const targetId = findLatestCommentedHighlightId(currentEditor.state.doc, commentsMap);
      if (!targetId) return;

      scrollToHighlightByIdInContainer(containerRef.current, targetId, {
        behavior: 'smooth',
        pulse: true,
      });
    });

    return unregister;
  }, []);

  // Sincroniza o título ativo no sumário e breadcrumb em tempo real durante a rolagem da página (Scroll-Spy)
  useEffect(() => {
    const handleScrollOrResize = () => {
      if (tocScrollRafRef.current !== null) return;
      tocScrollRafRef.current = requestAnimationFrame(() => {
        tocScrollRafRef.current = null;
        const currentHeadings = getTocSnapshot().headings;
        if (currentHeadings.length === 0) return;
        const activeIdx = computeActiveHeadingInDom(currentHeadings.length, currentHeadings);
        setTocActiveIndex(activeIdx);
      });
    };

    window.addEventListener('scroll', handleScrollOrResize, { passive: true });
    window.addEventListener('resize', handleScrollOrResize, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
      if (tocScrollRafRef.current !== null) {
        cancelAnimationFrame(tocScrollRafRef.current);
        tocScrollRafRef.current = null;
      }
    };
  }, [computeActiveHeadingInDom]);

  // Libera a trava da navegação pelo sumário assim que o usuário volta a rolar ou interagir manualmente
  useEffect(() => {
    const releaseNavigationLock = () => {
      if (navigationLockRef.current !== null) {
        navigationLockRef.current = null;
      }
    };

    window.addEventListener('wheel', releaseNavigationLock, { passive: true });
    window.addEventListener('touchstart', releaseNavigationLock, { passive: true });
    window.addEventListener('keydown', releaseNavigationLock, { passive: true });
    window.addEventListener('mousedown', releaseNavigationLock, { passive: true });

    return () => {
      window.removeEventListener('wheel', releaseNavigationLock);
      window.removeEventListener('touchstart', releaseNavigationLock);
      window.removeEventListener('keydown', releaseNavigationLock);
      window.removeEventListener('mousedown', releaseNavigationLock);
    };
  }, []);

  // Registra o comando de navegação rápida para um título ao clicar no Sumário (TOC Popover)
  useEffect(() => {
    const unregister = registerNavigateToHeadingHandler((headingIndex: number) => {
      popoverControllerRef.current?.closePopover();
      const stickyOffset = getStickyTopOffsetPx();

      // Caso 1: Modo Código-Fonte (textarea)
      if (isSourceModeRef.current && rawTextareaRef.current) {
        const md = rawContentRef.current;
        const mdHeadings = extractHeadingsFromMarkdown(md);
        const target = mdHeadings[headingIndex];
        if (!target) return;

        navigationLockRef.current = headingIndex;

        const charPos = target.charOffset ?? 0;
        const textarea = rawTextareaRef.current;
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(charPos, charPos);

        const localY = measureTextareaOffsetTopPx(textarea, md, charPos);
        const rect = textarea.getBoundingClientRect();
        const targetY = Math.max(
          0,
          Math.round(rect.top + window.scrollY + localY - stickyOffset - 12)
        );
        window.scrollTo({ top: targetY, left: 0, behavior: 'smooth' });
        updateTocState(mdHeadings, headingIndex);
        return;
      }

      // Caso 2: Editor Visual / Modo Leitura (.ProseMirror)
      const container = containerRef.current;
      if (!container) return;

      const domHeadings = Array.from(
        container.querySelectorAll(
          '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6'
        )
      ).filter((el) => (el.textContent || '').trim().length > 0) as HTMLElement[];

      const targetEl = domHeadings[headingIndex];
      if (!targetEl) return;

      navigationLockRef.current = headingIndex;

      const rect = targetEl.getBoundingClientRect();
      const rawTargetY = rect.top + window.scrollY - stickyOffset - 8;
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const targetScrollY = Math.max(0, Math.min(Math.round(rawTargetY), maxScrollY));

      window.scrollTo({
        top: targetScrollY,
        left: 0,
        behavior: 'smooth',
      });

      setTocActiveIndex(headingIndex);
      pulseHeadingElement(targetEl);
    });

    return unregister;
  }, []);

  // Update editor editable mode
  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditable, false);
    }
  }, [isEditable, editor]);

  // Handle native selection in Highlight mode & iPad context menu suppression
  useEffect(() => {
    const handleMouseUpOrTouchEnd = (e: MouseEvent | TouchEvent) => {
      if (!editor || !isHighlightMode || isEditable) return;

      const target = e.target as HTMLElement;

      // Ignora toques/cliques no próprio popover; só ignora <mark> quando não há seleção de texto (clique simples)
      if (target?.closest('[data-highlight-popover]')) {
        return;
      }

      const { from, to } = resolveSelectionRange(editor, true);
      if (from === to && target?.closest('mark')) {
        return;
      }

      if (from !== to) {
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }

        applyHighlightFromCurrentSelection(editor, true);
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (isHighlightMode) {
        e.preventDefault();
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('mouseup', handleMouseUpOrTouchEnd);
      container.addEventListener('touchend', handleMouseUpOrTouchEnd);
      container.addEventListener('contextmenu', handleContextMenu);
    }

    return () => {
      if (container) {
        container.removeEventListener('mouseup', handleMouseUpOrTouchEnd);
        container.removeEventListener('touchend', handleMouseUpOrTouchEnd);
        container.removeEventListener('contextmenu', handleContextMenu);
      }
    };
  }, [editor, isHighlightMode, isEditable, resolveSelectionRange, applyHighlightFromCurrentSelection]);

  const handleCommentsVersionBump = useCallback(() => {
    setCommentsVersion((v) => v + 1);
  }, []);

  const handleScheduleDebouncedContentFromPopover = useCallback(() => {
    scheduleDebouncedContentRef.current();
  }, []);

  // Controlador independente do seletor flutuante (substitui BubbleMenu/Tippy — @see docs/HIGHLIGHT_POPOVER_GOTCHAS.md)
  const popoverController = useHighlightPopoverController({
    editor,
    containerRef,
    docId,
    isEditable,
    isSourceMode,
    justAppliedHighlightAtRef,
    highlightTimeoutRef,
    onCommentsVersionBump: handleCommentsVersionBump,
    onScheduleDebouncedContent: handleScheduleDebouncedContentFromPopover,
    onScheduleCommentDomSync: scheduleCommentDomSync,
    onScheduleDebouncedHighlightCount: scheduleDebouncedHighlightCount,
  });
  popoverControllerRef.current = popoverController;

  // Initial highlight count on mount
  useEffect(() => {
    if (editor) {
      updateHighlightCount(editor);
    }
  }, [editor, updateHighlightCount]);

  // Sincroniza decoração visual (borda pontilhada) e contagem de comentários ativos
  useEffect(() => {
    syncCommentVisualsAndCount(editor);
  }, [editor, docId, commentsVersion, isSourceMode, syncCommentVisualsAndCount]);

  const handleCopyAllComments = useCallback(async (): Promise<number> => {
    const currentDocId = useAppStore.getState().document?.docId;

    if (isSourceModeRef.current) {
      const parsed = parseMarkdownWithHighlightComments(rawContentRef.current);
      const items = extractAllCommentedHighlightsInOrder(
        rawContentRef.current,
        parsed.comments
      );
      if (items.length === 0) return 0;
      const ok = await copyTextToClipboard(formatAllCommentsForCopy(items));
      return ok ? items.length : 0;
    }

    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) return 0;

    const commentsMap = getDocHighlightComments(currentDocId);
    const items = extractAllCommentedHighlightsInOrder(currentEditor.state.doc, commentsMap);
    if (items.length === 0) return 0;

    const ok = await copyTextToClipboard(formatAllCommentsForCopy(items));
    return ok ? items.length : 0;
  }, []);

  useEffect(() => {
    return registerCopyAllCommentsHandler(handleCopyAllComments);
  }, [handleCopyAllComments]);

  const handleRawTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value;
    rawContentRef.current = nextValue;
    isRawDirtyRef.current = true;
    setRawContent(nextValue);
    scheduleDebouncedContent();
    scheduleDebouncedTocRefresh(editorRef.current);
    if (nextValue.includes(HIGHLIGHT_COMMENTS_START_MARKER) || getActiveCommentCount() > 0) {
      syncCommentVisualsAndCount(null);
    }
  };

  const handleRawTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const currentVal = rawContentRef.current;
      const nextVal = currentVal.substring(0, start) + '  ' + currentVal.substring(end);

      rawContentRef.current = nextVal;
      isRawDirtyRef.current = true;
      setRawContent(nextVal);
      scheduleDebouncedContent();
      scheduleDebouncedTocRefresh(editorRef.current);

      requestAnimationFrame(() => {
        if (rawTextareaRef.current) {
          rawTextareaRef.current.selectionStart = start + 2;
          rawTextareaRef.current.selectionEnd = start + 2;
        }
      });
    }
  };

  const getContainerWidthClass = () => {
    switch (preferences.textWidth) {
      case 'narrow': return 'max-w-2xl';
      case 'normal': return 'max-w-4xl';
      case 'wide': return 'max-w-6xl';
      case 'full': return 'max-w-none w-full';
      default: return 'max-w-4xl';
    }
  };

  const showSourceEditor = isEditable && isSourceMode;
  const activePopover = popoverController.activePopover;
  const activeHighlightId = activePopover?.highlightId ?? null;
  const activeHighlightComment =
    activePopover && activeHighlightId ? getHighlightComment(docId, activeHighlightId) : '';
  const activeHighlightedText =
    activePopover && activeHighlightId && editor && !editor.isDestroyed
      ? extractHighlightTextByIdFromProseMirrorDoc(editor.state.doc, activeHighlightId)
      : '';
  const activeCommentsTotal = activePopover ? getActiveCommentCount() : 0;
  const popoverAnchorKey = activePopover
    ? `${activePopover.highlightId ?? 'legacy'}:${activePopover.anchorPos}:${activePopover.isCommentOpen ? 1 : 0}`
    : '';
  const popoverLayoutTriggerKey = `${preferences.fontSize}-${preferences.fontFamily}-${preferences.textWidth}-${commentsVersion}`;

  return (
    <div className="w-full flex flex-col items-center py-4 px-4 sm:px-6 print:p-0 print:m-0 print:w-full">
      {isEditable && (
        <EditorToolbar
          editor={editor}
          docId={docId}
          isSourceMode={isSourceMode}
          onToggleSourceMode={handleToggleSourceModeWithScrollSync}
          onHighlightCommentsChange={() => {
            setCommentsVersion((v) => v + 1);
            scheduleDebouncedContentRef.current();
            scheduleCommentDomSync(editorRef.current);
          }}
        />
      )}

      <div
        ref={containerRef}
        className={`relative w-full ${getContainerWidthClass()} transition-all duration-200 ${
          preferences.fontFamily === 'serif' ? 'font-serif-editor' : 'font-sans-editor'
        } ${isHighlightMode ? 'highlight-mode-active' : ''} ${isEditable ? 'editor-mode-active' : ''} print:max-w-none print:w-full print:p-0 print:m-0`}
        style={{ fontSize: `${preferences.fontSize}px` }}
      >
        <FindReplaceBar
          isOpen={documentSearch.isOpen}
          isReplaceExpanded={documentSearch.isReplaceExpanded}
          isEditable={isEditable}
          query={documentSearch.query}
          replacement={documentSearch.replacement}
          options={documentSearch.options}
          matches={documentSearch.matches}
          activeIndex={documentSearch.activeIndex}
          error={documentSearch.error}
          replaceFeedback={documentSearch.replaceFeedback}
          searchInputRef={documentSearch.searchInputRef}
          replaceInputRef={documentSearch.replaceInputRef}
          onQueryChange={documentSearch.onQueryChange}
          onReplacementChange={documentSearch.onReplacementChange}
          onToggleOption={documentSearch.onToggleOption}
          onToggleReplaceExpanded={documentSearch.onToggleReplaceExpanded}
          onNext={documentSearch.onNext}
          onPrev={documentSearch.onPrev}
          onReplaceCurrent={documentSearch.onReplaceCurrent}
          onReplaceAll={documentSearch.onReplaceAll}
          onClose={documentSearch.onClose}
        />

        <FloatingHighlightPopover
          isOpen={Boolean(activePopover && !isEditable && !isSourceMode && editor)}
          anchorKey={popoverAnchorKey}
          layoutTriggerKey={popoverLayoutTriggerKey}
          activeColor={activePopover?.color}
          isCommentOpen={activePopover?.isCommentOpen ?? false}
          getAnchorViewportRect={popoverController.getAnchorViewportRect}
          onAutoClose={popoverController.closePopover}
          onSelectColor={popoverController.handleSelectColor}
          onRemoveHighlight={popoverController.handleRemoveHighlight}
          onClose={popoverController.closePopover}
          commentText={activeHighlightComment}
          highlightedText={activeHighlightedText}
          totalCommentsCount={activeCommentsTotal}
          onToggleComment={popoverController.handleToggleComment}
          onChangeComment={popoverController.handleChangeComment}
          onDeleteComment={popoverController.handleDeleteComment}
          onCopyAllComments={handleCopyAllComments}
        />

        {showSourceEditor && (
          <div className="bg-white dark:bg-slate-800/90 shadow-sm border border-blue-300 dark:border-blue-700/70 rounded-xl p-4 sm:p-10 min-h-[75vh] max-w-full print:hidden">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 dark:border-slate-700/60 text-xs text-slate-400 dark:text-slate-500 font-sans select-none">
              <span className="font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider text-[11px]">
                Modo Código-Fonte (Markdown Puro)
              </span>
              <span className="hidden sm:inline text-[11px]">
                Edição direta do arquivo .md • Atalho: Ctrl+;
              </span>
            </div>
            <div className="relative w-full">
              <SourceSearchBackdrop
                content={rawContent}
                matches={documentSearch.matches}
                activeIndex={documentSearch.activeIndex}
                fontSizePx={Math.max(13, preferences.fontSize - 1)}
                isOpen={documentSearch.isOpen}
              />
              <textarea
                ref={rawTextareaRef}
                value={rawContent}
                onChange={handleRawTextareaChange}
                onKeyDown={handleRawTextareaKeyDown}
                spellCheck={false}
                aria-label="Editor de código-fonte Markdown"
                placeholder="Digite o código Markdown puro aqui..."
                className="relative z-10 w-full min-h-[65vh] bg-transparent text-slate-800 dark:text-slate-100 font-mono leading-relaxed resize-none outline-none border-none p-0 m-0 overflow-hidden selection:bg-blue-500/20"
                style={{ fontSize: `${Math.max(13, preferences.fontSize - 1)}px` }}
              />
            </div>
          </div>
        )}
        
        <EditorContent 
          editor={editor} 
          className={`${
            showSourceEditor ? 'hidden print:block' : ''
          } bg-white dark:bg-slate-800/90 shadow-sm border border-slate-200 dark:border-slate-700/60 rounded-xl p-4 sm:p-10 min-h-[75vh] max-w-full overflow-hidden print:shadow-none print:border-none print:p-0 print:min-h-0 print:bg-transparent print:dark:bg-transparent`} 
        />
      </div>
    </div>
  );
};
