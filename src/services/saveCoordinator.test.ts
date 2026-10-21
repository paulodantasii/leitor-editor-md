import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveCoordinator } from './saveCoordinator';
import { useAppStore } from '../store/useAppStore';
import * as oneDriveService from './oneDriveService';
import * as recentDocumentsService from './recentDocumentsService';

vi.mock('./oneDriveService', () => ({
  saveOneDriveFile: vi.fn(),
  downloadOneDriveFile: vi.fn(),
  getOneDriveItemMetadata: vi.fn(),
}));

vi.mock('./recentDocumentsService', () => ({
  saveRecentDocument: vi.fn().mockResolvedValue([]),
  getRecentDocuments: vi.fn().mockResolvedValue([]),
  cleanupBlankRecentDocuments: vi.fn().mockResolvedValue(undefined),
}));

describe('saveCoordinator (Fase 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mockLocalStorage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        mockLocalStorage[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
    });
    useAppStore.setState({
      document: {
        title: 'Arquivo Teste.md',
        content: '# Conteúdo 1',
        oneDriveItemId: 'drive-item-123',
        lastSavedAt: null,
        isDirty: true,
        revision: 1,
        draftRevision: 0,
        sourceRevision: 0,
        docId: 'doc-test-1',
      },
      fileHandle: null,
      syncStatus: 'idle',
    });
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('salva no OneDrive com sucesso, avança sourceRevision e limpa isDirty', async () => {
    vi.mocked(oneDriveService.saveOneDriveFile).mockResolvedValueOnce({
      id: 'drive-item-123',
      name: 'Arquivo Teste.md',
      lastModifiedDateTime: '2026-10-21T12:00:00Z',
    });

    const result = await saveCoordinator.save();

    expect(result.status).toBe('ok');
    expect(result.sourceRevision).toBe(1);
    expect(oneDriveService.saveOneDriveFile).toHaveBeenCalledTimes(1);

    const doc = useAppStore.getState().document!;
    expect(doc.sourceRevision).toBe(1);
    expect(doc.isDirty).toBe(false);
    expect(useAppStore.getState().syncStatus).toBe('saved');
  });

  it('preserva isDirty: true se o usuário editou o documento enquanto o salvamento estava em voo', async () => {
    let finishPut: (val: any) => void;
    const putPromise = new Promise((resolve) => {
      finishPut = resolve;
    });

    vi.mocked(oneDriveService.saveOneDriveFile).mockReturnValueOnce(putPromise as any);

    // Inicia o salvamento da revisão 1
    const savePromise = saveCoordinator.save();
    expect(saveCoordinator.isSaving()).toBe(true);

    // Usuário digita uma nova letra enquanto o PUT viaja (revisão sobe para 2)
    useAppStore.getState().updateDocumentContent('# Conteúdo 1 + novo texto');
    expect(useAppStore.getState().document!.revision).toBe(2);

    // Conclui o PUT
    finishPut!({
      id: 'drive-item-123',
      name: 'Arquivo Teste.md',
      lastModifiedDateTime: '2026-10-21T12:00:05Z',
    });

    const result = await savePromise;
    expect(result.status).toBe('ok');

    // sourceRevision avançou para a revisão gravada (1), mas isDirty é TRUE porque revision (2) > sourceRevision (1)
    const doc = useAppStore.getState().document!;
    expect(doc.sourceRevision).toBe(1);
    expect(doc.revision).toBe(2);
    expect(doc.isDirty).toBe(true);
  });

  it('coalesce múltiplas chamadas concorrentes em uma única gravação subsequente', async () => {
    let finishFirstPut: (val: any) => void;
    const firstPutPromise = new Promise((resolve) => {
      finishFirstPut = resolve;
    });

    vi.mocked(oneDriveService.saveOneDriveFile)
      .mockReturnValueOnce(firstPutPromise as any)
      .mockResolvedValueOnce({
        id: 'drive-item-123',
        name: 'Arquivo Teste.md',
        lastModifiedDateTime: '2026-10-21T12:00:10Z',
      });

    // 1º pedido em voo
    const p1 = saveCoordinator.save();

    // 2 novas edições e 2 novas tentativas de salvar durante o voo do primeiro
    useAppStore.getState().updateDocumentContent('# Conteúdo v2');
    const p2 = saveCoordinator.save();

    useAppStore.getState().updateDocumentContent('# Conteúdo v3');
    const p3 = saveCoordinator.save();

    // Apenas 1 PUT está em voo neste momento
    expect(oneDriveService.saveOneDriveFile).toHaveBeenCalledTimes(1);

    // Finaliza o 1º PUT
    finishFirstPut!({
      id: 'drive-item-123',
      name: 'Arquivo Teste.md',
      lastModifiedDateTime: '2026-10-21T12:00:00Z',
    });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1.status).toBe('ok');
    expect(r2.status).toBe('ok');
    expect(r3.status).toBe('ok');

    // Ao invés de 3 PUTs, foram feitos exatamente 2 PUTs (1 inicial + 1 coalescido com v3)
    expect(oneDriveService.saveOneDriveFile).toHaveBeenCalledTimes(2);

    const doc = useAppStore.getState().document!;
    expect(doc.isDirty).toBe(false);
    expect(doc.sourceRevision).toBe(doc.revision);
  });

  it('retorna offline quando a rede estiver indisponível para OneDrive', async () => {
    vi.stubGlobal('navigator', { onLine: false });

    const result = await saveCoordinator.save();
    expect(result.status).toBe('offline');
    expect(useAppStore.getState().syncStatus).toBe('offline-pending');
    expect(oneDriveService.saveOneDriveFile).not.toHaveBeenCalled();
  });

  it('grava em arquivo local quando fileHandle estiver presente', async () => {
    const mockWritable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockHandle = {
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    };

    useAppStore.setState({
      document: {
        title: 'Local.md',
        content: '# Texto Local',
        oneDriveItemId: null,
        lastSavedAt: null,
        isDirty: true,
        revision: 1,
        draftRevision: 0,
        sourceRevision: 0,
        docId: 'doc-local-1',
      },
      fileHandle: mockHandle as any,
    });

    const result = await saveCoordinator.save();
    expect(result.status).toBe('ok');
    expect(mockHandle.createWritable).toHaveBeenCalled();
    expect(mockWritable.write).toHaveBeenCalledWith('# Texto Local');
    expect(mockWritable.close).toHaveBeenCalled();

    const doc = useAppStore.getState().document!;
    expect(doc.sourceRevision).toBe(1);
    expect(doc.isDirty).toBe(false);
  });

  it('Fase 3: envia eTag para saveOneDriveFile e lida com conflito 412 abrindo CloudConflictModal', async () => {
    useAppStore.setState({
      document: {
        title: 'Cloud.md',
        content: '# Local Changes',
        oneDriveItemId: 'item-conflict',
        lastSavedAt: null,
        isDirty: true,
        revision: 2,
        draftRevision: 1,
        sourceRevision: 1,
        docId: 'doc-conflict',
        cloudETag: 'W/"etag-old"',
      },
    });

    const error412: any = new Error('412 Precondition Failed');
    error412.status = 412;
    vi.mocked(oneDriveService.saveOneDriveFile).mockRejectedValueOnce(error412);
    vi.mocked(oneDriveService.downloadOneDriveFile).mockResolvedValueOnce('# Nuvem Mais Recente');

    const result = await saveCoordinator.save();
    expect(result.status).toBe('conflict');
    expect(oneDriveService.saveOneDriveFile).toHaveBeenCalledWith('item-conflict', '# Local Changes', 'W/"etag-old"');

    const conflict = useAppStore.getState().cloudConflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.cloudContent).toBe('# Nuvem Mais Recente');
  });

  it('Fase 3: detecta alteração externa em arquivo local e retorna status conflict', async () => {
    const mockFile = {
      lastModified: 2000000,
      text: vi.fn().mockResolvedValue('# Mudou no bloco de notas'),
    };
    const mockHandle = {
      getFile: vi.fn().mockResolvedValue(mockFile),
      createWritable: vi.fn(),
    };

    useAppStore.setState({
      document: {
        title: 'Local.md',
        content: '# Minha edição no app',
        oneDriveItemId: null,
        lastSavedAt: null,
        isDirty: true,
        revision: 2,
        draftRevision: 1,
        sourceRevision: 1,
        docId: 'doc-local-ext',
        localLastModified: 1000000, // Arquivo foi alterado externamente com timestamp 2000000
      },
      fileHandle: mockHandle as any,
    });

    const result = await saveCoordinator.save();
    expect(result.status).toBe('conflict');
    expect(mockHandle.createWritable).not.toHaveBeenCalled();

    const conflict = useAppStore.getState().cloudConflict;
    expect(conflict).not.toBeNull();
    expect(conflict?.cloudContent).toBe('# Mudou no bloco de notas');
  });
});
