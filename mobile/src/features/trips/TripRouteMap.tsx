import { View } from 'react-native';
import type { Trip } from '../../core/types/trip.types';
import { groupItineraryStops } from '../../core/utils/trip';
import { isPlottable } from '../../core/utils/map';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/**
 * The route: where this trip goes, in order.
 *
 * **The tiles are not here yet, and that is a pending decision rather than an
 * oversight.** The web draws OpenStreetMap tiles through Leaflet and needs no
 * account to do it; every obvious React Native equivalent draws Google's tiles
 * on Android and wants an API key, which is a Google Cloud project and a
 * billing account before a single pin appears. The alternative that matches the
 * web — MapLibre against OSM — costs nothing but adds a native module that has
 * to survive a build. That trade is the reader's to make, not this file's.
 *
 * What is here is the part that matters most and would be needed either way:
 * the stops, grouped the way the map groups them, in the order they happen.
 * `groupItineraryStops` collapses consecutive days at one destination into a
 * single stop, so a week with four days in Ubud reads as one place rather than
 * four — which is what a route is.
 *
 * It also shows which stops are actually placeable. That is not debug output:
 * it is the visible half of the fix that taught the planner to supply
 * coordinates, and on a trip planned before that change most stops will say
 * they have no position.
 */
export function TripRouteMap({ trip }: { trip: Trip }) {
  const theme = useTheme();
  const stops = groupItineraryStops(trip.itinerary);
  const placed = stops.filter((stop) => isPlottable(stop.coordinates));

  if (stops.length === 0) return null;

  return (
    <Card padding="lg" elevation="soft">
      <View style={{ gap: theme.space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text variant="md" weight="semibold" leading="tight">
            Route
          </Text>
          <Text variant="xs" tone="muted">
            {placed.length} of {stops.length} placed
          </Text>
        </View>

        {stops.map((stop, index) => (
          <View key={stop.id} style={{ flexDirection: 'row', gap: theme.space.md }}>
            {/* The dot and the line under it — the timeline the web draws down
                the left of its itinerary, which reads the same on a phone. */}
            <View style={{ alignItems: 'center', width: 12 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  marginTop: 5,
                  backgroundColor: isPlottable(stop.coordinates)
                    ? theme.color.primary
                    : theme.color.border,
                }}
              />
              {index < stops.length - 1 ? (
                <View style={{ flex: 1, width: 2, backgroundColor: theme.color.border }} />
              ) : null}
            </View>

            <View style={{ flex: 1, paddingBottom: theme.space.sm, gap: 1 }}>
              <Text variant="sm" weight="medium" leading="snug">
                {stop.destination}
              </Text>
              <Text variant="xs" tone="muted">
                {stop.label.replace(`${stop.destination}`, '').trim()}
                {isPlottable(stop.coordinates)
                  ? ` · ${stop.coordinates.lat.toFixed(2)}, ${stop.coordinates.lng.toFixed(2)}`
                  : ' · no position'}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}
