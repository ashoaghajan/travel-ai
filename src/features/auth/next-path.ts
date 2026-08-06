/**
 * Where to land after signing in.
 *
 * The guard puts the blocked path in `?next=`, which means the value arrives
 * from the URL bar and cannot be trusted. Anything that is not a plain
 * in-app path is discarded — without this, `?next=https://elsewhere.example`
 * turns our login form into an open redirect, which is exactly the shape
 * phishing wants.
 */
import { ROUTES } from '../../app/routes';

export function safeNextPath(next: string | null): string {
  if (!next) return ROUTES.planner;

  // Must be absolute-in-app. `//host` is protocol-relative and leaves the
  // site; `/\` is treated as `//` by some browsers.
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return ROUTES.planner;
  }

  // Sending someone back to the auth pages after they have just used them
  // would loop.
  if (next === ROUTES.login || next === ROUTES.register) return ROUTES.planner;

  return next;
}
