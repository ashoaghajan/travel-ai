import { Suspense, lazy } from 'react';
import { MapView } from './MapView';
import type { MapStop } from './MapView';
import type { RouteMapProps } from './RouteMap';

/**
 * `RouteMap`, loaded on demand.
 *
 * ~46 KB gzipped of map library has no business in the first paint of a page
 * that may never plot anything, and the lazy boundary also keeps `leaflet` —
 * which touches `window` at module scope — out of the test environment.
 *
 * Shared so every caller gets the same chunk and the same fallback: the
 * stylised `MapView` card, which is a designed placeholder rather than a
 * spinner, so nothing jumps when the real tiles arrive.
 */
const RouteMap = lazy(() => import('./RouteMap'));

export type LazyRouteMapProps = RouteMapProps & {
  /** Drawn while the map chunk loads. Defaults to the points themselves. */
  fallbackStops?: MapStop[];
};

export function LazyRouteMap({ fallbackStops, ...props }: LazyRouteMapProps) {
  const stops = fallbackStops ?? props.points.map((point) => ({ id: point.id, label: point.label }));

  return (
    <Suspense fallback={<MapView stops={stops} size={props.size} caption="Loading the map…" />}>
      <RouteMap {...props} />
    </Suspense>
  );
}
