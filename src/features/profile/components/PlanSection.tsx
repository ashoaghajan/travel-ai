import { useState } from 'react';
import { Card } from '../../../components/common/Card';
import { CrownIcon } from '../../../components/common/icons';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { authStore } from '../../../store/auth.store';
import { formatLongDate } from '../../../utils/date';
import { UpgradeToProDialog } from '../../pro/components/UpgradeToProDialog';
import styles from './PlanSection.module.css';

/**
 * Which planner this account gets, and how to change it.
 *
 * A row beside the connected accounts rather than a page of its own: the tier
 * is a fact about the account, and it belongs with the other facts. A page
 * selling Pro to somebody who already has it is the same mistake as leaving
 * the sidebar card up.
 *
 * **This is where somebody goes back to free**, which is the half an upgrade
 * flow usually forgets.
 *
 * **The two directions are asked for differently, on purpose.** Upgrading opens
 * `UpgradeToProDialog` and waits for a yes, because it is the direction that
 * will one day take money and the dialog is where a payment provider lands.
 * Going back to free happens on the press: nothing is lost by it, and the
 * button that undoes it is the one that replaces it.
 */
export function PlanSection() {
  const { user, isPro } = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  /**
   * Going back to free, which happens on the press.
   *
   * Upgrading asks first — see `UpgradeToProDialog`, and the reason is that it
   * is the direction that will one day cost money. This direction never will,
   * and nothing is lost by it: the trips stay, the account stays, and the
   * button to come back is the one that replaces this. A confirmation here
   * would be ceremony around an action that undoes itself.
   */
  async function backToFree() {
    setBusy(true);
    setError(null);

    try {
      await authStore.setPlan('free');
    } catch {
      setError('That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="profile-plan">
      <h2 id="profile-plan" className={styles.title}>
        Plan
      </h2>

      <Card padding="lg" elevation="soft" className={styles.card}>
        <div className={styles.row}>
          <span className={styles.plan}>
            <span className={styles.name}>
              {isPro ? (
                <>
                  <CrownIcon size={16} className={styles.icon} />
                  Pro
                </>
              ) : (
                'Free'
              )}
            </span>
            <span className={styles.detail}>
              {isPro
                ? 'The planner writes with Claude, and you can talk to it.'
                : 'The quick planner builds trips from templates, and answers weather and places.'}
            </span>
            {/* Only on Pro, and only when the server gave a date — an account
                upgraded before this field existed has none, and "Pro since
                Invalid Date" is worse than no line at all. */}
            {isPro && user.proSince ? (
              <span className={styles.since}>Since {formatLongDate(user.proSince)}</span>
            ) : null}
          </span>

          <button
            type="button"
            className={isPro ? styles.downgrade : styles.upgrade}
            onClick={() => (isPro ? void backToFree() : setIsAsking(true))}
            disabled={busy}
          >
            {busy ? 'Saving…' : isPro ? 'Back to Free' : 'Upgrade to Pro'}
          </button>
        </div>

        {/*
          Said here rather than hidden, because it is true and somebody will
          notice: there is no payment behind this button. It is a placeholder
          until a provider is wired up, and pretending otherwise on the one
          screen that describes the account would be the wrong place to be coy.
        */}
        {isPro ? null : <p className={styles.note}>No payment yet — Pro is free while we build it.</p>}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </Card>

      {isAsking ? <UpgradeToProDialog onClose={() => setIsAsking(false)} /> : null}
    </section>
  );
}
