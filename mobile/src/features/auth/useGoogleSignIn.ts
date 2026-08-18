import { useCallback, useEffect, useState } from 'react';
import Constants from 'expo-constants';
import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { ApiError } from '../../core/services/http';
import { authStore } from '../../core/store/auth.store';

/**
 * The Google half of the sign-in screen.
 *
 * **This is `src/features/auth/useGoogleSignIn.ts` in purpose only.** The web
 * hook receives a credential that Google's own button has already fetched, and
 * its whole body is what to do with it. Here there is no button to hand one
 * over: the native SDK is the flow, so this hook opens the account chooser as
 * well as spending what comes back.
 *
 * **Why this library rather than `expo-auth-session`.** The server verifies
 * the ID token against a single audience — `GOOGLE_CLIENT_ID`, the *web*
 * client id (`server/src/modules/auth/google.ts`). An AuthSession flow with
 * the Android client would mint a token whose `aud` is the Android client id,
 * and the server would reject every one of them. The native SDK, given
 * `webClientId`, returns a token minted for the web client while the Android
 * OAuth entry — package name plus signing SHA-1 — is what authorises the app.
 * So the phone reaches the same endpoint the browser does, unchanged.
 */

/**
 * The web client id, from `app.json`.
 *
 * Not `EXPO_PUBLIC_*` like the API URL, because `.easignore` drops `.env` and
 * `.env.*` from the upload: a value put there would be present locally and
 * absent from every cloud build, which is the worst of the two options. It is
 * public by design — it names which app a credential was minted for, and the
 * server checks it as the audience. No client secret exists in this flow.
 */
export function googleWebClientId(): string | null {
  const id = Constants.expoConfig?.extra?.googleWebClientId;

  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

export type GoogleSignInState = {
  /** Opens the account chooser and signs in with whatever comes back. */
  signIn: () => void;
  isSubmitting: boolean;
  error: string | null;
};

/** Someone backing out of the account chooser is not an error to report. */
function isDismissal(caught: unknown): boolean {
  return (
    isErrorWithCode(caught) &&
    (caught.code === statusCodes.SIGN_IN_CANCELLED || caught.code === statusCodes.IN_PROGRESS)
  );
}

/**
 * Google Play's DEVELOPER_ERROR, which `statusCodes` does not name.
 *
 * The library enumerates the codes a *user* can act on, and this is not one of
 * them, so it arrives as the raw GMS status integer instead. Compared as a
 * string because the native layer hands the code across as one.
 */
const DEVELOPER_ERROR = '10';

/**
 * What the SDK's own failures mean, when they mean something specific.
 *
 * DEVELOPER_ERROR earns its own sentence for the reason `useDictation` gives
 * about a provider that was never switched on: it means Google has no OAuth
 * client for this package name and signing fingerprint, so every retry fails
 * identically, and "try again" sends somebody to press a button that cannot
 * work. It is also the one failure here that no user can do anything about.
 */
function describeSdkError(caught: unknown): string | null {
  if (!isErrorWithCode(caught)) return null;

  if (String(caught.code) === DEVELOPER_ERROR) {
    return 'Google sign-in is not configured for this build. Use your email and password.';
  }

  if (caught.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
    return 'This device has no Google Play Services, so Google sign-in cannot run here.';
  }

  return null;
}

export function useGoogleSignIn(): GoogleSignInState {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientId = googleWebClientId();

  /*
   * `configure` is synchronous bookkeeping on the native module rather than a
   * request, and it must have run before `signIn` is called. Doing it in an
   * effect rather than at module scope keeps it out of the import graph of
   * every screen that happens to pull this file in.
   */
  useEffect(() => {
    if (clientId) GoogleSignin.configure({ webClientId: clientId });
  }, [clientId]);

  const signIn = useCallback(() => {
    if (!clientId) return;

    setIsSubmitting(true);
    setError(null);

    void (async () => {
      try {
        /*
         * Play Services is not a given: an Honor or Huawei device may have
         * none at all, and there the button cannot work however it is pressed.
         * Asking first turns a native crash into a sentence.
         */
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

        const response = await GoogleSignin.signIn();

        if (response.type === 'cancelled') {
          setIsSubmitting(false);
          return;
        }

        const credential = response.data.idToken;

        if (!credential) {
          setError('Google did not return a usable sign-in. Please try again.');
          setIsSubmitting(false);
          return;
        }

        await authStore.signInWithGoogle(credential);
        // No navigation: the store flips to `authenticated` and the root swaps
        // this screen out, exactly as the password form relies on.
      } catch (caught) {
        if (isDismissal(caught)) {
          setIsSubmitting(false);
          return;
        }

        /*
         * The server's own message is shown, as it is for a password sign-in.
         * The one that matters is GOOGLE_LINK_REQUIRED: the address already
         * belongs to a password account, and only the server knows that.
         */
        setError(
          caught instanceof ApiError
            ? caught.message
            : (describeSdkError(caught) ??
              'We could not sign you in with Google. Please try again.'),
        );
        setIsSubmitting(false);
      }
    })();
  }, [clientId]);

  return { signIn, isSubmitting, error };
}
