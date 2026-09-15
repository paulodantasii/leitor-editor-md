import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
  Trash2,
  ChevronDown,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  List,
  ListOrdered,
  Quote,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Indent,
  Outdent,
  Minus,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Undo,
  Redo,
  RemoveFormatting,
} from 'lucide-react';
import { HighlightColor } from '../../types';
import { HIGHLIGHT_COLORS } from './HighlightPopover';

interface EditorToolbarProps {
  editor: Editor | null;
}

const COLOR_BAR_MAP: Record<HighlightColor, string> = {
  yellow: 'bg-amber-400',
  blue: 'bg-sky-400',
  red: 'bg-red-400',
  pink: 'bg-pink-400',
  green: 'bg-emerald-400',
  purple: 'bg-purple-400',
  orange: 'bg-orange-400',
  gray: 'bg-slate-400',
};

export const EditorToolbar: React.FC<EditorToolbarProps> = ({ editor }) => {
  const [isHighlightMenuOpen, setIsHighlightMenuOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const highlightMenuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuCoords({
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2,
      });
    }
  }, []);

  // Update position and handle scroll/resize when open
  useEffect(() => {
    if (isHighlightMenuOpen) {
      updateMenuPosition();
      window.addEventListener('scroll', updateMenuPosition, true);
      window.addEventListener('resize', updateMenuPosition);
    }
    return () => {
      window.removeEventListener('scroll', updateMenuPosition, true);
      window.removeEventListener('resize', updateMenuPosition);
    };
  }, [isHighlightMenuOpen, updateMenuPosition]);

  // Close highlight dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        highlightMenuRef.current &&
        !highlightMenuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsHighlightMenuOpen(false);
      }
    };
    if (isHighlightMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isHighlightMenuOpen]);

  if (!editor) return null;

  const isCustomHighlightActive = editor.isActive('customHighlight');
  const activeHighlightColor = (editor.getAttributes('customHighlight')?.color as HighlightColor) || 'yellow';

  const handleSetHighlight = (color: HighlightColor) => {
    const { from, to } = editor.state.selection;
    const attrs = editor.getAttributes('customHighlight');
    const existingId = attrs.id;

    if (from === to && existingId) {
      // Cursor is collapsed inside an existing highlight -> update all parts of this highlight entity
      const { tr } = editor.state;
      let modified = false;
      tr.doc.descendants((node, pos) => {
        if (!node.isText) return;
        const mark = node.marks.find(
          (m) => m.type.name === 'customHighlight' && m.attrs.id === existingId
        );
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
      const newId = existingId || Math.random().toString(36).substring(2, 6);
      editor.chain().focus().setCustomHighlight({ color, id: newId }).run();
    }
    setIsHighlightMenuOpen(false);
  };

  const handleRemoveHighlight = () => {
    const { from, to } = editor.state.selection;
    const attrs = editor.getAttributes('customHighlight');
    const existingId = attrs.id;

    if (from === to && existingId) {
      // Cursor is collapsed inside an existing highlight -> remove all parts of this entity
      const { tr } = editor.state;
      let modified = false;
      tr.doc.descendants((node, pos) => {
        if (!node.isText) return;
        const mark = node.marks.find(
          (m) => m.type.name === 'customHighlight' && m.attrs.id === existingId
        );
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
    setIsHighlightMenuOpen(false);
  };

  // Custom Paragraph/ListItem Indentation
  const handleIndent = () => {
    if (editor.isActive('bulletList') || editor.isActive('orderedList')) {
      editor.chain().focus().sinkListItem('listItem').run();
    } else {
      // Indent paragraph/blockquote by converting into blockquote or indenting list
      editor.chain().focus().sinkListItem('listItem').run();
    }
  };

  const handleOutdent = () => {
    if (editor.isActive('bulletList') || editor.isActive('orderedList')) {
      editor.chain().focus().liftListItem('listItem').run();
    } else {
      editor.chain().focus().liftListItem('listItem').run();
    }
  };

  return (
    <div className="sticky top-[calc(4.6rem+env(safe-area-inset-top,0px))] z-20 my-3 flex justify-center w-full animate-in fade-in slide-in-from-top-3 duration-200 print:hidden">
      <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border border-slate-200 dark:border-slate-700/80 shadow-lg rounded-2xl p-1.5 flex flex-wrap items-center justify-center gap-1 max-w-full">
        {/* Formatting Marks: Bold, Italic, Underline, Strike, Highlighter */}
        <div className="flex items-center gap-0.5 pr-1.5 border-r border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('bold') ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 font-bold' : ''
            }`}
            title="Negrito (Ctrl+B)"
          >
            <Bold className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('italic') ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Itálico (Ctrl+I)"
          >
            <Italic className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('underline') ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Sublinhado (Ctrl+U)"
          >
            <UnderlineIcon className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('strike') ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Tachado"
          >
            <Strikethrough className="w-4 h-4" />
          </button>

          {/* Highlight Color Picker & Remove Tool */}
          <div className="relative">
            <button
              ref={buttonRef}
              type="button"
              onClick={() => setIsHighlightMenuOpen((prev) => !prev)}
              className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-0.5 relative ${
                isCustomHighlightActive || isHighlightMenuOpen
                  ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                  : ''
              }`}
              title="Cor de Destaque / Grifar"
            >
              <div className="relative flex flex-col items-center">
                <Highlighter className="w-4 h-4" />
                {isCustomHighlightActive && (
                  <span
                    className={`absolute -bottom-1 w-3 h-0.5 rounded-full ${
                      COLOR_BAR_MAP[activeHighlightColor] || 'bg-amber-400'
                    }`}
                  />
                )}
              </div>
              <ChevronDown className="w-3 h-3 opacity-60 ml-0.5" />
            </button>

            {isHighlightMenuOpen && menuCoords && createPortal(
              <div
                ref={highlightMenuRef}
                style={{
                  position: 'fixed',
                  top: `${menuCoords.top}px`,
                  left: `${menuCoords.left}px`,
                  transform: 'translateX(-50%)',
                }}
                onMouseDown={(e) => {
                  // Prevent losing editor selection when interacting with popover
                  e.preventDefault();
                }}
                className="z-50 bg-white dark:bg-slate-800 rounded-full shadow-2xl border border-slate-200 dark:border-slate-700 px-3 py-1.5 flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-150 select-none whitespace-nowrap pointer-events-auto"
              >
                <div className="flex items-center gap-1.5 pr-2 border-r border-slate-200 dark:border-slate-700">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSetHighlight(c.id)}
                      onMouseDown={(e) => e.preventDefault()}
                      title={`Grifar de ${c.name}`}
                      className={`w-6 h-6 rounded-full transition-transform hover:scale-110 active:scale-95 ${c.bgClass} ${
                        isCustomHighlightActive && activeHighlightColor === c.id
                          ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-800 scale-110'
                          : ''
                      }`}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleRemoveHighlight}
                  onMouseDown={(e) => e.preventDefault()}
                  title="Remover grifo"
                  className="p-1.5 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>,
              document.body
            )}
          </div>
        </div>

        {/* Headings: H1, H2, H3 */}
        <div className="flex items-center gap-0.5 px-1.5 border-r border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('heading', { level: 1 }) ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Título 1"
          >
            <Heading1 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('heading', { level: 2 }) ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Título 2"
          >
            <Heading2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('heading', { level: 3 }) ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Título 3"
          >
            <Heading3 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('heading', { level: 4 }) ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Título 4"
          >
            <Heading4 className="w-4 h-4" />
          </button>
        </div>

        {/* Text Alignment */}
        <div className="flex items-center gap-0.5 px-1.5 border-r border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive({ textAlign: 'left' }) ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Alinhar à esquerda"
          >
            <AlignLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive({ textAlign: 'center' }) ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Centralizar"
          >
            <AlignCenter className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive({ textAlign: 'right' }) ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Alinhar à direita"
          >
            <AlignRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              editor.chain().focus().unsetTextAlign().run();
            }}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive({ textAlign: 'justify' }) ||
              (!editor.isActive({ textAlign: 'left' }) &&
                !editor.isActive({ textAlign: 'center' }) &&
                !editor.isActive({ textAlign: 'right' }))
                ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                : ''
            }`}
            title="Justificar (Padrão)"
          >
            <AlignJustify className="w-4 h-4" />
          </button>
        </div>

        {/* Indentation (Recuo) & Lists */}
        <div className="flex items-center gap-0.5 px-1.5 border-r border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={handleOutdent}
            className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title="Diminuir Recuo"
          >
            <Outdent className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleIndent}
            className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title="Aumentar Recuo"
          >
            <Indent className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('bulletList') ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Lista com marcadores"
          >
            <List className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('orderedList') ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Lista numerada"
          >
            <ListOrdered className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('blockquote') ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Citação"
          >
            <Quote className="w-4 h-4" />
          </button>
        </div>

        {/* Subscript, Superscript & Horizontal Divider */}
        <div className="flex items-center gap-0.5 px-1.5 border-r border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleSubscript().run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('subscript') ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Subscrito (x₂)"
          >
            <SubscriptIcon className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
            className={`p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
              editor.isActive('superscript') ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' : ''
            }`}
            title="Sobrescrito (x²)"
          >
            <SuperscriptIcon className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title="Inserir Divisor Horizontal"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>

        {/* Actions: Clear Formatting, Undo, Redo */}
        <div className="flex items-center gap-0.5 pl-1.5">
          <button
            type="button"
            onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
            title="Limpar formatação"
          >
            <RemoveFormatting className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            title="Desfazer (Ctrl+Z)"
          >
            <Undo className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            title="Refazer (Ctrl+Y)"
          >
            <Redo className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
