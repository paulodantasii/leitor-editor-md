import { DocumentState, TabItem } from '../types';
import { useAppStore } from '../store/useAppStore';
import { forceAppUpdate } from './appUpdateService';
import { isHomeTab } from './documentUtils';
import { markBridgeClean } from './editorContentBridge';

export interface ReloadTabsWarningInfo {
  readonly totalTabsCount: number;
  readonly openDocTabsCount: number;
  readonly dirtyTabTitles: ReadonlyArray<string>;
  readonly hasUnsavedWork: boolean;
}

/**
 * Monta o resumo de abas abertas e alterações não salvas para exibição
 * no modal de confirmação de recarga limpa do aplicativo.
 */
export function getReloadTabsWarningInfo(
  tabs: ReadonlyArray<TabItem>,
  activeTabId: string | null,
  activeDoc: DocumentState | null,
  hasPendingBridge: boolean
): ReloadTabsWarningInfo {
  const totalTabsCount = tabs.length;
  const openDocTabsCount = tabs.filter((t) => !isHomeTab(t)).length;
  const activeDocDirty = Boolean(activeDoc?.isDirty) || hasPendingBridge;

  const dirtyTitlesSet = new Set<string>();
  for (const tab of tabs) {
    const isActiveDocTab = tab.id === activeTabId && !isHomeTab(tab);
    if (tab.isDirty || (isActiveDocTab && activeDocDirty)) {
      dirtyTitlesSet.add(tab.title);
    }
  }

  if (tabs.length === 0 && activeDocDirty) {
    dirtyTitlesSet.add(activeDoc?.title || 'Documento atual');
  }

  const dirtyTabTitles = Array.from(dirtyTitlesSet);
  const hasUnsavedWork = dirtyTabTitles.length > 0 || activeDocDirty;

  return {
    totalTabsCount,
    openDocTabsCount,
    dirtyTabTitles,
    hasUnsavedWork,
  };
}

/**
 * Executa o encerramento limpo de todas as abas e recarrega o aplicativo
 * sem cache antigo e sem restaurar a sessão anterior.
 */
export async function executeCleanAppReload(): Promise<void> {
  markBridgeClean();
  useAppStore.getState().closeDocument();
  await forceAppUpdate({ clearSession: true });
}
