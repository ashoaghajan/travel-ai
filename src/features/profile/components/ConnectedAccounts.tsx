import { useState } from 'react';
import { Card } from '../../../components/common/Card';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { authStore } from '../../../store/auth.store';
import { describeAuthError } from '../../auth/auth.messages';
import { googleClientId } from '../../auth/google';
import { GoogleSignInButton } from '../../auth/components/GoogleSignInButton';
import styles from './ConnectedAccounts.module.css';

/**
 * Which providers this account can sign in with.
 *
 * This is the way out of the deliberate dead end on the sign-in screen: a
 * password account is refused at the Google button, because auto-linking on a
 * matching email would be unsafe while our own signups are unverified. Here
 * the account holder has already proved who they are, so connecting is safe
 * and is their decision.
 */
export function ConnectedAccounts() {
  const { user } = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to offer and nothing to show.
  if (!user || !googleClientId()) return null;

  const google = user.identities.find((identity) => identity.provider === 'google');

  // Disconnecting the only way in would lock the account, and there is no
  // password reset to recover with. The server refuses it too; hiding the
  // control means never offering an action that cannot succeed.
  const canDisconnect = user.hasPassword || user.identities.length > 1;

  async function run(action: Promise<void>) {
    setBusy(true);
    setError(null);

    try {
      await action;
    } catch (caught) {
      setError(describeAuthError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="profile-connected">
      <h2 id="profile-connected" className={styles.title}>
        Connected accounts
      </h2>

      <Card padding="lg" elevation="soft" className={styles.card}>
        <div className={styles.row}>
          <span className={styles.provider}>
            <span className={styles.name}>Google</span>
            <span className={styles.detail}>
              {google ? (google.email ?? 'Connected') : 'Not connected'}
            </span>
          </span>

          {google ? (
            canDisconnect ? (
              <button
                type="button"
                className={styles.disconnect}
                onClick={() => void run(authStore.unlinkGoogle())}
                disabled={busy}
              >
                {busy ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : (
              <span className={styles.detail}>Your only way to sign in</span>
            )
          ) : (
            <GoogleSignInButton
              text="continue_with"
              disabled={busy}
              onCredential={(credential) => void run(authStore.linkGoogle(credential))}
            />
          )}
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </Card>
    </section>
  );
}
