import { http } from './http';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/**
 * Where this device is, as something the explorer can select.
 *
 * The explorer picks a country and then a city, and a device that knows where
 * it is can fill both in before the reader touches anything. What it actually
 * knows is a latitude and a longitude, so the answer is assembled in two
 * steps: the browser supplies the point, and `/reference/location` turns it
 * into a country code, the country list's own spelling of that country, and a
 * city name.
 *
 * The second step is server-side rather than here for the reason every other
 * provider moved: one process asks OpenStreetMap once per neighbourhood per
 * day, instead of every browser asking for itself. It also means the country
 * *name* that comes back is the one the city list is keyed by, which a
 * client-side reverse geocoder could not promise.
 *
 * No React component may import this file.
 *
 * **Nine times in ten this file asks nobody anything.** A permission prompt
 * that appears unbidden on a page nobody has interacted with is the kind of
 * thing readers refuse on reflex and then cannot easily undo, so the rules
 * are:
 *
 * - once permission is granted, locating is silent and automatic, forever;
 * - the prompt is raised on our own initiative exactly once, on the first
 *   visit to a screen that wants it, and never again;
 * - after that it takes a press — `locate({ prompt: true })`, which is what
 *   the "Use my location" button calls.
 *
 * The record below is what makes "never again" true. `Permissions` reports a
 * denial on most browsers but not all, and it says nothing at all about a
 * prompt the reader dismissed rather than answered.
 *
 * **A copy of this file exists at
 * `mobile/src/core/services/location.service.ts`.** It has to: `navigator`
 * has no meaning on a phone. Everything above the platform seam — the record,
 * the two TTLs, the endpoint, the shape of the result — is deliberately the
 * same, and `core-copies.test.ts` holds the pair together.
 */

/**
 * How long a fix stands.
 *
 * Six hours rather than a day: the whole point is answering "what is around
 * me", and somebody who flew this morning is somewhere else this afternoon. It
 * is long enough that a day of dipping in and out of the app costs one fix.
 */
const FOUND_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How long a refusal stands.
 *
 * Longer than a fix, and for the opposite reason: a "no" that is forgotten
 * quickly becomes a question asked again, which is the behaviour this whole
 * file exists to avoid. A press of the button ignores it — an explicit request
 * is not the same thing as us asking.
 */
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Bump to invalidate every remembered fix.
 *
 * For a change of *meaning* as much as a change of shape. Version 2 is the day
 * `/reference/location` stopped answering with whatever OpenStreetMap called
 * the point and started answering with a city from the list — a device holding
 * "Al Maryah Island" from the day before would otherwise go on showing it for
 * six more hours, because nothing about the record's shape changed.
 *
 * The record also carries "we have already asked", so a bump costs one further
 * prompt to anyone who dismissed the last one. That is the price of the bump,
 * and it is why this is not done lightly.
 */
const CACHE_VERSION = 2;

/** A fix older than this is refused, and a fresh one taken instead. */
const MAX_POSITION_AGE_MS = 5 * 60 * 1000;

export type LocationPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';

/** Why locating did not work, in terms the screen can repeat to the reader. */
export type LocationFailure = 'denied' | 'unavailable' | 'unsupported';

export class LocationError extends Error {
  readonly reason: LocationFailure;

  constructor(reason: LocationFailure, message: string) {
    super(message);
    this.name = 'LocationError';
    this.reason = reason;
  }
}

const DENIED = () =>
  new LocationError(
    'denied',
    'This device is not sharing its location. Allow it in your browser settings to explore what is near you.',
  );

const UNAVAILABLE = () =>
  new LocationError('unavailable', 'We could not work out where you are. Try again in a moment.');

const UNSUPPORTED = () =>
  new LocationError('unsupported', 'This device cannot share its location.');

/**
 * A place, not a point.
 *
 * Every field is nullable because every field can genuinely be absent: a
 * coordinate in open water has no country, and one in open countryside has no
 * city. A place with no city is still worth having — it seats the country
 * selector, which is half the job.
 */
export type DevicePlace = {
  /** ISO 3166-1 alpha-2, or null. */
  countryCode: string | null;
  /** Spelled as the country list spells it, so the city lookup accepts it. */
  countryName: string | null;
  city: string | null;
};

/** `place: null` records that we asked and came back with nothing. */
type Remembered = { version: number; at: string; place: DevicePlace | null };

function readRemembered(): Remembered | null {
  const stored = storageService.get<Remembered | null>(STORAGE_KEYS.deviceLocation, null);

  if (!stored || stored.version !== CACHE_VERSION || typeof stored.at !== 'string') return null;

  return stored;
}

function isFresh(remembered: Remembered): boolean {
  const age = Date.now() - new Date(remembered.at).getTime();
  const ttl = remembered.place ? FOUND_TTL_MS : MISS_TTL_MS;

  return Number.isFinite(age) && age >= 0 && age < ttl;
}

function remember(place: DevicePlace | null): DevicePlace | null {
  try {
    storageService.set<Remembered>(STORAGE_KEYS.deviceLocation, {
      version: CACHE_VERSION,
      at: new Date().toISOString(),
      place,
    });
  } catch {
    // Full or blocked storage costs us the "ask once" guarantee and nothing
    // else. The fix itself is still returned.
  }

  return place;
}

/* ------------------------------------------------------------ the platform */

/*
 * Everything below this line is the browser's answer to the three questions
 * above it: may we ask, where are we, and what went wrong. The mobile copy
 * replaces exactly this section and nothing else.
 */

/**
 * Long enough for a cold fix, short enough not to hang the screen.
 *
 * Browser-side only: `getCurrentPosition` waits forever without it, where the
 * phone API this file's twin uses has a deadline of its own.
 */
const POSITION_TIMEOUT_MS = 10 * 1000;

function geolocation(): Geolocation | null {
  return typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
}

async function permissionState(): Promise<LocationPermission> {
  if (!geolocation()) return 'unsupported';

  const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions;
  // Older Safari has no Permissions API. "Askable" is the honest answer there:
  // the record above is then the only thing standing between the reader and a
  // second prompt, which is exactly what it is for.
  if (!permissions?.query) return 'prompt';

  try {
    const status = await permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return 'prompt';
  }
}

/** The device's own reading, as a promise rather than a pair of callbacks. */
async function currentPosition(): Promise<{ lat: number; lon: number }> {
  const api = geolocation();
  if (!api) throw UNSUPPORTED();

  return new Promise((resolve, reject) => {
    api.getCurrentPosition(
      (position) =>
        resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      (error) => {
        // 1 is PERMISSION_DENIED. A timeout and a hardware failure are both
        // "we do not know", which is a different sentence to the reader.
        reject(error.code === 1 ? DENIED() : UNAVAILABLE());
      },
      {
        // Low accuracy on purpose: this picks a city, and a city is not worth
        // waking the GPS radio for when the network already knows which one.
        enableHighAccuracy: false,
        timeout: POSITION_TIMEOUT_MS,
        maximumAge: MAX_POSITION_AGE_MS,
      },
    );
  });
}

export const locationService = {
  /** Whether this device could share its location, and whether it has agreed. */
  getPermission(): Promise<LocationPermission> {
    return permissionState();
  },

  /**
   * The last fix, if one is still current. Synchronous, so a screen can open
   * already knowing where it is rather than filling itself in a frame later.
   */
  getRemembered(): DevicePlace | null {
    const remembered = readRemembered();
    return remembered && isFresh(remembered) ? remembered.place : null;
  },

  /**
   * Where this device is.
   *
   * `prompt: false` — the automatic path — never raises a permission dialog
   * for a reader who has already been asked once, and answers null rather
   * than throwing: a screen that opened without knowing where it is should
   * show its selectors empty, not an error nobody asked for.
   *
   * `prompt: true` — the button — asks whatever the record says, ignores a
   * remembered fix, and throws, because somebody who pressed it is owed a
   * reason when nothing happens.
   */
  async locate(options: { prompt?: boolean } = {}): Promise<DevicePlace | null> {
    const asked = options.prompt === true;
    const remembered = readRemembered();

    if (!asked && remembered && isFresh(remembered)) return remembered.place;

    const permission = await permissionState();

    if (permission === 'unsupported') {
      if (asked) throw UNSUPPORTED();
      return null;
    }

    if (!asked && permission !== 'granted') {
      // Not granted, and we have raised the prompt before — `remembered`
      // survives its own TTL for exactly this test. Nothing more is asked of
      // the reader until they press the button.
      if (permission === 'denied' || remembered) return remember(null);
    }

    try {
      const { lat, lon } = await currentPosition();
      const place = await http.get<DevicePlace>(
        `/reference/location?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
      );

      // A country with no name cannot seat the selectors, and a lookup that
      // answered with one is not an answer.
      return remember(place?.countryName ? place : null);
    } catch (error) {
      remember(null);

      if (asked) throw error instanceof LocationError ? error : UNAVAILABLE();
      return null;
    }
  },

  /** Drops the record, so the next automatic attempt behaves like a first visit. */
  forget(): void {
    storageService.remove(STORAGE_KEYS.deviceLocation);
  },
};
