import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { authStore, useAuth } from '../store/auth.store';

/**
 * Settles the session before any route renders.
 *
 * The access token is held in memory, so after a reload the only surviving
 * evidence of a session is the httpOnly refresh cookie — and reading it takes
 * a round trip. Rendering routes first would show the guard an unauthenticated
 * app and bounce a signed-in user to the login page on every refresh, which is
 * the classic failure of this token strategy.
 *
 * So: render nothing until the answer is known. It is one request against a
 * same-origin API, and it replaces a visible redirect with a blank moment.
 */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (started) return;
    setStarted(true);

    // Never rejects — `restore()` treats "no session" as an ordinary answer.
    void authStore.bootstrap();
  }, [started]);

  if (status === 'unknown') return null;

  return <>{children}</>;
}
