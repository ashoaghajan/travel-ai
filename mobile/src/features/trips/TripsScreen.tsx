import { FlatList, Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Trip } from '../../core/types/trip.types';
import { imageSource } from '../../assets/bundled-images';
import { useTripsResource } from '../../core/store/trip.store';
import { formatDateRange } from '../../core/utils/date';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { SuitcaseIcon } from '../../components/icons';
import { useTheme } from '../../theme/useTheme';

/**
 * Saved trips, newest first.
 *
 * Uses `useTripsResource` rather than `useTrips` for the reason its docblock
 * gives: an empty-state illustration shown while the list is still in flight
 * claims "you have nothing", which is a different and wrong statement from
 * "not loaded yet". On a phone that distinction is sharper than on the web —
 * the first load happens over a mobile connection, and a cold Render instance
 * can take the better part of a minute to answer.
 */
function TripRow({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  const theme = useTheme();
  const cover = imageSource(trip.coverImage);

  return (
    <Card padding="none" elevation="card" onPress={onPress} style={{ overflow: 'hidden' }}>
      {cover ? <Image source={cover} style={{ width: '100%', height: 120 }} resizeMode="cover" /> : null}

      <View style={{ padding: theme.space.lg, gap: 4 }}>
        <Text variant="md" weight="semibold" leading="tight">
          {trip.title}
        </Text>
        <Text variant="xs" tone="muted">
          {formatDateRange(trip.startDate, trip.endDate)} · {trip.itinerary.length} days ·{' '}
          {trip.travellers} travellers
        </Text>
      </View>
    </Card>
  );
}

export function TripsScreen() {
  const theme = useTheme();
  const router = useRouter();
  /*
   * No effect to start the load: `createResource` fetches on its first
   * subscriber, which is this hook. That is the whole reason the web's screens
   * have no bootstrap step, and it ports unchanged.
   */
  const { data: trips, status } = useTripsResource();

  const loading = status === 'loading' && trips.length === 0;

  return (
    <Screen scroll={false}>
      <FlatList
        data={trips}
        keyExtractor={(trip) => trip.id}
        contentContainerStyle={{ gap: theme.space.md, paddingBottom: theme.space.xl }}
        ListHeaderComponent={
          <Text variant="xl" weight="bold" leading="tight" style={{ marginBottom: theme.space.md }}>
            Trips
          </Text>
        }
        renderItem={({ item }) => (
          <TripRow trip={item} onPress={() => router.push(`/trips/${item.id}`)} />
        )}
        ListEmptyComponent={
          <Card>
            <View style={{ alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.lg }}>
              <SuitcaseIcon size={28} color={theme.color.textMuted} />
              <Text variant="sm" tone="muted" leading="snug" style={{ textAlign: 'center' }}>
                {loading ? 'Loading your trips…' : 'No trips yet. Plan one from the Home tab.'}
              </Text>
            </View>
          </Card>
        }
      />
    </Screen>
  );
}
