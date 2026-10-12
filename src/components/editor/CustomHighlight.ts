import { Mark, mergeAttributes } from '@tiptap/core';
import { HighlightColor } from '../../types';

export interface CustomHighlightOptions {
  multicolor: boolean;
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customHighlight: {
      /**
       * Set a custom highlight color mark with optional unique highlight group id
       */
      setCustomHighlight: (attributes?: { color?: HighlightColor; id?: string }) => ReturnType;
      /**
       * Toggle a custom highlight color mark
       */
      toggleCustomHighlight: (attributes?: { color?: HighlightColor; id?: string }) => ReturnType;
      /**
       * Unset highlight mark
       */
      unsetCustomHighlight: () => ReturnType;
    };
  }
}

export const CustomHighlight = Mark.create<CustomHighlightOptions>({
  name: 'customHighlight',
  priority: 1001,

  addOptions() {
    return {
      multicolor: true,
      HTMLAttributes: {},
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open(_state: any, mark: any) {
            const color = mark.attrs?.color || 'yellow';
            const id = mark.attrs?.id;
            return `<mark class="${color}"${id ? ` data-id="${id}"` : ''}>`;
          },
          close() {
            return '</mark>';
          },
        },
      },
    };
  },

  addAttributes() {
    return {
      color: {
        default: 'yellow',
        parseHTML: (element) => {
          const dataColor = element.getAttribute('data-color');
          if (dataColor) return dataColor;

          const className = element.getAttribute('class') || '';
          const match = className.match(/\b(yellow|blue|red|pink|green|purple|orange|gray)\b/) || className.match(/hl-(\w+)/);
          return match ? match[1] : 'yellow';
        },
        renderHTML: (attributes) => {
          const color = attributes.color || 'yellow';
          return {
            class: color,
          };
        },
      },
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-id') || element.getAttribute('data-hl-id') || element.getAttribute('id'),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return {
            'data-id': attributes.id,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'mark',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCustomHighlight:
        (attributes) =>
        ({ commands }) => {
          const attrs = {
            id: attributes?.id || Math.random().toString(36).substring(2, 6),
            color: attributes?.color || 'yellow',
          };
          return commands.setMark(this.name, attrs);
        },
      toggleCustomHighlight:
        (attributes) =>
        ({ commands }) => {
          const attrs = {
            id: attributes?.id || Math.random().toString(36).substring(2, 6),
            color: attributes?.color || 'yellow',
          };
          return commands.toggleMark(this.name, attrs);
        },
      unsetCustomHighlight:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },
});
