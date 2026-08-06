/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Trip } from '../types/trip.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import {
  exploreService,
  normaliseCountryCode,
  normaliseName,
} from './explore.service';
import { activityService } from './activity.service';
import { countryService } from './country.service';
import { cityService } from './city.service';
import type { Country } from './country.service';

const SPAIN: Country = { name: 'Spain', code: 'ES' };
const JAPAN: Country = { name: 'Japan', code: 'JP' };
const COUNTRIES = [JAPAN, SPAIN];

function trip(id: string, fields: Partial<Trip> = {}): Trip {
  return {
    id,
    title: 'A trip',
    destination: 'Somewhere',
    startDate: '2026-08-01',
    endDate: '2026-08-08',
    travellers: 2,
    coverImage: 'cover.jpg',
    itinerary: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...fields,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normaliseName', () => {
  it('trims and collapses whitespace', () => {
    expect(normaliseName('  Mexico   City ')).toBe('Mexico City');
  });

  it.each([[''], [null], [42], ['   '], [undefined]])('rejects %s', (value) => {
    expect(normaliseName(value)).toBeNull();
  });

  it('rejects a name longer than any real place', () => {
    expect(normaliseName('x'.repeat(121))).toBeNull();
  });
});

describe('normaliseCountryCode', () => {
  it.each([
    ['es', 'ES'],
    [' jp ', 'JP'],
    ['ES', 'ES'],
  ])('%s → %s', (value, expected) => {
    expect(normaliseCountryCode(value)).toBe(expected);
  });

  it.each([['ESP'], ['E'], ['1S'], [''], [null]])('rejects %s', (value) => {
    expect(normaliseCountryCode(value)).toBeNull();
  });
});

describe('persisting the selection', () => {
  it('writes the country under the documented key', () => {
    exploreService.setCountry(SPAIN);

    expect(STORAGE_KEYS.selectedCountry).toBe('ai-travel-planner:selectedCountry');
    expect(exploreService.getChosenSelection().country).toEqual({ code: 'ES', name: 'Spain' });
  });

  it('writes the city under the documented key', () => {
    exploreService.setCity('Barcelona');

    expect(STORAGE_KEYS.selectedCity).toBe('ai-travel-planner:selectedCity');
    expect(exploreService.getChosenSelection().city).toBe('Barcelona');
  });

  it('clears the city when the country changes', () => {
    exploreService.setCountry(SPAIN);
    exploreService.setCity('Barcelona');

    exploreService.setCountry(JAPAN);

    expect(exploreService.getChosenSelection().city).toBeNull();
  });

  it('stores the normalised city and reports it back', () => {
    expect(exploreService.setCity('  san   sebastián ')).toBe('san sebastián');
  });

  it('refuses an unusable city', () => {
    expect(exploreService.setCity('   ')).toBeNull();
    expect(exploreService.getChosenSelection().city).toBeNull();
  });

  it('refuses a country with a bad ISO code', () => {
    exploreService.setCountry({ name: 'Nowhere', code: 'XYZ' });

    expect(exploreService.getChosenSelection().country).toBeNull();
  });

  it('ignores a junk value written by hand', () => {
    storageService.set(STORAGE_KEYS.selectedCountry, { code: 'ES' });

    expect(exploreService.getChosenSelection().country).toBeNull();
  });

  it('keeps working when storage refuses the write', () => {
    vi.spyOn(storageService, 'set').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(() => exploreService.setCountry(SPAIN)).not.toThrow();
    expect(() => exploreService.setCity('Madrid')).not.toThrow();
  });

  it('clears both halves', () => {
    exploreService.setCountry(SPAIN);
    exploreService.setCity('Madrid');

    exploreService.clearSelection();

    expect(exploreService.getChosenSelection()).toEqual({ country: null, city: null });
  });

  it('notifies subscribers when either half changes', () => {
    const listener = vi.fn();
    const unsubscribe = exploreService.subscribe(listener);

    exploreService.setCountry(SPAIN);
    exploreService.setCity('Madrid');
    expect(listener).toHaveBeenCalled();

    const calls = listener.mock.calls.length;
    unsubscribe();
    exploreService.setCity('Seville');
    expect(listener).toHaveBeenCalledTimes(calls);
  });
});

describe('resolveSelection', () => {
  it('has nothing to show with no trip and no choice', () => {
    expect(exploreService.resolveSelection([], null, COUNTRIES)).toEqual({
      countryCode: null,
      countryName: null,
      city: null,
      source: 'none',
    });
  });

  it('follows the active trip when nothing has been chosen', () => {
    const trips = [trip('t1', { destinationCountry: 'Japan', destinationCity: 'Kyoto' })];

    expect(exploreService.resolveSelection(trips, 't1', COUNTRIES)).toEqual({
      countryCode: 'JP',
      countryName: 'Japan',
      city: 'Kyoto',
      source: 'trip',
    });
  });

  it('reads a legacy trip’s single destination as the city', () => {
    const trips = [trip('t1', { destination: 'Bali' })];

    expect(exploreService.resolveSelection(trips, 't1', COUNTRIES)).toMatchObject({
      countryCode: null,
      city: 'Bali',
      source: 'trip',
    });
  });

  it('keeps the trip’s country name even when the list does not know it', () => {
    const trips = [trip('t1', { destinationCountry: 'Atlantis', destinationCity: 'Poseidonis' })];

    expect(exploreService.resolveSelection(trips, 't1', COUNTRIES)).toMatchObject({
      countryCode: null,
      countryName: 'Atlantis',
      city: 'Poseidonis',
    });
  });

  it('prefers an explicit choice over the active trip', () => {
    const trips = [trip('t1', { destinationCountry: 'Japan', destinationCity: 'Kyoto' })];
    exploreService.setCountry(SPAIN);
    exploreService.setCity('Barcelona');

    expect(exploreService.resolveSelection(trips, 't1', COUNTRIES)).toEqual({
      countryCode: 'ES',
      countryName: 'Spain',
      city: 'Barcelona',
      source: 'chosen',
    });
  });

  it('reports a chosen country with no city yet', () => {
    exploreService.setCountry(SPAIN);

    expect(exploreService.resolveSelection([], null, COUNTRIES)).toMatchObject({
      countryCode: 'ES',
      city: null,
      source: 'chosen',
    });
  });

  it('hands the decision back to the trip once the choice is cleared', () => {
    const trips = [trip('t1', { destinationCountry: 'Japan', destinationCity: 'Kyoto' })];
    exploreService.setCountry(SPAIN);
    exploreService.clearSelection();

    expect(exploreService.resolveSelection(trips, 't1', COUNTRIES).source).toBe('trip');
  });

  it('ignores an active id that matches no trip', () => {
    expect(exploreService.resolveSelection([trip('t1')], 'deleted', COUNTRIES).source).toBe('none');
  });

  it('ignores a trip that names nowhere at all', () => {
    const trips = [trip('t1', { destination: '  ', destinationCity: '', destinationCountry: '' })];

    expect(exploreService.resolveSelection(trips, 't1', COUNTRIES).source).toBe('none');
  });

  it('accepts the choice as an argument, for callers that already track it', () => {
    expect(
      exploreService.resolveSelection([], null, COUNTRIES, {
        country: { code: 'JP', name: 'Japan' },
        city: 'Osaka',
      }),
    ).toMatchObject({ countryCode: 'JP', city: 'Osaka', source: 'chosen' });
  });
});

describe('delegation', () => {
  it('passes country lookups to the country service', async () => {
    const spy = vi.spyOn(countryService, 'getCountries').mockResolvedValue(COUNTRIES);

    await expect(exploreService.getCountries()).resolves.toEqual(COUNTRIES);
    expect(spy).toHaveBeenCalled();
  });

  it('passes city lookups to the city service', async () => {
    const spy = vi.spyOn(cityService, 'getCities').mockResolvedValue(['Madrid']);

    await expect(exploreService.getCities('Spain')).resolves.toEqual(['Madrid']);
    expect(spy).toHaveBeenCalledWith('Spain', {});
  });

  it('passes type-ahead filtering to the city service', () => {
    const spy = vi.spyOn(cityService, 'filter');

    expect(exploreService.filterCities(['Barcelona', 'Madrid'], 'bar', 5)).toEqual(['Barcelona']);
    expect(spy).toHaveBeenCalledWith(['Barcelona', 'Madrid'], 'bar', 5);
  });

  it('sends the city and its country code to the activity layer', async () => {
    const spy = vi.spyOn(activityService, 'getActivities').mockResolvedValue({
      activities: [],
      hasMore: false,
      source: 'network',
      fetchedAt: '2026-07-28T09:00:00.000Z',
    });

    await exploreService.getActivities({ city: 'Barcelona', countryCode: 'ES', offset: 10 });

    expect(spy).toHaveBeenCalledWith({
      destination: 'Barcelona',
      countryCode: 'ES',
      offset: 10,
      limit: undefined,
      forceRefresh: undefined,
    });
  });

  it('omits an absent country code rather than sending null', async () => {
    const spy = vi.spyOn(activityService, 'getActivities').mockResolvedValue({
      activities: [],
      hasMore: false,
      source: 'network',
      fetchedAt: '2026-07-28T09:00:00.000Z',
    });

    await exploreService.getActivities({ city: 'Bali', countryCode: null });

    expect(spy.mock.calls[0]?.[0].countryCode).toBeUndefined();
  });
});
