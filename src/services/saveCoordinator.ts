import { useAppStore } from '../store/useAppStore';
import {
  saveOneDriveFile,
  downloadOneDriveFile,
  renameOneDriveFile,
  getOneDriveItemMetadata,
} from './oneDriveService';
import { flushPendingEditorContent } from './editorContentBridge';
import { downloadMarkdownFile } from './exportService';
import { saveRecentDocument } from './recentDocumentsService';
import { DocumentState, SaveResult } from '../types';

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
      lastModifiedAt: doc.lastModifiedAt ?? Date.now(),
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

    // Trava Anti-Apagão: nunca sobrescreve um documento com stub vazio aguardando hidratação
    if (doc.storedInDb && (!doc.content || doc.content.length === 0)) {
      return {
        status: 'error',
        message: 'Documento ainda está sendo carregado do cache local.',
      };
    }

    const docIdAtStart = doc.docId;
    const revisionAtStart = doc.revision ?? 0;
    const contentToSave = doc.content;
    const titleToSave = doc.title;
    const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const hasLocalChanges = Boolean(doc.isDirty || (doc.revision ?? 0) > (doc.sourceRevision ?? 0));

    // Destino 1: OneDrive (Bidirecional: Pull se limpo, Push se alterado)
    if (doc.oneDriveItemId) {
      if (!navigator.onLine) {
        state.setSyncStatus('offline-pending');
        return {
          status: 'offline',
          message: 'Sem conexão. As alterações continuam seguras no navegador.',
        };
      }

      if (!hasLocalChanges) {
        return await this.pullFromOneDrive(
          doc,
          docIdAtStart,
          revisionAtStart,
          contentToSave,
          titleToSave,
          nowFormatted
        );
      }

      return await this.pushToOneDrive(
        doc,
        docIdAtStart,
        revisionAtStart,
        contentToSave,
        titleToSave,
        nowFormatted
      );
    }

    // Destino 2: Arquivo local com Handle (Bidirecional: Pull se limpo, Push se alterado)
    const handle = state.fileHandle || doc.fileHandle;
    if (handle && typeof handle.createWritable === 'function') {
      if (!hasLocalChanges) {
        return await this.pullFromLocalHandle(
          doc,
          handle,
          docIdAtStart,
          revisionAtStart,
          contentToSave,
          titleToSave,
          nowFormatted
        );
      }

      return await this.pushToLocalHandle(
        doc,
        handle,
        docIdAtStart,
        revisionAtStart,
        contentToSave,
        nowFormatted
      );
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
            lastModifiedAt: file.lastModified,
            fileHandle: newHandle,
          });

          const afterUpdate = useAppStore.getState().document;
          if (afterUpdate) {
            const updatedList = await saveRecentDocument({ ...afterUpdate, fileHandle: newHandle }, 'sync');
            useAppStore.setState({ recentDocuments: updatedList });
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
          const updatedList = await saveRecentDocument({ ...afterUpdate }, 'sync');
          useAppStore.setState({ recentDocuments: updatedList });
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
            const updatedList = await saveRecentDocument({ ...afterUpdate }, 'sync');
            useAppStore.setState({ recentDocuments: updatedList });
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

  private async pullFromOneDrive(
    doc: DocumentState,
    docIdAtStart: string | undefined,
    revisionAtStart: number,
    contentToSave: string,
    titleToSave: string,
    nowFormatted: string
  ): Promise<SaveResult> {
    const itemId = doc.oneDriveItemId!;
    useAppStore.getState().setSyncStatus('saving');
    try {
      const [metadata, freshContent] = await Promise.all([
        getOneDriveItemMetadata(itemId).catch(() => null),
        downloadOneDriveFile(itemId),
      ]);

      if (doc.content && doc.content !== freshContent) {
        await saveRecentDocument({ ...doc }, 'sync');
      }

      const latest = useAppStore.getState().document;
      if (latest && latest.docId === docIdAtStart) {
        if ((latest.revision ?? 0) > revisionAtStart && freshContent !== contentToSave) {
          await saveRecentDocument({ ...latest }, 'conflict');
          useAppStore.getState().setCloudConflict({
            cloudModified: metadata?.lastModifiedDateTime || new Date().toISOString(),
            cloudContent: freshContent,
          });
          useAppStore.getState().setSyncStatus('idle');
          return {
            status: 'conflict',
            message: 'Conflito: o arquivo foi editado localmente enquanto sincronizava.',
          };
        }

        const resolvedTitle = metadata?.name || latest.title;
        const hadChanges = freshContent !== contentToSave || resolvedTitle !== titleToSave;
        const targetRev = hadChanges ? (latest.revision ?? 0) + 1 : (latest.revision ?? 0);

        const resolvedCloudModified = metadata?.lastModifiedDateTime ?? latest.cloudLastModified ?? null;
        const parsedCloudMs = resolvedCloudModified ? Date.parse(resolvedCloudModified) : NaN;

        useAppStore.getState().setDocument({
          title: resolvedTitle,
          content: freshContent,
          revision: targetRev,
          sourceRevision: targetRev,
          draftRevision: Math.max(latest.draftRevision ?? 0, targetRev),
          isDirty: false,
          lastSavedAt: nowFormatted,
          cloudLastModified: resolvedCloudModified,
          cloudETag: metadata?.eTag ?? latest.cloudETag ?? null,
          lastModifiedAt: Number.isFinite(parsedCloudMs) ? parsedCloudMs : Date.now(),
        });
        useAppStore.getState().setSyncStatus('saved');

        const afterUpdate = useAppStore.getState().document;
        if (afterUpdate) {
          const updatedList = await saveRecentDocument({ ...afterUpdate }, 'sync');
          useAppStore.setState({ recentDocuments: updatedList });
        }

        return {
          status: 'ok',
          message: hadChanges
            ? 'Sincronizado: alterações mais recentes carregadas do OneDrive!'
            : 'Já sincronizado com o OneDrive!',
          sourceRevision: targetRev,
        };
      }

      return {
        status: 'ok',
        message: 'Sincronizado com o OneDrive!',
        sourceRevision: revisionAtStart,
      };
    } catch (err: any) {
      useAppStore.getState().setSyncStatus('error');
      const msg = String(err?.message || '');
      if (msg.includes('401') || msg.includes('login') || msg.includes('token')) {
        return { status: 'auth', message: 'Sessão expirada. Faça login novamente no OneDrive.' };
      }
      return { status: 'error', message: err?.message || 'Erro ao sincronizar com o OneDrive.' };
    }
  }

  private async pushToOneDrive(
    doc: DocumentState,
    docIdAtStart: string | undefined,
    revisionAtStart: number,
    contentToSave: string,
    titleToSave: string,
    nowFormatted: string
  ): Promise<SaveResult> {
    const itemId = doc.oneDriveItemId!;
    useAppStore.getState().setSyncStatus('saving');
    const preSyncSnapshot = saveRecentDocument({ ...doc }, 'sync').catch(() => []);
    try {
      let updatedItem = await saveOneDriveFile(itemId, contentToSave, doc.cloudETag);

      // Se o título local foi alterado (ex.: renomeado pela barra de abas), sincroniza o nome no OneDrive via PATCH
      if (
        titleToSave &&
        updatedItem.name &&
        updatedItem.name !== titleToSave &&
        typeof renameOneDriveFile === 'function'
      ) {
        updatedItem = await renameOneDriveFile(itemId, titleToSave);
      }

      await preSyncSnapshot;

      // Verifica se o usuário não trocou de documento enquanto o PUT/PATCH viajava
      const latest = useAppStore.getState().document;
      if (latest && latest.docId === docIdAtStart) {
        const isStillDirty = (latest.revision ?? 0) > revisionAtStart;
        const resolvedTitle =
          updatedItem.name && latest.title === titleToSave ? updatedItem.name : latest.title;

        const parsedCloudMs = updatedItem.lastModifiedDateTime
          ? Date.parse(updatedItem.lastModifiedDateTime)
          : NaN;

        useAppStore.getState().setDocument({
          title: resolvedTitle,
          sourceRevision: revisionAtStart,
          draftRevision: Math.max(latest.draftRevision ?? 0, revisionAtStart),
          isDirty: isStillDirty,
          lastSavedAt: nowFormatted,
          cloudLastModified: updatedItem.lastModifiedDateTime,
          cloudETag: updatedItem.eTag || null,
          lastModifiedAt: Number.isFinite(parsedCloudMs) ? parsedCloudMs : Date.now(),
        });
        useAppStore.getState().setSyncStatus('saved');

        const afterUpdate = useAppStore.getState().document;
        if (afterUpdate) {
          const updatedList = await saveRecentDocument({ ...afterUpdate }, 'sync');
          useAppStore.setState({ recentDocuments: updatedList });
        }
      }

      return {
        status: 'ok',
        message: 'Sincronizado com o OneDrive!',
        sourceRevision: revisionAtStart,
      };
    } catch (err: any) {
      await preSyncSnapshot;
      useAppStore.getState().setSyncStatus('error');
      const msg = String(err?.message || '');
      if (msg.includes('412') || err?.status === 412) {
        await saveRecentDocument({ ...doc }, 'conflict');
        try {
          const freshContent = await downloadOneDriveFile(itemId);
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
      return { status: 'error', message: err?.message || 'Erro ao sincronizar com o OneDrive.' };
    }
  }

  private async pullFromLocalHandle(
    doc: DocumentState,
    handle: any,
    docIdAtStart: string | undefined,
    revisionAtStart: number,
    contentToSave: string,
    titleToSave: string,
    nowFormatted: string
  ): Promise<SaveResult> {
    if (typeof handle.getFile !== 'function') {
      useAppStore.getState().setSyncStatus('saved');
      return {
        status: 'ok',
        message: 'Arquivo local já está sincronizado!',
        sourceRevision: doc.sourceRevision,
      };
    }

    useAppStore.getState().setSyncStatus('saving');
    try {
      const diskFile = await handle.getFile();
      const diskText = await diskFile.text();

      if (doc.content && doc.content !== diskText) {
        await saveRecentDocument({ ...doc, fileHandle: handle }, 'sync');
      }

      const latest = useAppStore.getState().document;
      if (latest && latest.docId === docIdAtStart) {
        if ((latest.revision ?? 0) > revisionAtStart && diskText !== contentToSave) {
          await saveRecentDocument({ ...latest, fileHandle: handle }, 'conflict');
          useAppStore.getState().setCloudConflict({
            cloudModified: new Date(diskFile.lastModified).toISOString(),
            cloudContent: diskText,
          });
          useAppStore.getState().setSyncStatus('idle');
          return {
            status: 'conflict',
            message: 'Conflito: o arquivo foi alterado externamente enquanto sincronizava.',
          };
        }

        const resolvedTitle = diskFile.name || latest.title;
        const hadChanges = diskText !== contentToSave || resolvedTitle !== titleToSave;
        const targetRev = hadChanges ? (latest.revision ?? 0) + 1 : (latest.revision ?? 0);

        useAppStore.getState().setDocument({
          title: resolvedTitle,
          content: diskText,
          revision: targetRev,
          sourceRevision: targetRev,
          draftRevision: Math.max(latest.draftRevision ?? 0, targetRev),
          isDirty: false,
          lastSavedAt: nowFormatted,
          localLastModified: diskFile.lastModified,
          lastModifiedAt: diskFile.lastModified,
          fileHandle: handle,
        });
        useAppStore.getState().setSyncStatus('saved');

        const afterUpdate = useAppStore.getState().document;
        if (afterUpdate) {
          const updatedList = await saveRecentDocument({ ...afterUpdate, fileHandle: handle }, 'sync');
          useAppStore.setState({ recentDocuments: updatedList });
        }

        return {
          status: 'ok',
          message: hadChanges
            ? 'Sincronizado: alterações externas carregadas do arquivo local!'
            : 'Arquivo local já está sincronizado!',
          sourceRevision: targetRev,
        };
      }

      return {
        status: 'ok',
        message: 'Arquivo local sincronizado!',
        sourceRevision: revisionAtStart,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        useAppStore.getState().setSyncStatus('idle');
        return { status: 'cancelled' };
      }
      useAppStore.getState().setSyncStatus('error');
      return {
        status: 'error',
        message: err?.message || 'Não foi possível ler o arquivo local.',
      };
    }
  }

  private async pushToLocalHandle(
    doc: DocumentState,
    handle: any,
    docIdAtStart: string | undefined,
    revisionAtStart: number,
    contentToSave: string,
    nowFormatted: string
  ): Promise<SaveResult> {
    try {
      // Detecção de alteração externa antes de gravar
      if (typeof handle.getFile === 'function') {
        try {
          const existingFile = await handle.getFile();
          if (doc.localLastModified && existingFile && existingFile.lastModified > doc.localLastModified + 1000) {
            const freshExternalContent = await existingFile.text();
            await saveRecentDocument({ ...doc, fileHandle: handle }, 'conflict');
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

      useAppStore.getState().setSyncStatus('saving');
      const preSyncSnapshot = saveRecentDocument({ ...doc, fileHandle: handle }, 'sync').catch(() => []);

      const writable = await handle.createWritable();
      await writable.write(contentToSave);
      await writable.close();

      await preSyncSnapshot;

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
          lastModifiedAt: newLocalModified,
          fileHandle: handle,
        });
        useAppStore.getState().setSyncStatus('saved');

        const afterUpdate = useAppStore.getState().document;
        if (afterUpdate) {
          const updatedList = await saveRecentDocument({ ...afterUpdate, fileHandle: handle }, 'sync');
          useAppStore.setState({ recentDocuments: updatedList });
        }
      }

      return {
        status: 'ok',
        message: 'Sincronizado com o arquivo local!',
        sourceRevision: revisionAtStart,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        useAppStore.getState().setSyncStatus('idle');
        return { status: 'cancelled' };
      }
      useAppStore.getState().setSyncStatus('error');
      return {
        status: 'error',
        message: err?.message || 'Não foi possível gravar no arquivo local.',
      };
    }
  }
}

export const saveCoordinator = new SaveCoordinator();
