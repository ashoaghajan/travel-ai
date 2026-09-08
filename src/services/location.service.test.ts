/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http } from './http';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { LocationError, locationService } from './location.service';

/**
 * The point of this file is the *asking*, not the geometry.
 *
 * A permission prompt raised on a page nobody has touched is the one mistake
 * here that cannot be undone by a later release — readers refuse on reflex and
 * then never see the button again. So most of what follows is about which
 * calls reach `getCurrentPosition` at all.
 */

const YEREVAN = { countryCode: 'AM', countryName: 'Armenia', city: 'Yerevan' };

const COORDS = { coords: { latitude: 40.1776, longitude: 44.5126 } };

/** A `Geolocation` that succeeds, and a record of how often it was consulted. */
function deviceKnowsWhereItIs() {
  const getCurrentPosition = vi.fn((onSuccess: PositionCallback) => {
    onSuccess(COORDS as unknown as GeolocationPosition);
  });

  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: { getCurrentPosition },
  });

  return getCurrentPosition;
}

/** A `Geolocation` that refuses — code 1 is PERMISSION_DENIED. */
function deviceRefuses() {
  const getCurrentPosition = vi.fn(
    (_onSuccess: PositionCallback, onError?: PositionErrorCallback) => {
      onError?.({ code: 1, message: 'denied' } as GeolocationPositionError);
    },
  );

  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: { getCurrentPosition },
  });

  return getCurrentPosition;
}

/** What `navigator.permissions` reports, or nothing at all. */
function permissionsSay(state: PermissionState | null) {
  const current = globalThis.navigator;

  vi.stubGlobal('navigator', {
    ...current,
    geolocation: current.geolocation,
    permissions: state === null ? undefined : { query: async () => ({ state }) },
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(http, 'get').mockResolvedValue(YEREVAN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getPermission', () => {
  it('is unsupported where the browser has no geolocation', async () => {
    vi.stubGlobal('navigator', { ...navigator, geolocation: undefined });

    await expect(locationService.getPermission()).resolves.toBe('unsupported');
  });

  it('repeats what the Permissions API says', async () => {
    deviceKnowsWhereItIs();
    permissionsSay('granted');

    await expect(locationService.getPermission()).resolves.toBe('granted');
  });

  it('assumes it may ask where there is no Permissions API', async () => {
    deviceKnowsWhereItIs();
    permissionsSay(null);

    // Older Safari. "Askable" is the honest answer — the stored record is then
    // the only thing standing between the reader and a second prompt.
    await expect(locationService.getPermission()).resolves.toBe('prompt');
  });
});

describe('locate, automatically', () => {
  it('resolves the point through our own endpoint', async () => {
    deviceKnowsWhereItIs();
    permissionsSay('granted');

    await expect(locationService.locate()).resolves.toEqual(YEREVAN);
    expect(http.get).toHaveBeenCalledWith(
      '/reference/location?lat=40.1776&lon=44.5126',
    );
  });

  it('asks once on a first visit, and never again on its own', async () => {
    const device = deviceKnowsWhereItIs();
    permissionsSay('prompt');
    vi.mocked(http.get).mockResolvedValue({
      countryCode: null,
      countryName: null,
      city: null,
    });

    // The reader dismissed the prompt rather than answering it, which the
    // Permissions API does not report — so nothing but the record below can
    // stop us asking again.
    await locationService.locate();
    await locationService.locate();

    expect(device).toHaveBeenCalledTimes(1);
  });

  it('does not ask a reader who has already refused', async () => {
    const device = deviceKnowsWhereItIs();
    permissionsSay('denied');

    await expect(locationService.locate()).resolves.toBeNull();
    expect(device).not.toHaveBeenCalled();
  });

  it('answers null rather than throwing when the device refuses', async () => {
    deviceRefuses();
    permissionsSay('prompt');

    // Nobody asked for this fix, so nobody is owed an error about it.
    await expect(locationService.locate()).resolves.toBeNull();
  });

  it('serves a recent fix without consulting the device again', async () => {
    const device = deviceKnowsWhereItIs();
    permissionsSay('granted');

    await locationService.locate();
    await expect(locationService.locate()).resolves.toEqual(YEREVAN);

    expect(device).toHaveBeenCalledTimes(1);
  });

  it('takes a fresh fix once the last one is stale', async () => {
    const device = deviceKnowsWhereItIs();
    permissionsSay('granted');

    await locationService.locate();

    // Seven hours: past the six a fix stands for. Somebody who flew this
    // morning is somewhere else this afternoon.
    storageService.set(STORAGE_KEYS.deviceLocation, {
      version: 1,
      at: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      place: YEREVAN,
    });

    await locationService.locate();

    expect(device).toHaveBeenCalledTimes(2);
  });

  it('treats a point with no country as no answer', async () => {
    deviceKnowsWhereItIs();
    permissionsSay('granted');
    vi.mocked(http.get).mockResolvedValue({
      countryCode: null,
      countryName: null,
      city: null,
    });

    // A country is what seats the selectors. Without one there is nothing to
    // put on screen, so it is remembered as a miss rather than as a place.
    await expect(locationService.locate()).resolves.toBeNull();
  });
});

describe('locate, on request', () => {
  it('ignores a remembered refusal — a press is not us asking', async () => {
    const device = deviceKnowsWhereItIs();
    permissionsSay('prompt');
    vi.mocked(http.get).mockRejectedValueOnce(new Error('offline'));

    await locationService.locate();
    expect(device).toHaveBeenCalledTimes(1);

    await expect(locationService.locate({ prompt: true })).resolves.toEqual(YEREVAN);
    expect(device).toHaveBeenCalledTimes(2);
  });

  it('ignores a remembered fix, because the reader asked for a new one', async () => {
    const device = deviceKnowsWhereItIs();
    permissionsSay('granted');

    await locationService.locate();
    await locationService.locate({ prompt: true });

    expect(device).toHaveBeenCalledTimes(2);
  });

  it('says why, when the device refuses', async () => {
    deviceRefuses();
    permissionsSay('prompt');

    await expect(locationService.locate({ prompt: true })).rejects.toMatchObject({
      name: 'LocationError',
      reason: 'denied',
    });
  });

  it('tells a refusal from a failure', async () => {
    deviceKnowsWhereItIs();
    permissionsSay('granted');
    vi.mocked(http.get).mockRejectedValue(new Error('offline'));

    await expect(locationService.locate({ prompt: true })).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it('throws rather than answering null where there is no geolocation', async () => {
    vi.stubGlobal('navigator', { ...navigator, geolocation: undefined });

    await expect(locationService.locate({ prompt: true })).rejects.toBeInstanceOf(LocationError);
  });
});

describe('forget', () => {
  it('makes the next automatic attempt behave like a first visit', async () => {
    const device = deviceKnowsWhereItIs();
    permissionsSay('prompt');
    vi.mocked(http.get).mockResolvedValue({
      countryCode: null,
      countryName: null,
      city: null,
    });

    await locationService.locate();
    locationService.forget();
    await locationService.locate();

    expect(device).toHaveBeenCalledTimes(2);
  });
});
