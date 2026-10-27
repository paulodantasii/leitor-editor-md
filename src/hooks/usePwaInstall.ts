import { useState, useEffect, useCallback } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

// Module-level cache so the captured event survives React re-renders and unmounts
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

// Setup global listener immediately if running in browser
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    globalDeferredPrompt = null;
    notifyListeners();
  });
}

export type DetectedPlatform = 'windows' | 'ios' | 'android' | 'macos' | 'other';

function detectPlatform(): DetectedPlatform {
  if (typeof window === 'undefined') return 'other';
  const ua = window.navigator.userAgent.toLowerCase();
  
  // iOS / iPadOS detection (including iPadOS 13+ that reports Macintosh with multi-touch)
  const isIos =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos) return 'ios';

  if (/windows/.test(ua)) return 'windows';
  if (/android/.test(ua)) return 'android';
  if (/macintosh|mac os x/.test(ua)) return 'macos';

  return 'other';
}

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    Boolean((window.navigator as any).standalone)
  );
}

export function usePwaInstall() {
  const [hasPrompt, setHasPrompt] = useState<boolean>(() => globalDeferredPrompt !== null);
  const [isStandalone, setIsStandalone] = useState<boolean>(checkIsStandalone);
  const [platform] = useState<DetectedPlatform>(detectPlatform);

  useEffect(() => {
    const handleUpdate = () => {
      setHasPrompt(globalDeferredPrompt !== null);
      setIsStandalone(checkIsStandalone());
    };

    listeners.add(handleUpdate);

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches || checkIsStandalone());
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleMediaChange);
    } else {
      mediaQuery.addListener(handleMediaChange);
    }

    return () => {
      listeners.delete(handleUpdate);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMediaChange);
      } else {
        mediaQuery.removeListener(handleMediaChange);
      }
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unsupported'> => {
    if (!globalDeferredPrompt) {
      return 'unsupported';
    }

    try {
      const promptEvent = globalDeferredPrompt;
      await promptEvent.prompt();
      const choiceResult = await promptEvent.userChoice;

      if (choiceResult.outcome === 'accepted') {
        globalDeferredPrompt = null;
        notifyListeners();
        return 'accepted';
      }

      return 'dismissed';
    } catch (err) {
      console.warn('Erro ao disparar prompt de instalação:', err);
      return 'unsupported';
    }
  }, []);

  return {
    isInstallable: hasPrompt,
    isStandalone,
    platform,
    triggerInstall,
  };
}
