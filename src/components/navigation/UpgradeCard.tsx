import { useState } from 'react';
import { Button } from '../common/Button';
import { CrownIcon } from '../common/icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { authStore } from '../../store/auth.store';
import styles from './UpgradeCard.module.css';

/**
 * Sidebar "Upgrade to Pro" (DESIGN_SPEC Screen 2), wired.
 *
 * **It renders nothing for a Pro account.** A permanent advertisement to
 * somebody who has already upgraded is the cheapest way to make a paid thing
 * feel unpaid, and the plan row on the profile is where the tier belongs once
 * it is a fact rather than an offer.
 *
 * The copy names the one thing Pro actually changes. It used to promise
 * "unlimited itineraries, live pricing and offline access" — none of which is
 * a thing this app withholds, and two of which do not exist.
 *
 * **There is no payment.** The button asks the server for the tier and gets
 * it. That is deliberate while no provider is wired up, and the day one is,
 * this component sends somebody to a checkout instead of flipping a flag.
 */
export function UpgradeCard() {
  const { isAuthenticated, isPro } = useCurrentUser();
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to sell to somebody who has it, and nobody to sell to before the
  // session has settled — a card that appears and vanishes on boot is worse
  // than one that arrives a moment late.
  if (!isAuthenticated || isPro) return null;

  async function upgrade() {
    setIsUpgrading(true);
    setError(null);

    try {
      await authStore.setPlan('pro');
      // No success message and no navigation: the card is gone on the next
      // render, and the planner answers differently on the next prompt. The
      // absence is the confirmation.
    } catch {
      setError('That did not go through. Try again.');
      setIsUpgrading(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="sidebar-upgrade">
      <span className={styles.icon}>
        <CrownIcon size={18} />
      </span>
      <h2 id="sidebar-upgrade" className={styles.title}>
        Upgrade to Pro
      </h2>
      <p className={styles.description}>
        Plan with Claude instead of templates, and talk to it about the trip.
      </p>
      <Button
        variant="primary"
        size="md"
        fullWidth
        disabled={isUpgrading}
        onClick={() => void upgrade()}
      >
        {isUpgrading ? 'Upgrading…' : 'Upgrade'}
      </Button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
