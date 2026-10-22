# Leitor & Editor de Markdown PWA

Aplicação web progressiva (PWA) de alta performance desenvolvida para leitura, estudo e edição de documentos Markdown jurídicos e textos normativos estruturados, com grifos multicor persistentes, sincronização com Microsoft OneDrive, edição local nativa (File System Access API) e sistema de salvamento resiliente baseado em arquitetura por documento.

---

## 1. Arquitetura do Sistema e Fluxo de Dados (v2)

```
+-------------------------------------------------------------------------------+
|                                 TiptapEditor                                  |
|            (ProseMirror, Extensões Customizadas de Grifos e Tipografia)       |
+---------------------------------------+---------------------------------------+
                                        |
                            updateDocumentContent / revision++
                                        v
+-------------------------------------------------------------------------------+
|                          Zustand Store (useAppStore)                          |
|  - document: DocumentState | null        - syncStatus: SyncStatus             |
|  - revision, draftRevision, sourceRevision  - recentDocuments: RecentItem[]   |
+-------------------+-----------------------------------+-----------------------+
                    |                                   |
         saveCoordinator.saveDraft()           saveCoordinator.save()
                    |                          (Fila serializada + coalescência)
                    v                                   v
+---------------------------------------+   +-----------------------------------+
|        IndexedDB (idb-keyval)         |   | Destinos Permanentes:             |
| - Chaves individuais: doc:<id>        |   | 1. OneDrive (Microsoft Graph API) |
| - Índice leve: leitor_md_recents_v2   |   |    - If-Match / eTag (HTTP 412)   |
| - Descarte seguro: rascunhos protegidos|  |    - Auto-renomear: nome (1).md   |
| - Fallback de backup: LocalStorage    |   | 2. Arquivo Local (FS Access API)  |
+---------------------------------------+   |    - Sobrescrita com createWritable|
                                            +-----------------------------------+
```

---

## 2. Sistema de Salvamento e Coordenador Central (`saveCoordinator`)

O salvamento na versão 2 é centralizado no serviço `saveCoordinator.ts`:

1. **Fila Serializada e Coalescência**:
   - Garante que apenas uma gravação física (OneDrive ou arquivo local) ocorra por vez.
   - Requisições concorrentes ou edições durante o envio são coalescidas em uma única gravação subsequente contendo a versão mais fresca do documento.
2. **Revisões Monotônicas**:
   - `revision`: Contador estritamente crescente a cada alteração feita pelo usuário.
   - `sourceRevision`: Última revisão confirmada gravada no destino permanente (OneDrive ou arquivo em disco).
   - `draftRevision`: Última revisão gravada no cache/IndexedDB deste navegador.
   - `isDirty`: Verdadeiro sempre que `revision > sourceRevision`.
3. **Detecção e Resolução de Conflitos**:
   - **OneDrive**: Gravações enviam o header `If-Match: <cloudETag>`. Se o arquivo foi modificado na nuvem em outro dispositivo, a API retorna `412 Precondition Failed` e o app abre o `CloudConflictModal` para o usuário escolher entre manter a versão local ou substituir pela da nuvem.
   - **Arquivo Local**: Inspeciona `existingFile.lastModified` antes de invocar `createWritable()`, detectando alterações feitas em outros editores no computador.

---

## 3. Política de Salvamento Automático (Autosave)

Monitorado continuamente pelo hook `useAutoSaveAndSync.ts`:

- **Debounce Idle de 3 segundos**: Dispara o salvamento 3 segundos após o usuário parar de digitar.
- **Max-Wait de 30 segundos**: Em digitação ininterrupta, força a gravação a cada 30 segundos para evitar acúmulo de risco.
- **Flush Imediato em Eventos de Saída**: Eventos de perda de foco (`blur`), mudança de visibilidade (`visibilitychange`) e descarregamento da página (`pagehide` / `beforeunload`) forçam a serialização e gravação imediata no cache local e no destino.
- **Retentativas com Backoff Progressivo**: Falhas de rede sofrem retry automático com intervalos de 5 s, 15 s e 60 s (o último intervalo se repete). Ao restabelecer a conexão (`online`), o app sincroniza imediatamente as alterações pendentes.

---

## 4. Ciclo de Vida do Documento e "Salvar e Fechar"

1. **Estado `document: DocumentState | null` e Tela Inicial (`HomeScreen`)**:
   - O aplicativo suporta o estado limpo sem documento aberto.
   - Quando `document === null`, exibe a `HomeScreen` com cartões de ação rápida (Continuar Último, Abrir Arquivo, OneDrive e Novo Documento) e a grade dos 30 documentos recentes em cache.
2. **Botão Fechar (`X`) no Header**:
   - Menu dropdown com duas opções:
     - **Salvar e Fechar (Padrão)**: Garante a gravação no destino permanente ou rascunho e fecha para a tela inicial.
     - **Fechar sem salvar**: Pede confirmação apenas se houver alterações não salvas (`isDirty === true`).
3. **Documentos Efêmeros**:
   - Novos documentos em branco (`Sem Título.md`) permanecem efêmeros em memória. Se forem fechados sem digitação de conteúdo significativo, são descartados sem poluir o histórico ou criar arquivos vazios.
4. **Fechamento de Rascunhos (`CloseDraftModal`)**:
   - Se um documento sem fonte vinculada for fechado, o modal permite:
     - *Salvar no OneDrive*: Abre em modo "Salvar como" e fecha logo após a confirmação.
     - *Salvar no Dispositivo*: Dispara o seletor nativo do sistema e fecha após salvar.
     - *Fechar mantendo como Rascunho*: Mantém o documento no cache local com o selo **Rascunho** sem nenhuma perda.

---

## 5. Salvar como no OneDrive e Menu de Destino

1. **Menu de Destino de Salvamento (`SaveDestinationModal`)**:
   - Ao clicar em **Salvar** ou pressionar **`Ctrl+S` / `Cmd+S`** em um documento sem arquivo vinculado, abre o menu de destino para escolher entre **Salvar no OneDrive** e **Salvar no Dispositivo**.
   - Lembra o último destino selecionado em `localStorage` e destaca com o selo *"Último usado"*.
2. **Navegação e Resolução Automática de Nomes**:
   - O `OneDriveModal` no modo `save_as` permite navegar por pastas e editar o nome do arquivo.
   - Se o nome já existir na pasta, calcula o próximo nome livre com parênteses: `nome (1).md`, `nome (2).md` (evitando o formato nativo do Graph `nome 1.md`), com retentativa automática em caso de corrida (`409 Conflict`).
   - O documento é promovido no IndexedDB (removendo a chave `draft:<id>` anterior e criando `onedrive:<newItemId>`).

---

## 6. Regra de Remoção Segura do Histórico (Cota de 30 Documentos)

Um rascunho existe exclusivamente no navegador do usuário. Para evitar perda irreversível de texto ao atingir o limite de 30 itens:

1. **Prioridade de Descarte**: O item mais antigo que possua **fonte permanente** (OneDrive ou arquivo em disco) e esteja sincronizado é o primeiro a ser descarregado do cache. O arquivo original na nuvem/disco permanece 100% preservado.
2. **Proteção de Pendências**: Itens com alterações locais pendentes de envio (`draftRevision > sourceRevision`) **nunca são excluídos**.
3. **Proteção Total de Rascunhos**: Se todos os 30 documentos forem rascunhos, o sistema não apaga nenhum rascunho silenciosamente e avisa o usuário.

---

## 7. Indicador de Status Único no Header

Substitui o antigo ponto âmbar isolado e textos estáticos por um indicador dinâmico e contextual:

- `Editando…`: Alterações locais em andamento.
- `Rascunho salvo neste navegador`: Documento seguro no cache IndexedDB local.
- `Salvando…`: Gravação em andamento na nuvem ou no arquivo local.
- `Salvo no OneDrive às HH:MM`: Confirmação com horário do último salvamento na nuvem.
- `Salvo no arquivo às HH:MM`: Confirmação com horário da gravação no disco local.
- `Pendente (offline)`: Alterações salvas no navegador aguardando retorno da internet.
- `Conflito`: Alerta visual indicando alteração remota/externa para resolução.
- `Erro — tentar novamente`: Botão interativo que permite tentar a gravação novamente com um clique.

---

## 8. Scripts e Desenvolvimento

No ambiente Windows PowerShell, utilize sempre `npm.cmd`:

```powershell
# Instalar dependências
npm.cmd install

# Iniciar servidor de desenvolvimento (Vite)
npm.cmd run dev

# Executar suíte de testes unitários (Vitest)
npm.cmd test

# Compilar para produção (TypeScript + Vite)
npm.cmd run build
```
