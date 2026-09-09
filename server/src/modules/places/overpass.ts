/**
 * The Overpass client — metro stations, from OpenStreetMap itself.
 *
 * Here because the planner offers "only places near a metro" and OpenTripMap
 * cannot answer it. It has no subway category at all — `subway_entrances` and
 * `metro` are both rejected outright — and the nearest thing it does have,
 * `railway_stations`, is indexed on notability rather than on service: within
 * 15 km of the middle of Tbilisi it returns **nothing**, in a city with a
 * 23-station metro, and in Yerevan it returns the mainline terminus and none
 * of the metro. A rule built on that does not narrow a trip, it empties one.
 *
 * Overpass queries the OSM database directly, so a station is a station
 * because the map says it is one: the same two cities answer with 23 and with
 * the full network. It is keyless, which is the other reason it fits — no
 * account to hold, nothing to expire.
 *
 * What it costs is care about traffic. Overpass is volunteer-run and its usage
 * policy asks for modest, identified use, so this is server-side, behind a
 * long cache, asked once per city rather than once per trip, and given a
 * timeout it will actually honour. A failure here is never fatal: it comes
 * back as `null`, which the route declines to cache and the planner reads as
 * "cannot judge" — see `fetchMetroStations`.
 *
 * API: https://wiki.openstreetmap.org/wiki/Overpass_API
 */

/**
 * One instance, and the mirrors are deliberately not here.
 *
 * They were added when this answered nothing from Render and everything from
 * a laptop, on the theory that the main instance blocks cloud addresses. Then
 * they were measured, and the theory did not survive the measurement:
 * `overpass.kumi.systems` answers in **74 seconds** off data six weeks stale,
 * and `overpass.private.coffee` answers 504. Against a 20-second budget
 * neither can ever win, so a fallback list only spends another 40 seconds of
 * somebody's trip before failing anyway.
 *
 * `overpass-api.de` itself answers the same query in **1.2 seconds** with
 * current data. So the fix for a failure here is not a second address; it is
 * finding out what the first one said, which is why `null` now travels all the
 * way out as `Cache-Control: no-store` — a failing lookup is visible from
 * outside instead of looking like a city with no metro.
 */
const INSTANCE = 'https://overpass-api.de/api/interpreter';

/**
 * Longer than the other providers get, because Overpass is genuinely slower:
 * it is running a query, not reading an index. Still bounded, because a trip
 * being planned is waiting on it.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/** The budget Overpass itself is asked to work within, in seconds. */
const QUERY_TIMEOUT_S = 15;

/**
 * Identifies the sender, as the usage policy asks. Overpass is less strict
 * about this than Nominatim, which is not a reason to be less polite.
 */
const USER_AGENT = 'ai-travel-planner/1.0 (+https://travel-ai-io1t.onrender.com)';

/**
 * How far around a city centre to look, in metres.
 *
 * Wide enough for a network's outer ends — a metro reaches well past the
 * middle of the city it serves — and the result is only ever used to measure
 * *to*, so an extra station on the far edge costs nothing but a comparison.
 */
const SEARCH_RADIUS_M = 25_000;

/**
 * A ceiling on what one city can return.
 *
 * Not a correctness limit but a memory one: this list is sent to a phone and
 * held while a trip is planned. The largest networks in the world are a few
 * hundred stations, so nothing real is being cut off here.
 */
const MAX_STATIONS = 600;

export type MetroStation = {
  lat: number;
  lng: number;
  /** OSM's name, empty when the node carries none. For nothing but debugging. */
  name: string;
};

type OverpassElement = {
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

/**
 * Everything OSM tags as a metro stop, by all three of the spellings in use.
 *
 * `station=subway` is the modern tagging and the bulk of the answer.
 * `railway=subway_entrance` catches networks mapped by their street entrances
 * rather than by a station node, which is common in older imports — an
 * entrance is arguably the better thing to measure a walk to anyway.
 * `station=light_rail` is included because the distinction between a metro and
 * a light rail line is a local one that a reader asking for "near the metro"
 * is not making: in Tbilisi it is the metro, in Los Angeles it is the same
 * network under a different word.
 *
 * `nwr` rather than `node`, because a large station is mapped as a way or a
 * relation and `out center` is what reduces either to a point.
 */
const QUERY_BODY = [
  'nwr["station"="subway"](around:{radius},{lat},{lon});',
  'nwr["station"="light_rail"](around:{radius},{lat},{lon});',
  'nwr["railway"="subway_entrance"](around:{radius},{lat},{lon});',
].join('');

function buildQuery(lat: number, lon: number): string {
  const body = QUERY_BODY.replaceAll('{radius}', String(SEARCH_RADIUS_M))
    .replaceAll('{lat}', String(lat))
    .replaceAll('{lon}', String(lon));

  return `[out:json][timeout:${QUERY_TIMEOUT_S}];(${body});out center tags;`;
}

/** A point for an element, whether it was mapped as a node or as an area. */
function pointOf(element: OverpassElement): { lat: number; lng: number } | null {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;

  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { lat, lng: lon };
}

/**
 * Asked once.
 *
 * `null` means the question could not be put — a refusal, a timeout, a body
 * that made no sense. `[]` means it was put and answered with nothing, which
 * is a real fact about a city. Keeping those apart is the whole point of this
 * function, and the bug that produced it: a first deploy that could not reach
 * Overpass at all reported every city as having no metro.
 */
async function askOverpass(lat: number, lon: number): Promise<MetroStation[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(INSTANCE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams({ data: buildQuery(lat, lon) }).toString(),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const body = (await response.json()) as { elements?: OverpassElement[] };
    if (!Array.isArray(body.elements)) return null;

    const stations: MetroStation[] = [];

    for (const element of body.elements) {
      const point = pointOf(element);
      if (!point) continue;

      stations.push({ ...point, name: element.tags?.name ?? '' });
      if (stations.length >= MAX_STATIONS) break;
    }

    return stations;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Metro stations within reach of a point.
 *
 * **Never throws, and never conflates its two empty answers.** `[]` is a city
 * that has no metro, or none that anyone has mapped. `null` is every instance
 * declining to answer — and the caller must cache those differently, because
 * a day-long cache of a failure is a day of a preference quietly doing
 * nothing. That distinction was learned in production: the first deploy of
 * this answered `[]` for Paris, which has three hundred stations.
 *
 * The planner still treats both as "cannot judge" and stops filtering. That is
 * right there and wrong here: a rule must fail open, and a cache must not
 * remember a failure as a fact.
 */
export async function fetchMetroStations(
  lat: number,
  lon: number,
): Promise<MetroStation[] | null> {
  return askOverpass(lat, lon);
}
