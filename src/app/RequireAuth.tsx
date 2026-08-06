import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { ROUTES } from './routes';

/**
 * The account boundary.
 *
 * Wraps `AppShell`, so everything with a sidebar requires an account and only
 * the landing and auth pages sit outside it.
 *
 * This is a redirect, not a security control — the real enforcement is
 * `requireAuth` on the server, which is what decides whether any data is
 * returned. Someone who defeats this guard reaches an empty shell.
 */
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useCurrentUser();
  const location = useLocation();

  // `AuthBootstrap` normally settles the session before any route renders, so
  // this is only reached if something re-enters the tree mid-check.
  if (isLoading) return null;

  if (!isAuthenticated) {
    // Carry where they were headed so signing in resumes it rather than
    // dropping them on the dashboard.
    const next = `${location.pathname}${location.search}`;

    return <Navigate to={`${ROUTES.login}?next=${encodeURIComponent(next)}`} replace />;
  }

  return <Outlet />;
}
