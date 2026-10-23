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

export const TiptapEditor: React.FC = () => {
  // Fine-grained selectors: avoids re-rendering TiptapEditor on every content change / sync update
  const docId = useAppStore((state) => state.document?.docId);
  const isHighlightMode = useAppStore((state) => state.isHighlightMode);
  const isEditable = useAppStore((state) => state.isEditable);
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
  const isMouseDownRef = useRef(false);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastEmittedMarkdownRef = useRef<string | null>(null);
  const currentLoadedDocIdRef = useRef<string | null | undefined>(null);
  const markdownDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const highlightCountDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingStartTimeRef = useRef<number | null>(null);

  // State to control popover visibility: only opens on explicit click on a highlight mark
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
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
      highlightCountDebounceTimerRef.current = setTimeout(() => {
        updateHighlightCount(ed);
      }, 1200);
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
    content: useAppStore.getState().document?.content || '',
    editable: isEditable,
    onUpdate: ({ editor: currentEditor, transaction }) => {
      if (!transaction.docChanged) return;
      scheduleDebouncedContentRef.current();
      scheduleDebouncedHighlightCount(currentEditor);
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      if (!currentEditor) return;

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
            const uniqueId = Math.random().toString(36).substring(2, 6);

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

  // Flushes pending in-memory editor changes immediately to store and local storage
  const flushContent = useCallback(() => {
    lastTypingStartTimeRef.current = null;
    if (markdownDebounceTimerRef.current) {
      clearTimeout(markdownDebounceTimerRef.current);
      markdownDebounceTimerRef.current = null;
    }
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) return;

    // Skip heavy serialization if there are no pending unsaved changes
    if (!hasPendingBridgeChanges()) {
      return;
    }

    const rawMarkdown = currentEditor.storage.markdown.getMarkdown();
    lastEmittedMarkdownRef.current = rawMarkdown;
    markBridgeClean();
    updateDocumentContent(rawMarkdown);
    updateHighlightCount(currentEditor);
  }, [updateDocumentContent, updateHighlightCount]);

  const scheduleDebouncedContent = useCallback(() => {
    markDocumentDirty();
    markBridgeDirty();

    if (!lastTypingStartTimeRef.current) {
      lastTypingStartTimeRef.current = Date.now();
    }

    // Max-wait no editor: se digitação contínua por 4 s, força a serialização em background
    if (Date.now() - lastTypingStartTimeRef.current >= 4000) {
      flushContent();
      return;
    }

    if (markdownDebounceTimerRef.current) {
      clearTimeout(markdownDebounceTimerRef.current);
    }

    // Debounce adaptativo ao tamanho do documento (700ms para normais, até 1200ms para arquivos gigantes)
    const docSize = (lastEmittedMarkdownRef.current || '').length;
    const delay = docSize > 200000 ? 1200 : docSize > 80000 ? 950 : 700;

    markdownDebounceTimerRef.current = setTimeout(() => {
      flushContent();
    }, delay);
  }, [flushContent, markDocumentDirty]);

  scheduleDebouncedContentRef.current = scheduleDebouncedContent;

  // Register bridge flush handler & window lifecycle guards (background/close/blur)
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

    const handleBlur = () => {
      flushContent();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('blur', handleBlur);

    return () => {
      unregister();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('blur', handleBlur);
      if (markdownDebounceTimerRef.current) {
        clearTimeout(markdownDebounceTimerRef.current);
      }
      if (highlightCountDebounceTimerRef.current) {
        clearTimeout(highlightCountDebounceTimerRef.current);
      }
    };
  }, [flushContent]);

  // Update content only when document switches externally (docId) or initial mount
  useEffect(() => {
    if (!editor) return;

    if (currentLoadedDocIdRef.current === docId) {
      return;
    }

    currentLoadedDocIdRef.current = docId;
    const currentDoc = useAppStore.getState().document;

    if (!currentDoc || !currentDoc.content) {
      lastEmittedMarkdownRef.current = '';
      editor.commands.clearContent(false);
      updateHighlightCount(editor);
      return;
    }

    lastEmittedMarkdownRef.current = currentDoc.content;
    editor.commands.setContent(currentDoc.content, false);
    updateHighlightCount(editor);
  }, [docId, editor, updateHighlightCount]);

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

      // Ignore touches/clicks inside the popover UI or on existing marks
      if (target?.closest('[data-highlight-popover]') || target?.closest('mark')) {
        return;
      }

      const { from, to } = editor.state.selection;
      if (from !== to) {
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }

        const uniqueId = Math.random().toString(36).substring(2, 6);

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
    setPopoverOpen(false);

    const attrs = editor.getAttributes('customHighlight');
    const existingId = attrs.id;
    
    if (existingId) {
      const { tr } = editor.state;
      let modified = false;
      const { from, to } = editor.state.selection;

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
      
      if (modified) {
        editor.view.dispatch(tr);
      }
    } else {
      const newId = Math.random().toString(36).substring(2, 6);
      editor.chain().setCustomHighlight({ color, id: newId }).run();
    }
    
    // Clear selection away from highlight so popover closes cleanly without scanning doc
    editor.commands.setTextSelection(editor.state.selection.to);
    window.getSelection()?.removeAllRanges();
    // Color change does not alter count; no recounting needed
  };

  const handleRemoveHighlight = () => {
    if (!editor) return;
    
    const attrs = editor.getAttributes('customHighlight');
    const existingId = attrs.id;
    
    if (existingId) {
      const { tr } = editor.state;
      let modified = false;
      const { from, to } = editor.state.selection;

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
      
      if (modified) {
        editor.view.dispatch(tr);
      }
    } else {
      editor.chain().unsetCustomHighlight().run();
    }
    
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    
    setPopoverOpen(false);

    // Clear selection away from highlight cleanly without scanning doc
    editor.commands.setTextSelection(editor.state.selection.to);
    window.getSelection()?.removeAllRanges();
    scheduleDebouncedHighlightCount(editor);
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

  return (
    <div className="w-full flex flex-col items-center py-4 px-4 sm:px-6 print:p-0 print:m-0 print:w-full">
      {isEditable && <EditorToolbar editor={editor} />}

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
              activeColor={editor.getAttributes('customHighlight').color as HighlightColor}
              onSelectColor={handleSelectColor}
              onRemoveHighlight={handleRemoveHighlight}
              onClose={() => setPopoverOpen(false)}
            />
          </BubbleMenu>
        )}
        
        <EditorContent 
          editor={editor} 
          className="bg-white dark:bg-slate-800/90 shadow-sm border border-slate-200 dark:border-slate-700/60 rounded-xl p-4 sm:p-10 min-h-[75vh] max-w-full overflow-hidden print:shadow-none print:border-none print:p-0 print:min-h-0 print:bg-transparent print:dark:bg-transparent" 
        />
      </div>
    </div>
  );
};
