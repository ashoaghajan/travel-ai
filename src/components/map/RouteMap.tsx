import { useEffect, useMemo } from 'react';
import { divIcon } from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { LatLng } from '../../types/trip.types';
import { boundsOf, isDegenerate } from '../../utils/map';
import type { Bounds } from '../../utils/map';
import { cx } from '../../utils/cx';
import styles from './RouteMap.module.css';
import 'leaflet/dist/leaflet.css';

/**
 * The trip route on a real map: OpenStreetMap raster tiles, purple pins in
 * itinerary order, a straight line between them.
 *
 * Straight, not routed: there is no routing provider here, and a curve drawn
 * between two islands would be inventing a road. The line reads as "these came
 * one after another", which is what the itinerary actually claims.
 *
 * Default-exported so it can be lazily imported — Leaflet is ~42 KB gzipped and
 * has no business in the first paint of a page that may never show a map. The
 * lazy boundary also keeps `leaflet` (which touches `window` at module scope)
 * out of the Vitest node environment.
 */

export type RoutePoint = {
  id: string;
  label: string;
  coordinates: LatLng;
};

/** What a booked place is, which decides its glyph. */
export type RoutePlaceKind = 'hotel' | 'activity' | 'ticket' | 'airport';

/**
 * Somewhere booked, rather than a stop on the route.
 *
 * Kept apart from `RoutePoint` because these are not steps in an order: they
 * carry a glyph rather than a number and never join the line, which would
 * otherwise claim the reader travels from a stop to their hotel and back.
 */
export type RoutePlace = RoutePoint & { kind: RoutePlaceKind };

export type RouteMapProps = {
  /** Plottable stops only, in itinerary order. */
  points: RoutePoint[];
  /** Booked hotels, tickets and attractions. Off the route line, on the map. */
  places?: RoutePlace[];
  size?: 'md' | 'lg';
  /** The purple line between points. Off for unordered sets. */
  showRoute?: boolean;
  /**
   * Off by default: in the sticky itinerary aside a wheel gesture belongs to the
   * page, and capturing it pins the reader against a map they cannot scroll past.
   */
  scrollWheelZoom?: boolean;
  className?: string;
  ariaLabel: string;
};

/** Zoomed further out than the tiles allow — a street map of one pin is noise. */
const MAX_FIT_ZOOM = 12;
/** Used when every point lands on the same spot, where bounds say nothing. */
const SINGLE_POINT_ZOOM = 13;
const MIN_ZOOM = 2;
const MAX_ZOOM = 17;
const FIT_PADDING: [number, number] = [36, 36];

/**
 * One constant, so swapping to a keyed provider in Stage 2 is one line.
 *
 * HTTPS and the visible attribution below are both required by the OSM tile
 * usage policy — they are the basis on which these tiles are free to use.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function toLatLng(point: LatLng): LatLngExpression {
  return [point.lat, point.lng];
}

/**
 * A purple numbered pin, drawn in HTML.
 *
 * Leaflet's default marker is a PNG referenced by a relative path from inside
 * its own stylesheet, which bundlers resolve to a 404 unless the image imports
 * are re-pointed by hand. A `divIcon` sidesteps that entirely, and is the only
 * way to honour "map pins should be purple" (DESIGN_SPEC §4) with a token
 * rather than a recoloured sprite.
 *
 * `html` carries an index and nothing else. Labels go through `<Tooltip>`, whose
 * children React escapes — never interpolate an editable string into this.
 */
function pinFor(index: number) {
  return divIcon({
    className: styles.pinIcon,
    html: `<span class="${styles.pin}">${index + 1}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    tooltipAnchor: [0, -16],
  });
}

/**
 * One fixed glyph per kind, as inline SVG path data.
 *
 * Constants, never interpolated from a booking — `html` is raw markup, and a
 * title the reader typed has no business reaching it. The name is rendered by
 * `<Tooltip>`, whose children React escapes.
 */
const PLACE_GLYPHS: Record<RoutePlaceKind, string> = {
  hotel: '<path d="M3 10.5 9 5l6 5.5" /><path d="M4.5 9.6V15h9V9.6" />',
  activity: '<circle cx="9" cy="9" r="5.2" /><path d="M9 3.8v10.4M3.8 9h10.4" />',
  ticket: '<path d="M3.4 7.2V5.4h11.2v1.8a1.8 1.8 0 0 0 0 3.6v1.8H3.4v-1.8a1.8 1.8 0 0 0 0-3.6Z" />',
  // The way in and the way out. A trip's map without them showed where the
  // reader would be but never how they arrive.
  airport: '<path d="M2.6 9.4 15.4 4.6l-3 5.2 1.2 4.2-2.2-.8-1.6-2.6-5.4 1.4Z" />',
};

/** Class per kind, so a hotel pin is the colour a hotel is everywhere else. */
const PLACE_CLASS: Record<RoutePlaceKind, string> = {
  hotel: styles.placeHotel,
  activity: styles.placeActivity,
  ticket: styles.placeTicket,
  airport: styles.placeAirport,
};

/**
 * A booked place, drawn as an outlined marker rather than a numbered one.
 *
 * Deliberately unlike the route pins: these have no position in the itinerary,
 * and numbering them would invent an order the trip does not claim.
 */
function placePinFor(kind: RoutePlaceKind) {
  return divIcon({
    className: styles.pinIcon,
    html: `<span class="${styles.placePin} ${PLACE_CLASS[kind]}"><svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PLACE_GLYPHS[kind]}</svg></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    tooltipAnchor: [0, -15],
  });
}

/**
 * Keeps the viewport on the route.
 *
 * `MapContainer`'s `center`/`zoom`/`bounds` props are read once at mount and
 * ignored afterwards, so refitting when a stop is added in edit mode has to
 * happen from inside, through the map instance.
 */
function FitToRoute({ bounds }: { bounds: Bounds }) {
  const map = useMap();
  // The bounds array is rebuilt every render; its contents are what changed.
  const key = bounds.flat().join(',');

  useEffect(() => {
    if (isDegenerate(bounds)) {
      map.setView([bounds[0][0], bounds[0][1]], SINGLE_POINT_ZOOM);
      return;
    }

    map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  return null;
}

/**
 * Re-measures the map when its box changes.
 *
 * Leaflet measures its container once, at mount. The itinerary aside only
 * appears at 1024px and the map tab mounts inside a panel that was not laid out
 * yet — either leaves Leaflet convinced it is 0×0, showing a grey box.
 */
function TrackSize() {
  const map = useMap();

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(map.getContainer());

    return () => observer.disconnect();
  }, [map]);

  return null;
}

export default function RouteMap({
  points,
  places = [],
  size = 'md',
  showRoute = true,
  scrollWheelZoom = false,
  className,
  ariaLabel,
}: RouteMapProps) {
  /*
   * What the viewport is framed around.
   *
   * Booked places count: a hotel outside the route's box would otherwise sit
   * off-screen until the reader went looking for it.
   *
   * Airports deliberately do not. The airport you fly *from* is wherever you
   * live — a trip to Yerevan from Abu Dhabi is two thousand kilometres wide,
   * and fitting both ends shrinks the city you are actually visiting to a
   * dot. They are still drawn; they simply do not drag the frame to them, so
   * the destination airport shows up beside the city and the origin waits
   * until the reader zooms out.
   */
  const framed = useMemo(
    () => [...points, ...places.filter((place) => place.kind !== 'airport')],
    [points, places],
  );

  const bounds = useMemo(
    () =>
      boundsOf(
        (framed.length > 0 ? framed : places).map((point) => point.coordinates),
      ),
    [framed, places],
  );
  const line = useMemo(() => points.map((point) => toLatLng(point.coordinates)), [points]);

  // The caller decides what to show instead; this component draws points or
  // nothing, and never an empty world map.
  if (!bounds || (points.length === 0 && places.length === 0)) return null;

  return (
    <div className={cx(styles.frame, styles[size], className)} role="group" aria-label={ariaLabel}>
      <MapContainer
        className={styles.map}
        // Replaced by `FitToRoute` on the first commit; these exist only because
        // MapContainer refuses to mount without a view.
        center={toLatLng((points[0] ?? places[0]).coordinates)}
        zoom={SINGLE_POINT_ZOOM}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        scrollWheelZoom={scrollWheelZoom}
        // A route map is not a globe: one copy of the world, no infinite pan.
        worldCopyJump={false}
        /*
         * Tiles paint on arrival rather than fading in.
         *
         * Leaflet's fade sets every tile to `opacity: 0` and walks it back up
         * over 200ms from a `requestAnimationFrame` loop. Where those frames do
         * not run — a tab opened in the background, a throttled or occluded
         * window — the walk never starts and the tiles stay invisible: a map
         * with correct pins, correct attribution and no ground under them.
         * There is nothing worth animating here to weigh against that.
         */
        fadeAnimation={false}
      >
        <TileLayer
          url={TILE_URL}
          attribution={TILE_ATTRIBUTION}
          maxZoom={MAX_ZOOM}
          detectRetina
        />

        <FitToRoute bounds={bounds} />
        <TrackSize />

        {showRoute && line.length > 1 ? (
          <Polyline positions={line} className={styles.route} />
        ) : null}

        {points.map((point, index) => (
          <Marker key={point.id} position={toLatLng(point.coordinates)} icon={pinFor(index)}>
            <Tooltip direction="top" offset={[0, -4]} className={styles.tooltip}>
              {point.label}
            </Tooltip>
          </Marker>
        ))}

        {places.map((place) => (
          <Marker
            key={place.id}
            position={toLatLng(place.coordinates)}
            icon={placePinFor(place.kind)}
          >
            <Tooltip direction="top" offset={[0, -4]} className={styles.tooltip}>
              {place.label}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
