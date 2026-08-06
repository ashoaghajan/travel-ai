import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../../../components/common/Button';
import { cx } from '../../../utils/cx';
import { Card } from '../../../components/common/Card';
import { IconButton } from '../../../components/common/IconButton';
import { Tabs } from '../../../components/common/Tabs';
import { ArrowRightIcon } from '../../../components/common/icons';
import type { FlightSearchQuery, TripType } from '../../../types/travel.types';
import { AirportField } from './AirportField';
import styles from './FlightSearchForm.module.css';

/** DESIGN_SPEC Screen 4 trip type tabs. */
const TRIP_TYPES = [
  { id: 'round-trip', label: 'Round Trip' },
  { id: 'one-way', label: 'One Way' },
  { id: 'multi-city', label: 'Multi-city' },
] as const satisfies readonly { id: TripType; label: string }[];

const MAX_TRAVELLERS = 6;

export type FlightSearchFormProps = {
  initialQuery: FlightSearchQuery;
  isSearching?: boolean;
  onSearch: (query: FlightSearchQuery) => void;
  /** The submit button's label. The booking screen updates a trip, not a search. */
  submitLabel?: string;
  /** Shown while `isSearching`. */
  submitBusyLabel?: string;
  className?: string;
};

/**
 * Flight search panel (DESIGN_SPEC Screen 4). Holds its own draft state and
 * hands a completed query to the caller — it never fetches anything itself.
 */
export function FlightSearchForm({
  initialQuery,
  isSearching = false,
  onSearch,
  submitLabel = 'Search Flights',
  submitBusyLabel = 'Searching…',
  className,
}: FlightSearchFormProps) {
  const [tripType, setTripType] = useState<TripType>(initialQuery.tripType);
  const [from, setFrom] = useState(initialQuery.from);
  const [to, setTo] = useState(initialQuery.to);
  const [departDate, setDepartDate] = useState(initialQuery.departDate);
  const [returnDate, setReturnDate] = useState(initialQuery.returnDate ?? initialQuery.departDate);
  const [travellers, setTravellers] = useState(initialQuery.travellers);
  const [error, setError] = useState<string | null>(null);

  const wantsReturn = tripType === 'round-trip';

  function swapAirports() {
    setFrom(to);
    setTo(from);
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (from === to) {
      setError('Choose two different airports.');
      return;
    }
    if (wantsReturn && returnDate < departDate) {
      setError('The return date cannot be before the departure date.');
      return;
    }

    setError(null);
    onSearch({
      tripType,
      from,
      to,
      departDate,
      returnDate: wantsReturn ? returnDate : undefined,
      travellers,
    });
  }

  return (
    <Card padding="lg" elevation="card" className={cx(styles.card, className)}>
      <Tabs
        items={TRIP_TYPES}
        activeId={tripType}
        onChange={setTripType}
        idPrefix="trip-type"
        label="Trip type"
        className={styles.tabs}
      />

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.route}>
          <AirportField label="From" value={from} onChange={setFrom} />

          <IconButton
            variant="surface"
            label="Swap origin and destination"
            className={styles.swap}
            onClick={swapAirports}
          >
            <ArrowRightIcon size={18} />
          </IconButton>

          <AirportField label="To" value={to} onChange={setTo} />
        </div>

        <div className={styles.details}>
          <label className={styles.field}>
            <span className={styles.label}>Depart</span>
            <input
              className={styles.control}
              type="date"
              value={departDate}
              onChange={(event) => setDepartDate(event.target.value)}
            />
          </label>

          {wantsReturn ? (
            <label className={styles.field}>
              <span className={styles.label}>Return</span>
              <input
                className={styles.control}
                type="date"
                min={departDate}
                value={returnDate}
                onChange={(event) => setReturnDate(event.target.value)}
              />
            </label>
          ) : null}

          <label className={styles.field}>
            <span className={styles.label}>Travellers</span>
            <select
              className={styles.control}
              value={travellers}
              onChange={(event) => setTravellers(Number(event.target.value))}
            >
              {Array.from({ length: MAX_TRAVELLERS }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {count} {count === 1 ? 'Adult' : 'Adults'}
                </option>
              ))}
            </select>
          </label>
        </div>

        {tripType === 'multi-city' ? (
          <p className={styles.note}>
            Extra legs arrive in a later stage — this searches the first leg only.
          </p>
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" fullWidth disabled={isSearching}>
          {isSearching ? submitBusyLabel : submitLabel}
        </Button>
      </form>
    </Card>
  );
}
