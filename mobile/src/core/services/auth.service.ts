import type {
  AccessTokenResponse,
  ApiUser,
  AuthSessionResponse,
  LoginRequest,
  UserPlan,
  RegisterRequest,
} from '@ai-travel/shared';
import { http, setAccessToken } from './http';
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from './session';

/**
 * Accounts, as the app sees them.
 *
 * **A copy of `src/services/auth.service.ts`.** DIFFERS FROM WEB in one idea,
 * spread over four methods: the refresh token has to be kept by hand. On the
 * web the server sets an httpOnly cookie and the browser holds it without
 * being asked, so `register`, `login`, `signInWithGoogle` and `restore` only
 * ever deal in access tokens. Here the token arrives in the response body and
 * nothing remembers it unless `keep` writes it to the keychain — and `logout`
 * has to erase it, which the web achieves by the server clearing a cookie.
 *
 * No React component may import this file.
 *
 * Every call that opens or closes a session also settles the access token,
 * because the token and the session are the same fact and splitting them
 * across two call sites is how they drift apart.
 */

/**
 * Holds on to a new session.
 *
 * **The one thing this file does that the web's version does not.** There, the
 * server sets an httpOnly cookie and the browser keeps it without being asked;
 * here the refresh token arrives in the body and nothing keeps it unless this
 * writes it down. Forgetting to call this on a new sign-in path would produce
 * an app that works perfectly until it is killed.
 */
async function keep(session: AuthSessionResponse): Promise<void> {
  setAccessToken(session.accessToken);

  if (session.refreshToken) await writeRefreshToken(session.refreshToken);
}

export const authService = {
  async register(input: RegisterRequest): Promise<ApiUser> {
    const session = await http.post<AuthSessionResponse>('/auth/register', input);
    await keep(session);

    return session.user;
  },

  async login(input: LoginRequest): Promise<ApiUser> {
    const session = await http.post<AuthSessionResponse>('/auth/login', input);
    await keep(session);

    return session.user;
  },

  /**
   * Trade a Google ID token for one of our sessions.
   *
   * The credential is Google's; everything it comes back with is ours, so the
   * rest of the app cannot tell which door somebody used.
   */
  async signInWithGoogle(credential: string): Promise<ApiUser> {
    const session = await http.post<AuthSessionResponse>('/auth/google', { credential });
    await keep(session);

    return session.user;
  },

  /** Attach Google to the account already signed in. */
  async linkGoogle(credential: string): Promise<void> {
    await http.post<void>('/auth/google/link', { credential });
  },

  async unlinkGoogle(): Promise<void> {
    await http.delete<void>('/auth/google/link');
  },

  async logout(): Promise<void> {
    try {
      await http.post<void>('/auth/logout');
    } finally {
      /*
       * Whatever the server said, this device is signed out. A failed logout
       * that left the token in place would be the worst of both worlds — and
       * worse on a phone than on the web, because the credential left behind
       * is good for a month rather than until the tab closes.
       */
      setAccessToken(null);
      await clearRefreshToken();
    }
  },

  /** The signed-in account, or null. */
  async me(): Promise<ApiUser> {
    return http.get<ApiUser>('/me');
  },

  async updateName(name: string): Promise<ApiUser> {
    return http.patch<ApiUser>('/me', { name });
  },

  /**
   * Change the account's tier.
   *
   * **A placeholder for a payment provider.** Nothing here takes money, so
   * upgrading is a request the browser is allowed to make — which means anyone
   * who reads the network tab can be Pro for nothing. That is deliberate while
   * there is no billing: the tier shapes what somebody gets by default rather
   * than withholding it. The day a provider exists, this method and its
   * endpoint go, and the flag moves by webhook instead.
   */
  async setPlan(plan: UserPlan): Promise<ApiUser> {
    return http.post<ApiUser>('/me/plan', { plan });
  },

  /**
   * Trade the stored refresh token for a new access token.
   *
   * Called once at boot: the access token lives in memory, so after the app is
   * killed the only evidence of a session is what SecureStore kept, and this
   * is what reads it. Returns null rather than throwing — "not signed in" is
   * an ordinary answer on a first launch, not a failure.
   */
  async restore(): Promise<ApiUser | null> {
    try {
      const stored = await readRefreshToken();
      if (!stored) return null;

      const session = await http.post<AccessTokenResponse>(
        '/auth/refresh',
        { refreshToken: stored },
        { skipAuth: true },
      );

      setAccessToken(session.accessToken);
      if (session.refreshToken) await writeRefreshToken(session.refreshToken);

      return await this.me();
    } catch {
      /*
       * Deliberately does *not* clear the stored token.
       *
       * `http.ts` clears it when the server actually rejects it, which is the
       * case that means the credential is dead. Getting here can also just
       * mean the phone had no signal when somebody opened the app, and signing
       * them out for that is a bug they would experience as the app forgetting
       * them on the train.
       */
      setAccessToken(null);
      return null;
    }
  },
};
