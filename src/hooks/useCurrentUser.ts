import type { ApiUser } from '@ai-travel/shared';
import { useAuth } from '../store/auth.store';

export type CurrentUser = {
  /** Null until boot has settled, and whenever nobody is signed in. */
  user: ApiUser | null;
  isAuthenticated: boolean;
  /** True only while the initial session check is still outstanding. */
  isLoading: boolean;
};

/**
 * The signed-in account.
 *
 * The one thing screens should read to know who the user is — it replaced the
 * `CURRENT_USER` guest constant that used to be imported directly.
 */
export function useCurrentUser(): CurrentUser {
  const { status, user } = useAuth();

  return {
    user,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'unknown',
  };
}
