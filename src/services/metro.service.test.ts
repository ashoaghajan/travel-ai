import { afterEach, describe, expect, it, vi } from 'vitest';
import { http } from './http';
import { clearMetroCache, getMetroStations } from './metro.service';

/**
 * Where the metro stops, for the one rule that asks.
 *
 * The behaviour worth pinning down is what happens when the answer does not
 * arrive: an empty list, never a rejection. `isNearMetro` reads an empty list
 * as "cannot judge" and stops filtering, so a failure here costs a preference
 * and not a trip — but only if this file never throws.
 */

afterEach(() => {
  clearMetroCache();
  vi.restoreAllMocks();
});

describe('getMetroStations', () => {
  it('asks the API for the destination by name', async () => {
    const get = vi
      .spyOn(http, 'get')
      .mockResolvedValue({ stations: [{ lat: 41.7, lng: 44.8 }] } as never);

    await expect(getMetroStations('Tbilisi')).resolves.toEqual([{ lat: 41.7, lng: 44.8 }]);
    expect(get).toHaveBeenCalledWith('/places/metro', { query: { name: 'Tbilisi' } });
  });

  it('answers a second ask from memory', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue({ stations: [] } as never);

    await getMetroStations('Tbilisi');
    await getMetroStations('  tbilisi  ');

    // Same city, whatever the case and spacing — one request.
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('shares one request between two callers asking at once', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue({ stations: [] } as never);

    await Promise.all([getMetroStations('Paris'), getMetroStations('Paris')]);

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('answers an empty list when the request fails', async () => {
    vi.spyOn(http, 'get').mockRejectedValue(new Error('offline'));

    await expect(getMetroStations('Tbilisi')).resolves.toEqual([]);
  });

  it('drops a station with coordinates that cannot be plotted', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({
      stations: [
        { lat: 41.7, lng: 44.8 },
        { lat: Number.NaN, lng: 44.8 },
      ],
    } as never);

    await expect(getMetroStations('Tbilisi')).resolves.toEqual([{ lat: 41.7, lng: 44.8 }]);
  });

  it('survives a body with no stations in it at all', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({} as never);

    await expect(getMetroStations('Tbilisi')).resolves.toEqual([]);
  });

  it('does not ask about a destination with no name', async () => {
    const get = vi.spyOn(http, 'get');

    await expect(getMetroStations('   ')).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('retries after a failure rather than caching it', async () => {
    const get = vi.spyOn(http, 'get').mockRejectedValueOnce(new Error('offline'));

    await getMetroStations('Tbilisi');

    get.mockResolvedValue({ stations: [{ lat: 41.7, lng: 44.8 }] } as never);

    // A failed lookup turns the rule off for one trip. Holding it would turn
    // the rule off for the session, which is a different and worse promise.
    await expect(getMetroStations('Tbilisi')).resolves.toEqual([{ lat: 41.7, lng: 44.8 }]);
  });
});
