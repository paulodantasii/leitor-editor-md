/**
 * Memória volátil (escopo da sessão da página) da posição vertical de leitura de cada aba.
 *
 * - Chave: `TabItem.id`.
 * - Valor: `window.scrollY` (px, inteiro >= 0) no instante em que a aba deixou de ser a ativa.
 *
 * Imutabilidade: cada escrita substitui o Map por uma nova instância (nunca altera o atual).
 * Não reativo de propósito: guardar scroll no Zustand causaria re-renders e gravações de sessão a cada pixel.
 */
let positions: ReadonlyMap<string, number> = new Map();

const normalizeScrollY = (scrollY: number): number =>
  Number.isFinite(scrollY) && scrollY > 0 ? Math.round(scrollY) : 0;

/** Registra (ou sobrescreve) a posição de leitura da aba informada. */
export function saveTabScrollPosition(tabId: string, scrollY: number): void {
  if (!tabId) return;
  positions = new Map([...positions, [tabId, normalizeScrollY(scrollY)]]);
}

/**
 * Retorna a posição salva da aba e a remove da memória.
 * Retorna `null` quando não há registro (ex.: aba recém-aberta).
 */
export function consumeTabScrollPosition(tabId: string): number | null {
  if (!tabId || !positions.has(tabId)) return null;
  const value = positions.get(tabId) ?? 0;
  positions = new Map([...positions].filter(([id]) => id !== tabId));
  return value;
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
