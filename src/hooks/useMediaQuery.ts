import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
      }
      const mediaQueryList = window.matchMedia(query);
      if (typeof mediaQueryList.addEventListener === 'function') {
        mediaQueryList.addEventListener('change', onStoreChange);
        return () => mediaQueryList.removeEventListener('change', onStoreChange);
      }
      // Fallback for older Safari / WebKit versions
      mediaQueryList.addListener(onStoreChange);
      return () => mediaQueryList.removeListener(onStoreChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
