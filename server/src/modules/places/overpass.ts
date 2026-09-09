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
 * timeout it will actually honour. A failure here is never fatal: the caller
 * gets an empty list, and an empty list is what turns the rule off.
 *
 * API: https://wiki.openstreetmap.org/wiki/Overpass_API
 */

const BASE_URL = 'https://overpass-api.de/api/interpreter';

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
 * Metro stations within reach of a point.
 *
 * **Never throws.** Every failure — the network, a timeout, a rate limit, a
 * body that is not what was expected — comes back as an empty array, because
 * the one thing this must not do is turn "we could not ask" into "there are
 * none", which the planner would read as "nothing qualifies" and answer with
 * an empty trip. The caller cannot tell a city with no metro from a request
 * that failed, and deliberately does not need to.
 */
export async function fetchMetroStations(lat: number, lon: number): Promise<MetroStation[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams({ data: buildQuery(lat, lon) }).toString(),
      signal: controller.signal,
    });

    if (!response.ok) return [];

    const body = (await response.json()) as { elements?: OverpassElement[] };
    const elements = Array.isArray(body.elements) ? body.elements : [];

    const stations: MetroStation[] = [];

    for (const element of elements) {
      const point = pointOf(element);
      if (!point) continue;

      stations.push({ ...point, name: element.tags?.name ?? '' });
      if (stations.length >= MAX_STATIONS) break;
    }

    return stations;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
