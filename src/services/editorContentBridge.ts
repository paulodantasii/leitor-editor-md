/**
 * Bridge singleton for synchronizing pending editor changes with external consumers.
 * Allows components (Header, AutoSave, Cloud Sync, Export) to force an immediate
 * synchronization of the active ProseMirror document before reading markdown content.
 */

import { flushPendingLocalDocumentSave } from './storage';

type FlushHandler = () => void;

let registeredFlushHandler: FlushHandler | null = null;
let hasPendingChanges = false;

/**
 * Registers the active editor's flush routine.
 * Returns an unregister cleanup function.
 */
export function registerEditorFlushHandler(handler: FlushHandler): () => void {
  registeredFlushHandler = handler;
  return () => {
    if (registeredFlushHandler === handler) {
      registeredFlushHandler = null;
      hasPendingChanges = false;
    }
  };
}

/**
 * Notifies the bridge that unpersisted document changes are pending in the editor.
 */
export function markBridgeDirty(): void {
  hasPendingChanges = true;
}

/**
 * Notifies the bridge that pending changes have been successfully committed.
 */
export function markBridgeClean(): void {
  hasPendingChanges = false;
}

/**
 * Checks whether the editor currently has uncommitted in-memory changes.
 */
export function hasPendingBridgeChanges(): boolean {
  return hasPendingChanges;
}

/**
 * Immediately flushes any pending debounced editor content to the store and storage.
 * Safe to call even if no editor is mounted or no changes are pending.
 */
export function flushPendingEditorContent(): void {
  if (registeredFlushHandler && hasPendingChanges) {
    try {
      registeredFlushHandler();
    } catch (error) {
      console.error('Falha ao descarregar conteúdo pendente do editor:', error);
    }
  }

  // Also ensure pending coalesced storage I/O is synchronously committed
  try {
    flushPendingLocalDocumentSave();
  } catch (error) {
    console.error('Falha ao sincronizar persistência pendente no disco:', error);
  }
}
