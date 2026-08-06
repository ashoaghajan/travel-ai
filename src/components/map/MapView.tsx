import { cx } from '../../utils/cx';
import styles from './MapView.module.css';

export type MapStop = {
  id: string;
  /** "Day 1-2 Ubud" */
  label: string;
};

export type MapViewProps = {
  stops: MapStop[];
  size?: 'md' | 'lg';
  /**
   * Draws the purple line between markers. Turn it off for unordered points —
   * hotels in a city are not a route.
   */
  showRoute?: boolean;
  /** Overrides the caption in the corner. */
  caption?: string;
  className?: string;
};

const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 300;

/** Stable per-label offset so the same trip always draws the same route. */
function hashOf(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type Point = { x: number; y: number };

function pointFor(index: number, total: number, seed: string): Point {
  const progress = total <= 1 ? 0.5 : index / (total - 1);
  const x = 54 + progress * (VIEW_WIDTH - 108);
  const arc = Math.sin(progress * Math.PI * 1.15) * 46;
  const jitter = (hashOf(seed) % 26) - 13;

  return { x, y: clamp(214 - arc + jitter, 132, 248) };
}

/** Smooth cubic path through the stops. */
function routePath(points: Point[]): string {
  if (points.length === 0) return '';

  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;

    const previous = points[index - 1];
    const controlOffset = (point.x - previous.x) / 2;

    return (
      `${path} C ${previous.x + controlOffset} ${previous.y}, ` +
      `${point.x - controlOffset} ${point.y}, ${point.x} ${point.y}`
    );
  }, '');
}

/**
 * Placeholder route map (DESIGN_SPEC Screen 3): pale green land, pale blue
 * water, a purple route line and purple markers.
 *
 * Stage 1 explicitly does not block on a map provider — this component is the
 * seam where Mapbox or Google Maps drops in later, with the same `stops` prop.
 */
export function MapView({
  stops,
  size = 'md',
  showRoute = true,
  caption = 'Route preview',
  className,
}: MapViewProps) {
  const points = stops.map((stop, index) => pointFor(index, stops.length, stop.id + stop.label));
  const labels = stops.map((stop) => stop.label).join(', ');

  return (
    <div
      className={cx(styles.map, styles[size], className)}
      role="img"
      aria-label={
        showRoute
          ? `Route map with ${stops.length} stops: ${labels}`
          : `Map with ${stops.length} locations: ${labels}`
      }
    >
      <svg
        className={styles.canvas}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} className={styles.water} />

        <path
          className={styles.land}
          d="M0 300 L0 172 C 38 152 64 180 98 166 C 142 148 158 106 208 110 C 254 114 270 84 314 94 C 350 102 374 82 400 90 L400 300 Z"
        />
        <path
          className={styles.landAlt}
          d="M296 44 C 318 28 352 34 362 54 C 370 72 344 82 322 74 C 302 66 286 58 296 44 Z"
        />

        {showRoute && points.length > 1 ? (
          <path className={styles.route} d={routePath(points)} />
        ) : null}

        {points.map((point, index) => (
          <g key={stops[index].id}>
            <circle className={styles.markerHalo} cx={point.x} cy={point.y} r={11} />
            <circle className={styles.marker} cx={point.x} cy={point.y} r={6} />
          </g>
        ))}
      </svg>

      <ol className={styles.labels}>
        {stops.map((stop, index) => (
          <li
            key={stop.id}
            className={cx(styles.label, index % 2 === 0 ? styles.above : styles.below)}
            style={{
              left: `${(points[index].x / VIEW_WIDTH) * 100}%`,
              top: `${(points[index].y / VIEW_HEIGHT) * 100}%`,
            }}
          >
            {stop.label}
          </li>
        ))}
      </ol>

      <p className={styles.caption}>{caption}</p>
    </div>
  );
}
