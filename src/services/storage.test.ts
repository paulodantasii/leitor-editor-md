import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveLocalDocument,
  flushPendingLocalDocumentSave,
  clearLocalDocument,
  loadLocalDocument,
  saveOpenTabsSession,
  loadOpenTabsSession,
  clearOpenTabsSession,
  loadUserPreferences,
  saveUserPreferences,
  DEFAULT_PREFERENCES,
} from './storage';
import { saveRecentDocument } from './recentDocumentsService';
import { DocumentState, OpenTabsSession } from '../types';

vi.mock('./recentDocumentsService', () => ({
  saveRecentDocument: vi.fn().mockResolvedValue([]),
}));

describe('storage (coalesced saving)', () => {
  const sampleDoc: DocumentState = {
    title: 'Teste.md',
    content: '# Teste de persistência',
    oneDriveItemId: null,
    lastSavedAt: '12:00:00',
    isDirty: false,
    revision: 0,
    draftRevision: 0,
    sourceRevision: 0,
    docId: 'doc-123',
  };

  let mockLocalStore: Record<string, string> = {};
  let mockSessionStore: Record<string, string> = {};

  const createMockStorage = (backing: Record<string, string>) => ({
    getItem: vi.fn((key: string) => backing[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      backing[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete backing[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(backing)) {
        delete backing[k];
      }
    }),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mockLocalStore = {};
    mockSessionStore = {};
    vi.stubGlobal('localStorage', createMockStorage(mockLocalStore));
    vi.stubGlobal('sessionStorage', createMockStorage(mockSessionStore));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('deve coalescer múltiplas chamadas consecutivas de saveLocalDocument em um único salvamento após a pausa', () => {
    saveLocalDocument({ ...sampleDoc, content: 'Modificação 1' });
    saveLocalDocument({ ...sampleDoc, content: 'Modificação 2' });
    saveLocalDocument({ ...sampleDoc, content: 'Modificação final' });

    // Antes de decorrer o tempo do debounce, nada deve ter sido gravado ainda no sessionStorage
    expect(sessionStorage.getItem('leitor_md_document')).toBeNull();
    expect(localStorage.getItem('leitor_md_document')).toBeNull();

    // Avança o timer além de 400ms
    vi.advanceTimersByTime(450);

    const saved = sessionStorage.getItem('leitor_md_document');
    expect(saved).not.toBeNull();
    expect(localStorage.getItem('leitor_md_document')).toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.content).toBe('Modificação final');
  });

  it('deve salvar imediatamente quando o parâmetro immediate for true', () => {
    saveLocalDocument({ ...sampleDoc, content: 'Salvo direto' }, true);

    const saved = sessionStorage.getItem('leitor_md_document');
    expect(saved).not.toBeNull();
    expect(localStorage.getItem('leitor_md_document')).toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.content).toBe('Salvo direto');
  });

  it('deve realizar flush determinístico de gravação pendente ao invocar flushPendingLocalDocumentSave', () => {
    saveLocalDocument({ ...sampleDoc, content: 'Pendente no timer' });
    expect(sessionStorage.getItem('leitor_md_document')).toBeNull();

    flushPendingLocalDocumentSave();

    const saved = sessionStorage.getItem('leitor_md_document');
    expect(saved).not.toBeNull();
    expect(localStorage.getItem('leitor_md_document')).toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.content).toBe('Pendente no timer');
  });

  it('grava stub storedInDb no sessionStorage para arquivos > 400KB e evita sobrescrever IndexedDB com stub vazio', () => {
    const saveRecentMock = vi.mocked(saveRecentDocument);
    saveRecentMock.mockClear();

    const giantContent = 'A'.repeat(400_500);
    saveLocalDocument({ ...sampleDoc, content: giantContent }, true);

    const saved = JSON.parse(sessionStorage.getItem('leitor_md_document')!);
    expect(localStorage.getItem('leitor_md_document')).toBeNull();
    expect(saved.storedInDb).toBe(true);
    expect(saved.content).toBe('');
    expect(saveRecentMock).toHaveBeenCalledTimes(1);
    expect(saveRecentMock.mock.calls[0][0].content).toBe(giantContent);

    // Se ocorrer save com o stub não hidratado, NÃO deve sobrescrever o IndexedDB
    saveRecentMock.mockClear();
    saveLocalDocument({ ...sampleDoc, content: '', storedInDb: true }, true);
    expect(saveRecentMock).not.toHaveBeenCalled();
  });

  it('clearLocalDocument e clearOpenTabsSession limpam sessionStorage e chaves legadas no localStorage', () => {
    const session: OpenTabsSession = {
      activeTabId: 'tab-1',
      tabs: [
        {
          id: 'tab-1',
          title: 'Teste.md',
          docId: 'doc-123',
          oneDriveItemId: null,
          isDirty: false,
        },
      ],
      groups: [],
    };

    saveLocalDocument(sampleDoc, true);
    saveOpenTabsSession(session);
    localStorage.setItem('leitor_md_document', JSON.stringify(sampleDoc));
    localStorage.setItem('leitor_md_open_tabs_v1', JSON.stringify(session));

    expect(loadLocalDocument()?.title).toBe('Teste.md');
    expect(loadOpenTabsSession()?.activeTabId).toBe('tab-1');

    clearLocalDocument();
    clearOpenTabsSession();

    expect(sessionStorage.getItem('leitor_md_document')).toBeNull();
    expect(localStorage.getItem('leitor_md_document')).toBeNull();
    expect(sessionStorage.getItem('leitor_md_open_tabs_v1')).toBeNull();
    expect(localStorage.getItem('leitor_md_open_tabs_v1')).toBeNull();
  });

  it('autoSync vem ativado por padrão e persiste no localStorage quando desativado', () => {
    expect(DEFAULT_PREFERENCES.autoSync).toBe(true);
    expect(loadUserPreferences().autoSync).toBe(true);

    saveUserPreferences({ ...DEFAULT_PREFERENCES, autoSync: false });
    expect(loadUserPreferences().autoSync).toBe(false);
  });
});
