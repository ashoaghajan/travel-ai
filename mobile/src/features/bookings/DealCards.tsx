import { Image, Linking, View } from 'react-native';
import type { Flight, Hotel, PriceSource } from '../../core/types/travel.types';
import { imageSource } from '../../assets/bundled-images';
import { useMoney } from '../../core/store/currency.store';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/**
 * The priced results: one fare, one stay.
 *
 * Both cards exist to answer "what does this cost" without leaving the app,
 * and both hand over to a partner to actually book — so the only action either
 * one carries is the link, and it is absent rather than dead when the provider
 * gave no URL.
 */

/**
 * Where these prices came from, said plainly.
 *
 * The screens have to be able to tell the reader: sample prices are invented,
 * and a number nobody quoted must not be shown as though somebody had. The
 * wording is the web's.
 */
export function PriceProvenance({
  source,
  quotedAt,
}: {
  source: PriceSource;
  quotedAt: string | null;
}) {
  const theme = useTheme();

  const message =
    source === 'sample'
      ? 'Example prices — no provider is quoting this route yet.'
      : source === 'listing'
        ? 'Real places, no quoted prices. The partner has the rates.'
        : quotedAt
          ? `Quoted ${new Date(quotedAt).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}.`
          : 'Quoted just now.';

  return (
    <Text variant="xs" tone="muted" leading="snug" style={{ marginBottom: theme.space.xs }}>
      {message}
    </Text>
  );
}

export function FlightCard({
  flight,
  onAddToTrip,
  isOnTrip,
}: {
  flight: Flight;
  /**
   * Record this fare against a trip. Absent for a sample fare, whose price is
   * invented and which carries no booking link — filing one would write a
   * fiction the trip tab then repeats back as fact.
   */
  onAddToTrip?: () => void;
  /** Already recorded, so the button says so rather than inviting a duplicate. */
  isOnTrip?: boolean;
}) {
  const theme = useTheme();
  const money = useMoney();

  return (
    <Card padding="lg" elevation="soft">
      <View style={{ gap: theme.space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="md" weight="semibold" leading="tight">
              {flight.airline}
            </Text>
            <Text variant="xs" tone="muted" leading="tight">
              {flight.from} → {flight.to}
            </Text>
          </View>

          <Text variant="md" weight="bold" tone="primary" leading="tight">
            {money.format(flight.price)}
          </Text>
        </View>

        <Text variant="sm" leading="tight">
          {flight.departureTime} – {flight.arrivalTime}
        </Text>

        <Text variant="xs" tone="muted" leading="tight">
          {flight.duration} ·{' '}
          {flight.stops === 0 ? 'Direct' : `${flight.stops} stop${flight.stops === 1 ? '' : 's'}`}
        </Text>

        {/*
          The day the fare actually departs, when the provider named one.
          
          Not decoration: the provider searches a cache of fares found earlier
          rather than live inventory, so a search for the 15th comes back with
          real fares on nearby days. Without this a fare on the 16th sits under
          a header saying the 15th.
        */}
        {flight.departureDate ? (
          <Text variant="xs" tone="muted" leading="tight">
            Departs {flight.departureDate}
            {flight.returnDate ? ` · returns ${flight.returnDate}` : ''}
          </Text>
        ) : null}

        {/*
          Two different acts, and the order says which is which. Adding records
          the fare and stays here; booking leaves for the partner. The primary
          button is the one that keeps the reader in the app, because the other
          is the one they cannot undo from here.
        */}
        {onAddToTrip ? (
          <Button fullWidth onPress={onAddToTrip} disabled={isOnTrip}>
            {isOnTrip ? 'On this trip' : 'Add to trip'}
          </Button>
        ) : null}

        {flight.bookingUrl ? (
          <Button
            variant="secondary"
            fullWidth
            onPress={() => void Linking.openURL(flight.bookingUrl as string)}
          >
            Book this fare
          </Button>
        ) : null}
      </View>
    </Card>
  );
}

export function HotelCard({
  hotel,
  onAddToTrip,
  isOnTrip,
  isFullyBooked,
}: {
  hotel: Hotel;
  /** Record this stay against a trip. Absent for a sample price. */
  onAddToTrip?: () => void;
  /** Already recorded, so the button says so rather than inviting a duplicate. */
  isOnTrip?: boolean;
  /**
   * Every night of the trip already has a bed booked.
   *
   * Different from `isOnTrip`, which is about *this* stay: another hotel would
   * double up on nights already paid for rather than fill anything, so the
   * button says why instead of quietly accepting it.
   */
  isFullyBooked?: boolean;
}) {
  const theme = useTheme();
  const money = useMoney();
  const photo = imageSource(hotel.image);

  return (
    <Card padding="none" elevation="soft" style={{ overflow: 'hidden' }}>
      {photo ? <Image source={photo} style={{ width: '100%', height: 140 }} resizeMode="cover" /> : null}

      <View style={{ padding: theme.space.lg, gap: theme.space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="md" weight="semibold" leading="tight">
              {hotel.name}
            </Text>
            <Text variant="xs" tone="muted" leading="tight">
              {hotel.category} · {hotel.location}
            </Text>
          </View>

          {/*
            Null is the normal case for a real stay: the listings come from a
            places directory, which knows where hotels are but not what they
            cost. Saying where the price lives beats an empty space.
          */}
          {hotel.pricePerNight === null ? (
            <Text variant="xs" tone="muted" leading="tight" style={{ maxWidth: 110, textAlign: 'right' }}>
              Price on partner site
            </Text>
          ) : (
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="md" weight="bold" tone="primary" leading="tight">
                {money.format(hotel.pricePerNight)}
              </Text>
              <Text variant="xs" tone="muted" leading="tight">
                per night
              </Text>
            </View>
          )}
        </View>

        {hotel.rating > 0 ? (
          <Text variant="xs" tone="muted" leading="tight">
            ★ <Text variant="xs" weight="semibold">{hotel.rating.toFixed(1)}</Text>
            {hotel.reviews > 0 ? ` (${hotel.reviews})` : ''}
          </Text>
        ) : null}

        {/* Adding records the stay and stays here; the link below leaves for
            the partner. Same order, and same reason, as `FlightCard`. */}
        {onAddToTrip ? (
          <Button fullWidth onPress={onAddToTrip} disabled={isOnTrip || isFullyBooked}>
            {isOnTrip ? 'On this trip' : isFullyBooked ? 'Every night booked' : 'Add to trip'}
          </Button>
        ) : null}

        {hotel.bookingUrl ? (
          <Button
            variant="secondary"
            fullWidth
            onPress={() => void Linking.openURL(hotel.bookingUrl as string)}
          >
            See this stay
          </Button>
        ) : null}
      </View>
    </Card>
  );
}
