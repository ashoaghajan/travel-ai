import { useState } from 'react';
import { Alert, FlatList, Image, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Trip } from '../../core/types/trip.types';
import { imageSource } from '../../assets/bundled-images';
import { tripStore, useTripsResource } from '../../core/store/trip.store';
import { formatDateRange } from '../../core/utils/date';
import { Card } from '../../components/Card';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { SuitcaseIcon, TrashIcon } from '../../components/icons';
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
const DELETE_ERROR = 'We could not delete that trip. Please try again.';

function TripRow({
  trip,
  onPress,
  onDelete,
  isDeleting,
}: {
  trip: Trip;
  onPress: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const theme = useTheme();
  const cover = imageSource(trip.coverImage);

  return (
    <Card padding="none" elevation="card" onPress={onPress} style={{ overflow: 'hidden' }}>
      {cover ? <Image source={cover} style={{ width: '100%', height: 120 }} resizeMode="cover" /> : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: theme.space.md,
          padding: theme.space.lg,
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="md" weight="semibold" leading="tight">
            {trip.title}
          </Text>
          <Text variant="xs" tone="muted">
            {formatDateRange(trip.startDate, trip.endDate)} · {trip.itinerary.length} days ·{' '}
            {trip.travellers} travellers
          </Text>
        </View>

        {/*
          A nested touchable inside the card's own `Pressable`, which is what
          lets one tap open the trip and the other delete it: the inner view
          becomes the responder, so the press never reaches the card. The web
          has to fight the same fight with a z-index above a stretched link.

          Quiet rather than red, and it opens the confirm rather than deleting:
          the card exists to be opened, and the destructive colour is spent on
          the alert that actually does it.
        */}
        <TouchableOpacity
          onPress={onDelete}
          disabled={isDeleting}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${trip.title}`}
          accessibilityState={{ disabled: isDeleting, busy: isDeleting }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ opacity: isDeleting ? 0.4 : 1 }}
        >
          <TrashIcon size={20} color={theme.color.textMuted} />
        </TouchableOpacity>
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

  // By id rather than a boolean: the row that is going is the one that must
  // show it, and the rest of the list stays pressable while it goes.
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loading = status === 'loading' && trips.length === 0;

  /*
   * A load that failed is not an empty list, and this screen used to say it was.
   * `status` has an error state and nothing read it, so a trips request that
   * came back 500 — or never came back — rendered "No trips yet. Plan one from
   * the Home tab." to somebody with nine of them. That is the worst sentence
   * available: it is calm, it is plausible, and it is the one thing that would
   * stop a reader looking for their data.
   */
  const failed = status === 'error' && trips.length === 0;

  async function remove(trip: Trip) {
    setDeletingTripId(trip.id);
    setDeleteError(null);

    try {
      await tripStore.deleteTrip(trip.id);
    } catch {
      setDeleteError(DELETE_ERROR);
    } finally {
      setDeletingTripId(null);
    }
  }

  /**
   * The confirm is `Alert`, not a panel in the card as on the web.
   *
   * A phone has the platform's own destructive dialog — modal, styled red by
   * iOS and Android themselves, and the shape people already know from every
   * other app that deletes something. `TripDetailScreen` asks before discarding
   * edits the same way.
   */
  function confirmRemove(trip: Trip) {
    Alert.alert('Delete this trip?', `${trip.title} will be removed from your trips.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove(trip) },
    ]);
  }

  return (
    <Screen scroll={false}>
      <FlatList
        data={trips}
        keyExtractor={(trip) => trip.id}
        contentContainerStyle={{ gap: theme.space.md, paddingBottom: theme.space.xl }}
        ListHeaderComponent={
          <View style={{ marginBottom: theme.space.md, gap: theme.space.sm }}>
            <ScreenHeader title="Trips" />
            {/* A delete that failed left the trip on screen; without this the
                list looks like it simply ignored the tap. */}
            {deleteError ? (
              <Text variant="sm" tone="danger" accessibilityRole="alert">
                {deleteError}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <TripRow
            trip={item}
            onPress={() => router.push(`/trips/${item.id}`)}
            onDelete={() => confirmRemove(item)}
            isDeleting={deletingTripId === item.id}
          />
        )}
        ListEmptyComponent={
          <Card>
            <View style={{ alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.lg }}>
              <SuitcaseIcon size={28} color={failed ? theme.color.danger : theme.color.textMuted} />
              <Text
                variant="sm"
                tone={failed ? 'danger' : 'muted'}
                leading="snug"
                style={{ textAlign: 'center' }}
              >
                {loading
                  ? 'Loading your trips…'
                  : failed
                    ? 'We could not load your trips. Check your connection and pull to retry.'
                    : 'No trips yet. Plan one from the Home tab.'}
              </Text>
            </View>
          </Card>
        }
      />
    </Screen>
  );
}
