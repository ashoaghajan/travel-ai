import { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authStore } from '../../store/auth.store';
import { describeAuthError } from './auth.messages';
import { safeNextPath } from './next-path';

export type GoogleSignInState = {
  /** Hand this to `GoogleSignInButton`. */
  onCredential: (credential: string) => void;
  isSubmitting: boolean;
  error: string | null;
};

/**
 * The Google half of the sign-in screens.
 *
 * Lands in the same place a password sign-in does, `?next=` and all, because
 * as far as the app is concerned the two are the same event.
 */
export function useGoogleSignIn(): GoogleSignInState {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCredential = useCallback(
    (credential: string) => {
      setIsSubmitting(true);
      setError(null);

      authStore
        .signInWithGoogle(credential)
        .then(() => {
          navigate(safeNextPath(searchParams.get('next')), { replace: true });
        })
        .catch((caught: unknown) => {
          // The interesting one is `GOOGLE_LINK_REQUIRED`: the email belongs to
          // a password account, and the server's own message explains what to
          // do about it.
          setError(describeAuthError(caught));
          setIsSubmitting(false);
        });
    },
    [navigate, searchParams],
  );

  return { onCredential, isSubmitting, error };
}
