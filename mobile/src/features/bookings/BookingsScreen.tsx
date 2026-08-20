import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FlightSearchQuery, PartnerCategory } from '../../core/types/travel.types';
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
import { BookingSearchForm } from './BookingSearchForm';
import { DealCardsList } from './DealCardsList';
import { useDestinationAirport } from './useDestinationAirport';
import { PartnerCard } from './PartnerCard';
import { NO_TRIP, resolveBookingContext, toFlightQuery } from './booking.context';
import { initialFlightQuery } from './initialFlightQuery';
import { BOOKING_TABS, DEFAULT_BOOKING_TAB, filterPartnersByCategory } from './partner.filters';
import { buildPartnerUrl, describeBookingContext, toBookingContext } from './partner.links';

/**
 * Screen 7 — Partner booking.
 *
 * The trip this is filling for, and the partners that will take it. Choosing a
 * partner leaves the app for their site, which is where a booking still ends —
 * see `partner.links.ts`.
 *
 * **Prices first, partners underneath.** `useBookingDeals` runs the same
 * searches the web's flights and hotels screens run, so the reader sees what
 * things cost on the screen where they choose. The partner list stays below
 * it, because it is the only thing that works when there is nothing to price:
 * no trip chosen, no provider configured, or a route nobody quotes.
 *
 * **The web's search form, not one field.** This screen used to ask only where
 * the reader was flying *from* and take the rest from the trip, on the argument
 * that asking again for what the trip already knows is asking the reader to
 * retype what is on screen. The argument was wrong about what a form is for: a
 * trip is where somebody is going, and a search is what they want priced, and
 * those come apart the moment anyone wants a fare for one traveller on a trip
 * booked for four. The web has always let both be edited here;
 * `BookingSearchForm` is the same fields on this side, so the same trip prices
 * the same thing in a browser and in the app.
 *
 * `useDestinationAirport` survives it, and still only fills a gap — the trip's
 * city becomes an arrival code when the form has not named one.
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

  /*
   * The search this screen prices, and editable here — the web's state, for the
   * web's reason. It used to be a single `originCode`, everything else coming
   * from the trip, which left the reader no way to price a different route or
   * a different party size without editing the trip itself.
   *
   * Seeded from the resolved context rather than the bare last search, so a
   * cold load with a trip already active opens on that trip's route and dates
   * rather than on the previous trip's.
   */
  const filledTripId = resolved.trip?.id ?? null;

  const [query, setQuery] = useState<FlightSearchQuery>(() =>
    resolved.trip ? toFlightQuery(resolved.context) : initialFlightQuery(),
  );

  /*
   * Re-baselines when the trip being filled for changes, the way `useEditTrip`
   * re-baselines its draft when the trip underneath it moves.
   *
   * During render, not in an effect, and the difference is visible on screen.
   * Trips arrive from the store a beat after this mounts, so `filledTripId`
   * goes null → id on a later render, and that is the render where the form's
   * `key` changes and it remounts. An effect runs *after* that commit: the
   * form would seed its fields from the query as it was before the trip
   * arrived — the last saved search — and then the effect would move `query`
   * underneath it, leaving the summary pricing Abu Dhabi in August while the
   * fields read JFK → DPS in October. Setting state here re-renders before
   * anything commits, so the new key and the new value land together.
   */
  const [seededFor, setSeededFor] = useState(filledTripId);
  if (filledTripId !== seededFor) {
    setSeededFor(filledTripId);
    // Only a trip has anything to re-baseline from; losing one leaves the
    // reader's own search alone.
    if (filledTripId) setQuery(toFlightQuery(resolved.context));
  }

  const edited = useMemo(() => toBookingContext(query), [query]);

  /*
   * The arrival airport a trip implies, when nothing has named one. Returns
   * null the moment `destinationCode` is already set, so it never overrides a
   * code the reader typed into the form.
   */
  const resolvedDestination = useDestinationAirport(edited);

  /*
   * What the price searches actually run on.
   *
   * The form outranks the trip: it was seeded from it and the reader has since
   * had the chance to change it, so treating the trip as authoritative would
   * silently undo their edit. What the trip still supplies is the two things a
   * flight query has no field for — the destination's city and country, which
   * the Hotels and Activities tabs search on.
   *
   * Rebuilt from fields rather than spread wholesale so `useBookingDeals` —
   * which depends on the individual fields for exactly this reason — is not
   * handed a new object identity on every render.
   */
  const searchContext = useMemo(
    () => ({
      ...edited,
      destinationCode: edited.destinationCode ?? resolvedDestination,
      destinationCity: edited.destinationCity ?? resolved.context.destinationCity,
      destinationCountry: edited.destinationCountry ?? resolved.context.destinationCountry,
    }),
    [edited, resolvedDestination, resolved.context],
  );

  /*
   * Saved as well as held, so re-opening the screen — or a second trip — starts
   * from the search that was last run rather than from the spec defaults.
   */
  function updateSearch(next: FlightSearchQuery) {
    searchService.saveFlightSearch(next);
    setQuery(next);
  }

  const summary = describeBookingContext(searchContext);

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

      {/*
        Above the tabs, not inside the Flights one: this is the trip, and the
        whole screen prices it. The destination and dates chosen here are what
        the Hotels and Activities tabs search on too.

        Keyed on the trip so the form re-seeds its draft when the trip changes —
        the state above re-baselines, but the fields hold their own copy of it.
      */}
      <BookingSearchForm
        key={filledTripId ?? 'no-trip'}
        initialQuery={query}
        onSearch={updateSearch}
      />

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

      <DealCardsList context={searchContext} tab={activeTab} />

      <Text variant="md" weight="semibold" leading="tight">
        Or search our partners directly
      </Text>
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
          <PartnerCard partner={item} href={buildPartnerUrl(item, activeTab, searchContext)} />
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
