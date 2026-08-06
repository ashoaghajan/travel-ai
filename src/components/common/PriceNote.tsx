import { cx } from '../../utils/cx';
import type { PriceSource } from '../../types/travel.types';
import styles from './PriceNote.module.css';

export type PriceNoteProps = {
  source: PriceSource;
  /** ISO instant the provider quoted the prices. Ignored for samples. */
  quotedAt?: string | null;
  /**
   * Whether any fare on screen departs on a day other than the one searched
   * for. See the note in the component about why that is the normal case.
   */
  datesVary?: boolean;
  className?: string;
};

/** "2:45 PM" — a time is enough; these go stale in hours, not days. */
function formatQuotedAt(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(at);
}

/**
 * Where a set of prices came from, said out loud.
 *
 * This is the whole reason `PriceSource` is threaded up from the service. A
 * sample price is invented; showing one next to a real booking link without
 * saying so would be a lie the reader could act on. A live price is real but
 * perishable, so it gets a time instead.
 */
export function PriceNote({ source, quotedAt, datesVary, className }: PriceNoteProps) {
  const isSample = source === 'sample';
  // Real places, no prices — the state hotels are in until a pricing provider
  // is available. See the `PriceSource` union in `@ai-travel/shared`.
  const isListing = source === 'listing';
  const at = source === 'live' && quotedAt ? formatQuotedAt(quotedAt) : null;

  return (
    <>
      <p
        className={cx(styles.note, isSample && styles.sample, isListing && styles.vary, className)}
      >
        <span className={styles.dot} aria-hidden="true" />
        {isSample
          ? 'Sample prices — for layout only, not real fares.'
          : isListing
            ? 'Real stays, prices not quoted here — the partner has them.'
            : at
              ? `Live prices, quoted ${at}. They change often.`
              : 'Live prices. They change often.'}
      </p>

      {/*
        Said plainly rather than left for the reader to spot from the dates on
        the cards. The provider searches fares it has already found rather than
        live inventory, and it holds almost nothing for one named day — so a
        search is made across the month and most results land near the date
        asked for rather than on it. That is normal, and hiding it would put a
        price under a heading it does not belong to.
      */}
      {source === 'live' && datesVary ? (
        <p className={cx(styles.note, styles.vary, className)}>
          <span className={styles.dot} aria-hidden="true" />
          Some of these depart on nearby dates — each fare shows its own.
        </p>
      ) : null}
    </>
  );
}
