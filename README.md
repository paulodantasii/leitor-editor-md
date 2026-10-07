# Leitor & Editor de Markdown PWA

Aplicação web progressiva (PWA) de alta performance desenvolvida para leitura, estudo e edição de documentos Markdown jurídicos e textos normativos estruturados, com grifos multicor persistentes, sincronização com Microsoft OneDrive e cache local robusto.

---

## 1. Arquitetura do Sistema e Fluxo de Dados

```
+-----------------------------------------------------------------------+
|                             TiptapEditor                              |
|          (ProseMirror, Extensões Customizadas e Tipografia)           |
+-----------------------------------+-----------------------------------+
                                    |
                          updateDocumentContent
                                    v
+-----------------------------------------------------------------------+
|                       Zustand Store (useAppStore)                     |
|        - document (DocumentState)       - recentDocuments (Cache)     |
|        - isDirty (Flag de alteração)    - syncStatus (SyncStatus)     |
+-------------------+-----------------------------------+---------------+
                    |                                   |
         saveRecentDocument                    Autosave com Debounce
                    v                                   v
+---------------------------------------+   +---------------------------+
|          IndexedDB (idb-keyval)       |   |   OneDrive (Graph API)    |
|   - Até 30 arquivos em cache local    |   | - PUT /me/drive/items/... |
|   - Fallback defensivo LocalStorage   |   | - eTag / lastModified     |
+---------------------------------------+   +---------------------------+
```

### Ciclo de Vida do Documento e Sincronização:
1. **Entrada de Conteúdo e Serialização Preguiçosa**:
   * O editor TipTap mantém o estado do documento ativo em memória e sinaliza alteração no store (`markDocumentDirty`) instantaneamente.
   * A conversão integral para Markdown (`getMarkdown`) é realizada com debounce de 600 ms após a pausa na digitação, ou forçada de imediato através de `flushPendingEditorContent()` antes de qualquer operação externa (salvar, exportar, trocar de aba ou enviar à nuvem).
   * O documento ativo é persistido no armazenamento local de forma coalescida (`saveLocalDocument` com buffer de 400 ms) para evitar saturação de I/O em arquivos extensos, com garantia de flush síncrono.
2. **Salvamento Automático no OneDrive**:
   * Monitorado pelo hook `useAutoSaveAndSync`.
   * Se o arquivo possui `oneDriveItemId` e `isDirty === true`, um timer com debounce de 7,5 segundos é iniciado.
   * Ao expirar a pausa na digitação, dispara `saveOneDriveFile`, grava a nova versão na nuvem, captura o `lastModifiedDateTime` e reseta `isDirty: false`.
3. **Detecção Contínua de Atualizações da Nuvem (Polling Ativo & Eventos)**:
   * Monitorado continuamente por `useAutoSaveAndSync`:
     * Polling periódico em segundo plano a cada 10 segundos (`CLOUD_POLL_INTERVAL_MS = 10000`).
     * Checagem imediata em eventos de foco da janela (`window.focus`) e visibilidade da aba (`visibilitychange`).
   * A sessão MSAL é restaurada proativamente na inicialização do app (`App.tsx`), garantindo checagem contínua sem depender da abertura manual do modal do OneDrive.
   * Se a nuvem tiver uma versão mais recente:
     * **Caso local limpo (`!isDirty`)**: O conteúdo é recarregado e aplicado instantaneamente no editor, exibindo um toast discreto (`SyncNotificationToast`).
     * **Caso local com alterações pendentes (`isDirty`)**: Dispara o modal de resolução de conflito (`CloudConflictModal`), permitindo ao usuário escolher entre manter a versão local ou substituir pela versão mais recente da nuvem.
4. **Guarda Universal de Alterações Não Salvas (`UnsavedChangesModal`)**:
   * Intercepta qualquer ação de carregamento de novo arquivo ("Abrir Local", "Abrir OneDrive", "Abrir do Histórico" ou "Novo Documento").
   * Proteção nativa no navegador via evento `beforeunload` para impedir fechamento ou recarregamento acidental.

---

## 2. Padrões de Tipografia e Espaçamento Vertical

O arquivo `src/index.css` define o comportamento visual uniforme entre títulos e parágrafos:
* O container `.ProseMirror` padroniza a variável `--paragraph-spacing: 1.25em` (e `0.9em` no `@media print`).
* Tanto `.ProseMirror p` quanto `.ProseMirror h1` a `.ProseMirror h6` utilizam:
  * `margin-top: 0;`
  * `margin-bottom: var(--paragraph-spacing);`
* **Garantia Arquitetural**: A distância vertical entre qualquer título e o parágrafo abaixo (ou acima) é matematicamente idêntica à distância que separa dois parágrafos comuns de texto, respeitando estritamente o modelo de linhas em branco do Markdown.
* **Renderização Otimizada para Textos Extensos**: Os blocos de conteúdo diretos (`p`, `blockquote`, listas, tabelas, blocos de código) utilizam `content-visibility: auto` com `contain-intrinsic-size: auto 3.5rem`. Isso instrui o motor gráfico a calcular layout e pintura exclusivamente para os blocos visíveis na tela, sem perder a capacidade nativa de busca (Ctrl+F) e seleção. No `@media print`, essa propriedade é desativada para renderização integral das páginas.

---

## 3. Interfaces Públicas e Como Estender

### Store Central (`src/store/useAppStore.ts`):
* `document: DocumentState`: título, conteúdo, `oneDriveItemId`, `isDirty`, `lastSavedAt` e `cloudLastModified`.
* `recentDocuments: RecentDocumentItem[]`: lista dos últimos 30 documentos mantidos no IndexedDB.
* `openRecentDocument(item)`: abre documento do histórico com atualização automática da nuvem se for do OneDrive.

### Serviços Principais (`src/services/`):
* `editorContentBridge.ts`: canal síncrono para forçar a exportação do documento do ProseMirror para o store antes de leituras críticas (`flushPendingEditorContent`).
* `recentDocumentsService.ts`: gerencia a coleção de até 30 arquivos no IndexedDB com fallback defensivo.
* `oneDriveService.ts`: chamadas REST para Microsoft Graph API (`listOneDriveItems`, `downloadOneDriveFile`, `saveOneDriveFile`, `getOneDriveItemMetadata`).
* `storage.ts`: persistência local síncrona/assíncrona de preferências e documento ativo.

---

## 4. Gotchas e Decisões Críticas

1. **Limites de Rate Limit do OneDrive (HTTP 429)**:
   * O Microsoft Graph API impõe limites estritos de requisições por minuto.
   * **Decisão**: É estritamente proibido disparar requisições HTTP PUT ao OneDrive a cada caractere digitado. O salvamento na nuvem deve sempre passar pelo debounce de 7,5 segundos, enquanto a persistência local (IndexedDB) ocorre imediatamente.
2. **Capacidade de Armazenamento**:
   * O `localStorage` do navegador é limitado a ~5MB compartilhados.
   * **Decisão**: O histórico completo dos 30 documentos reside no `IndexedDB` via biblioteca `idb-keyval`, garantindo centenas de megabytes sem risco de estourar cotas do navegador.
3. **ExecutionPolicy no Windows PowerShell**:
   * O script `npm.ps1` é bloqueado por padrão pelas políticas de segurança do Windows.
   * **Decisão**: Utilize sempre `npm.cmd run dev` ou `npm.cmd run build` ao invocar comandos no shell Windows.
4. **Serialização Preguiçosa e Leitura de Conteúdo do Documento**:
   * O ProseMirror gerencia a árvore sintática em memória durante a edição contínua para evitar travamentos de conversão em documentos extensos.
   * **Decisão**: Todo novo módulo ou rotina que necessite ler `document.content` para download, impressão ou envio externo DEVE invocar `flushPendingEditorContent()` imediatamente antes da leitura.
