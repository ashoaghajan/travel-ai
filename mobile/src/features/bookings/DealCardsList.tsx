import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { BookingContext, PartnerCategory } from '../../core/types/travel.types';
import type { BookingDraft } from '../../core/types/booking.types';
import {
  activityToBookingDraft,
  flightToBookingDrafts,
  hotelToBookingDraft,
  isResultOnTrip,
} from '../../core/services/booking.service';
import { useBookings } from '../../core/store/booking.store';
import { stayGaps, stayPriceBasis } from '../../core/utils/booking';
import type { StayGap } from '../../core/utils/booking';
import {
  EMPTY_HOTEL_FILTERS,
  applyHotelFilters,
  countActiveFilters,
  sortHotels,
} from '@ai-travel/shared';
import type { HotelFilters, HotelSortId } from '@ai-travel/shared';
import { AddBookingToTripSheet } from './AddBookingToTripSheet';
import { HotelFilterBar } from './HotelFilterBar';
import { ActivityCard } from '../explore/ActivityCard';
import { categoryLabel } from '../explore/activity.filters';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import { FlightCard, HotelCard, PriceProvenance } from './DealCards';
import { buildActivityUrl, isDirectlyBookable } from './partner.links';
import { useBookingDeals } from './useBookingDeals';

/**
 * A stay draft aimed at the nights that still need one.
 *
 * `hotelToBookingDraft` dates a stay across the whole trip, which is right for
 * the first hotel and wrong for every one after it: with four of five nights
 * already booked, defaulting to the full range silently doubles up on the four
 * that are paid for. Unchanged when nothing is booked yet — then the whole trip
 * *is* the gap.
 *
 * The web's `forGap` in `BookingBrowser.tsx`, unchanged in substance.
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

/**
 * What the current tab costs, above the partners who sell it.
 *
 * Kept out of `BookingsScreen` because it is the half that talks to providers,
 * and the screen around it is a trip selector and a tab bar. Only the tab in
 * view is loaded — `useBookingDeals` sees to that, so opening Bookings does
 * not spend provider quota on two tabs nobody looked at.
 */
export function DealCardsList({
  context,
  tab,
  tripId,
}: {
  context: BookingContext;
  tab: PartnerCategory;
  /** The trip the screen is filling for, preselected in the sheet. */
  tripId: string | null;
}) {
  const theme = useTheme();
  const deals = useBookingDeals(context, tab);
  const bookings = useBookings();

  /*
   * A list, not one draft: `flightToBookingDrafts` returns a row per leg, and
   * a round-trip fare quoted as one number becomes two bookings.
   */
  const [pendingDrafts, setPendingDrafts] = useState<BookingDraft[] | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  /*
   * How the Hotels tab is ordered and narrowed. The web's `BookingBrowser`
   * holds the same two pieces of state for the same reason: the controls and
   * the rows have to agree, and neither owns the other.
   */
  const [hotelSort, setHotelSort] = useState<HotelSortId>('recommended');
  const [hotelFilters, setHotelFilters] = useState<HotelFilters>(EMPTY_HOTEL_FILTERS);

  /*
   * A new stay search clears the filters. Caps are drawn from the results, so
   * "up to $250" carried from Zurich into Hanoi hides nothing and carried the
   * other way empties the screen — neither of which the reader asked for.
   * Compared during render rather than in an effect, so the first paint of a
   * new city is already unfiltered.
   */
  const staySearch = `${context.destinationCity ?? ''}|${context.departDate ?? ''}|${context.returnDate ?? ''}|${context.travellers}`;
  const [seenStaySearch, setSeenStaySearch] = useState(staySearch);

  if (seenStaySearch !== staySearch) {
    setSeenStaySearch(staySearch);
    setHotelFilters(EMPTY_HOTEL_FILTERS);
  }

  /*
   * The stays as ordered and narrowed for display. Client-side over the page
   * already fetched — narrowing is a view of the results, not a new search.
   */
  const visibleHotels = useMemo(
    () => sortHotels(applyHotelFilters(deals.hotels, hotelFilters), hotelSort),
    [deals.hotels, hotelFilters, hotelSort],
  );

  /*
   * Which nights of this trip still have no bed, so a second hotel fills the
   * gap rather than re-booking what is already covered. Empty when no trip is
   * being filled for — then nothing is known and nothing is assumed.
   */
  const tripBookings = tripId ? bookings.filter((booking) => booking.tripId === tripId) : [];

  const gaps =
    tripId && context.departDate && context.returnDate
      ? stayGaps(context.departDate, context.returnDate, tripBookings)
      : [];

  const fillingForTrip = Boolean(tripId && context.departDate && context.returnDate);
  const everyNightBooked = fillingForTrip && gaps.length === 0;
  const firstGap = gaps[0] ?? null;

  return (
    <View style={{ gap: theme.space.md }}>
      {deals.isLoading ? (
        <Card>
          <View
            style={{ alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.lg }}
          >
            <ActivityIndicator color={theme.color.primary} />
            <Text variant="sm" tone="muted">
              Checking prices…
            </Text>
          </View>
        </Card>
      ) : null}

      {deals.error ? (
        <Text variant="sm" tone="danger" leading="snug" accessibilityRole="alert">
          {deals.error}
        </Text>
      ) : null}

      {/*
        Nothing to price is not a failure, and it is the ordinary state on a
        first visit. Saying which fact is missing beats an empty space, because
        the missing fact is the thing the reader can supply.
      */}
      {!deals.canSearch && !deals.isLoading ? (
        <Text variant="xs" tone="muted" leading="snug">
          {tab === 'flights'
            ? 'Choose a trip and say where you are flying from, and we will price the route.'
            : 'Choose a trip with a destination, and we will show what is on offer there.'}
        </Text>
      ) : null}

      {deals.canSearch && !deals.isLoading ? (
        <View style={{ gap: theme.space.md }}>
          <PriceProvenance source={deals.source} quotedAt={deals.quotedAt} />

          {/* Sorting and filtering, once there is a list to sort. */}
          {tab === 'hotels' && deals.hotels.length > 0 ? (
            <HotelFilterBar
              hotels={deals.hotels}
              sort={hotelSort}
              onSortChange={setHotelSort}
              filters={hotelFilters}
              onFiltersChange={setHotelFilters}
            />
          ) : null}

          {/* Narrowed to nothing: said here, with the count that says how much
              widening would get back. The bar above stays on screen, so the
              reader who over-narrowed has the controls to undo it. */}
          {tab === 'hotels' && deals.hotels.length > 0 && visibleHotels.length === 0 ? (
            <Text variant="xs" tone="muted" leading="snug" accessibilityRole="alert">
              No stay matches those filters. Widen them to see the other {deals.hotels.length} back
              from this search.
            </Text>
          ) : tab === 'hotels' && countActiveFilters(hotelFilters) > 0 ? (
            <Text variant="xs" tone="muted" leading="snug">
              Showing {visibleHotels.length} of {deals.hotels.length} stays.
            </Text>
          ) : null}

          {tab === 'flights'
            ? deals.flights.map((flight) => (
                <FlightCard
                  key={flight.id}
                  flight={flight}
                  onAddToTrip={
                    deals.source === 'sample'
                      ? undefined
                      : () => {
                          setAdded(null);
                          setPendingDrafts(
                            flightToBookingDrafts(flight, context, tripId, deals.source),
                          );
                        }
                  }
                  isOnTrip={isResultOnTrip(bookings, tripId, flight.id)}
                />
              ))
            : tab === 'hotels'
              ? visibleHotels.map((hotel) => (
                  <HotelCard
                    key={hotel.id}
                    hotel={hotel}
                    onAddToTrip={
                      deals.source === 'sample'
                        ? undefined
                        : () => {
                            setAdded(null);
                            setPendingDrafts([
                              forGap(
                                hotelToBookingDraft(hotel, context, tripId, deals.source),
                                firstGap,
                              ),
                            ]);
                          }
                    }
                    isOnTrip={isResultOnTrip(bookings, tripId, hotel.id)}
                    isFullyBooked={everyNightBooked}
                  />
                ))
              : deals.activities.map((activity) => (
                  <ActivityCard
                    key={activity.id}
                    activity={activity}
                    categoryLabel={categoryLabel(activity.category)}
                    /*
                     * Buttons, not a whole-card press: from here an activity
                     * becomes a *booking*, where the explorer's tap makes it a
                     * day's plan. Two different records, so two different
                     * controls rather than one gesture meaning both.
                     */
                    onAddToTrip={() => {
                      setAdded(null);
                      setPendingDrafts([activityToBookingDraft(activity, context, tripId)]);
                    }}
                    isOnTrip={isResultOnTrip(bookings, tripId, activity.id)}
                    /*
                      Only a row somebody actually sells gets an outbound
                      button. A place from the attractions directory used to
                      get a name search at a tour partner, which is what landed
                      readers on a page that did not list the place they
                      tapped — and there is nothing to sell them anyway.
                    */
                    bookingUrl={
                      isDirectlyBookable(activity)
                        ? buildActivityUrl(activity, context.destinationCity)
                        : undefined
                    }
                  />
                ))}

          {emptyFor(deals, tab) ? (
            <Text variant="xs" tone="muted" leading="snug">
              Nothing came back for this search. The partners below still work.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Said out here because the sheet closes on success. */}
      {added ? (
        <Text variant="xs" tone="success" accessibilityRole="alert" leading="snug">
          Added to {added}.
        </Text>
      ) : null}

      {pendingDrafts ? (
        <AddBookingToTripSheet
          drafts={pendingDrafts}
          onAdded={(label) => setAdded(label)}
          onClose={() => setPendingDrafts(null)}
        />
      ) : null}
    </View>
  );
}

/** True when the search ran and found nothing — which is a real answer. */
function emptyFor(
  deals: { flights: unknown[]; hotels: unknown[]; activities: unknown[] },
  tab: PartnerCategory,
): boolean {
  const list =
    tab === 'flights' ? deals.flights : tab === 'hotels' ? deals.hotels : deals.activities;

  return list.length === 0;
}
