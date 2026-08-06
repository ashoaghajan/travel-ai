import type { LatLng } from '../types/trip.types';

/**
 * The geometry the map needs, kept apart from the map itself.
 *
 * None of this imports Leaflet, so the rules that decide where the viewport
 * lands can be read and tested without a browser — which matters, because
 * jsdom has no layout and a Leaflet map cannot be rendered in the suite at all.
 */

/** `[[south, west], [north, east]]` — the shape Leaflet's `fitBounds` takes. */
export type Bounds = [[number, number], [number, number]];

/**
 * Whether a point can actually be drawn.
 *
 * Coordinates arrive from a third party, so `NaN`, `undefined` and out-of-range
 * values are all reachable. One bad point would drag a centroid into the sea
 * and stretch the bounds around half the planet.
 */
export function isPlottable(point: LatLng | undefined): point is LatLng {
  return (
    point !== undefined &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
}

/**
 * Arithmetic mean of the points.
 *
 * Good enough because every caller averages places within one city. It is wrong
 * across the antimeridian, which no single itinerary stop spans.
 */
export function centroidOf(points: (LatLng | undefined)[]): LatLng | undefined {
  const valid = points.filter(isPlottable);
  if (valid.length === 0) return undefined;

  const total = valid.reduce(
    (sum, point) => ({ lat: sum.lat + point.lat, lng: sum.lng + point.lng }),
    { lat: 0, lng: 0 },
  );

  return { lat: total.lat / valid.length, lng: total.lng / valid.length };
}

/** The box containing every plottable point, or null when there are none. */
export function boundsOf(points: (LatLng | undefined)[]): Bounds | null {
  const valid = points.filter(isPlottable);
  if (valid.length === 0) return null;

  const lats = valid.map((point) => point.lat);
  const lngs = valid.map((point) => point.lng);

  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

/**
 * True when every point sits within a few hundred metres of the others.
 *
 * `fitBounds` on a box that small zooms to the tile server's maximum, which
 * renders one pin over a car park. The caller picks a fixed zoom instead.
 */
export function isDegenerate(bounds: Bounds, epsilon = 0.005): boolean {
  return (
    Math.abs(bounds[1][0] - bounds[0][0]) < epsilon &&
    Math.abs(bounds[1][1] - bounds[0][1]) < epsilon
  );
}
