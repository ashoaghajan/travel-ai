import { ActivityIndicator, View } from 'react-native';
import type { BookingContext, PartnerCategory } from '../../core/types/travel.types';
import { ActivityCard } from '../explore/ActivityCard';
import { categoryLabel } from '../explore/activity.filters';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import { FlightCard, HotelCard, PriceProvenance } from './DealCards';
import { useBookingDeals } from './useBookingDeals';

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
}: {
  context: BookingContext;
  tab: PartnerCategory;
}) {
  const theme = useTheme();
  const deals = useBookingDeals(context, tab);

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

          {tab === 'flights'
            ? deals.flights.map((flight) => <FlightCard key={flight.id} flight={flight} />)
            : tab === 'hotels'
              ? deals.hotels.map((hotel) => <HotelCard key={hotel.id} hotel={hotel} />)
              : deals.activities.map((activity) => (
                  <ActivityCard
                    key={activity.id}
                    activity={activity}
                    categoryLabel={categoryLabel(activity.category)}
                  />
                ))}

          {emptyFor(deals, tab) ? (
            <Text variant="xs" tone="muted" leading="snug">
              Nothing came back for this search. The partners below still work.
            </Text>
          ) : null}
        </View>
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
