import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PartnerCategory } from '../../core/types/travel.types';
import { MOCK_PARTNERS } from '../../core/mock/partners';
import { searchService } from '../../core/services/search.service';
import { useActiveTripId, useTrips } from '../../core/store/trip.store';
import { formatDateRange } from '../../core/utils/date';
import { formatTravellers } from '../../core/utils/trip';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TicketIcon } from '../../components/icons';
import { useTheme } from '../../theme/useTheme';
import { PartnerCard } from './PartnerCard';
import { NO_TRIP, resolveBookingContext } from './booking.context';
import { BOOKING_TABS, DEFAULT_BOOKING_TAB, filterPartnersByCategory } from './partner.filters';
import { buildPartnerUrl, describeBookingContext } from './partner.links';

/**
 * Screen 7 — Partner booking.
 *
 * The trip this is filling for, and the partners that will take it. Choosing a
 * partner leaves the app for their site, which is where a booking still ends —
 * see `partner.links.ts`.
 *
 * **The web's priced results are not here yet.** `BookingsPage` searches fares
 * and rates in place so the reader can see what things cost before leaving;
 * that rests on `flightService`, `hotelService` and a search form this side
 * has none of. What it falls back to when there is nothing to price is exactly
 * this screen — the web's own words: the partner list "is the only thing that
 * works when there is nothing to price" — so this is a real subset of that
 * screen rather than a sketch of one, and the prices slot in above the
 * partners when those services are ported.
 *
 * **The trip is chosen in a sheet, and the tab is local state.** The web keeps
 * both in the URL so a filtered view can be linked; nobody links to a tab, and
 * the tab holds its state for as long as the app is alive.
 */
export function BookingsScreen() {
  const theme = useTheme();
  const router = useRouter();

  const trips = useTrips();
  const activeTripId = useActiveTripId();

  const [activeTab, setActiveTab] = useState<PartnerCategory>(DEFAULT_BOOKING_TAB);
  /*
   * `undefined` means "not chosen here", which falls back to the trip last
   * opened; `NO_TRIP` is a deliberate detach. The web needs that distinction
   * because an absent query parameter cannot mean "no trip" — it keeps it here
   * so `resolveBookingContext` is the same function on both sides.
   */
  const [requestedTripId, setRequestedTripId] = useState<string | null>(null);
  const [isPickingTrip, setIsPickingTrip] = useState(false);

  const resolved = useMemo(
    () =>
      resolveBookingContext(
        trips,
        activeTripId,
        searchService.getLastFlightSearch(),
        requestedTripId,
      ),
    [trips, activeTripId, requestedTripId],
  );

  const summary = describeBookingContext(resolved.context);

  const partners = useMemo(
    () => filterPartnersByCategory(MOCK_PARTNERS, activeTab),
    [activeTab],
  );

  const header = (
    <View style={{ gap: theme.space.md }}>
      <Text variant="xl" weight="bold" leading="tight">
        Book with our partners
      </Text>

      {/* Which trip this is for, and the way to change or drop it. */}
      <Card padding="lg" elevation="soft">
        <View style={{ gap: theme.space.sm }}>
          <Text variant="xs" weight="semibold" tone="muted" leading="tight">
            FILLING FOR
          </Text>

          <Pressable
            onPress={() => setIsPickingTrip(true)}
            accessibilityRole="button"
            accessibilityLabel="Choose which trip to fill for"
            style={({ pressed }) => [
              {
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: theme.space.lg,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.color.border,
                backgroundColor: theme.color.background,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              variant="sm"
              tone={resolved.trip ? 'main' : 'muted'}
              leading="tight"
              numberOfLines={1}
            >
              {resolved.trip?.title ?? 'No trip'}
            </Text>
          </Pressable>

          {resolved.trip ? (
            <>
              <Text variant="xs" tone="muted" leading="snug">
                {formatDateRange(resolved.trip.startDate, resolved.trip.endDate)} ·{' '}
                {formatTravellers(resolved.trip.travellers)}
              </Text>
              <Text
                variant="xs"
                tone="primary"
                weight="semibold"
                leading="tight"
                onPress={() => router.push(`/trips/${resolved.trip?.id}`)}
              >
                Open trip
              </Text>
            </>
          ) : (
            <Text variant="xs" tone="muted" leading="snug">
              Anything you book is yours to file against a trip later.
            </Text>
          )}
        </View>
      </Card>

      <Text variant="sm" tone="muted" leading="snug">
        {summary
          ? `Prices for ${summary}. Choosing one takes you to the partner to finish.`
          : "We'll take you to our trusted partners to complete your booking."}
      </Text>

      <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
        {BOOKING_TABS.map((tab) => {
          const isActive = tab.id === activeTab;

          return (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              style={({ pressed }) => [
                {
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: theme.space.md,
                  borderRadius: theme.radius.lg,
                  borderWidth: 1,
                  borderColor: isActive ? theme.color.primary : theme.color.border,
                  backgroundColor: isActive ? theme.color.primary : theme.color.surface,
                },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text
                variant="sm"
                weight="semibold"
                tone={isActive ? 'light' : 'muted'}
                leading="tight"
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={partners}
        keyExtractor={(partner) => partner.id}
        contentContainerStyle={{ gap: theme.space.md, paddingBottom: theme.space.xl }}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <PartnerCard partner={item} href={buildPartnerUrl(item, activeTab, resolved.context)} />
        )}
        ListEmptyComponent={
          <Card>
            <View
              style={{ alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.lg }}
            >
              <TicketIcon size={26} color={theme.color.textMuted} />
              <Text variant="sm" weight="semibold" leading="tight">
                No partners here yet
              </Text>
              <Text variant="xs" tone="muted" leading="snug" style={{ textAlign: 'center' }}>
                We're still adding partners for this category.
              </Text>
            </View>
          </Card>
        }
        ListFooterComponent={
          <View style={{ paddingTop: theme.space.lg, gap: theme.space.sm }}>
            <Text variant="xs" tone="muted" leading="snug">
              {summary
                ? `Prefilled with ${summary}.`
                : "Search for a flight first and we'll prefill these links."}
            </Text>
            <Text variant="xs" tone="light" leading="snug">
              By continuing, you'll be leaving AI Travel and going to our trusted partner's website.
              We may earn a commission on bookings made through these links, at no extra cost to
              you.
            </Text>
          </View>
        }
      />

      {isPickingTrip ? (
        <TripPicker
          trips={trips}
          selectedId={resolved.trip?.id ?? null}
          onSelect={(id) => {
            setRequestedTripId(id);
            setIsPickingTrip(false);
          }}
          onClose={() => setIsPickingTrip(false)}
        />
      ) : null}
    </Screen>
  );
}

/** The trip list as a sheet — what replaces the web's `<select>`. */
function TripPicker({
  trips,
  selectedId,
  onSelect,
  onClose,
}: {
  trips: { id: string; title: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const rows = [{ id: NO_TRIP, title: 'No trip' }, ...trips];

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View
        style={{
          flex: 1,
          backgroundColor: theme.color.background,
          paddingTop: insets.top + theme.space.lg,
          paddingBottom: insets.bottom,
          paddingHorizontal: theme.space.lg,
          gap: theme.space.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
          <Text variant="lg" weight="bold" leading="tight" style={{ flex: 1 }}>
            Filling for
          </Text>
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
        </View>

        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => {
            const isSelected =
              item.id === NO_TRIP ? selectedId === null : item.id === selectedId;

            return (
              <Pressable
                onPress={() => onSelect(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={({ pressed }) => [
                  {
                    paddingVertical: theme.space.md,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.color.border,
                  },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text
                  variant="sm"
                  weight={isSelected ? 'semibold' : 'regular'}
                  tone={isSelected ? 'primary' : 'main'}
                  leading="tight"
                >
                  {item.title}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}
