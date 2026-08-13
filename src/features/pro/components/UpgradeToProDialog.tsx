import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../components/common/Button';
import { CrownIcon } from '../../../components/common/icons';
import { authStore } from '../../../store/auth.store';
import styles from './UpgradeToProDialog.module.css';

const UPGRADE_ERROR = 'That did not go through. Try again.';

export type UpgradeToProDialogProps = {
  onClose: () => void;
  /** Called once the account is Pro, before the dialog closes. */
  onUpgraded?: () => void;
};

/**
 * Confirms the upgrade before taking it.
 *
 * Both ways in — the sidebar card and the profile's plan row — go through this,
 * so the sentence somebody agrees to is written once. It is also the seam where
 * a payment provider lands: today this dialog says there is nothing to pay, and
 * the day that changes it becomes the screen that says what it costs, without
 * either caller changing.
 *
 * A native `<dialog>`, as everywhere else in this app, so focus trapping,
 * Escape and the backdrop come from the browser rather than from us.
 *
 * **The request lives here rather than in the callers.** A confirmation that
 * only sets a flag and lets the caller do the work would leave the moment
 * between "Upgrade" and the answer belonging to nobody — this way the dialog
 * stays up, disabled, while the request is in flight, and a failure is shown
 * on the thing that caused it.
 */
export function UpgradeToProDialog({ onClose, onUpgraded }: UpgradeToProDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `showModal` is the only way to get the backdrop and the focus trap; it
  // cannot be expressed as a prop, so it happens on mount.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected || dialog.open) return;

    dialog.showModal();
    return () => dialog.close();
  }, []);

  async function confirm() {
    setIsUpgrading(true);
    setError(null);

    try {
      await authStore.setPlan('pro');
      onUpgraded?.();
      onClose();
    } catch {
      setError(UPGRADE_ERROR);
      setIsUpgrading(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape while the request is in flight would leave it running with
        // nothing on screen to report back to.
        if (isUpgrading) event.preventDefault();
        else onClose();
      }}
      onClick={(event) => {
        // A click on the dialog element itself is a click on the backdrop —
        // its children stop the event reaching here.
        if (event.target === dialogRef.current && !isUpgrading) onClose();
      }}
    >
      <div className={styles.body}>
        <span className={styles.icon}>
          <CrownIcon size={20} />
        </span>

        <h2 id={titleId} className={styles.title}>
          Upgrade to Pro?
        </h2>

        <p className={styles.lead}>
          The planner starts writing trips with Claude instead of building them from templates,
          and you can talk to it — ask for changes, and it rewrites the days.
        </p>

        {/* What is *not* being taken away, said plainly. Somebody deciding
            whether to upgrade is also deciding what they lose by not. */}
        <p className={styles.detail}>
          Everything else stays as it is. Weather, places, flights, hotels and dictation are the
          same on both plans.
        </p>

        <p className={styles.note}>
          <strong className={styles.noteStrong}>There is nothing to pay.</strong> Pro is free while
          we build it, and you can go back to the quick planner whenever you like.
        </p>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose} disabled={isUpgrading}>
            Not now
          </Button>
          <Button variant="primary" onClick={() => void confirm()} disabled={isUpgrading}>
            {isUpgrading ? 'Upgrading…' : 'Upgrade'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
