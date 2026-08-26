import { useSyncExternalStore } from 'react';
import type { ApiUser, LoginRequest, RegisterRequest, UserPlan } from '@ai-travel/shared';
import { authService } from '../services/auth.service';
import { signedOut } from '../services/http';
import { settingsService } from '../services/settings.service';
import { bookingStore } from './booking.store';
import { friendStore } from './friend.store';
import { tripStore } from './trip.store';

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
 * per store as the stores arrive — `forgetAccount` below is where they land.
 * `core-copies.test.ts` does not guard it, because it is not a copy and
 * pretending otherwise would make that guard lie.
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

/**
 * Puts every store back to how it looks with nobody signed in.
 *
 * One function rather than a list repeated at each of the two doors out of a
 * session, which is the mistake `src/store/auth.store.ts` describes having
 * made: they were maintained by hand, and the failure mode of adding a store
 * to only one of them is the last account's data still on the screen the next
 * person sees.
 *
 * A phone makes that worse than a browser tab does. A signed-out tab is
 * usually closed; a phone is handed to somebody, and the app is still running
 * when it is.
 */
function forgetAccount(): void {
  tripStore.reset();
  bookingStore.reset();
  // Nor who the last account was friends with.
  friendStore.reset();
  /*
   * Nor their theme. The cached copy is what paints before the next account's
   * settings arrive, so leaving it would show the previous reader's dark app
   * to whoever signs in next — on a phone, quite likely the person standing
   * beside them.
   */
  settingsService.clearCache();
  setState(ANONYMOUS);
}

/**
 * Enter a session with the account the server just described.
 *
 * The settings ride along on `ApiUser`, exactly as they do on the web, so
 * adopting them here — before the state change — means the theme and the
 * currency are already right by the time anything re-renders. Doing it at each
 * of the four doors into a session separately is how one of them ends up
 * forgotten; this is the single door they all go through.
 */
function enterSession(user: ApiUser): ApiUser {
  settingsService.adopt(user.settings);
  setState({ status: 'authenticated', user });

  return user;
}

/*
 * A refresh that failed, or a token the server read as replayed. By the time
 * this fires the request that triggered it is already lost, so there is
 * nothing to recover — only state to clear.
 */
signedOut.subscribe(forgetAccount);

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

    if (user) enterSession(user);
    else setState(ANONYMOUS);
  },

  async signIn(input: LoginRequest): Promise<ApiUser> {
    return enterSession(await authService.login(input));
  },

  async signUp(input: RegisterRequest): Promise<ApiUser> {
    return enterSession(await authService.register(input));
  },

  /**
   * The same event as `signIn`, arrived at through a different door.
   *
   * The credential is a Google ID token; everything the server sends back is
   * ours, so the state this lands in is indistinguishable from a password
   * sign-in — which is the point.
   */
  async signInWithGoogle(credential: string): Promise<ApiUser> {
    return enterSession(await authService.signInWithGoogle(credential));
  },

  async signOut(): Promise<void> {
    try {
      await authService.logout();
    } finally {
      // Even if the server never heard about it, this device is signed out.
      forgetAccount();
    }
  },

  async setPlan(plan: UserPlan): Promise<void> {
    enterSession(await authService.setPlan(plan));
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
