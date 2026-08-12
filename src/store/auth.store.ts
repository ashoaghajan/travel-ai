import { useSyncExternalStore } from 'react';
import type { ApiUser, LoginRequest, RegisterRequest } from '@ai-travel/shared';
import { authService } from '../services/auth.service';
import { signedOut } from '../services/http';
import { claimLocalData, releaseLocalData } from '../services/localData.service';
import { chatService } from '../services/chat.service';
import { searchService } from '../services/search.service';
import { settingsService } from '../services/settings.service';
import { tripImportService } from '../services/tripImport.service';
import { bookingStore } from './booking.store';
import { friendStore } from './friend.store';
import { messagesStore } from './messages.store';
import { savedActivityStore } from './savedActivity.store';
import { tripStore } from './trip.store';

/**
 * Who is signed in.
 *
 * Follows the same shape as `trip.store.ts` — a module-level cache, mutated in
 * one place, read by `useSyncExternalStore` — so identity is stable between
 * changes and no Context provider is needed.
 *
 * Unlike the trip store this is not backed by storage. The access token is
 * deliberately held only in memory, so on a cold load the session is
 * `'unknown'` until `bootstrap()` has asked the server. Rendering routes
 * before that resolves would bounce a signed-in user to the login page on
 * every refresh.
 */

export type AuthStatus =
  /** Boot has not finished; we genuinely do not know yet. */
  | 'unknown'
  | 'authenticated'
  | 'anonymous';

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

/** Stable between changes, as `useSyncExternalStore` requires. */
function getSnapshot(): AuthState {
  return state;
}

function signIn(user: ApiUser): void {
  // Before the state change, so the stores have this account's data by the
  // time anything re-renders against it.
  claimLocalData(user.id);

  /*
   * The account's own preferences, which arrived with it.
   *
   * `GET /api/me` carries settings and the active trip precisely so that
   * starting the app is one request rather than three. Adopting them here,
   * before the state change, means the theme and the currency are already
   * right by the time anything renders — and priming the active trip stops
   * the trip store fetching what we are already holding.
   */
  settingsService.adopt(user.settings);
  tripStore.primeActiveTrip(user.activeTripId);

  /*
   * The conversation and the recent searches, which are read synchronously.
   *
   * Both seed component state on the first render — the planner's message list
   * and the flight form — so they cannot wait for a resource to resolve.
   * Fetched here and written into their caches, which corrects them within a
   * frame of signing in rather than on the visit after.
   */
  void chatService.load().catch(() => undefined);
  void searchService.load().catch(() => undefined);

  setState({ status: 'authenticated', user });

  /*
   * Hand over any trips this browser saved before the trips API existed.
   *
   * Deliberately not awaited: the redirect must not wait on an upload, and a
   * failure must not stop anyone signing in. `tripImportService` never
   * throws — it reports, and leaves the local data untouched so the next
   * sign-in can retry.
   */
  void tripImportService.run(user.id).then((outcome) => {
    // The stores were loaded from an account that did not have these yet.
    if (outcome.status !== 'imported') return;

    void tripStore.refresh();
    void bookingStore.refresh();
    void savedActivityStore.refresh();
  });
}

/**
 * Puts every store back to how it looks with nobody signed in.
 *
 * One function rather than the two identical lists this used to be, in the
 * `signedOut` handler and in `signOut`. They were maintained by hand and had
 * grown to six entries each; the failure mode of adding a seventh to only one
 * of them is a store still holding the last account's data on the screen the
 * next person sees.
 */
function forgetAccount(): void {
  releaseLocalData();
  // The next reader must not see this account's trips, or have their theme
  // painted, for the moment before their own arrive.
  tripStore.reset();
  bookingStore.reset();
  savedActivityStore.reset();
  // Private conversations, and the socket carrying this account's inbox — the
  // next person to sign in on this browser must inherit neither.
  messagesStore.reset();
  // Nor who the last account was friends with.
  friendStore.reset();
  settingsService.clearCache();
  chatService.clearCache();
  searchService.clearCache();
  setState(ANONYMOUS);
}

/**
 * A session that ended without the user asking — an expired refresh, or a
 * token replay. `http.ts` announces it; the guard reacts to the state change.
 */
signedOut.subscribe(() => {
  if (state.status === 'anonymous') return;

  forgetAccount();
});

export const authStore = {
  subscribe,
  getSnapshot,

  /**
   * Settle the session once, at startup.
   *
   * Trades the refresh cookie for an access token. A first-time visitor has no
   * cookie, which is an ordinary `anonymous`, not an error.
   */
  async bootstrap(): Promise<void> {
    const user = await authService.restore();

    if (!user) {
      setState(ANONYMOUS);
      return;
    }

    signIn(user);
  },

  async signIn(input: LoginRequest): Promise<ApiUser> {
    const user = await authService.login(input);
    signIn(user);

    return user;
  },

  async signUp(input: RegisterRequest): Promise<ApiUser> {
    const user = await authService.register(input);
    signIn(user);

    return user;
  },

  /** Google is another door into the same session — same landing as the rest. */
  async signInWithGoogle(credential: string): Promise<ApiUser> {
    const user = await authService.signInWithGoogle(credential);
    signIn(user);

    return user;
  },

  /**
   * Connect or disconnect Google on the account already signed in.
   *
   * Both re-read `/api/me` rather than guessing the new state: the server
   * decides whether a disconnect was allowed, and the profile screen should
   * show what it decided.
   */
  async linkGoogle(credential: string): Promise<void> {
    await authService.linkGoogle(credential);
    setState({ status: 'authenticated', user: await authService.me() });
  },

  async unlinkGoogle(): Promise<void> {
    await authService.unlinkGoogle();
    setState({ status: 'authenticated', user: await authService.me() });
  },

  async signOut(): Promise<void> {
    try {
      await authService.logout();
    } finally {
      // Even if the server never heard about it, this browser is signed out.
      forgetAccount();
    }
  },

  async updateName(name: string): Promise<void> {
    const user = await authService.updateName(name);
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
