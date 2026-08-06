import { Navigate, Outlet, useSearchParams } from 'react-router-dom';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { safeNextPath } from '../features/auth/next-path';

/**
 * The mirror of `RequireAuth`: keeps a signed-in reader off the auth pages.
 *
 * Without it, `/login` and `/register` answer a session that already exists
 * with a form asking for one — the same dead end the landing page's "Get
 * Started" used to be.
 *
 * `safeNextPath` decides where they go instead, rather than a hardcoded
 * planner: a session that arrives at `/login?next=/trips` — an expired guard
 * redirect the reader came back to, or a stale link — should resume the trip
 * they were after. That is the same resolution `LoginPage` performs on submit,
 * including its refusal of an off-site `next`.
 */
export function RedirectIfAuthenticated() {
  const { isAuthenticated, isLoading } = useCurrentUser();
  const [searchParams] = useSearchParams();

  // `AuthBootstrap` normally settles the session before any route renders, so
  // this is only reached if something re-enters the tree mid-check.
  if (isLoading) return null;

  if (isAuthenticated) {
    return <Navigate to={safeNextPath(searchParams.get('next'))} replace />;
  }

  return <Outlet />;
}
