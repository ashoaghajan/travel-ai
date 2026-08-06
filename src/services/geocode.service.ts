import type { LatLng } from '../types/trip.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import {
  MissingApiKeyError,
  UnknownPlaceError,
  openTripMapService,
} from './opentripmap.service';

/**
 * Place name → coordinates, cached.
 *
 * The trip map needs a point per stop, and a trip stores only a destination
 * string, so this is the bridge. It is a service rather than a call inside a
 * hook for one reason: geocoding the same six stops on every visit to a trip
 * page would spend the OpenTripMap quota on an answer that has not changed
 * since the town was founded.
 *
 * Three layers: an in-memory map (survives a re-render), a localStorage cache
 * (survives a reload), and a promise map so two concurrent callers share one
 * request. No React component may import this file.
 */

/** Where a town is does not change. Long, because a miss costs a request. */
const FOUND_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Negative results expire far sooner. "Departure" will never be a place, but a
 * name the API does not know today may be one it learns, and a stop the reader
 * renames deserves a fresh attempt without clearing the whole cache.
 */
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Bump to invalidate every cached copy after a shape change. */
const CACHE_VERSION = 1;

/** ~90 bytes an entry, on a 5 MB quota shared with the reader's trips. */
const MAX_ENTRIES = 200;

/**
 * Labels the itinerary templates use that are not places.
 *
 * Every generated trip ends on "Departure", and a prompt naming nowhere yields
 * "Your destination". Asking the API about these is a request whose failure is
 * known in advance, so they never leave the browser.
 */
const NON_PLACES = new Set(['departure', 'your destination', 'home', 'travel day']);

export type GeocodeResult = LatLng & { name: string };

type Entry = {
  /** ISO timestamp of the lookup. */
  at: string;
  /** Absent on a negative entry — the place is known not to exist. */
  point?: GeocodeResult;
};

type GeocodeCache = {
  version: number;
  entries: Record<string, Entry>;
};

/** The country is part of the identity: Barcelona, Venezuela is a real answer. */
function cacheKey(name: string, countryCode?: string): string {
  return `${(countryCode ?? '').toUpperCase()}|${name.trim().toLowerCase()}`;
}

function readCache(): GeocodeCache {
  const cached = storageService.get<GeocodeCache | null>(STORAGE_KEYS.geocodes, null);

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
  const ttl = entry.point ? FOUND_TTL_MS : NOT_FOUND_TTL_MS;

  return Number.isFinite(age) && age >= 0 && age < ttl;
}

/** Oldest lookups go first once the cache is full. */
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

    storageService.set<GeocodeCache>(STORAGE_KEYS.geocodes, {
      version: CACHE_VERSION,
      entries: { ...evict(cache.entries), [key]: entry },
    });
  } catch {
    // Full or blocked storage must not fail a lookup that succeeded — the point
    // is still returned, it just will not survive the reload.
  }
}

/** Mirrors the stored cache so a re-render never parses JSON. */
const memory = new Map<string, Entry>();

/** One request per place, shared by concurrent callers. */
const inFlight = new Map<string, Promise<GeocodeResult | null>>();

async function lookup(
  key: string,
  name: string,
  countryCode?: string,
): Promise<GeocodeResult | null> {
  try {
    const found = await openTripMapService.findDestination(name, countryCode);
    // `lon` becomes `lng` here and nowhere else.
    const point: GeocodeResult = { lat: found.lat, lng: found.lon, name: found.name };
    const entry: Entry = { at: new Date().toISOString(), point };

    memory.set(key, entry);
    writeEntry(key, entry);
    return point;
  } catch (error) {
    // A missing key is a fact about our configuration, not about the place.
    // Caching it would poison every stop the moment a key is added.
    if (error instanceof MissingApiKeyError) throw error;

    if (error instanceof UnknownPlaceError) {
      const entry: Entry = { at: new Date().toISOString() };

      memory.set(key, entry);
      writeEntry(key, entry);
      return null;
    }

    // Offline, a timeout, a 500: transient. Nothing is cached, so the next
    // visit tries again rather than remembering an outage as geography.
    return null;
  }
}

export const geocodeService = {
  /**
   * Coordinates for a place name, or null when there are none to be had.
   *
   * Null is an answer, not a failure: half the stops on a generated trip are
   * labels rather than places, and the map is expected to draw the rest. Only
   * `MissingApiKeyError` throws, because that is worth saying once — and
   * saying, rather than silently showing an empty map.
   */
  async locate(name: string, countryCode?: string): Promise<GeocodeResult | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (NON_PLACES.has(trimmed.toLowerCase())) return null;

    const key = cacheKey(trimmed, countryCode);
    const remembered = memory.get(key) ?? readCache().entries[key];

    if (remembered && isFresh(remembered)) {
      memory.set(key, remembered);
      return remembered.point ?? null;
    }

    const pending =
      inFlight.get(key) ??
      lookup(key, trimmed, countryCode).finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, pending);
    return pending;
  },

  /**
   * Several places, one after another.
   *
   * Sequential on purpose: a trip has a handful of stops, cached ones resolve
   * without touching the network, and a burst of parallel requests is the shape
   * of traffic a free tier throttles. Repeated names are looked up once.
   */
  async locateAll(
    names: string[],
    countryCode?: string,
  ): Promise<Map<string, GeocodeResult | null>> {
    const results = new Map<string, GeocodeResult | null>();

    for (const name of names) {
      if (results.has(name)) continue;
      results.set(name, await geocodeService.locate(name, countryCode));
    }

    return results;
  },

  clearCache(): void {
    memory.clear();
    inFlight.clear();
    storageService.remove(STORAGE_KEYS.geocodes);
  },
};
