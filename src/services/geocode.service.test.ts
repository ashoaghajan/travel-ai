/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import {
  MissingApiKeyError,
  OpenTripMapError,
  UnknownPlaceError,
  openTripMapService,
} from './opentripmap.service';
import { geocodeService } from './geocode.service';

const UBUD = { name: 'Ubud', lat: -8.5069, lon: 115.2625 };

function findDestination() {
  return vi.spyOn(openTripMapService, 'findDestination');
}

// The module holds an in-memory mirror and an in-flight map, neither of which
// `restoreMocks` touches — without this the second test reads the first's answers.
beforeEach(() => {
  geocodeService.clearCache();
});

afterEach(() => {
  geocodeService.clearCache();
});

describe('locate', () => {
  it('returns the point, converting lon to lng', async () => {
    findDestination().mockResolvedValue(UBUD);

    await expect(geocodeService.locate('Ubud', 'ID')).resolves.toEqual({
      lat: -8.5069,
      lng: 115.2625,
      name: 'Ubud',
    });
  });

  it('answers a second call from memory, without a request', async () => {
    const spy = findDestination().mockResolvedValue(UBUD);

    await geocodeService.locate('Ubud', 'ID');
    await geocodeService.locate('Ubud', 'ID');

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('answers from storage after the memory mirror is gone', async () => {
    const spy = findDestination().mockResolvedValue(UBUD);

    await geocodeService.locate('Ubud', 'ID');

    // A fresh page load: storage survives, the module's map does not.
    const stored = storageService.get(STORAGE_KEYS.geocodes, null);
    geocodeService.clearCache();
    storageService.set(STORAGE_KEYS.geocodes, stored);

    await expect(geocodeService.locate('Ubud', 'ID')).resolves.toMatchObject({ lat: -8.5069 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('treats the same name in another country as another place', async () => {
    const spy = findDestination().mockResolvedValue(UBUD);

    await geocodeService.locate('Valencia', 'ES');
    await geocodeService.locate('Valencia', 'VE');

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent callers', async () => {
    const spy = findDestination().mockResolvedValue(UBUD);

    await Promise.all([geocodeService.locate('Ubud'), geocodeService.locate('Ubud')]);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refetches once the positive entry has expired', async () => {
    const spy = findDestination().mockResolvedValue(UBUD);

    await geocodeService.locate('Ubud');
    geocodeService.clearCache();
    storageService.set(STORAGE_KEYS.geocodes, {
      version: 1,
      entries: {
        '|ubud': { at: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString(), point: UBUD },
      },
    });

    await geocodeService.locate('Ubud');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it.each([[''], ['   ']])('does not look up the empty name %o', async (name) => {
    const spy = findDestination();

    await expect(geocodeService.locate(name)).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  // Every generated trip ends on "Departure"; asking about it is a request
  // whose failure is known before it leaves the browser.
  it.each([['Departure'], ['Your destination'], ['home'], ['TRAVEL DAY']])(
    'never looks up %s',
    async (name) => {
      const spy = findDestination();

      await expect(geocodeService.locate(name)).resolves.toBeNull();
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it('survives a corrupt cache', async () => {
    localStorage.setItem(STORAGE_KEYS.geocodes, '{not json');
    findDestination().mockResolvedValue(UBUD);

    await expect(geocodeService.locate('Ubud')).resolves.toMatchObject({ lat: -8.5069 });
  });

  it('ignores a cache written by an older version', async () => {
    const spy = findDestination().mockResolvedValue(UBUD);
    storageService.set(STORAGE_KEYS.geocodes, {
      version: 0,
      entries: { '|ubud': { at: new Date().toISOString(), point: UBUD } },
    });

    await geocodeService.locate('Ubud');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ignores a cache whose entries are not an object', async () => {
    const spy = findDestination().mockResolvedValue(UBUD);
    storageService.set(STORAGE_KEYS.geocodes, { version: 1, entries: null });

    await geocodeService.locate('Ubud');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('still returns the point when storage refuses the write', async () => {
    findDestination().mockResolvedValue(UBUD);
    vi.spyOn(storageService, 'set').mockImplementation(() => {
      throw new Error('quota');
    });

    await expect(geocodeService.locate('Ubud')).resolves.toMatchObject({ lat: -8.5069 });
  });

  it('evicts the oldest entries once full', async () => {
    findDestination().mockResolvedValue(UBUD);

    const entries: Record<string, { at: string; point: typeof UBUD }> = {};
    for (let index = 0; index < 200; index += 1) {
      entries[`|place-${index}`] = {
        at: new Date(2020, 0, 1, 0, index).toISOString(),
        point: UBUD,
      };
    }
    storageService.set(STORAGE_KEYS.geocodes, { version: 1, entries });

    await geocodeService.locate('Ubud');

    const cache = storageService.get<{ entries: Record<string, unknown> }>(
      STORAGE_KEYS.geocodes,
      { entries: {} },
    );
    expect(Object.keys(cache.entries)).toHaveLength(200);
    expect(cache.entries['|ubud']).toBeDefined();
    // The very oldest went to make room.
    expect(cache.entries['|place-0']).toBeUndefined();
  });
});

describe('locate when the place does not exist', () => {
  it('returns null and remembers the miss', async () => {
    const spy = findDestination().mockRejectedValue(new UnknownPlaceError('Atlantis'));

    await expect(geocodeService.locate('Atlantis')).resolves.toBeNull();
    await expect(geocodeService.locate('Atlantis')).resolves.toBeNull();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries once the negative entry has expired', async () => {
    const spy = findDestination().mockRejectedValue(new UnknownPlaceError('Atlantis'));

    await geocodeService.locate('Atlantis');
    geocodeService.clearCache();
    storageService.set(STORAGE_KEYS.geocodes, {
      version: 1,
      entries: { '|atlantis': { at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() } },
    });

    await geocodeService.locate('Atlantis');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('locate when the lookup fails', () => {
  // A timeout says nothing about the place, so remembering it would turn an
  // outage into permanent geography.
  it('returns null without caching a transient failure', async () => {
    const spy = findDestination().mockRejectedValue(new OpenTripMapError('Could not reach'));

    await expect(geocodeService.locate('Ubud')).resolves.toBeNull();
    await expect(geocodeService.locate('Ubud')).resolves.toBeNull();

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not cache an unexpected error either', async () => {
    const spy = findDestination().mockRejectedValue(new Error('boom'));

    await expect(geocodeService.locate('Ubud')).resolves.toBeNull();
    await geocodeService.locate('Ubud');

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('rethrows a missing API key rather than caching it', async () => {
    findDestination().mockRejectedValue(new MissingApiKeyError());

    await expect(geocodeService.locate('Ubud')).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(storageService.get(STORAGE_KEYS.geocodes, null)).toBeNull();
  });
});

describe('locateAll', () => {
  it('resolves every name', async () => {
    findDestination().mockResolvedValue(UBUD);

    const results = await geocodeService.locateAll(['Ubud', 'Canggu']);

    expect([...results.keys()]).toEqual(['Ubud', 'Canggu']);
  });

  it('looks a repeated name up once', async () => {
    const spy = findDestination().mockResolvedValue(UBUD);

    const results = await geocodeService.locateAll(['Ubud', 'Canggu', 'Ubud']);

    expect(results.size).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // Mixed coverage is the normal case, not an error.
  it('keeps the places it found when one is unknown', async () => {
    findDestination().mockImplementation(async (name: string) => {
      if (name === 'Departure') throw new UnknownPlaceError(name);
      return UBUD;
    });

    const results = await geocodeService.locateAll(['Ubud', 'Departure']);

    expect(results.get('Ubud')).toMatchObject({ lat: -8.5069 });
    expect(results.get('Departure')).toBeNull();
  });

  it('propagates a missing API key instead of returning half a map', async () => {
    findDestination().mockRejectedValue(new MissingApiKeyError());

    await expect(geocodeService.locateAll(['Ubud', 'Canggu'])).rejects.toBeInstanceOf(
      MissingApiKeyError,
    );
  });
});

describe('clearCache', () => {
  it('empties the stored cache', async () => {
    findDestination().mockResolvedValue(UBUD);

    await geocodeService.locate('Ubud');
    expect(storageService.get(STORAGE_KEYS.geocodes, null)).not.toBeNull();

    geocodeService.clearCache();
    expect(storageService.get(STORAGE_KEYS.geocodes, null)).toBeNull();
  });

  it('makes the next lookup ask again', async () => {
    const spy = findDestination().mockResolvedValue(UBUD);

    await geocodeService.locate('Ubud');
    geocodeService.clearCache();
    await geocodeService.locate('Ubud');

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
