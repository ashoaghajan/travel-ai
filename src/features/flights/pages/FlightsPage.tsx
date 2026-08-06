import { useMemo, useState } from 'react';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Card } from '../../../components/common/Card';
import { EmptyState } from '../../../components/common/EmptyState';
import { Skeleton } from '../../../components/common/Skeleton';
import { PriceNote } from '../../../components/common/PriceNote';
import { FlightResultCard } from '../../../components/cards/FlightResultCard';
import { TicketIcon } from '../../../components/common/icons';
import { formatWeekdayDate } from '../../../utils/date';
import type { Flight } from '../../../types/travel.types';
import { FlightSearchForm } from '../components/FlightSearchForm';
import { initialFlightQuery, useFlightSearch } from '../useFlightSearch';
import styles from './FlightsPage.module.css';

const SORT_OPTIONS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'cheapest', label: 'Cheapest' },
  { id: 'fastest', label: 'Fastest' },
] as const;

type SortId = (typeof SORT_OPTIONS)[number]['id'];

const SKELETON_COUNT = 3;

function sortFlights(flights: Flight[], sort: SortId): Flight[] {
  // "Recommended" is the order the service returns.
  if (sort === 'recommended') return flights;

  return [...flights].sort((a, b) =>
    sort === 'cheapest' ? a.price - b.price : a.durationMinutes - b.durationMinutes,
  );
}

/** Screen 4 — Flight search with mock results (DESIGN_SPEC §8). */
export function FlightsPage() {
  const { query, results, source, quotedAt, error, isSearching, search } = useFlightSearch();
  const [sort, setSort] = useState<SortId>('recommended');
  // Read once: the form owns its draft after the first render.
  const [formQuery] = useState(initialFlightQuery);

  const sorted = useMemo(() => sortFlights(results, sort), [results, sort]);

  // Live fares come from a month-wide search, so most land near the requested
  // day rather than on it. See `PriceNote`.
  const datesVary = useMemo(
    () => results.some((flight) => flight.departureDate && flight.departureDate !== query.departDate),
    [results, query.departDate],
  );

  const dates = query.returnDate
    ? `${formatWeekdayDate(query.departDate)} - ${formatWeekdayDate(query.returnDate)}`
    : formatWeekdayDate(query.departDate);
  const travellers = `${query.travellers} ${query.travellers === 1 ? 'Adult' : 'Adults'}`;

  return (
    <div className={styles.page}>
      <PageHeader title="Search Flights" />

      <div className={styles.content}>
        <FlightSearchForm
          initialQuery={formQuery}
          isSearching={isSearching}
          onSearch={(next) => void search(next)}
        />

        <section className={styles.results} aria-labelledby="flight-results-heading">
          <header className={styles.resultsHeader}>
            <div className={styles.resultsTitles}>
              <h2 id="flight-results-heading" className={styles.resultsTitle}>
                Best Options
              </h2>
              <p className={styles.resultsMeta}>
                {query.from} → {query.to} · {dates} · {travellers}
              </p>
              {isSearching ? null : <PriceNote source={source} quotedAt={quotedAt} datesVary={datesVary} />}
            </div>

            <label className={styles.sort}>
              <span className="visually-hidden">Sort results</span>
              <select
                className={styles.sortControl}
                value={sort}
                onChange={(event) => setSort(event.target.value as SortId)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </header>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          {isSearching ? (
            <div className={styles.list} aria-busy="true">
              <span className="visually-hidden">Searching for flights…</span>
              {Array.from({ length: SKELETON_COUNT }, (_, index) => (
                <Card key={index} padding="lg" elevation="soft" className={styles.skeletonCard}>
                  <Skeleton width="40%" height="16px" />
                  <Skeleton width="100%" height="28px" />
                  <Skeleton width="30%" height="20px" />
                </Card>
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={<TicketIcon size={26} />}
              title="No flights for this route"
              description="Try different airports or dates."
            />
          ) : (
            <ul className={styles.list}>
              {sorted.map((flight) => (
                <FlightResultCard key={flight.id} as="li" flight={flight} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
