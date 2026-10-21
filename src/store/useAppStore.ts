import { create } from 'zustand';
import {
  UserPreferences,
  HighlightColor,
  SyncStatus,
  DocumentState,
  UserProfile,
  RecentDocumentItem,
} from '../types';
import {
  loadUserPreferences,
  saveUserPreferences,
  loadLocalDocument,
  saveLocalDocument,
  clearLocalDocument,
} from '../services/storage';
import {
  getRecentDocuments,
  saveRecentDocument,
  deleteRecentDocument as deleteRecentFromDb,
  loadRecentDocumentWithCloudSync,
  cleanupBlankRecentDocuments,
} from '../services/recentDocumentsService';
import { isBlankUntitledDocument } from '../services/documentUtils';
import { SAMPLE_LEGISLATION_DOC } from '../components/sampleDocs';

interface AppState {
  // Preferences
  preferences: UserPreferences;
  setPreferences: (updater: Partial<UserPreferences> | ((prev: UserPreferences) => UserPreferences)) => void;

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
  loadCachedDocument: () => void;
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
      return { document: updated };
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
      return { document: updated };
    });
  },
  markDocumentDirty: () => {
    set((state) => {
      if (!state.document) return state;
      const newRevision = (state.document.revision ?? 0) + 1;
      return {
        document: {
          ...state.document,
          revision: newRevision,
          isDirty: true,
        },
      };
    });
  },
  closeDocument: () => {
    clearLocalDocument();
    set({
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
      set({
        document: {
          ...loaded,
          revision: rev,
          sourceRevision: srcRev,
          draftRevision: loaded.draftRevision ?? rev,
          docId: loaded.docId || `doc-${Date.now()}`,
        },
        fileHandle: loaded.fileHandle || null,
      });
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

    set({
      document: {
        title: 'Constituição Federal - Amostra Vade Mecum.md',
        content: SAMPLE_LEGISLATION_DOC,
        oneDriveItemId: null,
        lastSavedAt: null,
        isDirty: false,
        revision: 0,
        draftRevision: 0,
        sourceRevision: 0,
        docId: 'doc-sample',
      },
      fileHandle: null,
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
    set({
      document: newDoc,
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

      set({
        document: doc,
        fileHandle: doc.fileHandle || null,
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
}));
