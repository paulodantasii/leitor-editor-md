import CodeBlock from '@tiptap/extension-code-block';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CodeBlockView } from './CodeBlockView';

/**
 * Extensão de bloco de código que preserva o nome 'codeBlock' (compatibilidade total
 * com tiptap-markdown e serialização incremental) e adiciona um NodeView com botão "Copiar".
 */
export const CopyableCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
