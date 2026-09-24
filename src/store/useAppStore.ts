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
} from '../services/storage';
import {
  getRecentDocuments,
  saveRecentDocument,
  deleteRecentDocument as deleteRecentFromDb,
  loadRecentDocumentWithCloudSync,
} from '../services/recentDocumentsService';
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
  document: DocumentState;
  setDocument: (doc: Partial<DocumentState>) => void;
  updateDocumentContent: (content: string) => void;
  loadCachedDocument: () => void;
  createNewDocument: () => void;

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

  // File Handle for Direct Overwrite Saving
  fileHandle: any | null;
  setFileHandle: (handle: any | null) => void;

  // Modals
  isOneDriveModalOpen: boolean;
  setIsOneDriveModalOpen: (open: boolean) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;
  isRecentModalOpen: boolean;
  setIsRecentModalOpen: (open: boolean) => void;
}

const initialPreferences = loadUserPreferences();

const getInitialDoc = (): DocumentState => {
  const cached = loadLocalDocument();
  if (cached && (cached.content !== undefined || cached.title)) {
    return { ...cached, docId: cached.docId || 'doc-initial' };
  }
  return {
    title: 'Constituição Federal - Amostra Vade Mecum.md',
    content: SAMPLE_LEGISLATION_DOC,
    oneDriveItemId: null,
    lastSavedAt: null,
    isDirty: false,
    docId: 'doc-sample',
  };
};

const initialDoc: DocumentState = getInitialDoc();

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
      const isNewContent = docPartial.content !== undefined && docPartial.content !== state.document.content;
      const updated = {
        ...state.document,
        ...docPartial,
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
      const updated = { ...state.document, content, isDirty: true };
      saveLocalDocument(updated);
      return { document: updated };
    });
  },
  loadCachedDocument: () => {
    const cached = loadLocalDocument() || {
      title: 'Constituição Federal - Amostra Vade Mecum.md',
      content: SAMPLE_LEGISLATION_DOC,
      oneDriveItemId: null,
      lastSavedAt: null,
      isDirty: false,
      docId: 'doc-sample',
    };
    set({ document: { ...cached, docId: cached.docId || `doc-${Date.now()}` } });
  },
  createNewDocument: () => {
    const newDoc: DocumentState = {
      title: 'Sem Título.md',
      content: '',
      oneDriveItemId: null,
      lastSavedAt: new Date().toLocaleTimeString(),
      isDirty: false,
      docId: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };
    set({
      document: newDoc,
      fileHandle: null,
      highlightCount: 0,
      isEditable: true, // Já abre em modo de edição para digitar direto
      isHighlightMode: false,
    });
    saveLocalDocument(newDoc);
  },

  // Recent Documents (up to 30 files in cache)
  recentDocuments: [],
  loadRecentDocuments: async () => {
    try {
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
        fileHandle: null,
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

  // File Handle for Direct Overwrite Saving
  fileHandle: null,
  setFileHandle: (handle) => set({ fileHandle: handle }),

  // Modals
  isOneDriveModalOpen: false,
  setIsOneDriveModalOpen: (open) => set({ isOneDriveModalOpen: open }),
  isSettingsModalOpen: false,
  setIsSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
  isRecentModalOpen: false,
  setIsRecentModalOpen: (open) => set({ isRecentModalOpen: open }),
}));
