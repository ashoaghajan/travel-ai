import * as SecureStore from 'expo-secure-store';

/**
 * Where the refresh token lives on a phone.
 *
 * The web keeps this in an httpOnly cookie so that no script can read it. A
 * native app has no such thing, so it goes to the platform's own secret store
 * — Keychain on iOS, the Android Keystore — which is the nearest equivalent:
 * encrypted at rest, tied to this app, and not visible to anything else on the
 * device.
 *
 * **Not MMKV.** The rest of the app's storage is an unencrypted memory-mapped
 * file, which is right for trips and settings and wrong for the one credential
 * that can mint sessions for a month.
 *
 * The access token is deliberately *not* here. It lives in a module variable
 * in `http.ts` exactly as it does on the web: it lasts fifteen minutes, so
 * persisting it would add a durable secret to the device to save one request
 * on a cold start.
 */

const REFRESH_TOKEN = 'ai-travel.refreshToken';

/**
 * Reads the stored token.
 *
 * Returns null rather than throwing when the store is unavailable — a device
 * with no lock screen, or a keychain that refuses — because the only sensible
 * response is the same as having no token: sign in again.
 */
export async function readRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN);
  } catch {
    return null;
  }
}

/**
 * Stores a token, replacing whatever was there.
 *
 * Called on every rotation, so a failure here is not cosmetic: it would leave
 * the *old* token in the store while the server has already replaced it, and
 * the next refresh would present a rotated token and trip the reuse detector,
 * killing the whole family. Better to clear it and ask for a password than to
 * leave a credential behind that will be read as theft.
 */
export async function writeRefreshToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(REFRESH_TOKEN, token);
  } catch {
    await clearRefreshToken();
  }
}

export async function clearRefreshToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN);
  } catch {
    // Nothing useful to do. The session is over either way.
  }
}
