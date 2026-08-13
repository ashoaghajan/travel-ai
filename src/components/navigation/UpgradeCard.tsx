import { useState } from 'react';
import { Button } from '../common/Button';
import { CrownIcon } from '../common/icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { UpgradeToProDialog } from '../../features/pro/components/UpgradeToProDialog';
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
 * The button asks rather than acts: `UpgradeToProDialog` owns the sentence
 * somebody agrees to and the request that follows it, so this card and the
 * profile's plan row cannot drift apart — and so there is one place for a
 * payment provider to land.
 */
export function UpgradeCard() {
  const { isAuthenticated, isPro } = useCurrentUser();
  const [isAsking, setIsAsking] = useState(false);

  // Nothing to sell to somebody who has it, and nobody to sell to before the
  // session has settled — a card that appears and vanishes on boot is worse
  // than one that arrives a moment late.
  if (!isAuthenticated || isPro) return null;

  return (
    <>
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
        <Button variant="primary" size="md" fullWidth onClick={() => setIsAsking(true)}>
          Upgrade
        </Button>
      </section>

      {/*
        No success handling here on purpose: the account becomes Pro, this card
        stops rendering, and the absence is the confirmation. A toast would be
        announcing something the reader can already see.
      */}
      {isAsking ? <UpgradeToProDialog onClose={() => setIsAsking(false)} /> : null}
    </>
  );
}
