import { useEffect, useRef, useState } from 'react';
import { googleClientId, loadGoogleIdentityServices } from '../google';
import styles from './GoogleSignInButton.module.css';

export type GoogleSignInButtonProps = {
  /** Receives the ID token. Errors are the caller's to display. */
  onCredential: (credential: string) => void;
  /** "Sign in with Google" versus "Sign up with Google". */
  text?: 'signin_with' | 'signup_with' | 'continue_with';
  disabled?: boolean;
};

const LOAD_ERROR = 'We could not load Google sign-in. Check your connection, or use your email.';

/**
 * Google's own sign-in button.
 *
 * Google renders it into our container rather than us drawing one: their
 * branding terms require the real thing, and a credential can only come from
 * their code. That is also why this cannot be an ordinary `<Button>`.
 *
 * Callers decide whether Google sign-in is available at all — see
 * `FederatedSignIn`, which explains the absence in development.
 */
export function GoogleSignInButton({
  onCredential,
  text = 'signin_with',
  disabled = false,
}: GoogleSignInButtonProps) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so re-rendering with a new callback does not re-initialise
  // GIS, which would draw a second button into the container.
  const handler = useRef(onCredential);
  handler.current = onCredential;

  const clientId = googleClientId();

  useEffect(() => {
    if (!clientId) return;

    let active = true;

    loadGoogleIdentityServices()
      .then((google) => {
        if (!active || !container.current) return;

        google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            if (credential) handler.current(credential);
          },
          // Explicit button only. One Tap appears unbidden on page load, which
          // is not something to spring on someone reading a sign-in form.
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        google.accounts.id.renderButton(container.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text,
          logo_alignment: 'center',
        });
      })
      .catch(() => {
        if (active) setError(LOAD_ERROR);
      });

    return () => {
      active = false;
    };
  }, [clientId, text]);

  // `FederatedSignIn` and `ConnectedAccounts` both check for a client id before
  // rendering this, so reaching here without one means a new call site forgot.
  if (!clientId) return null;

  return (
    <div className={styles.wrapper}>
      {/* GIS draws into this; `inert` is how we disable a button we do not own. */}
      <div ref={container} className={styles.button} inert={disabled || undefined} />

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
