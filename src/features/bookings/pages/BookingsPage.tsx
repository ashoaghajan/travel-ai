import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../../components/layout/PageHeader';
import { EmptyState } from '../../../components/common/EmptyState';
import { PartnerCard } from '../../../components/cards/PartnerCard';
import { TicketIcon } from '../../../components/common/icons';
import { MOCK_PARTNERS } from '../../../mock/partners';
import { searchService } from '../../../services/search.service';
import { useActiveTripId, useTrips } from '../../../store/trip.store';
import { partnerToBookingDraft } from '../../../services/booking.service';
import type { BookingDraft } from '../../../types/booking.types';
import { AddBookingToTripDialog } from '../components/AddBookingToTripDialog';
import { BookingBrowser } from '../components/BookingBrowser';
import { NO_TRIP, resolveBookingContext, toFlightQuery } from '../booking.context';
import { formatDateRange } from '../../../utils/date';
import { formatTravellers } from '../../../utils/trip';
import { FlightSearchForm } from '../../flights/components/FlightSearchForm';
import { initialFlightQuery } from '../../flights/useFlightSearch';
import type { FlightSearchQuery } from '../../../types/travel.types';
import type { PartnerCategory } from '../../../types/travel.types';
import {
  DEFAULT_BOOKING_TAB,
  filterPartnersByCategory,
  isBookingTab,
} from '../partner.filters';
import { buildPartnerUrl, describeBookingContext, toBookingContext } from '../partner.links';
import styles from './BookingsPage.module.css';

const TAB_ID_PREFIX = 'bookings';

/**
 * Screen 7 — Partner booking (DESIGN_SPEC §8).
 *
 * The screen used to be a list of logos: the reader had to leave to find out
 * what anything cost, and came back only to leave again. It now prices the
 * current trip in place, and a click on a fare or a rate is what hands the
 * reader over — see `partner.links.ts` for why leaving is still where a
 * booking ends.
 *
 * The partner list survives underneath, because it is the only thing that
 * works when there is nothing to price: no trip searched yet, no provider
 * configured, or a route the provider has never heard of.
 */
export function BookingsPage() {
  // The tab lives in the URL so a partner list can be linked to.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const activeTab: PartnerCategory = isBookingTab(requested) ? requested : DEFAULT_BOOKING_TAB;

  /*
   * Which trip this screen is filling for.
   *
   * `?tripId=` outranks the trip last opened, and `?tripId=none` is a
   * deliberate detach — see `booking.context.ts` for why an absent parameter
   * cannot mean that.
   */
  const trips = useTrips();
  const activeTripId = useActiveTripId();
  const requestedTripId = searchParams.get('tripId');
  const resolved = useMemo(
    () => resolveBookingContext(trips, activeTripId, searchService.getLastFlightSearch(), requestedTripId),
    [trips, activeTripId, requestedTripId],
  );

  /*
   * The search this screen prices, and editable here.
   *
   * It used to be read once from the last flight search, which meant changing
   * the route or the party size required leaving for `/flights` and coming
   * back. It is state rather than a memo so the form below can move it — and
   * so a search the reader types outranks what the trip implied.
   *
   * Seeded from the resolved context, not from the bare last search. The effect
   * below only fires when the *trip changes*, which never happens on a cold
   * load — the id is already right on the first render. Starting from the last
   * search therefore left the form showing the previous trip's route, dates and
   * party under a banner naming this one, and `FlightSearchForm` is keyed on
   * that same id so it never re-seeded either.
   */
  const [query, setQuery] = useState<FlightSearchQuery>(() =>
    resolved.trip ? toFlightQuery(resolved.context) : initialFlightQuery(),
  );

  // Re-baselines when the trip being filled for changes, the way `useEditTrip`
  // re-baselines its draft when the trip underneath it moves.
  const filledTripId = resolved.trip?.id ?? null;
  useEffect(() => {
    if (filledTripId) setQuery(toFlightQuery(resolved.context));
    // Keyed on the trip, not the context, which is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filledTripId]);

  const context = useMemo(() => toBookingContext(query), [query]);
  const summary = describeBookingContext(context);

  // A list: a round-trip fare is two flights, and each becomes its own booking.
  const [pendingDrafts, setPendingDrafts] = useState<BookingDraft[] | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  function updateSearch(next: FlightSearchQuery) {
    // Saved as well as held, so `/flights` opens on the same search and a
    // reload of this screen does too.
    searchService.saveFlightSearch(next);
    setQuery(next);
  }

  function selectTrip(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set('tripId', next || NO_TRIP);
    setSearchParams(params, { replace: true });
  }

  function selectTab(next: PartnerCategory) {
    const params = new URLSearchParams(searchParams);
    if (next === DEFAULT_BOOKING_TAB) {
      params.delete('tab');
    } else {
      params.set('tab', next);
    }
    setSearchParams(params, { replace: true });
  }

  const partners = useMemo(
    () => filterPartnersByCategory(MOCK_PARTNERS, activeTab),
    [activeTab],
  );


  return (
    <div className={styles.page}>
      <PageHeader title="Book with our partners" />

      <div className={styles.content}>
        {/* Which trip this is for, and the way to change or drop it — the
            inbound half of the link between this screen and a trip. */}
        <div className={styles.tripBar}>
          <label className={styles.tripField}>
            <span className={styles.tripLabel}>Filling for</span>
            <select
              className={styles.tripSelect}
              value={resolved.trip?.id ?? ''}
              onChange={(event) => selectTrip(event.target.value)}
            >
              <option value="">No trip</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.title}
                </option>
              ))}
            </select>
          </label>

          {resolved.trip ? (
            <>
              <p className={styles.tripMeta}>
                {formatDateRange(resolved.trip.startDate, resolved.trip.endDate)} ·{' '}
                {formatTravellers(resolved.trip.travellers)}
              </p>
              <Link className={styles.tripLink} to={`/trips/${resolved.trip.id}?tab=bookings`}>
                Open trip
              </Link>
            </>
          ) : (
            <p className={styles.tripMeta}>
              Anything you add is kept until you file it against a trip.
            </p>
          )}
        </div>

        {added ? (
          <p className={styles.added} role="status">
            Added to {added}.
          </p>
        ) : null}

        <p className={styles.intro}>
          {summary
            ? `Prices for ${summary}. Choosing one takes you to the partner to finish.`
            : "We'll take you to our trusted partners to complete your booking."}
        </p>

        {/*
          Above the tabs, not inside the Flights one: this is the trip, and the
          whole screen prices it. The destination and dates chosen here are what
          the Hotels and Activities tabs search on too.
        */}
        <FlightSearchForm
          key={filledTripId ?? 'no-trip'}
          initialQuery={query}
          onSearch={updateSearch}
          submitLabel="Update search"
          submitBusyLabel="Updating…"
        />

        <BookingBrowser
          context={context}
          tripId={resolved.trip?.id ?? null}
          activeTab={activeTab}
          onTabChange={selectTab}
          idPrefix={TAB_ID_PREFIX}
          onAdded={setAdded}
        >
          <section className={styles.partners} aria-labelledby="booking-partners-heading">
            <h2 id="booking-partners-heading" className={styles.partnersTitle}>
              Or search our partners directly
            </h2>

            {partners.length === 0 ? (
              <EmptyState
                icon={<TicketIcon size={26} />}
                title="No partners here yet"
                description="We're still adding partners for this category."
              />
            ) : (
              <ul className={styles.list}>
                {partners.map((partner) => (
                  <PartnerCard
                    key={partner.id}
                    as="li"
                    partner={partner}
                    href={buildPartnerUrl(partner, activeTab, context)}
                    onAddToTrip={() =>
                      setPendingDrafts([
                        partnerToBookingDraft(
                          partner,
                          activeTab,
                          buildPartnerUrl(partner, activeTab, context),
                          context,
                          resolved.trip?.id ?? null,
                        ),
                      ])
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        </BookingBrowser>

        <p className={styles.status} role="status">
          {summary
            ? `Prefilled with ${summary}.`
            : "Search for a flight first and we'll prefill these links."}
        </p>

        <p className={styles.disclaimer}>
          By continuing, you'll be leaving AI Travel and going to our trusted partner's website. We
          may earn a commission on bookings made through these links, at no extra cost to you.
        </p>
      </div>

      {pendingDrafts ? (
        <AddBookingToTripDialog
          drafts={pendingDrafts}
          onClose={() => setPendingDrafts(null)}
          onAdded={setAdded}
        />
      ) : null}
    </div>
  );
}
