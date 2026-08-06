import { Button } from '../common/Button';
import { CrownIcon } from '../common/icons';
import styles from './UpgradeCard.module.css';

/**
 * Sidebar "Upgrade to Pro" promo (DESIGN_SPEC Screen 2).
 * Nothing is wired up — Stage 1 has no accounts or billing.
 */
export function UpgradeCard() {
  return (
    <section className={styles.card} aria-labelledby="sidebar-upgrade">
      <span className={styles.icon}>
        <CrownIcon size={18} />
      </span>
      <h2 id="sidebar-upgrade" className={styles.title}>
        Upgrade to Pro
      </h2>
      <p className={styles.description}>
        Unlimited itineraries, live pricing and offline access.
      </p>
      <Button variant="primary" size="md" fullWidth>
        Upgrade
      </Button>
    </section>
  );
}
