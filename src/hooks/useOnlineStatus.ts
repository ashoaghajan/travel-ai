import { useSyncExternalStore } from 'react';

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

function getSnapshot(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

/** Browser connectivity, used to make trip screens read-only when disconnected. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
