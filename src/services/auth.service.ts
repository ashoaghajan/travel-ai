import type {
  ApiUser,
  AuthSessionResponse,
  LoginRequest,
  UserPlan,
  RegisterRequest,
} from '@ai-travel/shared';
import { http, setAccessToken } from './http';

/**
 * Accounts, as the app sees them.
 *
 * No React component may import this file.
 *
 * Every call that opens or closes a session also settles the access token,
 * because the token and the session are the same fact and splitting them
 * across two call sites is how they drift apart.
 */

export const authService = {
  async register(input: RegisterRequest): Promise<ApiUser> {
    const session = await http.post<AuthSessionResponse>('/auth/register', input);
    setAccessToken(session.accessToken);

    return session.user;
  },

  async login(input: LoginRequest): Promise<ApiUser> {
    const session = await http.post<AuthSessionResponse>('/auth/login', input);
    setAccessToken(session.accessToken);

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
    setAccessToken(session.accessToken);

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
      // Whatever the server said, this browser is signed out. A failed logout
      // that left the token in place would be the worst of both worlds.
      setAccessToken(null);
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
   * Trade the refresh cookie for a new access token.
   *
   * Called once at boot: the access token lives in memory, so after a reload
   * the only evidence of a session is the cookie, and this is what reads it.
   * Returns false rather than throwing — "not signed in" is an ordinary answer
   * on a first visit, not a failure.
   */
  async restore(): Promise<ApiUser | null> {
    try {
      const { accessToken } = await http.post<{ accessToken: string; expiresIn: number }>(
        '/auth/refresh',
        undefined,
        { skipAuth: true },
      );

      setAccessToken(accessToken);

      return await this.me();
    } catch {
      setAccessToken(null);
      return null;
    }
  },
};
