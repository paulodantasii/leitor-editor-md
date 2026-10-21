import { useAppStore } from '../store/useAppStore';
import { saveOneDriveFile, downloadOneDriveFile } from './oneDriveService';
import { flushPendingEditorContent } from './editorContentBridge';
import { downloadMarkdownFile } from './exportService';
import { saveRecentDocument } from './recentDocumentsService';
import { SaveResult } from '../types';

export interface SaveOptions {
  /**
   * Se true (padrão): caso o documento não tenha fonte (OneDrive ou arquivo local conectado),
   * exibe diálogo para salvar arquivo no disco / download.
   * Se false (ex.: autosave em segundo plano): rascunhos sem fonte são gravados apenas
   * no cache local (draftRevision), sem abrir popup de seleção de arquivo na tela.
   */
  interactive?: boolean;
}

class SaveCoordinator {
  private inFlightPromise: Promise<SaveResult> | null = null;
  private queuedRequest: {
    interactive: boolean;
    resolvers: Array<(res: SaveResult) => void>;
    rejecters: Array<(err: any) => void>;
  } | null = null;

  /**
   * Retorna true se há salvamento em andamento na rede ou no disco.
   */
  public isSaving(): boolean {
    return this.inFlightPromise !== null;
  }

  /**
   * Ponto central de salvamento da aplicação.
   * Serializa requisições: no máximo 1 gravação simultânea; chamadas concorrentes
   * são coalescidas em uma única próxima execução com o estado mais recente.
   */
  public async save(options: SaveOptions = { interactive: true }): Promise<SaveResult> {
    // 1. Sempre descarrega texto pendente do editor ProseMirror para a store antes de qualquer decisão
    flushPendingEditorContent();

    // 2. Se já existe gravação em andamento, enfileira e coalese
    if (this.inFlightPromise) {
      return new Promise<SaveResult>((resolve, reject) => {
        if (!this.queuedRequest) {
          this.queuedRequest = {
            interactive: !!options.interactive,
            resolvers: [resolve],
            rejecters: [reject],
          };
        } else {
          if (options.interactive) {
            this.queuedRequest.interactive = true;
          }
          this.queuedRequest.resolvers.push(resolve);
          this.queuedRequest.rejecters.push(reject);
        }
      });
    }

    // 3. Executa a gravação atual
    this.inFlightPromise = this.executeSave(options).finally(() => {
      this.inFlightPromise = null;
      this.processQueue();
    });

    return this.inFlightPromise;
  }

  /**
   * Processa requisições que chegaram enquanto a gravação anterior estava em voo.
   */
  private async processQueue(): Promise<void> {
    if (!this.queuedRequest) return;

    const queued = this.queuedRequest;
    this.queuedRequest = null;

    flushPendingEditorContent();

    const state = useAppStore.getState();
    const doc = state.document;
    if (!doc) {
      const okResult: SaveResult = {
        status: 'ok',
        message: 'Nenhum documento aberto.',
      };
      queued.resolvers.forEach((res) => res(okResult));
      return;
    }

    // Se o documento já estiver limpo em relação à fonte (nenhuma nova edição durante o voo anterior)
    const hasUnsavedChanges = (doc.revision ?? 0) > (doc.sourceRevision ?? 0);
    if (!hasUnsavedChanges && !doc.isDirty) {
      const okResult: SaveResult = {
        status: 'ok',
        message: 'Já sincronizado.',
        sourceRevision: doc.sourceRevision,
      };
      queued.resolvers.forEach((res) => res(okResult));
      return;
    }

    // Executa a próxima gravação coalescida
    this.inFlightPromise = this.executeSave({ interactive: queued.interactive }).finally(() => {
      this.inFlightPromise = null;
      this.processQueue();
    });

    try {
      const result = await this.inFlightPromise;
      queued.resolvers.forEach((res) => res(result));
    } catch (err) {
      queued.rejecters.forEach((rej) => rej(err));
    }
  }

  /**
   * Grava apenas o rascunho local (IndexedDB + localStorage) e atualiza draftRevision.
   */
  public async saveDraft(): Promise<void> {
    flushPendingEditorContent();
    const state = useAppStore.getState();
    const doc = state.document;
    if (!doc) return;
    const currentRev = doc.revision ?? 0;

    useAppStore.getState().setDocument({
      draftRevision: currentRev,
    });

    const updatedDoc = useAppStore.getState().document;
    if (updatedDoc) {
      await saveRecentDocument({ ...updatedDoc });
    }
  }

  private async executeSave(options: SaveOptions): Promise<SaveResult> {
    const state = useAppStore.getState();
    const doc = state.document;
    if (!doc) {
      return { status: 'ok', message: 'Nenhum documento aberto.' };
    }
    const docIdAtStart = doc.docId;
    const revisionAtStart = doc.revision ?? 0;
    const contentToSave = doc.content;
    const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Destino 1: OneDrive
    if (doc.oneDriveItemId) {
      if (!navigator.onLine) {
        state.setSyncStatus('offline-pending');
        return {
          status: 'offline',
          message: 'Sem conexão. As alterações continuam seguras no navegador.',
        };
      }

      state.setSyncStatus('saving');
      try {
        const updatedItem = await saveOneDriveFile(doc.oneDriveItemId, contentToSave, doc.cloudETag);

        // Verifica se o usuário não trocou de documento enquanto o PUT viajava
        const latest = useAppStore.getState().document;
        if (latest && latest.docId === docIdAtStart) {
          const isStillDirty = (latest.revision ?? 0) > revisionAtStart;
          useAppStore.getState().setDocument({
            sourceRevision: revisionAtStart,
            draftRevision: Math.max(latest.draftRevision ?? 0, revisionAtStart),
            isDirty: isStillDirty,
            lastSavedAt: nowFormatted,
            cloudLastModified: updatedItem.lastModifiedDateTime,
            cloudETag: updatedItem.eTag || null,
          });
          useAppStore.getState().setSyncStatus('saved');

          const afterUpdate = useAppStore.getState().document;
          if (afterUpdate) {
            await saveRecentDocument({ ...afterUpdate });
          }
        }

        return {
          status: 'ok',
          message: 'Salvo no OneDrive!',
          sourceRevision: revisionAtStart,
        };
      } catch (err: any) {
        useAppStore.getState().setSyncStatus('error');
        const msg = String(err?.message || '');
        if (msg.includes('412') || err?.status === 412) {
          try {
            const freshContent = await downloadOneDriveFile(doc.oneDriveItemId);
            useAppStore.getState().setCloudConflict({
              cloudModified: new Date().toISOString(),
              cloudContent: freshContent,
            });
          } catch {
            // ignore
          }
          return { status: 'conflict', message: 'Conflito: o arquivo foi alterado na nuvem em outro dispositivo.' };
        }
        if (msg.includes('401') || msg.includes('login') || msg.includes('token')) {
          return { status: 'auth', message: 'Sessão expirada. Faça login novamente no OneDrive.' };
        }
        return { status: 'error', message: err?.message || 'Erro ao salvar no OneDrive.' };
      }
    }

    // Destino 2: Arquivo local com Handle
    const handle = state.fileHandle || doc.fileHandle;
    if (handle && typeof handle.createWritable === 'function') {
      try {
        // Detecção de alteração externa antes de gravar
        if (typeof handle.getFile === 'function') {
          try {
            const existingFile = await handle.getFile();
            if (doc.localLastModified && existingFile && existingFile.lastModified > doc.localLastModified + 1000) {
              const freshExternalContent = await existingFile.text();
              useAppStore.getState().setCloudConflict({
                cloudModified: new Date(existingFile.lastModified).toISOString(),
                cloudContent: freshExternalContent,
              });
              return {
                status: 'conflict',
                message: 'Conflito: o arquivo foi alterado fora do navegador por outro aplicativo.',
              };
            }
          } catch {
            // Se falhou ao inspecionar o arquivo antes de gravar, prossegue com createWritable
          }
        }

        const writable = await handle.createWritable();
        await writable.write(contentToSave);
        await writable.close();

        let newLocalModified = Date.now();
        if (typeof handle.getFile === 'function') {
          try {
            const latestFile = await handle.getFile();
            if (latestFile) newLocalModified = latestFile.lastModified;
          } catch {
            // ignore
          }
        }

        const latest = useAppStore.getState().document;
        if (latest && latest.docId === docIdAtStart) {
          const isStillDirty = (latest.revision ?? 0) > revisionAtStart;
          useAppStore.getState().setDocument({
            sourceRevision: revisionAtStart,
            draftRevision: Math.max(latest.draftRevision ?? 0, revisionAtStart),
            isDirty: isStillDirty,
            lastSavedAt: nowFormatted,
            localLastModified: newLocalModified,
            fileHandle: handle,
          });

          const afterUpdate = useAppStore.getState().document;
          if (afterUpdate) {
            await saveRecentDocument({ ...afterUpdate, fileHandle: handle });
          }
        }

        return {
          status: 'ok',
          message: 'Arquivo salvo!',
          sourceRevision: revisionAtStart,
        };
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return { status: 'cancelled' };
        }
        return {
          status: 'error',
          message: err?.message || 'Não foi possível gravar no arquivo local.',
        };
      }
    }

    // Destino 3: Sem fonte vinculada
    if (!options.interactive) {
      await this.saveDraft();
      return {
        status: 'ok',
        message: 'Rascunho salvo localmente.',
        sourceRevision: doc.sourceRevision,
      };
    }

    // Salvar interativo para documento sem fonte: File Picker ou Download
    try {
      if ('showSaveFilePicker' in window) {
        const newHandle = await (window as any).showSaveFilePicker({
          suggestedName: doc.title || 'documento_grifado.md',
          types: [{ description: 'Arquivo Markdown', accept: { 'text/markdown': ['.md'] } }],
        });

        const writable = await newHandle.createWritable();
        await writable.write(contentToSave);
        await writable.close();

        const file = await newHandle.getFile();
        useAppStore.getState().setFileHandle(newHandle);

        const latest = useAppStore.getState().document;
        if (latest) {
          const isStillDirty = (latest.revision ?? 0) > revisionAtStart;
          useAppStore.getState().setDocument({
            title: file.name,
            sourceRevision: revisionAtStart,
            draftRevision: Math.max(latest.draftRevision ?? 0, revisionAtStart),
            isDirty: isStillDirty,
            lastSavedAt: nowFormatted,
            localLastModified: file.lastModified,
            fileHandle: newHandle,
          });

          const afterUpdate = useAppStore.getState().document;
          if (afterUpdate) {
            await saveRecentDocument({ ...afterUpdate, fileHandle: newHandle });
          }
        }

        return {
          status: 'ok',
          message: 'Arquivo salvo!',
          sourceRevision: revisionAtStart,
        };
      }

      // Fallback: download no dispositivo (iOS Safari / navegadores legados)
      downloadMarkdownFile(contentToSave, doc.title || 'documento.md');
      const latest = useAppStore.getState().document;
      if (latest) {
        const isStillDirty = (latest.revision ?? 0) > revisionAtStart;
        useAppStore.getState().setDocument({
          sourceRevision: revisionAtStart,
          draftRevision: Math.max(latest.draftRevision ?? 0, revisionAtStart),
          isDirty: isStillDirty,
          lastSavedAt: nowFormatted,
        });

        const afterUpdate = useAppStore.getState().document;
        if (afterUpdate) {
          await saveRecentDocument({ ...afterUpdate });
        }
      }

      return {
        status: 'ok',
        message: 'Salvo no dispositivo!',
        sourceRevision: revisionAtStart,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { status: 'cancelled' };
      }
      try {
        downloadMarkdownFile(contentToSave, doc.title || 'documento.md');
        const latest = useAppStore.getState().document;
        if (latest) {
          const isStillDirty = (latest.revision ?? 0) > revisionAtStart;
          useAppStore.getState().setDocument({
            sourceRevision: revisionAtStart,
            draftRevision: Math.max(latest.draftRevision ?? 0, revisionAtStart),
            isDirty: isStillDirty,
            lastSavedAt: nowFormatted,
          });

          const afterUpdate = useAppStore.getState().document;
          if (afterUpdate) {
            await saveRecentDocument({ ...afterUpdate });
          }
        }

        return {
          status: 'ok',
          message: 'Salvo no dispositivo!',
          sourceRevision: revisionAtStart,
        };
      } catch (fallbackErr: any) {
        return {
          status: 'error',
          message: fallbackErr?.message || 'Erro ao salvar arquivo.',
        };
      }
    }
  }
}

export const saveCoordinator = new SaveCoordinator();
