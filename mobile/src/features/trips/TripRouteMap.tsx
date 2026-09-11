import { View } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  ViewAnnotation,
  type LngLatBounds,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';
import type { LatLng, Trip } from '../../core/types/trip.types';
import { groupItineraryStops } from '../../core/utils/trip';
import { boundsOf, isDegenerate, isPlottable } from '../../core/utils/map';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/**
 * The route: where this trip goes, in order.
 *
 * **MapLibre against OpenStreetMap, which is what Leaflet draws on the web.**
 * The two apps therefore show the same tiles, and — the reason it was chosen —
 * it needs no account: every obvious React Native alternative renders Google's
 * tiles on Android and wants an API key, a Cloud project and a billing account
 * before one pin appears.
 *
 * The style is written here rather than fetched from a style server, so there
 * is no third party between the app and the tiles, and nothing to go down or
 * start charging.
 *
 * `groupItineraryStops` collapses consecutive days at one destination into a
 * single stop, so a week with four days in Ubud draws one pin rather than four
 * stacked on the same coordinates.
 *
 * **The numbered pins are `ViewAnnotation`s, not a symbol layer.** Drawing a
 * number with `text-field` makes MapLibre fetch a glyph set, and a style with
 * no `glyphs` URL sends it after an empty one — which is the native error
 * `[Mbgl-HttpRequest] [HTTP] Unable to parse resourceUrl` that used to appear
 * over this screen. The obvious patch is to point `glyphs` at a font server,
 * but every public one is a third party, which is the dependency the inline
 * style exists to avoid. An annotation is a real React Native view positioned
 * at a coordinate, so the number is drawn by the same `Text` as the rest of
 * the app and needs nothing from the network at all.
 */

/** OSM raster tiles, declared inline — no style server, no key, no account. */
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      // Required by the OSM tile usage policy, and shown by the map's own
      // attribution control rather than left to this component to draw.
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** A little air around the route, so pins are not flush against the edge. */
const BOUNDS_PADDING = 48;

/**
 * Somewhere booked, rather than a stop on the route.
 *
 * Kept apart from the numbered stops for the reason the web keeps them apart:
 * these are not steps in an order. They carry a colour rather than a number
 * and never join the line, which would otherwise claim the reader travels from
 * a museum to their hotel and back between every pair of days.
 *
 * Without these the map was the route and nothing else — and since
 * `groupItineraryStops` collapses consecutive days in one city into a single
 * stop, a five-day trip to Tbilisi drew exactly **one** pin. Every attraction
 * on it is a booking (`createFromItinerary` files the schedule as bookings the
 * moment a trip is saved), so all of them were on the web's map and none were
 * here.
 */
export type RoutePlaceKind = 'hotel' | 'activity' | 'ticket' | 'airport';

export type RoutePlace = {
  id: string;
  label: string;
  coordinates: LatLng;
  kind: RoutePlaceKind;
};

/**
 * One colour per kind, so a glance separates where you sleep from what you see.
 *
 * Colour rather than the web's inline SVG glyphs: those are drawn into a
 * Leaflet `divIcon` as markup, which has no equivalent here. A `ViewAnnotation`
 * is a real view, so it gets the same treatment every other small indicator in
 * this app gets — a filled dot in a token colour, sized well below the
 * numbered stops so the route stays the thing you read first.
 */
const PLACE_COLOURS = (theme: ReturnType<typeof useTheme>): Record<RoutePlaceKind, string> => ({
  hotel: theme.color.accent,
  activity: theme.color.success,
  ticket: theme.color.success,
  airport: theme.color.danger,
});

export function TripRouteMap({ trip, places = [] }: { trip: Trip; places?: RoutePlace[] }) {
  const theme = useTheme();

  const stops = groupItineraryStops(trip.itinerary);
  const placed = stops.filter((stop) => isPlottable(stop.coordinates));

  /*
   * Nothing to draw is not the same as nothing to say.
   *
   * A trip planned before the planner learned to supply coordinates has stops
   * with no position, and an empty map would read as broken. Saying how many
   * could be placed is the honest version, and it is the same sentence the web
   * shows under its map.
   */
  // A trip whose only plottable things are its bookings still gets a real map.
  if (placed.length === 0 && places.length === 0) {
    return (
      <Card padding="lg" elevation="soft">
        <Text variant="sm" weight="semibold" leading="tight">
          Route
        </Text>
        <Text variant="xs" tone="muted" leading="snug">
          None of this trip's {stops.length} stops could be placed on a map.
        </Text>
      </Card>
    );
  }

  const points = placed.map((stop) => stop.coordinates);

  /*
   * Framed against everything that will be drawn, not just the route.
   *
   * A hotel or an attraction outside the stops' own box would sit off-screen
   * on first paint, which reads as a missing pin rather than as a camera that
   * has not been told about it.
   */
  const bounds = boundsOf([...points, ...places.map((place) => place.coordinates)]);

  /*
   * One stop, or several so close together the box has no area, cannot be
   * framed by bounds — MapLibre would zoom to its maximum and show a street
   * corner. `isDegenerate` is the web's own test for exactly this, and the
   * answer is the same: centre on the place and pick a sensible zoom.
   */
  const degenerate = !bounds || isDegenerate(bounds);
  const first = points[0];

  const line = {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: points.map((point) => [point!.lng, point!.lat]),
    },
  };

  return (
    <Card padding="none" elevation="soft" style={{ overflow: 'hidden' }}>
      <View style={{ height: 220 }}>
        <Map
          mapStyle={OSM_STYLE}
          style={{ flex: 1 }}
          // A map inside a scrolling page: rotation and tilt are gestures
          // somebody is far more likely to trigger by accident than to want.
          touchRotate={false}
          touchPitch={false}
          logo={false}
        >
          <Camera
            initialViewState={
              degenerate
                ? { center: [first!.lng, first!.lat], zoom: 9 }
                : {
                    /*
                     * The two libraries disagree about order, so the
                     * conversion is explicit rather than a cast. `boundsOf`
                     * returns Leaflet's [[minLat, minLng], [maxLat, maxLng]];
                     * MapLibre wants [west, south, east, north] — longitude
                     * first. Getting this wrong puts the camera in the ocean
                     * off West Africa, which is the classic symptom.
                     */
                    bounds: [
                      bounds![0][1],
                      bounds![0][0],
                      bounds![1][1],
                      bounds![1][0],
                    ] as LngLatBounds,
                    padding: {
                      top: BOUNDS_PADDING,
                      bottom: BOUNDS_PADDING,
                      left: BOUNDS_PADDING,
                      right: BOUNDS_PADDING,
                    },
                  }
            }
          />

          {/* Only worth a line when there is somewhere to go *to*. */}
          {points.length > 1 ? (
            <GeoJSONSource id="route" data={line}>
              <Layer
                id="route-line"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{
                  'line-color': theme.color.mapRoute,
                  'line-width': 3,
                  'line-opacity': 0.85,
                }}
              />
            </GeoJSONSource>
          ) : null}

          {places.map((place) => (
            <ViewAnnotation
              key={place.id}
              id={`place-${place.id}`}
              lngLat={[place.coordinates.lng, place.coordinates.lat]}
            >
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: PLACE_COLOURS(theme)[place.kind],
                  borderWidth: 2,
                  borderColor: theme.color.textLight,
                }}
              />
            </ViewAnnotation>
          ))}

          {placed.map((stop, index) => (
            <ViewAnnotation
              key={`${stop.destination}-${index}`}
              id={`stop-${index}`}
              lngLat={[stop.coordinates!.lng, stop.coordinates!.lat]}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: theme.color.mapRoute,
                  borderWidth: 2,
                  borderColor: theme.color.textLight,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="xs" weight="bold" tone="light" leading="tight">
                  {index + 1}
                </Text>
              </View>
            </ViewAnnotation>
          ))}
        </Map>
      </View>

      <View
        style={{
          padding: theme.space.md,
          borderTopWidth: 1,
          borderTopColor: theme.color.border,
        }}
      >
        <Text variant="xs" tone="muted">
          {placed.map((stop) => stop.destination).join(' → ')}
          {placed.length < stops.length
            ? ` · ${stops.length - placed.length} not placed`
            : ''}
        </Text>
      </View>
    </Card>
  );
}
