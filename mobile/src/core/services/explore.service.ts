import type { Trip } from '../types/trip.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { activityService } from './activity.service';
import type { ActivitiesResult } from './activity.service';
import { countryService } from './country.service';
import type { Country } from './country.service';
import { cityService } from './city.service';
import { locationService } from './location.service';
import type { DevicePlace, LocationPermission } from './location.service';

/**
 * Re-exported so `useExplore` still imports one module rather than four. The
 * error is a value rather than a type because the hook matches on it to tell a
 * refusal from a failure.
 */
export { LocationError } from './location.service';
export type { DevicePlace, LocationPermission } from './location.service';

/**
 * Where the explorer is pointed, and what is there.
 *
 * Owns the country/city selection and its persistence, and composes the three
 * services that answer it: `country.service` for the list of countries,
 * `city.service` for one country's cities, and `activity.service` for the
 * attractions in a chosen city. Keeping the composition here is what lets
 * `useExplore` import one module instead of four, and what gives Stage 2 a
 * single seam to move behind `GET /api/explore`.
 *
 * The selection comes from three sources, in this order:
 *
 * 1. an explicit choice the reader made here, persisted across reloads;
 * 2. where the device says it is;
 * 3. the country and city of the trip they last opened.
 *
 * A choice outranks both — someone who deliberately switched to Barcelona
 * should not find themselves somewhere else because they glanced at an
 * itinerary or walked through an airport.
 *
 * **The device outranks the trip**, which is the one ordering here worth
 * arguing about. The explorer answers "what is there", and the likeliest
 * unspoken subject of that question is where the reader is standing: a trip
 * they opened last week is a plan, and the city around them is a fact. The
 * trip is not lost — the page offers it as a named, one-press alternative,
 * and taking it is a choice like any other.
 *
 * `adoptPlace` is what makes that press durable. Both the trip offer and the
 * "Use my location" button go through it, because pressing either one *is*
 * saying something, and a reload should not forget it.
 */

/** Longer than any real place name; guards against a junk write. */
const MAX_NAME_LENGTH = 120;

export type SelectionSource = 'chosen' | 'trip' | 'device' | 'none';

export type ExploreSelection = {
  /** ISO 3166-1 alpha-2, or null when no country is settled on. */
  countryCode: string | null;
  /** Country display name — also the key `city.service` expects. */
  countryName: string | null;
  /** Null when a country is chosen but a city is not yet. */
  city: string | null;
  source: SelectionSource;
};

const EMPTY_SELECTION: ExploreSelection = {
  countryCode: null,
  countryName: null,
  city: null,
  source: 'none',
};

/** Collapses whitespace and rejects anything that is not a usable name. */
export function normaliseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return null;

  return trimmed;
}

/** ISO 3166-1 alpha-2, or null. */
export function normaliseCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

type StoredCountry = { code: string; name: string };

export type ChosenSelection = { country: StoredCountry | null; city: string | null };

/**
 * Standalone rather than a method so `resolveSelection` can default to it —
 * a method referencing its own object in a default would make the service's
 * type circular.
 */
function readChosenSelection(): ChosenSelection {
  return {
    country: readStoredCountry(),
    city: normaliseName(storageService.get<string | null>(STORAGE_KEYS.selectedCity, null)),
  };
}

function readStoredCountry(): StoredCountry | null {
  const stored = storageService.get<Partial<StoredCountry> | null>(
    STORAGE_KEYS.selectedCountry,
    null,
  );

  const code = normaliseCountryCode(stored?.code);
  const name = normaliseName(stored?.name);

  return code && name ? { code, name } : null;
}

/**
 * The trip's country and city.
 *
 * `destinationCountry` and `destinationCity` are the fields to use, but trips
 * created before they existed only carry `destination` — a single string like
 * "Bali". Reading that as a city gives those trips a working explorer without
 * a migration; the country stays unknown, which only costs the ISO filter.
 */
function tripSelection(trips: Trip[], activeTripId: string | null): ExploreSelection | null {
  if (!activeTripId) return null;

  const active = trips.find((trip) => trip.id === activeTripId);
  if (!active) return null;

  const countryName = normaliseName(active.destinationCountry);
  const city = normaliseName(active.destinationCity) ?? normaliseName(active.destination);

  if (!countryName && !city) return null;

  return { countryCode: null, countryName, city, source: 'trip' };
}

/**
 * The device's fix, as a selection.
 *
 * Null when the fix names no country: a city with no country cannot drive the
 * city lookup, which is keyed by country name, so half an answer here is no
 * answer. `countries` supplies the spelling, exactly as it does for a trip.
 */
function deviceSelection(
  device: DevicePlace | null,
  countries: Country[],
): ExploreSelection | null {
  if (!device) return null;

  const code = normaliseCountryCode(device.countryCode);
  const name = normaliseName(device.countryName);
  const matched = countryService.find(countries, code);
  const countryName = matched?.name ?? name;

  if (!countryName) return null;

  return {
    countryCode: matched?.code ?? code,
    countryName,
    city: normaliseName(device.city),
    source: 'device',
  };
}

export const exploreService = {
  /* ------------------------------------------------------------- lookups */

  /** Every country, alphabetically. Cached — see `country.service`. */
  async getCountries(options: { forceRefresh?: boolean } = {}): Promise<Country[]> {
    return countryService.getCountries(options);
  },

  /** The cities of one country, alphabetically. Cached — see `city.service`. */
  async getCities(countryName: string, options: { forceRefresh?: boolean } = {}): Promise<string[]> {
    return cityService.getCities(countryName, options);
  },

  /** Type-ahead matches, so the selector never renders 16,000 options. */
  filterCities(cities: string[], query: string, limit?: number): string[] {
    return cityService.filter(cities, query, limit);
  },

  /* ------------------------------------------------------------ the device */

  /** Whether this device could say where it is, and whether it has agreed to. */
  getLocationPermission(): Promise<LocationPermission> {
    return locationService.getPermission();
  },

  /** The last fix, if it is still current — see `location.service`. */
  getRememberedLocation(): DevicePlace | null {
    return locationService.getRemembered();
  },

  /**
   * Where the device is. `prompt: true` asks for permission and throws when it
   * cannot have it; the default does neither. See `location.service`.
   */
  locateDevice(options: { prompt?: boolean } = {}): Promise<DevicePlace | null> {
    return locationService.locate(options);
  },

  /**
   * Turns somewhere the reader did not type into a choice they own.
   *
   * Takes a `DevicePlace` because a fix and a resolved trip destination are
   * the same three fields, and both reach here the same way: the reader
   * pressed something that named a place. Making that a *stored* choice is
   * what stops the next reload undoing it.
   *
   * The country goes through `countries` so the stored name is the list's own
   * — `setCountry` is what the city lookup is keyed by, and a name spelled any
   * other way seats a country whose cities never load. The place's own name is
   * the fallback, on the reasoning in `/reference/location`: a country list
   * that has not arrived yet should cost the suggestions, not the selection.
   *
   * Does nothing when there is no usable country, which is the caller's cue
   * that the selection has been left where it was.
   */
  adoptPlace(place: DevicePlace, countries: Country[] = []): void {
    const code = normaliseCountryCode(place.countryCode);
    const name = normaliseName(place.countryName);
    if (!code) return;

    const matched = countryService.find(countries, code);
    if (!matched && !name) return;

    exploreService.setCountry(matched ?? { code, name: name as string });

    // After the country, always: `setCountry` clears the city, which is the
    // right thing when a reader swaps countries and the wrong order here.
    if (place.city) exploreService.setCity(place.city);
  },

  /* ----------------------------------------------------------- selection */

  /** The reader's explicit choice, or null where they have not made one. */
  getChosenSelection(): ChosenSelection {
    return readChosenSelection();
  },

  /**
   * Records a chosen country. Clears the city, which belongs to the country
   * that is being replaced.
   */
  setCountry(country: Country): void {
    const code = normaliseCountryCode(country.code);
    const name = normaliseName(country.name);
    if (!code || !name) return;

    try {
      storageService.set(STORAGE_KEYS.selectedCountry, { code, name } satisfies StoredCountry);
      storageService.remove(STORAGE_KEYS.selectedCity);
    } catch {
      // Full or blocked storage: the session still works, it just forgets.
    }
  },

  /** Records a chosen city. Returns the stored form, or null if unusable. */
  setCity(city: string): string | null {
    const name = normaliseName(city);
    if (!name) return null;

    try {
      storageService.set(STORAGE_KEYS.selectedCity, name);
    } catch {
      // As above — persistence is best effort.
    }

    return name;
  },

  /** Drops the choice, handing the decision back to the device and the trip. */
  clearSelection(): void {
    storageService.remove(STORAGE_KEYS.selectedCountry);
    storageService.remove(STORAGE_KEYS.selectedCity);
  },

  /** Notifies when either half of the choice changes, including another tab. */
  subscribe(listener: () => void): () => void {
    const unsubscribes = [
      storageService.subscribe(STORAGE_KEYS.selectedCountry, listener),
      storageService.subscribe(STORAGE_KEYS.selectedCity, listener),
    ];

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  },

  /**
   * What the explorer should be showing, and where it came from.
   *
   * `countries` resolves the trip's country *name* to the ISO code the
   * OpenTripMap lookup needs; until that list has loaded the code is simply
   * null, and the search runs unfiltered rather than not at all.
   */
  resolveSelection(
    trips: Trip[],
    activeTripId: string | null,
    countries: Country[] = [],
    chosen: ChosenSelection = readChosenSelection(),
    device: DevicePlace | null = null,
  ): ExploreSelection {
    if (chosen.country) {
      return {
        countryCode: chosen.country.code,
        countryName: chosen.country.name,
        city: chosen.city,
        source: 'chosen',
      };
    }

    const fromDevice = deviceSelection(device, countries);
    if (fromDevice) return fromDevice;

    const fromTrip = tripSelection(trips, activeTripId);
    if (!fromTrip) return EMPTY_SELECTION;

    const matched = countryService.findByName(countries, fromTrip.countryName);

    return {
      ...fromTrip,
      countryCode: matched?.code ?? null,
      countryName: matched?.name ?? fromTrip.countryName,
    };
  },

  /* ---------------------------------------------------------- activities */

  /**
   * One page of attractions for a city.
   *
   * `countryCode` is what stops "Barcelona" resolving to Venezuela — see
   * `openTripMapService.findDestination`.
   */
  async getActivities(options: {
    city: string;
    countryCode?: string | null;
    offset?: number;
    limit?: number;
    forceRefresh?: boolean;
  }): Promise<ActivitiesResult> {
    return activityService.getActivities({
      destination: options.city,
      countryCode: options.countryCode ?? undefined,
      offset: options.offset,
      limit: options.limit,
      forceRefresh: options.forceRefresh,
    });
  },
};
