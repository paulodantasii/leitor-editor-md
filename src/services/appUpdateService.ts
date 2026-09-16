/**
 * Safely clears browser asset caches and unregisters service workers,
 * then reloads the page to fetch the latest deployed version.
 * 
 * IMPORTANT: This ONLY clears CacheStorage (HTML/JS/CSS web assets).
 * It preserves localStorage and IndexedDB intact, ensuring that user documents,
 * preferences, and "Carregar Último" are NEVER lost.
 */
export async function forceAppUpdate(): Promise<void> {
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

  // Force reload with timestamp query parameter to bypass Safari HTTP cache
  const url = new URL(window.location.href);
  url.searchParams.set('_v', Date.now().toString());
  window.location.href = url.toString();
}
