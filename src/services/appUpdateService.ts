import { flushPendingEditorContent } from './editorContentBridge';
import { flushPendingLocalDocumentSave } from './storage';

const RELOAD_GUARD_KEY = 'leitor_md_reloaded_build';

export function getCurrentBuildId(): string {
  return typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
}

/**
 * Garante que qualquer edição pendente no editor ou no debounce local
 * seja persistida sincronamente no localStorage antes de recarregar a página.
 */
function flushUserWorkBeforeReload(): void {
  try {
    flushPendingEditorContent();
  } catch (err) {
    console.warn('Erro ao descarregar conteúdo do editor antes do reload:', err);
  }
  try {
    flushPendingLocalDocumentSave();
  } catch (err) {
    console.warn('Erro ao descarregar salvamento local antes do reload:', err);
  }
}

/**
 * Limpa exclusivamente o CacheStorage de ativos web (HTML/JS/CSS) e desregistra
 * Service Workers antigos, preservando 100% do localStorage e IndexedDB.
 */
export async function forceAppUpdate(): Promise<void> {
  flushUserWorkBeforeReload();

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.warn('Erro ao limpar cache de ativos:', err);
  }

  // Força recarregamento ignorando cache HTTP via query param temporário
  const url = new URL(window.location.href);
  url.searchParams.set('_v', Date.now().toString());
  window.location.replace(url.toString());
}

/**
 * Verifica no servidor se há um novo build publicado (comparando version.json
 * com o __APP_BUILD_ID__ compilado no bundle atual). Se houver divergência,
 * limpa os ativos antigos e força o carregamento da nova versão.
 */
export async function checkAndApplyAppUpdate(): Promise<boolean> {
  const currentBuildId = getCurrentBuildId();
  if (currentBuildId === 'dev' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return false;
  }

  try {
    const baseUrl = import.meta.env?.BASE_URL || '/';
    const versionUrl = `${baseUrl}version.json?t=${Date.now()}`;
    const response = await fetch(versionUrl, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });

    if (!response.ok) return false;

    const data = await response.json();
    const remoteBuildId = data?.buildId;

    if (remoteBuildId && typeof remoteBuildId === 'string' && remoteBuildId !== currentBuildId) {
      let lastReloadedBuild: string | null = null;
      try {
        lastReloadedBuild = sessionStorage.getItem(RELOAD_GUARD_KEY);
      } catch {
        // ignore
      }

      if (lastReloadedBuild === remoteBuildId) {
        return false;
      }

      try {
        sessionStorage.setItem(RELOAD_GUARD_KEY, remoteBuildId);
      } catch {
        // ignore
      }

      await forceAppUpdate();
      return true;
    }
  } catch {
    // Falha silenciosa quando offline ou se version.json ainda não existir
  }

  return false;
}

/**
 * Inicializa o Service Worker com bypass de cache HTTP (updateViaCache: 'none'),
 * escuta trocas de controlador (controllerchange) e verifica atualizações ao focar na aba.
 */
export function initAutoUpdateListeners(): () => void {
  // Limpa o parâmetro _v da barra de endereços após um reload de atualização
  try {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has('_v')) {
      currentUrl.searchParams.delete('_v');
      window.history.replaceState({}, document.title, currentUrl.toString());
    }
  } catch {
    // ignore
  }

  if (!import.meta.env.PROD) {
    return () => {};
  }

  let isRefreshing = false;

  const handleControllerChange = () => {
    if (isRefreshing) return;
    isRefreshing = true;
    flushUserWorkBeforeReload();
    window.location.reload();
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl, { updateViaCache: 'none' })
      .then((reg) => {
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Verifica atualizações do SW periodicamente quando visível
        reg.update().catch(() => {});
      })
      .catch((err) => console.warn('Falha no registro do Service Worker:', err));
  }

  // Checa imediatamente no boot se o bundle em memória está defasado em relação ao version.json
  checkAndApplyAppUpdate();

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      checkAndApplyAppUpdate();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then((reg) => reg?.update()).catch(() => {});
      }
    }
  };

  const handleOnline = () => {
    checkAndApplyAppUpdate();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('online', handleOnline);

  return () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('online', handleOnline);
  };
}
