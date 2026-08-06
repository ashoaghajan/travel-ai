import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlaceNotFoundError,
  WeatherUnavailableError,
  describeWeatherCode,
  weatherService,
} from './weather.service';

const GEOCODE_HIT = {
  results: [
    {
      name: 'Abu Dhabi',
      latitude: 24.45,
      longitude: 54.39,
      country: 'United Arab Emirates',
      country_code: 'AE',
      admin1: 'Abu Dhabi Emirate',
      timezone: 'Asia/Dubai',
      population: 603_492,
    },
  ],
};

const FORECAST = {
  current: { temperature_2m: 33.6, weather_code: 0 },
  daily: { temperature_2m_max: [38.2], temperature_2m_min: [29.4] },
};

function ok(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  weatherService.clearCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('findPlace', () => {
  it('answers with what the provider knows', async () => {
    fetchMock.mockResolvedValueOnce(ok(GEOCODE_HIT));

    await expect(weatherService.findPlace('Abu Dhabi')).resolves.toEqual({
      name: 'Abu Dhabi',
      country: 'United Arab Emirates',
      countryCode: 'AE',
      region: 'Abu Dhabi Emirate',
      latitude: 24.45,
      longitude: 54.39,
      timezone: 'Asia/Dubai',
      population: 603_492,
    });
  });

  it('refuses an empty name without asking the provider', async () => {
    await expect(weatherService.findPlace('  ')).rejects.toThrow(PlaceNotFoundError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the name resolves to nothing', async () => {
    fetchMock.mockResolvedValueOnce(ok({ results: [] }));

    await expect(weatherService.findPlace('Atlantis')).rejects.toThrow(PlaceNotFoundError);
  });

  it('throws when a hit carries no coordinates', async () => {
    fetchMock.mockResolvedValueOnce(ok({ results: [{ name: 'Nowhere' }] }));

    await expect(weatherService.findPlace('Nowhere')).rejects.toThrow(PlaceNotFoundError);
  });

  it('surfaces a provider outage as its own error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false } as Response);

    await expect(weatherService.findPlace('Abu Dhabi')).rejects.toThrow(WeatherUnavailableError);
  });
});

describe('getWeather', () => {
  it('reports the current conditions, rounded', async () => {
    fetchMock.mockResolvedValueOnce(ok(GEOCODE_HIT)).mockResolvedValueOnce(ok(FORECAST));

    await expect(weatherService.getWeather('Abu Dhabi')).resolves.toEqual({
      place: 'Abu Dhabi',
      country: 'United Arab Emirates',
      countryCode: 'AE',
      temperature: 34,
      description: 'clear',
      high: 38,
      low: 29,
    });
  });

  it('caches, so a repeated question spares the free tier', async () => {
    fetchMock.mockResolvedValueOnce(ok(GEOCODE_HIT)).mockResolvedValueOnce(ok(FORECAST));

    await weatherService.getWeather('Abu Dhabi');
    await weatherService.getWeather('abu dhabi');

    // Two calls for the first question, none for the second.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the current temperature when there is no daily range', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(GEOCODE_HIT))
      .mockResolvedValueOnce(ok({ current: { temperature_2m: 20, weather_code: 3 } }));

    const report = await weatherService.getWeather('Abu Dhabi');
    expect(report).toMatchObject({ temperature: 20, high: 20, low: 20, description: 'overcast' });
  });

  it('throws when the forecast carries no temperature', async () => {
    fetchMock.mockResolvedValueOnce(ok(GEOCODE_HIT)).mockResolvedValueOnce(ok({ current: {} }));

    await expect(weatherService.getWeather('Abu Dhabi')).rejects.toThrow(WeatherUnavailableError);
  });

  it('refuses an empty name', async () => {
    await expect(weatherService.getWeather('   ')).rejects.toThrow(PlaceNotFoundError);
  });
});

describe('describeWeatherCode', () => {
  it('turns the WMO codes into words', () => {
    expect(describeWeatherCode(0)).toBe('clear');
    expect(describeWeatherCode(2)).toBe('mostly clear');
    expect(describeWeatherCode(45)).toBe('foggy');
    expect(describeWeatherCode(61)).toBe('rainy');
    expect(describeWeatherCode(75)).toBe('snowy');
    expect(describeWeatherCode(95)).toBe('thundery');
  });

  it('has a word for a code it does not know', () => {
    // Better than showing "code 99" to someone asking about their holiday.
    expect(describeWeatherCode(-1)).toBe('unsettled');
  });
});
