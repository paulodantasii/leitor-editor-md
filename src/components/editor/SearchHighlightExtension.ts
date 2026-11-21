import { Extension, Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { TextMatchRange } from '../../services/searchReplaceService';

export const searchHighlightPluginKey = new PluginKey<DecorationSet>('searchHighlight');

export interface SearchHighlightMeta {
  readonly matches: ReadonlyArray<TextMatchRange>;
  readonly activeIndex: number;
}

/**
 * Atualiza as decorações visuais de busca no ProseMirror sem modificar o documento,
 * sem acionar autosave e sem entrar no histórico de Desfazer (Ctrl+Z).
 */
export function setSearchHighlightState(
  editor: Editor | null,
  matches: ReadonlyArray<TextMatchRange>,
  activeIndex: number
): void {
  if (!editor || editor.isDestroyed || !editor.view) return;

  const meta: SearchHighlightMeta = { matches, activeIndex };
  const tr = editor.state.tr
    .setMeta(searchHighlightPluginKey, meta)
    .setMeta('addToHistory', false);

  editor.view.dispatch(tr);
}

export const SearchHighlightExtension = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: searchHighlightPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, prev, _oldState, newState) {
            const meta = tr.getMeta(searchHighlightPluginKey) as SearchHighlightMeta | undefined;
            if (meta) {
              if (!meta.matches || meta.matches.length === 0) {
                return DecorationSet.empty;
              }

              const docSize = newState.doc.content.size;
              const decorations: Decoration[] = [];

              for (let i = 0; i < meta.matches.length; i++) {
                const m = meta.matches[i];
                if (m.from >= 0 && m.to > m.from && m.to <= docSize) {
                  const isActive = i === meta.activeIndex;
                  decorations.push(
                    Decoration.inline(m.from, m.to, {
                      class: isActive ? 'search-match search-match-active' : 'search-match',
                    })
                  );
                }
              }

              return DecorationSet.create(newState.doc, decorations);
            }

            if (tr.docChanged) {
              return prev.map(tr.mapping, tr.doc);
            }

            return prev;
          },
        },
        props: {
          decorations(state) {
            return searchHighlightPluginKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
