import { Image, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { ItineraryActivity, ItineraryDay } from '../../core/types/trip.types';
import { imageSource } from '../../assets/bundled-images';
import { useTrips } from '../../core/store/trip.store';
import { formatDateRange, formatWeekdayDate } from '../../core/utils/date';
import { usdFormatter } from '../../core/utils/currency';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import { TripRouteMap } from './TripRouteMap';

/**
 * One trip: the header, the route, and the days.
 *
 * The web splits this across tabs — itinerary, map, bookings, notes — because
 * it has the width for a sticky map column beside a list. A phone does not, so
 * the map sits at the top at a fixed height and the days scroll under it. That
 * is the same information in the order somebody actually wants it: where am I
 * going, then what am I doing.
 *
 * Bookings and notes are Phase 2 and deliberately absent rather than stubbed.
 */

function Activity({ activity }: { activity: ItineraryActivity }) {
  const theme = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: theme.space.md }}>
      <Text
        variant="xs"
        tone="muted"
        weight="semibold"
        style={{ width: 44, fontVariant: ['tabular-nums'] }}
      >
        {activity.time}
      </Text>

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="sm" weight="medium" leading="snug">
          {activity.title}
        </Text>
        {activity.description ? (
          <Text variant="xs" tone="muted" leading="snug">
            {activity.description}
          </Text>
        ) : null}
      </View>

      {/* Zero is a real answer — "free" — and must not read as "unknown". */}
      {typeof activity.priceEstimate === 'number' ? (
        <Text variant="xs" weight="semibold" style={{ fontVariant: ['tabular-nums'] }}>
          {activity.priceEstimate === 0 ? 'Free' : usdFormatter.format(activity.priceEstimate)}
        </Text>
      ) : null}
    </View>
  );
}

function Day({ day }: { day: ItineraryDay }) {
  const theme = useTheme();
  const photo = imageSource(day.image);

  return (
    <Card padding="none" elevation="soft" style={{ overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, padding: theme.space.lg, gap: 2 }}>
          <Text variant="xs" tone="primary" weight="semibold">
            DAY {day.dayNumber} · {formatWeekdayDate(day.date)}
          </Text>
          <Text variant="md" weight="semibold" leading="tight">
            {day.destination}
          </Text>
          {day.summary ? (
            <Text variant="xs" tone="muted" leading="snug">
              {day.summary}
            </Text>
          ) : null}
        </View>

        {/*
          Shown at every width, unlike the web, which hid it below 768px until
          that turned out to be backwards — the picture is how somebody
          recognises the place at a glance, and a phone is where most of this
          is read.
        */}
        {photo ? (
          <Image
            source={photo}
            style={{ width: 72, height: 56, borderRadius: theme.radius.md, marginRight: theme.space.lg }}
            resizeMode="cover"
          />
        ) : null}
      </View>

      {day.activities.length > 0 ? (
        <View
          style={{
            gap: theme.space.md,
            padding: theme.space.lg,
            borderTopWidth: 1,
            borderTopColor: theme.color.border,
          }}
        >
          {day.activities.map((activity) => (
            <Activity key={activity.id} activity={activity} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function TripDetailScreen() {
  const theme = useTheme();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const trips = useTrips();
  const trip = trips.find((candidate) => candidate.id === tripId);

  if (!trip) {
    return (
      <Screen>
        <Card>
          <Text variant="sm" tone="muted">
            That trip is no longer here.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="xl" weight="bold" leading="tight">
        {trip.title}
      </Text>
      <Text variant="xs" tone="muted">
        {formatDateRange(trip.startDate, trip.endDate)} · {trip.travellers} travellers
      </Text>

      <TripRouteMap trip={trip} />

      <Text variant="md" weight="semibold" leading="tight" style={{ marginTop: theme.space.sm }}>
        Day by day
      </Text>

      {trip.itinerary.map((day) => (
        <Day key={day.id} day={day} />
      ))}
    </Screen>
  );
}
