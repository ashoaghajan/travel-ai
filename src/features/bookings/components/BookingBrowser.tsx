import { useState } from 'react';
import { Card } from '../../../components/common/Card';
import { Skeleton } from '../../../components/common/Skeleton';
import { PriceNote } from '../../../components/common/PriceNote';
import { Tabs } from '../../../components/common/Tabs';
import { tabId, tabPanelId } from '../../../components/common/tabs.helpers';
import { EmptyState } from '../../../components/common/EmptyState';
import { TicketIcon } from '../../../components/common/icons';
import { FlightResultCard } from '../../../components/cards/FlightResultCard';
import { HotelCard } from '../../../components/cards/HotelCard';
import { ActivityCard } from '../../../components/cards/ActivityCard';
import { describeOccupancy } from '@ai-travel/shared';
import type { BookingContext, PartnerCategory } from '../../../types/travel.types';
import type { BookingDraft } from '../../../types/booking.types';
import type { StayGap } from '../../../utils/booking';
import { stayGaps, stayPriceBasis } from '../../../utils/booking';
import { formatDateRange } from '../../../utils/date';
import {
  activityToBookingDraft,
  flightToBookingDrafts,
  hotelToBookingDraft,
  isResultOnTrip,
} from '../../../services/booking.service';
import { useBookings } from '../../../store/booking.store';
import { categoryLabel } from '../../explore/activity.filters';
import { BOOKING_TABS } from '../partner.filters';
import { buildActivityUrl } from '../partner.links';
import { useBookingDeals } from '../useBookingDeals';
import { AddBookingToTripDialog } from './AddBookingToTripDialog';
import { FlightLegs } from './FlightLegs';
import type { FlightLegSelection } from './FlightLegs';
import styles from './BookingBrowser.module.css';

const SKELETON_COUNT = 3;

/**
 * A stay draft aimed at the nights that still need one.
 *
 * The mapper dates a stay across the whole trip, which is right for the first
 * hotel and wrong for every one after it. Unchanged when nothing is booked yet
 * — then the whole trip *is* the gap.
 */
function forGap(draft: BookingDraft, gap: StayGap | null): BookingDraft {
  if (!gap) return draft;

  return {
    ...draft,
    date: gap.from,
    endDate: gap.to,
    priceBasis: draft.price === undefined ? undefined : stayPriceBasis(gap.from, gap.to),
  };
}

export type BookingBrowserProps = {
  /** What to search: destination, dates, travellers, and an origin for fares. */
  context: BookingContext;
  /** The trip a pick is filed against, or null to decide later. */
  tripId: string | null;
  activeTab: PartnerCategory;
  onTabChange: (tab: PartnerCategory) => void;
  /** Distinguishes the two pages' tab ids, which share a document on neither. */
  idPrefix: string;
  /** Rendered under the list — the partner cards on the booking screen. */
  children?: React.ReactNode;
  onAdded?: (label: string) => void;
};

/**
 * The catalogue: fares, stays and things to do, as a scrolling list.
 *
 * One component for both screens. `/bookings` browses it under its search
 * form, and a trip's Bookings tab browses the same thing under what is already
 * booked — so choosing a hotel is the same act in both places, and neither can
 * drift into having a better version than the other.
 *
 * Inline, deliberately. This used to be a dialog on the trip page, which put a
 * modal between the reader and a list they wanted to scroll and compare.
 */
export function BookingBrowser({
  context,
  tripId,
  activeTab,
  onTabChange,
  idPrefix,
  children,
  onAdded,
}: BookingBrowserProps) {
  const bookings = useBookings();

  /*
   * Which flight the reader is choosing, and between which airports.
   *
   * Held here rather than in `FlightLegs` because the search below is driven
   * by it: the panel and the results have to agree on which leg is on screen.
   */
  const [legs, setLegs] = useState<FlightLegSelection>(() => ({
    leg: 'outbound',
    from: context.originCode ?? '',
    to: context.destinationCode ?? '',
    date: context.departDate ?? '',
  }));

  /*
   * The context the fare search actually runs against.
   *
   * One way, always: each leg is its own fare and its own booking. Handing the
   * provider a return date would bring back a bundled round trip, which is the
   * thing this flow replaced — see `FlightLegs`.
   */
  const flightContext: BookingContext =
    activeTab === 'flights'
      ? {
          ...context,
          tripType: 'one-way',
          originCode: legs.from || null,
          destinationCode: legs.to || null,
          departDate: legs.date || null,
          returnDate: null,
        }
      : context;

  const deals = useBookingDeals(flightContext, activeTab);

  // A list: a round-trip fare is two flights, and each becomes its own booking.
  const [pendingDrafts, setPendingDrafts] = useState<BookingDraft[] | null>(null);

  const results =
    activeTab === 'flights'
      ? deals.flights
      : activeTab === 'hotels'
        ? deals.hotels
        : deals.activities;
  const hasResults = deals.canSearch && (deals.isLoading || results.length > 0);

  const heading =
    activeTab === 'flights'
      ? 'Fares for this trip'
      : activeTab === 'hotels'
        ? 'Stays for these dates'
        : 'Things to do there';

  /*
   * Which nights of the trip still need a bed.
   *
   * Only meaningful when filling for a trip; browsing `/bookings` with no trip
   * chosen has no nights to be short of, so every stay stays addable.
   *
   * A new stay is offered for the first gap rather than for the whole trip:
   * having booked Sep 3–6 of a Sep 3–7 trip, the useful next booking is the
   * one night left, and defaulting to the full range would silently double up
   * on three nights already paid for.
   */
  const tripBookings = tripId ? bookings.filter((booking) => booking.tripId === tripId) : [];

  const gaps =
    tripId && context.departDate && context.returnDate
      ? stayGaps(context.departDate, context.returnDate, tripBookings)
      : [];

  /** Only a booked stay covers a night, so only one makes the line worth showing. */
  const bookedStays = tripBookings.filter(
    (booking) => booking.kind === 'hotel' && booking.status === 'booked',
  ).length;

  const fillingForTrip = Boolean(tripId && context.departDate && context.returnDate);
  const everyNightBooked = fillingForTrip && gaps.length === 0;
  const firstGap = gaps[0] ?? null;

  /**
   * The coverage line: what is still open, or that nothing is.
   *
   * Null when no trip is being filled for, and — deliberately — when nothing
   * is booked yet: a reader who has booked no hotel does not need telling that
   * the whole trip is unbooked, and saying so would put a notice above every
   * first-time search.
   */
  const coverage = !fillingForTrip
    ? null
    : everyNightBooked
      ? 'Every night of this trip has a stay booked.'
      : gaps.length > 0 && bookedStays > 0
        ? `Still open: ${gaps.map((gap) => formatDateRange(gap.from, gap.to)).join(', ')}`
        : null;

  return (
    <div className={styles.browser}>
      <Tabs
        items={BOOKING_TABS}
        activeId={activeTab}
        onChange={onTabChange}
        idPrefix={idPrefix}
        label="Booking categories"
      />

      <div
        role="tabpanel"
        id={tabPanelId(idPrefix, activeTab)}
        aria-labelledby={tabId(idPrefix, activeTab)}
        tabIndex={0}
        className={styles.panel}
      >
        {/* Chosen before the fares, because it decides which fares these are. */}
        {activeTab === 'flights' ? (
          <FlightLegs
            context={context}
            value={legs}
            onChange={setLegs}
            className={styles.legs}
          />
        ) : null}

        {hasResults ? (
          <section className={styles.deals} aria-labelledby={`${idPrefix}-deals-heading`}>
            <div className={styles.dealsHeader}>
              <h3 id={`${idPrefix}-deals-heading`} className={styles.dealsTitle}>
                {heading}
              </h3>
              {deals.isLoading ? null : (
                <PriceNote
                  source={deals.source}
                  quotedAt={deals.quotedAt}
                  datesVary={deals.flights.some(
                    (flight) => flight.departureDate && flight.departureDate !== context.departDate,
                  )}
                />
              )}
              {/* Who the rate covers.
                  A nightly figure beside a two-traveller trip is ambiguous on
                  its face, and the answer is not guessable: the provider
                  prices by occupancy, quoting the same Yerevan room at $103.79
                  for one adult and $115.81 for two. Saying it beats leaving a
                  reader to wonder whether to double it. */}
              {activeTab === 'hotels' ? (
                <p className={styles.coverage}>
                  Prices for {describeOccupancy(context.travellers)}.
                </p>
              ) : null}
              {/* Which nights still need a bed, said before the reader picks a
                  hotel rather than after — a greyed-out button on its own
                  looks like a fault. */}
              {activeTab === 'hotels' && coverage ? (
                <p className={styles.coverage}>{coverage}</p>
              ) : null}
            </div>

            {deals.error ? (
              <p className={styles.error} role="alert">
                {deals.error}
              </p>
            ) : null}

            {deals.isLoading ? (
              <div className={styles.list} aria-busy="true">
                <span className="visually-hidden">Loading…</span>
                {Array.from({ length: SKELETON_COUNT }, (_, index) => (
                  <Card key={index} padding="lg" elevation="soft" className={styles.skeletonCard}>
                    <Skeleton width="40%" height="16px" />
                    <Skeleton width="100%" height="28px" />
                    <Skeleton width="30%" height="20px" />
                  </Card>
                ))}
              </div>
            ) : (
              <ul className={styles.list}>
                {activeTab === 'flights'
                  ? deals.flights.map((flight) => (
                      <FlightResultCard
                        key={flight.id}
                        as="li"
                        flight={flight}
                        /*
                         * Hidden for a sample fare. Its price is invented and it
                         * carries no booking link, so recording it would file a
                         * fiction the trip tab then repeats.
                         */
                        onAddToTrip={
                          deals.source === 'sample'
                            ? undefined
                            : () =>
                                setPendingDrafts(
                                  flightToBookingDrafts(flight, flightContext, tripId, deals.source),
                                )
                        }
                        isOnTrip={isResultOnTrip(bookings, tripId, flight.id)}
                      />
                    ))
                  : activeTab === 'hotels'
                    ? deals.hotels.map((hotel) => (
                        <HotelCard
                          key={hotel.id}
                          as="li"
                          hotel={hotel}
                          onAddToTrip={
                            deals.source === 'sample'
                              ? undefined
                              : () =>
                                  setPendingDrafts([
                                    forGap(
                                      hotelToBookingDraft(hotel, context, tripId, deals.source),
                                      firstGap,
                                    ),
                                  ])
                          }
                          isOnTrip={isResultOnTrip(bookings, tripId, hotel.id)}
                          // Every night has a bed booked; another stay would
                          // double up rather than fill anything.
                          isFullyBooked={everyNightBooked}
                        />
                      ))
                    : deals.activities.map((activity) => (
                        <ActivityCard
                          key={activity.id}
                          as="li"
                          activity={activity}
                          categoryLabel={categoryLabel(activity.category)}
                          to={`/activities/${encodeURIComponent(activity.id)}`}
                          bookingUrl={buildActivityUrl(activity.title, context.destinationCity)}
                          onAddToTrip={() =>
                            setPendingDrafts([activityToBookingDraft(activity, context, tripId)])
                          }
                          isOnTrip={isResultOnTrip(bookings, tripId, activity.id)}
                        />
                      ))}
              </ul>
            )}
          </section>
        ) : deals.canSearch ? null : (
          <EmptyState
            icon={<TicketIcon size={26} />}
            title="Nothing to show yet"
            description={
              activeTab === 'flights'
                ? 'Search for a flight and the fares for this trip will be listed here.'
                : 'Give the trip a destination and we will list what is there.'
            }
          />
        )}

        {children}
      </div>

      {pendingDrafts ? (
        <AddBookingToTripDialog
          drafts={pendingDrafts}
          onClose={() => setPendingDrafts(null)}
          onAdded={onAdded}
        />
      ) : null}
    </div>
  );
}
