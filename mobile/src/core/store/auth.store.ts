import { useSyncExternalStore } from 'react';
import type { ApiUser, LoginRequest, RegisterRequest, UserPlan } from '@ai-travel/shared';
import { authService } from '../services/auth.service';
import { signedOut } from '../services/http';

/**
 * Who is signed in.
 *
 * **A deliberately smaller version of `src/store/auth.store.ts`, not a copy.**
 * The web's store also clears eight other stores on sign-out — chat, search,
 * settings, bookings, friends, messages, trip import, local-data claiming —
 * and none of those exist on this side yet. Copying it would have meant
 * copying eight services to satisfy the imports, most of them for features
 * this milestone does not build.
 *
 * So this is the same shape with the same three states, and it grows a line
 * per store as the stores arrive. `core-copies.test.ts` does not guard it,
 * because it is not a copy and pretending otherwise would make that guard
 * lie.
 *
 * The three states matter: `unknown` is not `anonymous`. On a cold start the
 * app has a token in the keychain and no idea yet whether it is still good, and
 * a screen that treats "not yet known" as "signed out" flashes the sign-in
 * form at somebody who is signed in.
 */

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

export type AuthState = {
  status: AuthStatus;
  user: ApiUser | null;
};

const ANONYMOUS: AuthState = { status: 'anonymous', user: null };

let state: AuthState = { status: 'unknown', user: null };
const listeners = new Set<() => void>();

function setState(next: AuthState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): AuthState => state;

/*
 * A refresh that failed, or a token the server read as replayed. By the time
 * this fires the request that triggered it is already lost, so there is
 * nothing to recover — only state to clear.
 */
signedOut.subscribe(() => setState(ANONYMOUS));

export const authStore = {
  subscribe,
  getSnapshot,

  /**
   * Settle the session once, at launch.
   *
   * Trades the stored refresh token for an access token. A first launch has no
   * token, which is an ordinary `anonymous` rather than an error.
   */
  async bootstrap(): Promise<void> {
    const user = await authService.restore();

    setState(user ? { status: 'authenticated', user } : ANONYMOUS);
  },

  async signIn(input: LoginRequest): Promise<ApiUser> {
    const user = await authService.login(input);
    setState({ status: 'authenticated', user });

    return user;
  },

  async signUp(input: RegisterRequest): Promise<ApiUser> {
    const user = await authService.register(input);
    setState({ status: 'authenticated', user });

    return user;
  },

  async signOut(): Promise<void> {
    try {
      await authService.logout();
    } finally {
      // Even if the server never heard about it, this device is signed out.
      setState(ANONYMOUS);
    }
  },

  async setPlan(plan: UserPlan): Promise<void> {
    const user = await authService.setPlan(plan);
    setState({ status: 'authenticated', user });
  },

  /** Testing seam — the module cache otherwise outlives a single test. */
  reset(): void {
    state = { status: 'unknown', user: null };
    listeners.clear();
  },
};

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
