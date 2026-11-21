# Contrato & Gotchas do Seletor Flutuante de Grifos (`HighlightPopover`)

Este documento registra a arquitetura definitiva, o contrato de comportamento (PC e iPad/touch) e as armadilhas ocultas (*gotchas*) do seletor flutuante de cores e comentários de grifos no **Modo Leitura** e no **Modo Grifar**.

---

## 1. Arquitetura Atual (Desacoplada e Determinística)

O seletor flutuante **não** utiliza `@tiptap/react` `<BubbleMenu>` nem `tippy.js`. Ele foi isolado em três camadas independentes:

1. **Lógica Pura, Geometria e Transações (`src/services/highlightPopoverGeometry.ts`)**
   - Resolve o alvo diretamente na árvore ProseMirror (`resolveHighlightTargetInDoc`) para grifos com `data-id` ou legados sem `data-id`, de 1 caractere, com formatação aninhada (`<strong>`, `<em>`) ou distribuídos em múltiplos parágrafos.
   - Valida gestos sem depender de heurísticas implícitas do editor (`isValidDesktopClick`, `isValidTouchTap`).
   - Calcula posicionamento `fixed`, flip vertical, clamping horizontal/vertical na `visualViewport` e visibilidade durante o scroll (`computePopoverPosition`, `isAnchorVisibleInViewport`).
   - Constrói transações puras de cor e remoção (`createUpdateHighlightColorTransaction`, `createRemoveHighlightTransaction`) sem alterar `tr.selection`.
2. **Controlador de Ciclo de Vida e Gestos (`src/hooks/useHighlightPopoverController.ts`)**
   - Mantém estado próprio (`activePopover`) desacoplado de `editor.state.selection`.
   - Orquestra eventos de mouse (PC), touch (iPad/iOS), `Escape`, troca de documento/modo, troca de cor, remoção e comentários.
3. **Camada Visual via Portal (`src/components/editor/FloatingHighlightPopover.tsx`)**
   - Renderiza `HighlightPopover` via `createPortal(..., document.body)` com `position: fixed`, `z-20` e `print:hidden`.
   - Monitora redimensionamentos internos via `ResizeObserver` e rolagem via `scroll` em fase de captura + `window.visualViewport` coalescidos por `requestAnimationFrame`.

---

## 2. Contrato Completo de UX & Comportamento

### 2.1 Modos Permitidos
- **Modo Leitura** e **Modo Grifar** (`!isEditable && !isSourceMode`): ativo.
- **Modo Edição** (visual ou código-fonte): desativado (cores e comentários são manipulados pela `EditorToolbar`). Entrar em Modo Edição/Código-Fonte ou trocar de aba fecha o seletor imediatamente.

### 2.2 Abertura, Toggle e Troca de Grifo
- **PC (Mouse):** botão esquerdo (`button === 0`), no `mouseup`, com deslocamento `<= 5 px` entre `mousedown` e `mouseup`, sem tecla `Shift`, sem seleção ativa (`window.getSelection().isCollapsed`) e fora da janela pós-grifo (`250 ms`). Iniciar uma seleção arrastada *de dentro* de um grifo existente continua permitido sem abrir o seletor.
- **iPad / Touch:** no `touchend`, com deslocamento `<= 10 px` e duração `<= 500 ms` (ignora rolagem e *long-press* de seleção nativa), respeitando guarda anti-evento sintético (`450 ms`) para `mousedown`/`mouseup` gerados pelo Safari após o toque.
- **Clicar novamente no MESMO grifo já aberto:** **fecha (toggle)**, inclusive ao clicar em outra linha/parágrafo de um grifo longo multi-linha com o mesmo `data-id`.
- **Clicar em OUTRO grifo (B) enquanto aberto no grifo (A):** move diretamente em **1 clique** para o ponto clicado em B, fechando eventual caixa de comentário de A e atualizando cor ativa e indicador de comentário.
- **Clicar/tocar fora:** fecha imediatamente no `mousedown` (PC) ou no `touchend` de toque válido (iPad).

### 2.3 Posicionamento e Responsividade
- **Âncora exata no trecho clicado:** `anchorPos` é travado no ponto interno do caractere clicado e medido ao vivo via `editor.view.coordsAtPos(anchorPos, 1)`, nunca preso ao início do grifo.
- **Vertical:** abre **acima** por padrão (`10 px` de folga); se ultrapassar `headerBottom + 8 px`, faz **flip automático para baixo** (`anchor.bottom + 10 px`). Se o balão expandido não couber por completo em nenhum lado, escolhe o lado com mais espaço e aplica *clamping* dentro da `visualViewport`.
- **Horizontal:** sempre contido com margem mínima de `8 px` das bordas esquerda e direita da `visualViewport`.
- **Camada (`z-index`) e Impressão:** `z-20` (abaixo do `<Header>` `z-30`, da `FindReplaceBar` `z-[25]` e dos modais `z-50`) e oculto na impressão (`print:hidden`).

### 2.4 Troca de Cor, Remoção e Comentários
- **Pílula compacta (sem caixa de comentário aberta):** clicar em uma cor atualiza todos os fragmentos do grifo, preserva o `data-id` e eventual comentário salvo, fecha o seletor imediatamente e limpa seleção DOM residual.
- **Com caixa de comentário aberta:** clicar em uma nova cor atualiza a cor do grifo, atualiza o anel da cor ativa **e mantém o seletor e a caixa de comentário abertos** para o usuário continuar digitando sem perder o foco/cursor do `<textarea>`.
- **Grifos legados sem `data-id`:** ao trocar de cor ou abrir comentário, o grifo recebe um ID sequencial e tem o bloco contíguo inteiro atualizado.
- **Remoção (lixeira):** remove todos os fragmentos do grifo (por `data-id` ou bloco contíguo legado), fecha o seletor e resincroniza contadores.

### 2.5 Rolagem (Scroll), Resize e Atalhos
- Enquanto a âncora estiver visível entre `headerBottom` e o fundo da `visualViewport` (incluindo scroll horizontal dentro de `.tableWrapper`), o seletor acompanha o texto em tempo real.
- Quando a âncora sai da área visível:
  - **Pílula compacta:** fecha automaticamente.
  - **Caixa de comentário aberta (Trava Inteligente):** permanece aberta e dentro da `visualViewport` mesmo com abertura/fechamento do teclado virtual no iPad, fechando apenas por clique fora, `OK`, `Esc` ou `Ctrl+Enter`/`Cmd+Enter`.
- **Atalhos:** `Esc` fecha imediatamente em qualquer estado; `J` / navegação pelo Sumário fecha o seletor antes de rolar.

---

## 3. Catálogo de Gotchas (Armadilhas Documentadas)

1. **PROIBIDO usar `<BubbleMenu>` ou `tippy.js` para este popover em modo não editável:**
   - `<BubbleMenu>` foi projetado para editores editáveis com seleção arrastada. Em `editable: false`, depender dele obriga o código a forjar `editor.commands.setTextSelection(...)`, gerando todo o efeito dominó abaixo.
2. **Gotcha do `mousedown` no PC (`selectionchange` antes do `mouseup`):**
   - No Chrome/Edge no Windows, clicar com mouse em texto (`mousedown`) faz o `DOMObserver` do ProseMirror mover `editor.state.selection` para a posição clicada **antes** do `mouseup`.
   - No Safari do iPad, um toque rápido em área `contenteditable="false"` normalmente não dispara `selectionchange` antes do `touchend` — por isso o bug só quebrava no PC!
   - **Consequências letais se acoplar à seleção:**
     - `setTextSelection(tapPos)` no `mouseup` resulta em `selectionChanged === false`, fazendo o `BubbleMenuView` dar `return` antes de atualizar `getReferenceClientRect` e reabrindo o Tippy **congelado na posição do 1º clique**.
     - `editor.getAttributes('customHighlight').id` no `mouseup` lê o **novo** grifo já selecionado pelo `mousedown`, fazendo a comparação "é o mesmo grifo?" retornar falso positivo e fechar o seletor ao tentar trocar do Grifo A para o Grifo B.
   - **Regra:** sempre comparar o grifo clicado contra o estado próprio `activePopoverRef.current` (`isSamePopoverTarget`), nunca contra `editor.getAttributes()` ou `editor.state.selection`.
3. **Gotcha da *stale closure* no `<BubbleMenu>` do `@tiptap/react`:**
   - O componente `<BubbleMenu>` registra o plugin apenas quando `[editor, element]` mudam, congelando a primeira referência de `shouldShow` (e variáveis React como `isEditable`) pelo resto da vida do editor.
4. **Gotcha de bloquear clique no PC com `!editor.state.selection.empty`:**
   - Em modo não editável no desktop, `editor.state.selection` pode ficar desatualizada após seleções ou trocas de foco. Nunca bloqueie cliques por `!editor.state.selection.empty`; verifique apenas a seleção real visível do navegador (`window.getSelection()?.isCollapsed`).
5. **Gotcha da cor em `CustomHighlight` (`class` vs `data-color`):**
   - `CustomHighlight` serializa e renderiza a cor via `class="blue"` (não `data-color`). Sempre resolva a cor no documento ProseMirror (`resolveHighlightTargetInDoc`) com fallback para `data-color` e classe CSS (`parseHighlightColorFromElement`).
6. **Gotcha de grifos legados sem `data-id`:**
   - Comandos como `setCustomHighlight` / `unsetCustomHighlight` sobre seleção colapsada falham silenciosamente. Sempre resolva e opere sobre todo o span contíguo da mesma cor (`legacyRange`).
7. **Gotcha de foco e seleção ao trocar cor com comentário aberto:**
   - Nunca chame `tr.setSelection(...)` na transação de troca de cor nem `window.getSelection()?.removeAllRanges()` quando `isCommentOpen === true`, pois isso pode perturbar o foco/seleção dentro do `<textarea>` do comentário.

---

## 4. Checklist Anti-Regressão Obrigatório

Antes de concluir qualquer alteração envolvendo grifos, comentários, `TiptapEditor`, `HighlightPopover` ou `CustomHighlight`:

- [ ] Executar `npm.cmd test` e garantir que `src/services/highlightPopoverGeometry.test.ts` passe integralmente.
- [ ] Verificar que não há importação nem uso de `BubbleMenu` ou `tippy` em `TiptapEditor.tsx`.
- [ ] Testar manualmente no **PC (mouse)**:
  1. Clicar no Grifo A → abre exatamente sobre o trecho clicado.
  2. Clicar no Grifo B com A aberto → move diretamente em 1 clique para B (não fecha nem abre em A).
  3. Clicar no mesmo grifo longo em outra linha → fecha (toggle).
  4. Abrir comentário em A, digitar texto, clicar em outra cor → cor muda na hora, texto e caixa de comentário permanecem abertos e focados.
  5. Rolar a página para baixo até o grifo sair sob o cabeçalho → pílula compacta fecha; com comentário aberto permanece visível.
  6. Arrastar a partir de dentro de um grifo no Modo Grifar → seleciona/substitui normalmente sem o seletor atrapalhar.
- [ ] Testar no **iPad (touch)**: toque simples abre/fecha/troca, rolagem não abre por engano e teclado virtual não fecha a caixa de comentário.
