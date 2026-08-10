import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { locateHotels } from './hotel.service';
import { ApiError, http } from './http';

/**
 * `locateHotels`.
 *
 * The search half of this service is covered in
 * `travel-search.services.test.ts`, alongside flights, because the rule those
 * two share — a price is either quoted or admitted to be invented — is the
 * thing worth testing together.
 *
 * This is the other half, and it exists for one narrow case: stays saved
 * before the catalogue kept its own coordinates. Their names cannot be
 * geocoded, so the catalogue id is the only thing that can place them on the
 * map. An empty answer is the correct outcome whenever that fails — those rows
 * read "Not on the map", which is what they did before.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('locateHotels', () => {
  it('returns the coordinates keyed by id', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ 'h-1': { lat: 40.18, lng: 44.51 } });

    const found = await locateHotels(['h-1']);

    expect(found.get('h-1')).toEqual({ lat: 40.18, lng: 44.51 });
  });

  it('asks for the ids it was given', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue({});

    await locateHotels([' h-1 ', 'h-2']);

    expect(get).toHaveBeenCalledWith('/hotels/locate', { query: { ids: 'h-1,h-2' } });
  });

  it('makes no request when every id is blank', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue({});

    await expect(locateHotels([' ', ''])).resolves.toEqual(new Map());
    expect(get).not.toHaveBeenCalled();
  });

  it('makes no request for an empty list', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue({});

    await expect(locateHotels([])).resolves.toEqual(new Map());
    expect(get).not.toHaveBeenCalled();
  });

  it('leaves the rows unplaced when the API cannot answer', async () => {
    vi.spyOn(http, 'get').mockRejectedValue(
      new ApiError(502, ERROR_CODES.INTERNAL, 'Unreachable.'),
    );

    // "Not on the map" is the honest outcome — inventing a position for a
    // stay would put a marker somewhere the reader is not staying.
    await expect(locateHotels(['h-1'])).resolves.toEqual(new Map());
  });

  it('omits an id the catalogue does not know', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ 'h-1': { lat: 1, lng: 2 } });

    const found = await locateHotels(['h-1', 'h-unknown']);

    expect(found.has('h-unknown')).toBe(false);
    expect(found.size).toBe(1);
  });
});
