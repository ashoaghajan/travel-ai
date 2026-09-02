import { STORAGE_KEYS, storageService } from './localStorage.service';
import { PlaceNotFoundError, weatherService } from './weather.service';

/**
 * Place name → IANA time zone, cached.
 *
 * The calendar export needs one of these per itinerary day: an activity at
 * 19:30 in Tbilisi has to land at 19:30 in Tbilisi, not at 19:30 wherever the
 * traveller happens to be reading. `/api/weather/place` already answers with a
 * `timezone` — this is the cache in front of it, on the same three layers as
 * `geocode.service`: memory for a re-render, storage for a reload, and a
 * promise map so two callers asking about the same city make one request.
 *
 * **A miss is expected and is not an error.** A day's `destination` is
 * documented in `PlannerDayPlan` as "a district or a nearby town" — "Sololaki &
 * Vera", "Old Town (Abanotubani)" — and the gazetteer behind that endpoint
 * holds populated places. It answers NOT_FOUND for most districts. Callers are
 * expected to fall back to the trip's own city, which is why {@link
 * resolveForTrip} takes one.
 *
 * No React component may import this file.
 */

/** Where a city sits in the world does not change. Zones do, rarely. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Negative results expire sooner: a district the gazetteer learns is a win. */
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CACHE_VERSION = 1;

/** Tiny entries, but the quota is shared with the reader's trips. */
const MAX_ENTRIES = 200;

type Entry = {
  /** ISO timestamp of the lookup. */
  at: string;
  /** Absent on a negative entry — the name resolves to no zone. */
  zone?: string;
};

type TimezoneCache = {
  version: number;
  entries: Record<string, Entry>;
};

/**
 * Labels that are not places, and must never be asked about.
 *
 * The same set `geocode.service` keeps, and for the same reason: every
 * generated trip ends on "Departure", and a request whose failure is known in
 * advance is a request worth not making.
 */
const NON_PLACES = new Set(['departure', 'your destination', 'home', 'travel day']);

function cacheKey(name: string): string {
  return name.trim().toLowerCase();
}

function readCache(): TimezoneCache {
  const cached = storageService.get<TimezoneCache | null>(STORAGE_KEYS.timezones, null);

  if (
    !cached ||
    cached.version !== CACHE_VERSION ||
    typeof cached.entries !== 'object' ||
    cached.entries === null
  ) {
    return { version: CACHE_VERSION, entries: {} };
  }

  return { version: CACHE_VERSION, entries: cached.entries };
}

function isFresh(entry: Entry): boolean {
  const age = Date.now() - new Date(entry.at).getTime();
  const ttl = entry.zone ? TTL_MS : NOT_FOUND_TTL_MS;

  return Number.isFinite(age) && age >= 0 && age < ttl;
}

function evict(entries: Record<string, Entry>): Record<string, Entry> {
  const keys = Object.keys(entries);
  if (keys.length < MAX_ENTRIES) return entries;

  const kept = keys
    .sort((a, b) => entries[b].at.localeCompare(entries[a].at))
    .slice(0, MAX_ENTRIES - 1);

  return Object.fromEntries(kept.map((key) => [key, entries[key]]));
}

function writeEntry(key: string, entry: Entry): void {
  try {
    const cache = readCache();

    storageService.set<TimezoneCache>(STORAGE_KEYS.timezones, {
      version: CACHE_VERSION,
      entries: { ...evict(cache.entries), [key]: entry },
    });
  } catch {
    // A full or blocked store must not fail a lookup that succeeded.
  }
}

const memory = new Map<string, Entry>();
const inFlight = new Map<string, Promise<string | null>>();

async function lookup(key: string, name: string): Promise<string | null> {
  try {
    const facts = await weatherService.findPlace(name);
    const zone = facts.timezone;

    // A place that resolved but carries no zone is still an answer about that
    // place, so it is cached — as a miss, which expires sooner.
    const entry: Entry = { at: new Date().toISOString(), ...(zone ? { zone } : {}) };

    memory.set(key, entry);
    writeEntry(key, entry);

    return zone ?? null;
  } catch (error) {
    if (error instanceof PlaceNotFoundError) {
      const entry: Entry = { at: new Date().toISOString() };

      memory.set(key, entry);
      writeEntry(key, entry);

      return null;
    }

    // Offline, a timeout, a 500: transient. Nothing is cached, so the next
    // export tries again rather than remembering an outage as geography.
    return null;
  }
}

export const timezoneService = {
  /** The IANA zone for a place, or null when there is none to be had. */
  async locate(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (NON_PLACES.has(trimmed.toLowerCase())) return null;

    const key = cacheKey(trimmed);
    const remembered = memory.get(key) ?? readCache().entries[key];

    if (remembered && isFresh(remembered)) {
      memory.set(key, remembered);
      return remembered.zone ?? null;
    }

    const pending =
      inFlight.get(key) ??
      lookup(key, trimmed).finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, pending);
    return pending;
  },

  /**
   * A zone for every destination a trip visits, falling back to the trip's own.
   *
   * The fallback is the point of this function. Most day labels do not resolve,
   * and an unzoned event floats to the reader's local time — which for somebody
   * in Yerevan planning Lisbon is three hours wrong on every entry. The trip's
   * city does resolve, so one lookup covers every day the districts lost.
   *
   * Sequential, like `geocodeService.locateAll`: a handful of names, most of
   * them cached, and a burst of parallel requests is the shape a free tier
   * throttles.
   */
  async resolveForTrip(
    destinations: string[],
    fallbackPlace?: string,
  ): Promise<(destination: string) => string | undefined> {
    const zones = new Map<string, string>();

    for (const name of destinations) {
      if (zones.has(name)) continue;
      const zone = await timezoneService.locate(name);
      if (zone) zones.set(name, zone);
    }

    const everyDayResolved = destinations.every((name) => zones.has(name));
    const fallback =
      everyDayResolved || !fallbackPlace ? null : await timezoneService.locate(fallbackPlace);

    return (destination: string) => zones.get(destination) ?? fallback ?? undefined;
  },

  clearCache(): void {
    memory.clear();
    inFlight.clear();
    storageService.remove(STORAGE_KEYS.timezones);
  },
};
