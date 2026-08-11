import { useEffect, useId, useRef } from 'react';
import { Button } from '../../../components/common/Button';
import { UploadIcon } from '../../../components/common/icons';
import type { Trip } from '../../../types/trip.types';
import { formatDateRange } from '../../../utils/date';
import { formatTravellers } from '../../../utils/trip';
import { useTripImport } from '../useTripImport';
import styles from './ImportTripDialog.module.css';

export type ImportTripDialogProps = {
  onClose: () => void;
  /** Called once the trip is saved to this account. */
  onImported: (trip: Trip) => void;
};

/**
 * Pick a file, see what is in it, then take it.
 *
 * The step in the middle is the point. An import writes a trip into the
 * reader's own account, and a file is opaque until something reads it — so
 * nothing is saved until they have seen the title, the dates and the size of
 * the thing they are about to acquire, and been told if they already have it.
 *
 * A native `<dialog>`, like every other dialog here, so Escape, the backdrop
 * and the focus trap come from the browser.
 */
export function ImportTripDialog({ onClose, onImported }: ImportTripDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const inputId = useId();

  const { stage, preview, duplicate, error, selectFile, submit, importAnyway } = useTripImport();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected || dialog.open) return;

    dialog.showModal();
    return () => dialog.close();
  }, []);

  const isImporting = stage === 'importing';
  const isDuplicate = stage === 'duplicate';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const trip = isDuplicate ? await importAnyway() : await submit();
    if (trip) onImported(trip);
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <form className={styles.body} onSubmit={handleSubmit}>
        <h2 id={titleId} className={styles.title}>
          Import a trip
        </h2>
        <p className={styles.subtitle}>
          Choose a <code>.trip.json</code> file someone exported from this app.
        </p>

        <div className={styles.field}>
          <span className={styles.label}>Trip file</span>
          <div className={styles.picker}>
            <input
              id={inputId}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              disabled={isImporting}
              onChange={(event) => void selectFile(event.target.files?.[0] ?? null)}
            />
            <label className={styles.pickerButton} htmlFor={inputId}>
              <UploadIcon size={18} />
              Choose file
            </label>
          </div>
        </div>

        {preview ? (
          <div className={styles.summary}>
            <span className={styles.summaryTitle}>{preview.title}</span>
            <span className={styles.summaryMeta}>
              {[
                preview.destination,
                formatDateRange(preview.startDate, preview.endDate),
                formatTravellers(preview.travellers),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className={styles.summaryMeta}>
              {preview.days} {preview.days === 1 ? 'day' : 'days'} · {preview.activities}{' '}
              {preview.activities === 1 ? 'activity' : 'activities'} · {preview.notes}{' '}
              {preview.notes === 1 ? 'note' : 'notes'}
            </span>
          </div>
        ) : null}

        {isDuplicate && duplicate ? (
          <p className={styles.warning} role="alert">
            You already have a trip called “{duplicate.title}” on the same dates. Importing again
            will add a second copy — nothing you already have is changed.
          </p>
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {preview ? (
          <p className={styles.note}>
            The plan and any notes come across. Bookings do not — they belong to whoever made them.
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isImporting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!preview || isImporting}>
            {isImporting ? 'Importing…' : isDuplicate ? 'Import anyway' : 'Import trip'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
