import { googleClientId } from '../google';
import { useGoogleSignIn } from '../useGoogleSignIn';
import { GoogleSignInButton } from './GoogleSignInButton';
import styles from '../pages/AuthPage.module.css';

export type FederatedSignInProps = {
  text: 'signin_with' | 'signup_with';
  /** The password form is mid-submit; do not start a second sign-in. */
  disabled?: boolean;
};

const NOT_CONFIGURED = 'Google sign-in is off — set VITE_GOOGLE_CLIENT_ID in .env.local.';

/**
 * The providers, and the "or" that separates them from the email form.
 *
 * Button and divider are one component so they appear and disappear together
 * — a lone "or" above a form, with nothing above it, is worse than no divider
 * at all.
 *
 * With no client id a production build renders nothing, exactly as before
 * Google sign-in existed. Development says so instead: a button that vanishes
 * without explanation is indistinguishable from one that was never built.
 */
export function FederatedSignIn({ text, disabled = false }: FederatedSignInProps) {
  const google = useGoogleSignIn();

  if (!googleClientId()) {
    if (!import.meta.env.DEV) return null;

    return <p className={styles.notConfigured}>{NOT_CONFIGURED}</p>;
  }

  return (
    <>
      <div className={styles.federated}>
        <GoogleSignInButton
          onCredential={google.onCredential}
          text={text}
          disabled={disabled || google.isSubmitting}
        />

        {google.error ? (
          <p className={styles.error} role="alert">
            {google.error}
          </p>
        ) : null}
      </div>

      <p className={styles.divider} aria-hidden="true">
        or
      </p>
    </>
  );
}
