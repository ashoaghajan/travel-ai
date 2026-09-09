/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { airportService } from './airport.service';
import { currentCityAirportService } from './currentCityAirport.service';
import { geocodeService } from './geocode.service';
import { locationService } from './location.service';
import type { Airport } from '../types/travel.types';

const AIRPORT: Airport = {
  code: 'EVN', city: 'Yerevan', name: 'Zvartnots', countryCode: 'AM',
};

beforeEach(() => {
  vi.spyOn(locationService, 'locate').mockResolvedValue({
    city: 'Yerevan', countryCode: 'AM', countryName: 'Armenia',
  });
  vi.spyOn(airportService, 'search').mockResolvedValue([AIRPORT]);
  vi.spyOn(airportService, 'remember').mockImplementation(() => {});
  vi.spyOn(airportService, 'inCountry').mockResolvedValue([AIRPORT]);
  vi.spyOn(geocodeService, 'locate').mockResolvedValue({ lat: 40.18, lng: 44.51, name: 'Yerevan' });
});

describe('the current city departure airport', () => {
  it('matches the city and country and remembers its display name', async () => {
    vi.mocked(airportService.search).mockResolvedValue([
      { ...AIRPORT, code: 'XXX', countryCode: 'US' }, AIRPORT,
    ]);
    expect(await currentCityAirportService.locate()).toEqual(AIRPORT);
    expect(airportService.search).toHaveBeenCalledWith('Yerevan', undefined);
    expect(airportService.remember).toHaveBeenCalledWith(AIRPORT);
    expect(geocodeService.locate).not.toHaveBeenCalled();
  });

  it('uses the nearest airport when the current town has none', async () => {
    vi.mocked(locationService.locate).mockResolvedValue({
      city: 'Ashtarak', countryCode: 'AM', countryName: 'Armenia',
    });
    vi.mocked(airportService.search).mockResolvedValue([]);
    expect(await currentCityAirportService.locate()).toEqual(AIRPORT);
    expect(geocodeService.locate).toHaveBeenCalledWith('Ashtarak', 'AM');
    expect(airportService.inCountry).toHaveBeenCalledWith('AM', { lat: 40.18, lon: 44.51 }, undefined);
  });

  it('does not guess an airport when the city cannot be located', async () => {
    vi.mocked(airportService.search).mockResolvedValue([]);
    vi.mocked(geocodeService.locate).mockResolvedValue(null);
    expect(await currentCityAirportService.locate()).toBeNull();
    expect(airportService.inCountry).not.toHaveBeenCalled();
  });

  it.each([null, { city: null, countryCode: 'AM', countryName: 'Armenia' }])(
    'leaves the existing origin alone when location is unavailable: %s', async (place) => {
      vi.mocked(locationService.locate).mockResolvedValue(place);
      expect(await currentCityAirportService.locate()).toBeNull();
      expect(airportService.search).not.toHaveBeenCalled();
    },
  );

  it('treats a failed lookup as an optional default', async () => {
    vi.mocked(locationService.locate).mockRejectedValue(new Error('Unavailable'));
    expect(await currentCityAirportService.locate()).toBeNull();
  });

  it('discards a location result after the screen has been left', async () => {
    const controller = new AbortController();
    const pending = currentCityAirportService.locate(controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    expect(airportService.remember).not.toHaveBeenCalled();
  });
});
