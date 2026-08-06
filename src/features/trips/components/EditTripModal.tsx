import { useEffect, useId, useRef } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../../../components/common/Button';
import type { Trip } from '../../../types/trip.types';
import { hasErrors } from '../editTrip';
import { useEditTrip } from '../useEditTrip';
import styles from './EditTripModal.module.css';

export type EditTripModalProps = {
  trip: Trip;
  onClose: () => void;
  /** Called after the changes are persisted. */
  onSaved?: (trip: Trip) => void;
};

/**
 * The trip's metadata — name, where, when, how many.
 *
 * Deliberately *only* metadata. The itinerary is edited in place on the trip
 * page, where the timeline, photographs and map stay on screen; pulling it
 * into this box turned an itinerary into a long form and took away everything
 * that made it recognisable.
 *
 * A native `<dialog>`, so focus trapping, Escape and the backdrop come from
 * the browser. Escape and Cancel both discard; a backdrop click is ignored
 * while there are unsaved changes, because losing an edit to a stray click
 * outside the box is the one way this can go wrong quietly.
 */
export function EditTripModal({ trip, onClose, onSaved }: EditTripModalProps) {
  const { draft, errors, isDirty, isSaving, saveError, hasAttemptedSave, setField, save, cancel } =
    useEditTrip(trip);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const fieldId = useId();

  // `showModal` cannot be expressed as a prop, so it happens on mount.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected || dialog.open) return;

    dialog.showModal();
    return () => dialog.close();
  }, []);

  const showErrors = hasAttemptedSave && hasErrors(errors);

  function discard() {
    cancel();
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (await save()) {
      onSaved?.(trip);
      onClose();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        discard();
      }}
      onClick={(event) => {
        // The dialog element itself is the backdrop; its children stop the
        // event before it reaches here.
        if (event.target === dialogRef.current && !isDirty) onClose();
      }}
    >
      <form className={styles.form} onSubmit={submit}>
        <header className={styles.header}>
          <div>
            <h2 id={titleId} className={styles.heading}>
              Edit trip details
            </h2>
            {isDirty ? (
              <p className={styles.dirty} role="status">
                Unsaved Changes
              </p>
            ) : null}
          </div>
        </header>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Trip details</h3>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${fieldId}-title`}>
                Trip title
              </label>
              <input
                id={`${fieldId}-title`}
                className={styles.control}
                value={draft.title}
                onChange={(event) => setField('title', event.target.value)}
                disabled={isSaving}
              />
              {showErrors && errors.title ? (
                <p className={styles.fieldError}>{errors.title}</p>
              ) : null}
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${fieldId}-country`}>
                  Country
                </label>
                <input
                  id={`${fieldId}-country`}
                  className={styles.control}
                  value={draft.destinationCountry}
                  onChange={(event) => setField('destinationCountry', event.target.value)}
                  disabled={isSaving}
                  autoComplete="country-name"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${fieldId}-city`}>
                  City
                </label>
                <input
                  id={`${fieldId}-city`}
                  className={styles.control}
                  value={draft.destinationCity}
                  onChange={(event) => setField('destinationCity', event.target.value)}
                  disabled={isSaving}
                />
              </div>
            </div>
            {showErrors && errors.destination ? (
              <p className={styles.fieldError}>{errors.destination}</p>
            ) : null}

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${fieldId}-start`}>
                  Start date
                </label>
                <input
                  id={`${fieldId}-start`}
                  type="date"
                  className={styles.control}
                  value={draft.startDate}
                  onChange={(event) => setField('startDate', event.target.value)}
                  disabled={isSaving}
                />
                {showErrors && errors.startDate ? (
                  <p className={styles.fieldError}>{errors.startDate}</p>
                ) : null}
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${fieldId}-end`}>
                  End date
                </label>
                <input
                  id={`${fieldId}-end`}
                  type="date"
                  className={styles.control}
                  value={draft.endDate}
                  min={draft.startDate || undefined}
                  onChange={(event) => setField('endDate', event.target.value)}
                  disabled={isSaving}
                />
                {showErrors && errors.endDate ? (
                  <p className={styles.fieldError}>{errors.endDate}</p>
                ) : null}
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${fieldId}-travellers`}>
                  Travellers
                </label>
                <input
                  id={`${fieldId}-travellers`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  className={styles.control}
                  value={draft.travellers}
                  onChange={(event) => setField('travellers', Number(event.target.value))}
                  disabled={isSaving}
                />
                {showErrors && errors.travellers ? (
                  <p className={styles.fieldError}>{errors.travellers}</p>
                ) : null}
              </div>
            </div>
          </section>

        </div>

        <footer className={styles.footer}>
          {saveError ? (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          ) : null}
          {showErrors && !saveError ? (
            <p className={styles.error} role="alert">
              Fix the highlighted fields before saving.
            </p>
          ) : null}

          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={discard} disabled={isSaving}>
              Cancel Changes
            </Button>
            <Button type="submit" variant="primary" disabled={isSaving || !isDirty}>
              {isSaving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
