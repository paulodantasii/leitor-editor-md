import { create } from 'zustand';
import {
  UserPreferences,
  HighlightColor,
  SyncStatus,
  DocumentState,
  UserProfile,
  RecentDocumentItem,
  TabItem,
  OpenTabsSession,
} from '../types';
import {
  loadUserPreferences,
  saveUserPreferences,
  loadLocalDocument,
  saveLocalDocument,
  clearLocalDocument,
  saveOpenTabsSession,
  loadOpenTabsSession,
  clearOpenTabsSession,
} from '../services/storage';
import {
  getRecentDocuments,
  saveRecentDocument,
  deleteRecentDocument as deleteRecentFromDb,
  loadRecentDocumentWithCloudSync,
  cleanupBlankRecentDocuments,
} from '../services/recentDocumentsService';
import { isBlankUntitledDocument } from '../services/documentUtils';
import { flushPendingEditorContent } from '../services/editorContentBridge';
import { SAMPLE_LEGISLATION_DOC } from '../components/sampleDocs';
import { renameOneDriveFile } from '../services/oneDriveService';

interface AppState {
  // Preferences
  preferences: UserPreferences;
  setPreferences: (updater: Partial<UserPreferences> | ((prev: UserPreferences) => UserPreferences)) => void;

  // Tab Management
  tabs: TabItem[];
  activeTabId: string | null;
  openTab: (doc: Partial<DocumentState> & { title: string; content?: string }, fileHandle?: any) => string;
  switchTab: (tabId: string) => Promise<void>;
  closeTab: (tabId: string, forceWithoutSaving?: boolean) => void;
  renameTab: (tabId: string, newTitle: string) => void;

  // Editor Modes
  isHighlightMode: boolean;
  setIsHighlightMode: (active: boolean) => void;
  toggleHighlightMode: () => void;
  activeHighlightColor: HighlightColor;
  setActiveHighlightColor: (color: HighlightColor) => void;
  isEditable: boolean;
  setIsEditable: (editable: boolean) => void;

  // Document State
  document: DocumentState | null;
  setDocument: (doc: Partial<DocumentState>) => void;
  updateDocumentContent: (content: string) => void;
  markDocumentDirty: () => void;
  loadCachedDocument: () => Promise<void>;
  createNewDocument: () => void;
  closeDocument: () => void;

  // Recent Documents (up to 30 files in cache)
  recentDocuments: RecentDocumentItem[];
  loadRecentDocuments: () => Promise<void>;
  openRecentDocument: (item: RecentDocumentItem) => Promise<{ success: boolean; updatedFromCloud: boolean; warning?: string }>;
  deleteRecentDocument: (id: string) => Promise<void>;

  // Highlights Counter
  highlightCount: number;
  setHighlightCount: (count: number) => void;

  // Sync & Cloud
  syncStatus: SyncStatus;
  setSyncStatus: (status: SyncStatus) => void;
  userProfile: UserProfile | null;
  setUserProfile: (profile: UserProfile | null) => void;
  syncNotification: string | null;
  setSyncNotification: (msg: string | null) => void;
  cloudConflict: { cloudModified: string; cloudContent: string } | null;
  setCloudConflict: (conflict: { cloudModified: string; cloudContent: string } | null) => void;

  // File Handle for Direct Overwrite Saving
  fileHandle: any | null;
  setFileHandle: (handle: any | null) => void;

  // Modals
  isOneDriveModalOpen: boolean;
  oneDriveModalMode: 'open' | 'save_as';
  oneDriveSuccessAction: 'close' | null;
  setIsOneDriveModalOpen: (open: boolean, mode?: 'open' | 'save_as', successAction?: 'close' | null) => void;
  setOneDriveSuccessAction: (action: 'close' | null) => void;
  isSaveDestinationModalOpen: boolean;
  setIsSaveDestinationModalOpen: (open: boolean) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;
  isRecentModalOpen: boolean;
  setIsRecentModalOpen: (open: boolean) => void;
  isInstallModalOpen: boolean;
  setIsInstallModalOpen: (open: boolean) => void;
}

const initialPreferences = loadUserPreferences();

const getInitialDoc = (): DocumentState | null => {
  const cached = loadLocalDocument();
  // Ignora (e descarta) "Sem Título.md" em branco herdado de versões antigas
  if (cached && isBlankUntitledDocument(cached)) {
    try {
      localStorage.removeItem('leitor_md_document');
    } catch {
      // ignore
    }
    return null;
  } else if (cached && (cached.content !== undefined || cached.title)) {
    const rev = cached.revision ?? (cached.isDirty ? 1 : 0);
    const srcRev = cached.sourceRevision ?? (cached.isDirty ? 0 : rev);
    const draftRev = cached.draftRevision ?? rev;
    return {
      ...cached,
      revision: rev,
      sourceRevision: srcRev,
      draftRevision: draftRev,
      isDirty: rev > srcRev,
      docId: cached.docId || 'doc-initial',
    };
  }
  return null;
};

const initialDoc: DocumentState | null = getInitialDoc();
const savedSession = loadOpenTabsSession();

let initialTabs: TabItem[] = [];
let initialActiveTabId: string | null = null;

if (savedSession && savedSession.tabs && savedSession.tabs.length > 0) {
  initialActiveTabId = savedSession.activeTabId || savedSession.tabs[0].id;
  initialTabs = savedSession.tabs.map((t) => {
    const isCurActive = t.id === initialActiveTabId;
    return {
      id: t.id,
      title: t.title,
      isDirty: t.isDirty,
      docId: t.docId,
      oneDriveItemId: t.oneDriveItemId,
      fileHandle: isCurActive && initialDoc ? initialDoc.fileHandle || null : null,
      snapshot: isCurActive && initialDoc ? initialDoc : undefined,
    };
  });
} else if (initialDoc) {
  const tabId = 'tab-initial';
  initialTabs = [
    {
      id: tabId,
      title: initialDoc.title,
      isDirty: initialDoc.isDirty,
      docId: initialDoc.docId || 'doc-initial',
      oneDriveItemId: initialDoc.oneDriveItemId,
      fileHandle: initialDoc.fileHandle || null,
      snapshot: initialDoc,
    },
  ];
  initialActiveTabId = tabId;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Preferences
  preferences: initialPreferences,
  setPreferences: (updater) => {
    set((state) => {
      const newPrefs = typeof updater === 'function' ? updater(state.preferences) : { ...state.preferences, ...updater };
      saveUserPreferences(newPrefs);
      return { preferences: newPrefs };
    });
  },

  // Tab Management
  tabs: initialTabs,
  activeTabId: initialActiveTabId,

  openTab: (doc, fileHandle) => {
    const state = get();

    // 1. Verifica se já existe aba aberta com o mesmo arquivo (OneDrive ou handle/docId idêntico)
    const existingTab = state.tabs.find((t) => {
      if (doc.oneDriveItemId && t.oneDriveItemId && doc.oneDriveItemId === t.oneDriveItemId) {
        return true;
      }
      if (doc.docId && t.docId && doc.docId === t.docId) {
        return true;
      }
      if (fileHandle && t.fileHandle && fileHandle === t.fileHandle) {
        return true;
      }
      if (fileHandle && t.fileHandle && fileHandle.name && t.fileHandle.name && fileHandle.name === t.fileHandle.name && doc.title === t.title) {
        return true;
      }
      return false;
    });

    if (existingTab) {
      get().switchTab(existingTab.id);
      get().setSyncNotification('Arquivo já está aberto nesta aba');
      return existingTab.id;
    }

    // 2. Se o documento ativo for um rascunho em branco sem título e sem conteúdo, reutiliza a aba ativa
    const isCurrentBlank =
      state.document &&
      isBlankUntitledDocument(state.document) &&
      (!state.document.content || state.document.content.trim() === '') &&
      !state.document.isDirty;

    const targetDocId = doc.docId || `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const rev = doc.revision ?? (doc.isDirty ? 1 : 0);
    const srcRev = doc.sourceRevision ?? (doc.isDirty ? 0 : rev);
    const draftRev = doc.draftRevision ?? rev;

    const normalizedDoc: DocumentState = {
      title: doc.title,
      content: doc.content ?? '',
      oneDriveItemId: doc.oneDriveItemId ?? null,
      lastSavedAt: doc.lastSavedAt ?? null,
      isDirty: doc.isDirty ?? false,
      revision: rev,
      sourceRevision: srcRev,
      draftRevision: draftRev,
      docId: targetDocId,
      cloudLastModified: doc.cloudLastModified ?? null,
      cloudETag: doc.cloudETag ?? null,
      localLastModified: doc.localLastModified ?? null,
      fileHandle: fileHandle || doc.fileHandle || null,
    };

    if (isCurrentBlank && state.activeTabId) {
      const updatedDoc = normalizedDoc;
      const updatedTabs = state.tabs.map((t) =>
        t.id === state.activeTabId
          ? {
              ...t,
              title: updatedDoc.title,
              isDirty: updatedDoc.isDirty,
              docId: targetDocId,
              oneDriveItemId: updatedDoc.oneDriveItemId,
              fileHandle: updatedDoc.fileHandle,
              snapshot: updatedDoc,
            }
          : t
      );
      set({
        tabs: updatedTabs,
        document: updatedDoc,
        fileHandle: updatedDoc.fileHandle,
        syncStatus: updatedDoc.isDirty ? 'idle' : 'saved',
        syncNotification: null,
        cloudConflict: null,
      });
      saveLocalDocument(updatedDoc);
      saveOpenTabsSession({
        activeTabId: state.activeTabId,
        tabs: updatedTabs.map((t) => ({
          id: t.id,
          title: t.title,
          docId: t.docId,
          oneDriveItemId: t.oneDriveItemId || null,
          isDirty: t.isDirty,
        })),
      });
      return state.activeTabId;
    }

    // 3. Caso contrário, descarrega o editor atual e adiciona nova aba
    flushPendingEditorContent();
    const currentDoc = get().document;
    const currentHandle = get().fileHandle;

    const tabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newDoc = normalizedDoc;

    const newTab: TabItem = {
      id: tabId,
      title: newDoc.title,
      isDirty: newDoc.isDirty,
      docId: targetDocId,
      oneDriveItemId: newDoc.oneDriveItemId,
      fileHandle: newDoc.fileHandle,
      snapshot: newDoc,
    };

    const updatedTabs = state.tabs.map((t) => {
      if (t.id === state.activeTabId && currentDoc) {
        return {
          ...t,
          title: currentDoc.title,
          isDirty: currentDoc.isDirty,
          fileHandle: currentHandle,
          snapshot: { ...currentDoc, fileHandle: currentHandle },
        };
      }
      return t;
    });

    const nextTabs = [...updatedTabs, newTab];

    set({
      tabs: nextTabs,
      activeTabId: tabId,
      document: newDoc,
      fileHandle: fileHandle || doc.fileHandle || null,
      syncStatus: doc.isDirty ? 'idle' : 'saved',
      syncNotification: null,
      cloudConflict: null,
    });

    saveLocalDocument(newDoc);
    saveOpenTabsSession({
      activeTabId: tabId,
      tabs: nextTabs.map((t) => ({
        id: t.id,
        title: t.title,
        docId: t.docId,
        oneDriveItemId: t.oneDriveItemId || null,
        isDirty: t.isDirty,
      })),
    });

    return tabId;
  },

  switchTab: async (tabId: string) => {
    const state = get();
    if (tabId === state.activeTabId) return;

    flushPendingEditorContent();
    const currentDoc = get().document;
    const currentHandle = get().fileHandle;

    const updatedTabs = get().tabs.map((t) => {
      if (t.id === state.activeTabId && currentDoc) {
        return {
          ...t,
          title: currentDoc.title,
          isDirty: currentDoc.isDirty,
          fileHandle: currentHandle,
          snapshot: { ...currentDoc, fileHandle: currentHandle },
        };
      }
      return t;
    });

    const targetTab = updatedTabs.find((t) => t.id === tabId);
    if (!targetTab) return;

    let targetDoc: DocumentState | null = targetTab.snapshot || null;
    let targetHandle = targetTab.fileHandle || null;

    if (!targetDoc) {
      try {
        const recents = await getRecentDocuments();
        const match = recents.find(
          (r) =>
            (targetTab.oneDriveItemId && r.oneDriveItemId === targetTab.oneDriveItemId) ||
            r.id === targetTab.docId ||
            r.title === targetTab.title
        );
        if (match) {
          targetDoc = {
            title: match.title,
            content: match.content,
            oneDriveItemId: match.oneDriveItemId,
            lastSavedAt: match.lastSavedAt,
            isDirty: targetTab.isDirty,
            revision: match.revision ?? 0,
            draftRevision: match.draftRevision ?? 0,
            sourceRevision: match.sourceRevision ?? 0,
            docId: targetTab.docId,
            cloudLastModified: match.cloudLastModified,
            cloudETag: match.cloudETag,
            localLastModified: match.localLastModified,
            fileHandle: match.fileHandle,
          };
          targetHandle = match.fileHandle || null;
        }
      } catch (err) {
        console.warn('Erro ao restaurar documento da aba do IndexedDB:', err);
      }
    }

    if (!targetDoc) {
      targetDoc = {
        title: targetTab.title,
        content: '',
        oneDriveItemId: targetTab.oneDriveItemId || null,
        lastSavedAt: null,
        isDirty: targetTab.isDirty,
        revision: 0,
        draftRevision: 0,
        sourceRevision: 0,
        docId: targetTab.docId,
      };
    }

    const finalTabs = updatedTabs.map((t) =>
      t.id === tabId ? { ...t, snapshot: targetDoc!, fileHandle: targetHandle } : t
    );

    set({
      tabs: finalTabs,
      activeTabId: tabId,
      document: targetDoc,
      fileHandle: targetHandle,
      syncStatus: targetDoc.isDirty ? 'idle' : 'saved',
      syncNotification: null,
      cloudConflict: null,
    });

    saveLocalDocument(targetDoc);
    saveOpenTabsSession({
      activeTabId: tabId,
      tabs: finalTabs.map((t) => ({
        id: t.id,
        title: t.title,
        docId: t.docId,
        oneDriveItemId: t.oneDriveItemId || null,
        isDirty: t.isDirty,
      })),
    });
  },

  closeTab: (tabId: string, forceWithoutSaving?: boolean) => {
    const state = get();
    const tabToClose = state.tabs.find((t) => t.id === tabId);
    if (!tabToClose) return;

    if (!forceWithoutSaving && tabToClose.isDirty) {
      return;
    }

    const tabIndex = state.tabs.findIndex((t) => t.id === tabId);
    const remainingTabs = state.tabs.filter((t) => t.id !== tabId);

    if (remainingTabs.length === 0) {
      clearLocalDocument();
      clearOpenTabsSession();
      set({
        tabs: [],
        activeTabId: null,
        document: null,
        fileHandle: null,
        isEditable: false,
        isHighlightMode: false,
        highlightCount: 0,
        syncStatus: 'idle',
        syncNotification: null,
        cloudConflict: null,
      });
      return;
    }

    if (state.activeTabId === tabId) {
      const nextIndex = tabIndex < remainingTabs.length ? tabIndex : remainingTabs.length - 1;
      const nextTab = remainingTabs[nextIndex];

      const nextDoc: DocumentState = nextTab.snapshot || {
        title: nextTab.title,
        content: '',
        oneDriveItemId: nextTab.oneDriveItemId || null,
        lastSavedAt: null,
        isDirty: nextTab.isDirty,
        revision: 0,
        draftRevision: 0,
        sourceRevision: 0,
        docId: nextTab.docId,
      };

      set({
        tabs: remainingTabs,
        activeTabId: nextTab.id,
        document: nextDoc,
        fileHandle: nextTab.fileHandle || null,
        syncStatus: nextDoc.isDirty ? 'idle' : 'saved',
        syncNotification: null,
        cloudConflict: null,
      });

      saveLocalDocument(nextDoc);
      saveOpenTabsSession({
        activeTabId: nextTab.id,
        tabs: remainingTabs.map((t) => ({
          id: t.id,
          title: t.title,
          docId: t.docId,
          oneDriveItemId: t.oneDriveItemId || null,
          isDirty: t.isDirty,
        })),
      });
    } else {
      set({ tabs: remainingTabs });
      saveOpenTabsSession({
        activeTabId: state.activeTabId,
        tabs: remainingTabs.map((t) => ({
          id: t.id,
          title: t.title,
          docId: t.docId,
          oneDriveItemId: t.oneDriveItemId || null,
          isDirty: t.isDirty,
        })),
      });
    }
  },

  renameTab: (tabId: string, newTitle: string) => {
    let finalTitle = newTitle.trim();
    if (!finalTitle) {
      finalTitle = 'Sem Título.md';
    } else if (
      !finalTitle.toLowerCase().endsWith('.md') &&
      !finalTitle.toLowerCase().endsWith('.markdown') &&
      !finalTitle.toLowerCase().endsWith('.txt')
    ) {
      finalTitle = `${finalTitle}.md`;
    }

    const state = get();
    const targetTab = state.tabs.find((t) => t.id === tabId);
    if (targetTab && targetTab.title === finalTitle) {
      return;
    }

    const isActive = state.activeTabId === tabId;
    const currentDoc = state.document;

    const nextTabs = state.tabs.map((t) => {
      if (t.id === tabId) {
        const nextRev = (t.snapshot?.revision ?? 0) + 1;
        const snap = t.snapshot
          ? { ...t.snapshot, title: finalTitle, isDirty: true, revision: nextRev }
          : undefined;
        return {
          ...t,
          title: finalTitle,
          isDirty: true,
          snapshot: snap,
        };
      }
      return t;
    });

    if (isActive && currentDoc) {
      const updatedDoc: DocumentState = {
        ...currentDoc,
        title: finalTitle,
        isDirty: true,
        revision: (currentDoc.revision ?? 0) + 1,
      };
      let newHandle = state.fileHandle;
      if (newHandle && newHandle.name !== finalTitle) {
        newHandle = null;
      }
      const syncedTabs = nextTabs.map((t) =>
        t.id === tabId ? { ...t, snapshot: updatedDoc, fileHandle: newHandle } : t
      );
      set({
        tabs: syncedTabs,
        document: updatedDoc,
        fileHandle: newHandle,
      });
      saveLocalDocument(updatedDoc);
      saveRecentDocument(updatedDoc)
        .then((list) => set({ recentDocuments: list }))
        .catch(() => {});
    } else {
      set({ tabs: nextTabs });

      // Se renomeou uma aba em segundo plano conectada ao OneDrive e está online, sincroniza o nome no OneDrive
      if (
        targetTab?.oneDriveItemId &&
        typeof navigator !== 'undefined' &&
        navigator.onLine &&
        typeof renameOneDriveFile === 'function'
      ) {
        renameOneDriveFile(targetTab.oneDriveItemId, finalTitle)
          .then(async (renamedItem) => {
            const resolvedName = renamedItem.name || finalTitle;
            const currentTabs = get().tabs.map((t) => {
              if (t.id !== tabId) return t;
              const snapRev = t.snapshot?.revision ?? 1;
              const updatedSnap = t.snapshot
                ? {
                    ...t.snapshot,
                    title: resolvedName,
                    isDirty: false,
                    sourceRevision: snapRev,
                    cloudLastModified: renamedItem.lastModifiedDateTime,
                    cloudETag: renamedItem.eTag || null,
                  }
                : undefined;
              return {
                ...t,
                title: resolvedName,
                isDirty: false,
                snapshot: updatedSnap,
              };
            });
            set({ tabs: currentTabs });
            saveOpenTabsSession({
              activeTabId: get().activeTabId,
              tabs: currentTabs.map((t) => ({
                id: t.id,
                title: t.title,
                docId: t.docId,
                oneDriveItemId: t.oneDriveItemId || null,
                isDirty: t.isDirty,
              })),
            });
            const savedSnap = currentTabs.find((t) => t.id === tabId)?.snapshot;
            if (savedSnap) {
              const list = await saveRecentDocument(savedSnap);
              set({ recentDocuments: list });
            }
          })
          .catch(() => {
            // Se falhar, permanece com isDirty: true para sincronizar quando a aba for focada
          });
      }
    }

    saveOpenTabsSession({
      activeTabId: state.activeTabId,
      tabs: nextTabs.map((t) => ({
        id: t.id,
        title: t.title,
        docId: t.docId,
        oneDriveItemId: t.oneDriveItemId || null,
        isDirty: t.isDirty,
      })),
    });
  },

  // Highlight & Editing Mode (Mutually exclusive: enabling Editing mode automatically disables Highlight mode)
  isHighlightMode: false,
  setIsHighlightMode: (active) =>
    set((state) => ({
      isHighlightMode: active,
      ...(active ? { isEditable: false } : {}),
    })),
  toggleHighlightMode: () =>
    set((state) => {
      const nextActive = !state.isHighlightMode;
      return {
        isHighlightMode: nextActive,
        ...(nextActive ? { isEditable: false } : {}),
      };
    }),
  activeHighlightColor: 'yellow',
  setActiveHighlightColor: (color) => set({ activeHighlightColor: color }),
  isEditable: false, // Default to Reading mode as specified
  setIsEditable: (editable) =>
    set((state) => ({
      isEditable: editable,
      ...(editable ? { isHighlightMode: false } : {}),
    })),

  // Document State
  document: initialDoc,
  setDocument: (docPartial) => {
    set((state) => {
      const currentDoc = state.document || {
        title: 'Sem Título.md',
        content: '',
        oneDriveItemId: null,
        lastSavedAt: null,
        isDirty: false,
        revision: 0,
        draftRevision: 0,
        sourceRevision: 0,
        docId: `doc-${Date.now()}`,
      };
      const isNewContent = docPartial.content !== undefined && docPartial.content !== currentDoc.content;
      const isNewTitle = docPartial.title !== undefined && docPartial.title !== currentDoc.title;

      let revision = docPartial.revision !== undefined
        ? docPartial.revision
        : (isNewContent || isNewTitle ? (currentDoc.revision ?? 0) + 1 : (currentDoc.revision ?? 0));

      let sourceRevision = docPartial.sourceRevision !== undefined
        ? docPartial.sourceRevision
        : (currentDoc.sourceRevision ?? 0);

      let draftRevision = docPartial.draftRevision !== undefined
        ? docPartial.draftRevision
        : (currentDoc.draftRevision ?? 0);

      if (docPartial.isDirty === false && docPartial.sourceRevision === undefined) {
        sourceRevision = revision;
      }

      const isDirty = docPartial.isDirty !== undefined
        ? docPartial.isDirty
        : revision > sourceRevision;

      const updated: DocumentState = {
        ...currentDoc,
        ...docPartial,
        revision,
        sourceRevision,
        draftRevision,
        isDirty,
        ...(isNewContent && !docPartial.docId
          ? { docId: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}` }
          : {}),
      };
      saveLocalDocument(updated);

      let updatedTabs = state.tabs;
      if (state.activeTabId) {
        updatedTabs = state.tabs.map((t) =>
          t.id === state.activeTabId
            ? {
                ...t,
                title: updated.title,
                isDirty: updated.isDirty,
                docId: updated.docId || t.docId,
                oneDriveItemId: updated.oneDriveItemId !== undefined ? updated.oneDriveItemId : t.oneDriveItemId,
                fileHandle: state.fileHandle,
                snapshot: updated,
              }
            : t
        );
      } else {
        const newTabId = 'tab-' + Date.now();
        const newTab: TabItem = {
          id: newTabId,
          title: updated.title,
          isDirty: updated.isDirty,
          docId: updated.docId || 'doc-initial',
          oneDriveItemId: updated.oneDriveItemId,
          fileHandle: state.fileHandle,
          snapshot: updated,
        };
        updatedTabs = [newTab];
        saveOpenTabsSession({
          activeTabId: newTabId,
          tabs: updatedTabs.map((t) => ({
            id: t.id,
            title: t.title,
            docId: t.docId,
            oneDriveItemId: t.oneDriveItemId || null,
            isDirty: t.isDirty,
          })),
        });
        return { document: updated, tabs: updatedTabs, activeTabId: newTabId };
      }

      saveOpenTabsSession({
        activeTabId: state.activeTabId,
        tabs: updatedTabs.map((t) => ({
          id: t.id,
          title: t.title,
          docId: t.docId,
          oneDriveItemId: t.oneDriveItemId || null,
          isDirty: t.isDirty,
        })),
      });

      return { document: updated, tabs: updatedTabs };
    });
  },
  updateDocumentContent: (content) => {
    set((state) => {
      if (!state.document) return state;
      const newRevision = (state.document.revision ?? 0) + 1;
      const sourceRev = state.document.sourceRevision ?? 0;
      const updated: DocumentState = {
        ...state.document,
        content,
        revision: newRevision,
        isDirty: newRevision > sourceRev,
      };
      saveLocalDocument(updated);

      const updatedTabs = state.tabs.map((t) =>
        t.id === state.activeTabId
          ? {
              ...t,
              isDirty: updated.isDirty,
              snapshot: updated,
            }
          : t
      );

      saveOpenTabsSession({
        activeTabId: state.activeTabId,
        tabs: updatedTabs.map((t) => ({
          id: t.id,
          title: t.title,
          docId: t.docId,
          oneDriveItemId: t.oneDriveItemId || null,
          isDirty: t.isDirty,
        })),
      });

      return { document: updated, tabs: updatedTabs };
    });
  },
  markDocumentDirty: () => {
    set((state) => {
      if (!state.document) return state;
      const newRevision = (state.document.revision ?? 0) + 1;
      const updated: DocumentState = {
        ...state.document,
        revision: newRevision,
        isDirty: true,
      };
      const updatedTabs = state.tabs.map((t) =>
        t.id === state.activeTabId
          ? {
              ...t,
              isDirty: true,
              snapshot: updated,
            }
          : t
      );
      return {
        document: updated,
        tabs: updatedTabs,
      };
    });
  },
  closeDocument: () => {
    clearLocalDocument();
    clearOpenTabsSession();
    set({
      tabs: [],
      activeTabId: null,
      document: null,
      fileHandle: null,
      isEditable: false,
      isHighlightMode: false,
      highlightCount: 0,
      syncStatus: 'idle',
      syncNotification: null,
      cloudConflict: null,
    });
  },
  loadCachedDocument: async () => {
    const loaded = loadLocalDocument();
    if (loaded && !isBlankUntitledDocument(loaded)) {
      const rev = loaded.revision ?? 0;
      const srcRev = loaded.sourceRevision ?? rev;
      get().openTab(
        {
          ...loaded,
          revision: rev,
          sourceRevision: srcRev,
          draftRevision: loaded.draftRevision ?? rev,
          docId: loaded.docId || `doc-${Date.now()}`,
        },
        loaded.fileHandle || null
      );
      return;
    }

    try {
      const recents = await getRecentDocuments();
      if (recents.length > 0) {
        await get().openRecentDocument(recents[0]);
        return;
      }
    } catch {
      // ignore
    }

    get().openTab({
      title: 'Constituição Federal - Amostra Vade Mecum.md',
      content: SAMPLE_LEGISLATION_DOC,
      oneDriveItemId: null,
      lastSavedAt: null,
      isDirty: false,
      revision: 0,
      draftRevision: 0,
      sourceRevision: 0,
      docId: 'doc-sample',
    });
  },
  createNewDocument: () => {
    // Documento efêmero: NÃO é gravado no localStorage nem no histórico enquanto estiver vazio.
    // Passa a ser persistido automaticamente na primeira edição com conteúdo significativo ou ao ser renomeado/salvo.
    const newDoc: DocumentState = {
      title: 'Sem Título.md',
      content: '',
      oneDriveItemId: null,
      lastSavedAt: null,
      isDirty: false,
      revision: 0,
      draftRevision: 0,
      sourceRevision: 0,
      docId: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };
    get().openTab(newDoc);
    set({
      fileHandle: null,
      highlightCount: 0,
      isEditable: true, // Já abre em modo de edição para digitar direto
      isHighlightMode: false,
    });
  },

  // Recent Documents (up to 30 files in cache)
  recentDocuments: [],
  loadRecentDocuments: async () => {
    try {
      await cleanupBlankRecentDocuments();
      const list = await getRecentDocuments();
      set({ recentDocuments: list });
    } catch (err) {
      console.warn('Erro ao carregar lista de documentos recentes:', err);
    }
  },
  openRecentDocument: async (item: RecentDocumentItem) => {
    try {
      set({ syncStatus: 'saving' });
      const { doc, updatedFromCloud, warning } = await loadRecentDocumentWithCloudSync(item);

      get().openTab(doc, doc.fileHandle || null);

      set({
        syncStatus: updatedFromCloud ? 'saved' : 'idle',
        highlightCount: 0,
      });

      // Refresh recent list to update last opened order
      const refreshed = await getRecentDocuments();
      set({ recentDocuments: refreshed });

      return { success: true, updatedFromCloud, warning };
    } catch (err: any) {
      set({ syncStatus: 'error' });
      console.error('Falha ao abrir documento recente:', err);
      return { success: false, updatedFromCloud: false, warning: err.message || 'Falha ao carregar documento' };
    }
  },
  deleteRecentDocument: async (id: string) => {
    try {
      const updated = await deleteRecentFromDb(id);
      set({ recentDocuments: updated });
    } catch (err) {
      console.error('Falha ao remover documento do histórico:', err);
    }
  },

  // Highlights Counter
  highlightCount: 0,
  setHighlightCount: (count) => set({ highlightCount: count }),

  // Sync & Cloud
  syncStatus: 'idle',
  setSyncStatus: (status) => set({ syncStatus: status }),
  userProfile: null,
  setUserProfile: (profile) => set({ userProfile: profile }),
  syncNotification: null,
  setSyncNotification: (msg) => set({ syncNotification: msg }),
  cloudConflict: null,
  setCloudConflict: (conflict) => set({ cloudConflict: conflict }),

  // File Handle for Direct Overwrite Saving
  fileHandle: null,
  setFileHandle: (handle) => set({ fileHandle: handle }),

  // Modals
  isOneDriveModalOpen: false,
  oneDriveModalMode: 'open',
  oneDriveSuccessAction: null,
  setIsOneDriveModalOpen: (open, mode = 'open', successAction = null) =>
    set((state) => ({
      isOneDriveModalOpen: open,
      oneDriveModalMode: open ? mode : state.oneDriveModalMode,
      oneDriveSuccessAction: open ? successAction : null,
    })),
  setOneDriveSuccessAction: (action) => set({ oneDriveSuccessAction: action }),
  isSaveDestinationModalOpen: false,
  setIsSaveDestinationModalOpen: (open) => set({ isSaveDestinationModalOpen: open }),
  isSettingsModalOpen: false,
  setIsSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
  isRecentModalOpen: false,
  setIsRecentModalOpen: (open) => set({ isRecentModalOpen: open }),
  isInstallModalOpen: false,
  setIsInstallModalOpen: (open) => set({ isInstallModalOpen: open }),
}));
