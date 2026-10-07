import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveLocalDocument, flushPendingLocalDocumentSave } from './storage';
import { DocumentState } from '../types';

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
    docId: 'doc-123',
  };

  let mockStore: Record<string, string> = {};

  beforeEach(() => {
    vi.useFakeTimers();
    mockStore = {};
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => mockStore[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockStore[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStore[key];
      }),
      clear: vi.fn(() => {
        mockStore = {};
      }),
    };
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('deve coalescer múltiplas chamadas consecutivas de saveLocalDocument em um único salvamento após a pausa', () => {
    saveLocalDocument({ ...sampleDoc, content: 'Modificação 1' });
    saveLocalDocument({ ...sampleDoc, content: 'Modificação 2' });
    saveLocalDocument({ ...sampleDoc, content: 'Modificação final' });

    // Antes de decorrer o tempo do debounce, nada deve ter sido gravado ainda no localStorage
    expect(localStorage.getItem('leitor_md_document')).toBeNull();

    // Avança o timer além de 400ms
    vi.advanceTimersByTime(450);

    const saved = localStorage.getItem('leitor_md_document');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.content).toBe('Modificação final');
  });

  it('deve salvar imediatamente quando o parâmetro immediate for true', () => {
    saveLocalDocument({ ...sampleDoc, content: 'Salvo direto' }, true);

    const saved = localStorage.getItem('leitor_md_document');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.content).toBe('Salvo direto');
  });

  it('deve realizar flush determinístico de gravação pendente ao invocar flushPendingLocalDocumentSave', () => {
    saveLocalDocument({ ...sampleDoc, content: 'Pendente no timer' });
    expect(localStorage.getItem('leitor_md_document')).toBeNull();

    flushPendingLocalDocumentSave();

    const saved = localStorage.getItem('leitor_md_document');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.content).toBe('Pendente no timer');
  });
});
