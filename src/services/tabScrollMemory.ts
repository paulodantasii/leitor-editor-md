/**
 * Memória volátil (escopo da sessão da página) da posição vertical de leitura de cada aba.
 *
 * - Chave: `TabItem.id`.
 * - Valor: objeto imutável contendo `scrollY` (px, inteiro >= 0) e `docId` opcional.
 *
 * Imutabilidade: cada escrita substitui o Map por uma nova instância (nunca altera o atual).
 * Não reativo de propósito: guardar scroll no Zustand causaria re-renders e gravações de sessão a cada pixel.
 */
export interface TabScrollRecord {
  readonly scrollY: number;
  readonly docId?: string;
}

let positions: ReadonlyMap<string, TabScrollRecord> = new Map();

const normalizeScrollY = (scrollY: number): number =>
  Number.isFinite(scrollY) && scrollY > 0 ? Math.round(scrollY) : 0;

/** Registra (ou sobrescreve) a posição de leitura da aba informada. */
export function saveTabScrollPosition(tabId: string, scrollY: number, docId?: string): void {
  if (!tabId) return;
  const previous = positions.get(tabId);
  const resolvedDocId = docId !== undefined ? docId : previous?.docId;
  const nextRecord: TabScrollRecord = {
    scrollY: normalizeScrollY(scrollY),
    ...(resolvedDocId !== undefined ? { docId: resolvedDocId } : {}),
  };

  if (
    previous &&
    previous.scrollY === nextRecord.scrollY &&
    previous.docId === nextRecord.docId
  ) {
    return;
  }

  positions = new Map([...positions, [tabId, nextRecord]]);
}

/**
 * Lê a posição salva da aba SEM removê-la da memória.
 * Se `expectedDocId` for informado e o registro salvo pertencer a outro `docId`
 * (ex.: aba foi reutilizada para abrir um novo documento), retorna `null`.
 */
export function getTabScrollPosition(tabId: string, expectedDocId?: string): number | null {
  if (!tabId || !positions.has(tabId)) return null;
  const record = positions.get(tabId);
  if (!record) return null;
  if (expectedDocId && record.docId && record.docId !== expectedDocId) {
    return null;
  }
  return record.scrollY;
}

/**
 * Retorna a posição salva da aba e a remove da memória.
 * Retorna `null` quando não há registro (ex.: aba recém-aberta).
 */
export function consumeTabScrollPosition(tabId: string, expectedDocId?: string): number | null {
  if (!tabId || !positions.has(tabId)) return null;
  const record = positions.get(tabId);
  positions = new Map([...positions].filter(([id]) => id !== tabId));
  if (!record) return null;
  if (expectedDocId && record.docId && record.docId !== expectedDocId) {
    return null;
  }
  return record.scrollY;
}

/** Remove explicitamente o registro de uma aba específica. */
export function clearTabScrollPosition(tabId: string): void {
  if (!tabId || !positions.has(tabId)) return;
  positions = new Map([...positions].filter(([id]) => id !== tabId));
}

/** Remove posições de abas que não estão mais abertas. Não faz nada se não houver itens obsoletos. */
export function pruneTabScrollPositions(openTabIds: ReadonlyArray<string>): void {
  const openSet = new Set(openTabIds);
  const hasStale = [...positions.keys()].some((id) => !openSet.has(id));
  if (!hasStale) return;
  positions = new Map([...positions].filter(([id]) => openSet.has(id)));
}

/** Limpa toda a memória (uso em testes). */
export function resetTabScrollPositions(): void {
  positions = new Map();
}
