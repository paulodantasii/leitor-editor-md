import React, { useState, useEffect, useRef, useCallback } from 'react';
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

import { useAppStore } from '../../store/useAppStore';
import { CustomHighlight } from './CustomHighlight';
import { HighlightPopover } from './HighlightPopover';
import { EditorToolbar } from './EditorToolbar';
import { HighlightColor } from '../../types';

export const TiptapEditor: React.FC = () => {
  const {
    document: currentDoc,
    updateDocumentContent,
    isHighlightMode,
    isEditable,
    preferences,
    setHighlightCount,
  } = useAppStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const isMouseDownRef = useRef(false);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // Accurately counts unique connected highlight entities
  const updateHighlightCount = useCallback(
    (ed: Editor | null) => {
      if (!ed || !containerRef.current) return;
      const allMarks = Array.from(containerRef.current.querySelectorAll('mark'));

      if (allMarks.length === 0) {
        setHighlightCount(0);
        return;
      }

      // Group marks by unique data-id
      const uniqueIds = new Set<string>();
      let unassignedCount = 0;

      for (let i = 0; i < allMarks.length; i++) {
        const hlId = allMarks[i].getAttribute('data-id');
        if (hlId) {
          uniqueIds.add(hlId);
        } else {
          unassignedCount++;
        }
      }

      setHighlightCount(uniqueIds.size + unassignedCount);
    },
    [setHighlightCount]
  );

  // Initialize Tiptap Editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Image.configure({ inline: true, allowBase64: true }),
      TextAlign.configure({ types: ['heading', 'paragraph', 'blockquote'] }),
      Underline,
      Subscript,
      Superscript,
      TextStyle,
      Color,
      CustomHighlight,
      Markdown.configure({ html: true, transformPastedText: true, breaks: true }),
    ],
    content: currentDoc.content,
    editable: isEditable,
    onUpdate: ({ editor }) => {
      const rawMarkdown = editor.storage.markdown.getMarkdown();
      updateDocumentContent(rawMarkdown);
      updateHighlightCount(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      if (!editor) return;

      const { from, to } = editor.state.selection;

      // Case A: User selected a text range in Highlight Mode -> APPLY HIGHLIGHT (Yellow standard, no popover)
      if (isHighlightMode && !editor.isDestroyed && from !== to) {
        // Prevent instant highlight while dragging on PC
        if (isMouseDownRef.current) return;

        // On touch devices (iPad), native OS selection handles don't fire touchend when dragged.
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }

        highlightTimeoutRef.current = setTimeout(() => {
          const currentSel = editor.state.selection;
          if (currentSel.from !== currentSel.to) {
            const uniqueId = Math.random().toString(36).substring(2, 6);

            setPopoverOpen(false);

            editor
              .chain()
              .focus()
              .setCustomHighlight({ color: 'yellow', id: uniqueId })
              .setTextSelection(currentSel.to)
              .run();

            setTimeout(() => {
              window.getSelection()?.removeAllRanges();
              document.getSelection()?.empty();
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
            }, 20);

            updateHighlightCount(editor);
          }
        }, 250);
      }
    },
  });

  // Update content when document changes externally
  useEffect(() => {
    if (editor && currentDoc.content && editor.storage.markdown.getMarkdown() !== currentDoc.content) {
      editor.commands.setContent(currentDoc.content, false);
      updateHighlightCount(editor);
    }
  }, [currentDoc.content, editor, updateHighlightCount]);

  // Update editor editable mode
  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditable);
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
          .focus()
          .setCustomHighlight({ color: 'yellow', id: uniqueId })
          .setTextSelection(to)
          .run();

        setTimeout(() => {
          window.getSelection()?.removeAllRanges();
          document.getSelection()?.empty();
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }, 30);

        updateHighlightCount(editor);
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
  }, [editor, isHighlightMode, isEditable, updateHighlightCount, setPopoverOpen]);

  // Ref to debounce touch and mouse events on mobile/iPad
  const lastPointerDownTimeRef = useRef(0);

  // Handle click on marks (activate popover) vs click outside marks (deactivate popover)
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (!editor || editor.isDestroyed || isEditable) return;

      const now = Date.now();
      if (e.type === 'touchstart') {
        lastPointerDownTimeRef.current = now;
      } else if (e.type === 'mousedown' && now - lastPointerDownTimeRef.current < 400) {
        return;
      }

      const target = e.target as HTMLElement;
      if (!target) return;

      // Don't close if clicking inside the popover itself
      if (target.closest('[data-highlight-popover]')) {
        return;
      }

      // Check if clicking on a highlight mark (finger cursor)
      const markEl = target.closest('mark');
      if (markEl && containerRef.current?.contains(markEl)) {
        try {
          const textNode = markEl.firstChild || markEl;
          const pos = editor.view.posAtDOM(textNode, 0);
          if (pos >= 0 && pos < editor.state.doc.content.size) {
            const clickedId = markEl.getAttribute('data-id');
            const currentActiveId = editor.getAttributes('customHighlight').id;
            const currentSel = editor.state.selection;

            // Check if the popover is already open for this exact highlight mark:
            const isSameMark =
              isPopoverOpenRef.current &&
              ((clickedId && currentActiveId && clickedId === currentActiveId) ||
                (!clickedId && !currentActiveId && pos >= currentSel.from - 2 && pos <= currentSel.to + 2 && editor.isActive('customHighlight')));

            if (isSameMark) {
              // 2nd click: close the popover and clear mark selection
              setPopoverOpen(false);
              let clearPos = -1;
              editor.state.doc.descendants((node, p) => {
                if (clearPos !== -1) return false;
                if (node.isText && !node.marks.some((m) => m.type.name === 'customHighlight')) {
                  clearPos = p;
                  return false;
                }
              });

              if (clearPos >= 0) {
                editor.commands.setTextSelection(clearPos);
              } else {
                editor.commands.setTextSelection(0);
              }
              window.getSelection()?.removeAllRanges();
              return;
            }

            // 1st click (or 3rd click after closing): Open color popover
            setPopoverOpen(true);
            editor.commands.setTextSelection(pos + 1);
            return;
          }
        } catch {
          // fallback
        }
      }

      // Clicked outside any mark (normal arrow cursor) -> deactivate popover if active
      if (isPopoverOpenRef.current || editor.isActive('customHighlight')) {
        setPopoverOpen(false);
        let clearPos = -1;
        editor.state.doc.descendants((node, pos) => {
          if (clearPos !== -1) return false;
          if (node.isText && !node.marks.some(m => m.type.name === 'customHighlight')) {
            clearPos = pos;
            return false;
          }
        });

        if (clearPos >= 0) {
          editor.commands.setTextSelection(clearPos);
        } else {
          editor.commands.setTextSelection(0);
        }
        window.getSelection()?.removeAllRanges();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
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
    
    const attrs = editor.getAttributes('customHighlight');
    const existingId = attrs.id;
    
    if (existingId) {
      const { tr } = editor.state;
      let modified = false;
      
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
      
      if (modified) {
        editor.view.dispatch(tr);
      }
    } else {
      const newId = Math.random().toString(36).substring(2, 6);
      editor.chain().focus().setCustomHighlight({ color, id: newId }).run();
    }
    
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    
    setPopoverOpen(false);

    // Clear selection away from highlight so popover closes
    let clearPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (clearPos !== -1) return false;
      if (node.isText && !node.marks.some(m => m.type.name === 'customHighlight')) {
        clearPos = pos;
        return false;
      }
    });
    if (clearPos >= 0) {
      editor.commands.setTextSelection(clearPos);
    } else {
      editor.commands.setTextSelection(0);
    }
    window.getSelection()?.removeAllRanges();
    updateHighlightCount(editor);
  };

  const handleRemoveHighlight = () => {
    if (!editor) return;
    
    const attrs = editor.getAttributes('customHighlight');
    const existingId = attrs.id;
    
    if (existingId) {
      const { tr } = editor.state;
      let modified = false;
      
      tr.doc.descendants((node, pos) => {
        if (!node.isText) return;
        const mark = node.marks.find(m => m.type.name === 'customHighlight' && m.attrs.id === existingId);
        if (mark) {
          tr.removeMark(pos, pos + node.nodeSize, mark.type);
          modified = true;
        }
      });
      
      if (modified) {
        editor.view.dispatch(tr);
      }
    } else {
      editor.chain().focus().unsetCustomHighlight().run();
    }
    
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    
    setPopoverOpen(false);

    // Clear selection away from highlight so popover closes
    let clearPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (clearPos !== -1) return false;
      if (node.isText && !node.marks.some(m => m.type.name === 'customHighlight')) {
        clearPos = pos;
        return false;
      }
    });
    if (clearPos >= 0) {
      editor.commands.setTextSelection(clearPos);
    } else {
      editor.commands.setTextSelection(0);
    }
    window.getSelection()?.removeAllRanges();
    updateHighlightCount(editor);
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
          className="bg-white dark:bg-slate-800/90 shadow-sm border border-slate-200 dark:border-slate-700/60 rounded-xl p-6 sm:p-10 min-h-[75vh] print:shadow-none print:border-none print:p-0 print:min-h-0 print:bg-transparent print:dark:bg-transparent" 
        />
      </div>
    </div>
  );
};
