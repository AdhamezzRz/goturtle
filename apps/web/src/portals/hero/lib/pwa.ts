import { useSyncExternalStore } from 'react';

/**
 * PWA install support. `beforeinstallprompt` fires early (often before the Me page
 * mounts), so it is captured at module load — this module is imported by the header.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    emit();
  });
}

let snapshot = { canPrompt: false, installed, ios: false };
function getSnapshot() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const next = { canPrompt: !!deferred, installed, ios };
  if (next.canPrompt !== snapshot.canPrompt || next.installed !== snapshot.installed || next.ios !== snapshot.ios) snapshot = next;
  return snapshot;
}

export function useInstall() {
  const s = useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, getSnapshot);
  return {
    ...s,
    async prompt() {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      emit();
      return outcome === 'accepted';
    },
  };
}
