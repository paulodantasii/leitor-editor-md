import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditor, EditorContent, Editor, BubbleMenu } from '@tiptap/react';
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
import { TextSelection } from '@tiptap/pm/state';

import { useAppStore } from '../../store/useAppStore';
import { CustomHighlight } from './CustomHighlight';
import { HighlightPopover } from './HighlightPopover';
import { EditorToolbar } from './EditorToolbar';
import { HighlightColor } from '../../types';
import {
  registerEditorFlushHandler,
  markBridgeDirty,
  markBridgeClean,
  hasPendingBridgeChanges,
} from '../../services/editorContentBridge';
import { useTabScrollRestoration } from '../../hooks/useTabScrollRestoration';
import {
  generateNextHighlightId,
  registerScrollToLatestHighlightHandler,
  scrollToLatestHighlightInContainer,
  scanHighlightsInMarkdown,
} from '../../services/highlightIdService';
import {
  extractHeadingsFromProseMirrorDoc,
  extractHeadingsFromMarkdown,
  findActiveHeadingIndexByTops,
  getStickyTopOffsetPx,
  updateTocState,
  resetTocState,
  registerNavigateToHeadingHandler,
  pulseHeadingElement,
} from '../../services/tocService';
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
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastEmittedMarkdownRef = useRef<string | null>(null);
  const currentLoadedDocIdRef = useRef<string | null | undefined>(null);
  const markdownDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const markdownIdleCallbackRef = useRef<number | null>(null);
  const highlightCountDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tocExtractTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tocScrollRafRef = useRef<number | null>(null);

  // Estado e refs do Modo Código-Fonte (Markdown puro)
  const [rawContent, setRawContent] = useState<string>(() => useAppStore.getState().document?.content || '');
  const rawContentRef = useRef<string>(rawContent);
  const isSourceModeRef = useRef<boolean>(isSourceMode);
  const prevIsSourceModeRef = useRef<boolean>(isSourceMode);
  const isRawDirtyRef = useRef<boolean>(false);

  // State to control popover visibility: only opens on explicit click on a highlight mark
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [activeHighlightColor, setActiveHighlightColor] = useState<HighlightColor>('yellow');
  const isPopoverOpenRef = useRef(false);

  const setPopoverOpen = useCallback((open: boolean) => {
    isPopoverOpenRef.current = open;
    setIsPopoverOpen(open);
  }, []);

  // Track global mouse down state for PC dragging
  useEffect(() => {
    const handleDown = () => (isMouseDownRef.current = true);
    const handleUp = () => (isMouseDownRef.current = false);
    
    window.addEventListener('mousedown', handleDown);
    window.addEventListener('mouseup', handleUp);
    
    return () => {
      window.removeEventListener('mousedown', handleDown);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const editorRef = useRef<Editor | null>(null);
  const scheduleDebouncedContentRef = useRef<() => void>(() => {});
  const postponePendingContentFlushRef = useRef<() => void>(() => {});
  const scheduleDebouncedTocRefreshRef = useRef<(ed: Editor | null) => void>(() => {});

  // High-performance highlight counting directly from in-memory ProseMirror doc tree
  const updateHighlightCount = useCallback(
    (ed: Editor | null) => {
      if (!ed || ed.isDestroyed) return;

      const runCount = () => {
        if (!ed || ed.isDestroyed) return;
        const uniqueIds = new Set<string>();
        let unassignedCount = 0;

        ed.state.doc.descendants((node) => {
          if (!node.isText) return;
          for (let i = 0; i < node.marks.length; i++) {
            const mark = node.marks[i];
            if (mark.type.name === 'customHighlight') {
              if (mark.attrs.id) {
                uniqueIds.add(mark.attrs.id);
              } else {
                unassignedCount++;
              }
            }
          }
        });

        setHighlightCount(uniqueIds.size + unassignedCount);
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
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true, breaks: true }),
    ],
    shouldRerenderOnTransaction: false,
    content: useAppStore.getState().document?.content || '',
    editable: isEditable,
    onUpdate: ({ transaction }) => {
      if (!transaction.docChanged) return;
      scheduleDebouncedContentRef.current();
      scheduleDebouncedTocRefreshRef.current(editorRef.current);
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      if (!currentEditor) return;

      // Se houver edições pendentes no buffer, qualquer movimento de cursor ou seleção
      // indica que o usuário continua ativo no documento — adia a serialização pesada.
      postponePendingContentFlushRef.current();

      const { from, to } = currentEditor.state.selection;

      // User selected a text range in Highlight Mode -> APPLY HIGHLIGHT
      if (isHighlightMode && !currentEditor.isDestroyed && from !== to) {
        // Prevent instant highlight while dragging on PC
        if (isMouseDownRef.current) return;

        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }

        highlightTimeoutRef.current = setTimeout(() => {
          const currentSel = currentEditor.state.selection;
          if (currentSel.from !== currentSel.to) {
            const uniqueId = generateNextHighlightId(
              currentEditor.state.doc,
              useAppStore.getState().document?.docId
            );

            setPopoverOpen(false);

            currentEditor
              .chain()
              .setCustomHighlight({ color: 'yellow', id: uniqueId })
              .setTextSelection(currentSel.to)
              .run();

            scheduleDebouncedHighlightCount(currentEditor);
          }
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

    if (isSourceModeRef.current) {
      const rawMarkdown = rawContentRef.current;
      lastEmittedMarkdownRef.current = rawMarkdown;
      markBridgeClean();
      updateDocumentContent(rawMarkdown);
      setHighlightCount(countHighlightsInRawMarkdown(rawMarkdown));
      return;
    }

    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) return;

    const rawMarkdown = currentEditor.storage.markdown.getMarkdown();
    lastEmittedMarkdownRef.current = rawMarkdown;
    markBridgeClean();
    updateDocumentContent(rawMarkdown);
    updateHighlightCount(currentEditor);
  }, [clearPendingContentTimers, updateDocumentContent, updateHighlightCount, setHighlightCount]);

  const armIdleFlushTimer = useCallback(() => {
    clearPendingContentTimers();

    // Debounce adaptativo ao tamanho do documento:
    // Em arquivos gigantes (> 200KB, como o CPC), aguarda 5s de inatividade completa
    // (sem digitar, apagar, formatar ou mover o cursor) para nunca travar a UI.
    const docSize = (lastEmittedMarkdownRef.current || '').length;
    const delay = docSize > 200000 ? 5000 : docSize > 80000 ? 3000 : 1000;

    markdownDebounceTimerRef.current = setTimeout(() => {
      markdownDebounceTimerRef.current = null;

      // Enquanto o popover de cor/exclusão de grifo estiver aberto, adia a serialização
      if (isPopoverOpenRef.current && hasPendingBridgeChanges()) {
        armIdleFlushTimer();
        return;
      }

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        markdownIdleCallbackRef.current = (window as any).requestIdleCallback(
          () => {
            markdownIdleCallbackRef.current = null;
            if (isPopoverOpenRef.current && hasPendingBridgeChanges()) {
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
    (headingsCount: number): number => {
      if (headingsCount === 0) return -1;

      const thresholdY = getStickyTopOffsetPx() + 8;

      // Quando em Modo Código-Fonte (textarea visível), mede a posição Y real de cada título no textarea
      if (isSourceModeRef.current && rawTextareaRef.current) {
        const textarea = rawTextareaRef.current;
        const rect = textarea.getBoundingClientRect();
        const md = rawContentRef.current;
        const mdHeadings = extractHeadingsFromMarkdown(md);
        if (mdHeadings.length === 0) return -1;

        const charOffsets = mdHeadings.map((h) => h.charOffset ?? 0);
        const localTops = measureMultipleTextareaOffsetsTopPx(textarea, md, charOffsets);
        const estimatedTops = localTops.map((localY) => rect.top + localY);
        return findActiveHeadingIndexByTops(estimatedTops, thresholdY);
      }

      const container = containerRef.current;
      if (!container) return 0;

      const domHeadings = container.querySelectorAll(
        '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6'
      );
      if (domHeadings.length === 0) return 0;

      const tops: number[] = [];
      for (let i = 0; i < domHeadings.length; i++) {
        const el = domHeadings[i] as HTMLElement;
        // Ignora headings vazios para manter paridade 1:1 com extractHeadingsFromProseMirrorDoc
        if ((el.textContent || '').trim().length > 0) {
          tops.push(el.getBoundingClientRect().top);
        }
      }

      return findActiveHeadingIndexByTops(tops, thresholdY);
    },
    []
  );

  const refreshTocStructure = useCallback(
    (ed: Editor | null) => {
      const headings = isSourceModeRef.current
        ? extractHeadingsFromMarkdown(rawContentRef.current)
        : ed && !ed.isDestroyed
        ? extractHeadingsFromProseMirrorDoc(ed.state.doc)
        : [];

      const activeIdx = computeActiveHeadingInDom(headings.length);
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
      resetTocState();
    };
  }, [flushContent, clearPendingContentTimers]);

  // Update content when document switches externally (docId) or initial mount
  useEffect(() => {
    if (!editor) return;

    if (currentLoadedDocIdRef.current === docId) {
      return;
    }

    currentLoadedDocIdRef.current = docId;
    isRawDirtyRef.current = false;
    const currentDoc = useAppStore.getState().document;
    const nextContent = currentDoc?.content || '';

    lastEmittedMarkdownRef.current = nextContent;
    rawContentRef.current = nextContent;
    setRawContent(nextContent);

    if (!nextContent) {
      editor.commands.clearContent(false);
      updateHighlightCount(editor);
      refreshTocStructure(editor);
      return;
    }

    editor.commands.setContent(nextContent, false);
    updateHighlightCount(editor);
    requestAnimationFrame(() => {
      refreshTocStructure(editor);
    });
  }, [docId, editor, updateHighlightCount, refreshTocStructure]);

  // Escuta atualizações externas de conteúdo na mesma aba (ex.: resolução de conflito ou sync silencioso do OneDrive)
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      const nextDoc = state.document;
      const prevDoc = prevState.document;
      if (!nextDoc || !prevDoc) return;
      if (nextDoc.docId !== prevDoc.docId) return;
      if (nextDoc.content === prevDoc.content) return;
      if (nextDoc.content === lastEmittedMarkdownRef.current) return;

      lastEmittedMarkdownRef.current = nextDoc.content;
      rawContentRef.current = nextDoc.content;
      isRawDirtyRef.current = false;
      setRawContent(nextDoc.content);

      const currentEditor = editorRef.current;
      if (currentEditor && !currentEditor.isDestroyed) {
        currentEditor.commands.setContent(nextDoc.content, false);
        updateHighlightCount(currentEditor);
        requestAnimationFrame(() => {
          refreshTocStructure(currentEditor);
        });
      } else if (isSourceModeRef.current) {
        refreshTocStructure(null);
      }
    });
    return unsubscribe;
  }, [updateHighlightCount, refreshTocStructure]);

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
    return captureVisualScrollAnchor(containerRef.current, md);
  }, []);

  const handleToggleSourceModeWithScrollSync = useCallback(() => {
    if (hasPendingBridgeChanges()) {
      flushContent();
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
      setPopoverOpen(false);

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
        lastEmittedMarkdownRef.current = latestRaw;
        editor.commands.setContent(latestRaw, false);
        updateHighlightCount(editor);
        isRawDirtyRef.current = false;
      }

      const raf1 = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container) {
          const targetScrollY = resolveVisualTargetScrollY(container, anchorToRestore);
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
    setPopoverOpen,
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
          editor.commands.setContent(rawContentRef.current, false);
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
      if (isSourceModeRef.current && rawTextareaRef.current) {
        const md = rawContentRef.current;
        const summary = scanHighlightsInMarkdown(md);
        const targetId = summary.latestSequentialId || summary.latestLegacyId;
        if (!targetId) return;

        const escapedId = targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`<mark\\b[^>]*\\b(?:data-id|data-hl-id|id)=["']${escapedId}["'][^>]*>`, 'i');
        const match = regex.exec(md);
        if (match && typeof match.index === 'number') {
          const textarea = rawTextareaRef.current;
          textarea.focus({ preventScroll: true });
          textarea.setSelectionRange(match.index, match.index + match[0].length);
          const ratio = md.length > 0 ? match.index / md.length : 0;
          const rect = textarea.getBoundingClientRect();
          const estimatedY = Math.max(0, rect.top + window.scrollY + textarea.scrollHeight * ratio - window.innerHeight * 0.3);
          window.scrollTo({ top: estimatedY, left: 0, behavior: 'smooth' });
        }
        return;
      }

      scrollToLatestHighlightInContainer(containerRef.current, editorRef.current, {
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
        if (!isTransitioningSourceModeRef.current) {
          lastScrollSyncAnchorRef.current = captureCurrentScrollAnchorSnapshot();
        }
        const ed = editorRef.current;
        const headings = isSourceModeRef.current
          ? extractHeadingsFromMarkdown(rawContentRef.current)
          : ed && !ed.isDestroyed
          ? extractHeadingsFromProseMirrorDoc(ed.state.doc)
          : [];
        if (headings.length === 0) return;
        const activeIdx = computeActiveHeadingInDom(headings.length);
        updateTocState(headings, activeIdx);
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
  }, [computeActiveHeadingInDom, captureCurrentScrollAnchorSnapshot]);

  // Registra o comando de navegação rápida para um título ao clicar no Sumário (TOC Popover)
  useEffect(() => {
    const unregister = registerNavigateToHeadingHandler((headingIndex: number) => {
      const stickyOffset = getStickyTopOffsetPx();

      // Caso 1: Modo Código-Fonte (textarea)
      if (isSourceModeRef.current && rawTextareaRef.current) {
        const md = rawContentRef.current;
        const mdHeadings = extractHeadingsFromMarkdown(md);
        const target = mdHeadings[headingIndex];
        if (!target) return;

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

      const rect = targetEl.getBoundingClientRect();
      const rawTargetY = rect.top + window.scrollY - stickyOffset - 8;
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const targetScrollY = Math.max(0, Math.min(Math.round(rawTargetY), maxScrollY));

      window.scrollTo({
        top: targetScrollY,
        left: 0,
        behavior: 'smooth',
      });

      pulseHeadingElement(targetEl);
    });

    return unregister;
  }, []);

  // Update editor editable mode
  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditable, false);
      if (isEditable) {
        setPopoverOpen(false);
      }
    }
  }, [isEditable, editor, setPopoverOpen]);

  // Handle native selection in Highlight mode & iPad context menu suppression
  useEffect(() => {
    const handleMouseUpOrTouchEnd = (e: MouseEvent | TouchEvent) => {
      if (!editor || !isHighlightMode || isEditable) return;

      const target = e.target as HTMLElement;

      // Ignora toques/cliques no próprio popover; só ignora <mark> quando não há seleção de texto (clique simples)
      if (target?.closest('[data-highlight-popover]')) {
        return;
      }

      const { from, to } = editor.state.selection;
      if (from === to && target?.closest('mark')) {
        return;
      }

      if (from !== to) {
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }

        const uniqueId = generateNextHighlightId(
          editor.state.doc,
          useAppStore.getState().document?.docId
        );

        setPopoverOpen(false);

        editor
          .chain()
          .setCustomHighlight({ color: 'yellow', id: uniqueId })
          .setTextSelection(to)
          .run();

        scheduleDebouncedHighlightCount(editor);
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
  }, [editor, isHighlightMode, isEditable, scheduleDebouncedHighlightCount, setPopoverOpen]);

  // Ref to debounce touch and mouse events on mobile/iPad
  const lastPointerDownTimeRef = useRef(0);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);

  // Handle click on marks (activate popover) vs click outside marks (deactivate popover)
  useEffect(() => {
    // Handler para MOUSE (desktop) — lógica inalterada
    const handleMouseDown = (e: MouseEvent) => {
      if (!editor || editor.isDestroyed || isEditable) return;

      const now = Date.now();
      // Guard: ignora mousedown sintético gerado logo após touchend (400ms)
      if (now - lastPointerDownTimeRef.current < 400) return;

      const target = e.target as HTMLElement;
      if (!target) return;

      if (target.closest('[data-highlight-popover]')) return;

      const markEl = target.closest('mark');
      if (markEl && containerRef.current?.contains(markEl)) {
        try {
          const textNode = markEl.firstChild || markEl;
          const pos = editor.view.posAtDOM(textNode, 0);
          if (pos >= 0 && pos < editor.state.doc.content.size) {
            const clickedId = markEl.getAttribute('data-id');
            const currentActiveId = editor.getAttributes('customHighlight').id;
            const currentSel = editor.state.selection;

            const isSameMark =
              isPopoverOpenRef.current &&
              ((clickedId && currentActiveId && clickedId === currentActiveId) ||
                (!clickedId && !currentActiveId && pos >= currentSel.from - 2 && pos <= currentSel.to + 2 && editor.isActive('customHighlight')));

            if (isSameMark) {
              setPopoverOpen(false);
              editor.commands.setTextSelection(pos);
              window.getSelection()?.removeAllRanges();
              return;
            }

            const clickedColor =
              (markEl.getAttribute('data-color') as HighlightColor) ||
              (editor.getAttributes('customHighlight').color as HighlightColor) ||
              'yellow';
            setActiveHighlightColor(clickedColor);
            setPopoverOpen(true);
            editor.commands.setTextSelection(pos + 1);
            return;
          }
        } catch {
          // fallback
        }
      }

      if (isPopoverOpenRef.current) {
        setPopoverOpen(false);
        window.getSelection()?.removeAllRanges();
      }
    };

    // Handler TOUCH FASE 1: apenas grava coordenadas e timestamp, NÃO abre popover
    const handleTouchStart = (e: TouchEvent) => {
      if (!editor || editor.isDestroyed || isEditable) return;
      const touch = e.touches[0];
      if (!touch) return;
      lastPointerDownTimeRef.current = Date.now();
      touchStartXRef.current = touch.clientX;
      touchStartYRef.current = touch.clientY;
    };

    // Handler TOUCH FASE 2: decide se foi tap válido com base em deslocamento e duração
    const handleTouchEnd = (e: TouchEvent) => {
      if (!editor || editor.isDestroyed || isEditable) return;

      const touch = e.changedTouches[0];
      if (!touch) return;

      const deltaX = touch.clientX - touchStartXRef.current;
      const deltaY = touch.clientY - touchStartYRef.current;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const duration = Date.now() - lastPointerDownTimeRef.current;

      // Cancela se o dedo se moveu mais que 10px (scroll/drag) ou levou mais de 500ms (long-press)
      const TAP_MOVE_THRESHOLD = 10;
      const TAP_DURATION_MAX = 500;
      if (distance > TAP_MOVE_THRESHOLD || duration > TAP_DURATION_MAX) return;

      const target = e.target as HTMLElement;
      if (!target) return;

      if (target.closest('[data-highlight-popover]')) return;

      const markEl = target.closest('mark');
      if (markEl && containerRef.current?.contains(markEl)) {
        try {
          const textNode = markEl.firstChild || markEl;
          const pos = editor.view.posAtDOM(textNode, 0);
          if (pos >= 0 && pos < editor.state.doc.content.size) {
            const clickedId = markEl.getAttribute('data-id');
            const currentActiveId = editor.getAttributes('customHighlight').id;
            const currentSel = editor.state.selection;

            const isSameMark =
              isPopoverOpenRef.current &&
              ((clickedId && currentActiveId && clickedId === currentActiveId) ||
                (!clickedId && !currentActiveId && pos >= currentSel.from - 2 && pos <= currentSel.to + 2 && editor.isActive('customHighlight')));

            if (isSameMark) {
              setPopoverOpen(false);
              editor.commands.setTextSelection(pos);
              window.getSelection()?.removeAllRanges();
              return;
            }

            const clickedColor =
              (markEl.getAttribute('data-color') as HighlightColor) ||
              (editor.getAttributes('customHighlight').color as HighlightColor) ||
              'yellow';
            setActiveHighlightColor(clickedColor);
            setPopoverOpen(true);
            editor.commands.setTextSelection(pos + 1);
            return;
          }
        } catch {
          // fallback
        }
      }

      if (isPopoverOpenRef.current) {
        setPopoverOpen(false);
        window.getSelection()?.removeAllRanges();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [editor, isEditable, setPopoverOpen]);

  // Initial highlight count on mount
  useEffect(() => {
    if (editor) {
      updateHighlightCount(editor);
    }
  }, [editor, updateHighlightCount]);

  const handleSelectColor = (color: HighlightColor) => {
    if (!editor) return;

    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    setActiveHighlightColor(color);
    setPopoverOpen(false);

    const attrs = editor.getAttributes('customHighlight');
    const existingId = attrs.id;
    const { from, to } = editor.state.selection;

    if (existingId) {
      const { tr } = editor.state;
      let modified = false;

      // Localized search range (10000 characters) around current selection
      const searchFrom = Math.max(0, from - 5000);
      const searchTo = Math.min(tr.doc.content.size, to + 5000);

      tr.doc.nodesBetween(searchFrom, searchTo, (node, pos) => {
        if (!node.isText) return;
        const mark = node.marks.find(m => m.type.name === 'customHighlight' && m.attrs.id === existingId);
        if (mark) {
          tr.removeMark(pos, pos + node.nodeSize, mark.type);
          const newMark = mark.type.create({ ...mark.attrs, color });
          tr.addMark(pos, pos + node.nodeSize, newMark);
          modified = true;
        }
      });

      // Defensive fallback if mark spanned beyond 5000 chars
      if (!modified) {
        tr.doc.descendants((node, pos) => {
          if (!node.isText) return;
          const mark = node.marks.find(m => m.type.name === 'customHighlight' && m.attrs.id === existingId);
          if (mark) {
            tr.removeMark(pos, pos + node.nodeSize, mark.type);
            const newMark = mark.type.create({ ...mark.attrs, color });
            tr.addMark(pos, pos + node.nodeSize, newMark);
            modified = true;
          }
        });
      }

      const safePos = Math.min(to, tr.doc.content.size);
      tr.setSelection(TextSelection.create(tr.doc, safePos));
      editor.view.dispatch(tr);
    } else {
      const newId = generateNextHighlightId(
        editor.state.doc,
        useAppStore.getState().document?.docId
      );
      editor
        .chain()
        .setCustomHighlight({ color, id: newId })
        .setTextSelection(to)
        .run();
    }

    window.getSelection()?.removeAllRanges();
    // Color change does not alter count; no recounting needed
  };

  const handleRemoveHighlight = () => {
    if (!editor) return;

    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    setPopoverOpen(false);

    const attrs = editor.getAttributes('customHighlight');
    const existingId = attrs.id;
    const { from, to } = editor.state.selection;

    if (existingId) {
      const { tr } = editor.state;
      let modified = false;

      const searchFrom = Math.max(0, from - 5000);
      const searchTo = Math.min(tr.doc.content.size, to + 5000);

      tr.doc.nodesBetween(searchFrom, searchTo, (node, pos) => {
        if (!node.isText) return;
        const mark = node.marks.find(m => m.type.name === 'customHighlight' && m.attrs.id === existingId);
        if (mark) {
          tr.removeMark(pos, pos + node.nodeSize, mark.type);
          modified = true;
        }
      });

      if (!modified) {
        tr.doc.descendants((node, pos) => {
          if (!node.isText) return;
          const mark = node.marks.find(m => m.type.name === 'customHighlight' && m.attrs.id === existingId);
          if (mark) {
            tr.removeMark(pos, pos + node.nodeSize, mark.type);
            modified = true;
          }
        });
      }

      const safePos = Math.min(to, tr.doc.content.size);
      tr.setSelection(TextSelection.create(tr.doc, safePos));
      editor.view.dispatch(tr);
    } else {
      editor
        .chain()
        .unsetCustomHighlight()
        .setTextSelection(to)
        .run();
    }

    window.getSelection()?.removeAllRanges();
    scheduleDebouncedHighlightCount(editor);
  };

  const handleRawTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value;
    rawContentRef.current = nextValue;
    isRawDirtyRef.current = true;
    setRawContent(nextValue);
    scheduleDebouncedContent();
    scheduleDebouncedTocRefresh(editorRef.current);
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

  return (
    <div className="w-full flex flex-col items-center py-4 px-4 sm:px-6 print:p-0 print:m-0 print:w-full">
      {isEditable && (
        <EditorToolbar
          editor={editor}
          isSourceMode={isSourceMode}
          onToggleSourceMode={handleToggleSourceModeWithScrollSync}
        />
      )}

      <div
        ref={containerRef}
        className={`relative w-full ${getContainerWidthClass()} transition-all duration-200 ${
          preferences.fontFamily === 'serif' ? 'font-serif-editor' : 'font-sans-editor'
        } ${isHighlightMode ? 'highlight-mode-active' : ''} ${isEditable ? 'editor-mode-active' : ''} print:max-w-none print:w-full print:p-0 print:m-0`}
        style={{ fontSize: `${preferences.fontSize}px` }}
      >
        {editor && (
          <BubbleMenu 
            editor={editor} 
            tippyOptions={{ duration: 100 }}
            shouldShow={({ editor }) => !isEditable && isPopoverOpenRef.current && editor.isActive('customHighlight')}
          >
            <HighlightPopover
              activeColor={activeHighlightColor}
              onSelectColor={handleSelectColor}
              onRemoveHighlight={handleRemoveHighlight}
              onClose={() => setPopoverOpen(false)}
            />
          </BubbleMenu>
        )}

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
            <textarea
              ref={rawTextareaRef}
              value={rawContent}
              onChange={handleRawTextareaChange}
              onKeyDown={handleRawTextareaKeyDown}
              spellCheck={false}
              aria-label="Editor de código-fonte Markdown"
              placeholder="Digite o código Markdown puro aqui..."
              className="w-full min-h-[65vh] bg-transparent text-slate-800 dark:text-slate-100 font-mono leading-relaxed resize-none outline-none border-none p-0 m-0 overflow-hidden selection:bg-blue-500/20"
              style={{ fontSize: `${Math.max(13, preferences.fontSize - 1)}px` }}
            />
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
