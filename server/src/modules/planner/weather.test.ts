import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_FORECAST_DAYS,
  PlaceNotFoundError,
  WeatherUnavailableError,
  describeWeatherCode,
  getWeather,
  resetWeatherCache,
} from './weather';

/**
 * The one fact the planner looks up rather than recalls.
 *
 * The model must never invent a temperature for somewhere the user is about to
 * fly, so what matters here is that a failure stays a failure: an unknown place
 * and an unreachable provider are separate errors, because the first is
 * something the model can repeat back and the second is not.
 */

const GEOCODE = {
  results: [{ name: 'Kyoto', latitude: 35.01, longitude: 135.76, country: 'Japan' }],
};

const FORECAST = {
  current: { temperature_2m: 18.4, weather_code: 61 },
  daily: {
    time: ['2027-04-02', '2027-04-03'],
    temperature_2m_max: [21.2, 19.8],
    temperature_2m_min: [11.4, 10.9],
    weather_code: [61, 0],
    precipitation_sum: [3.44, 0],
  },
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetWeatherCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  resetWeatherCache();
  vi.unstubAllGlobals();
});

describe('getWeather', () => {
  it('reports the current conditions and the days asked for', async () => {
    fetchMock.mockResolvedValueOnce(ok(GEOCODE)).mockResolvedValueOnce(ok(FORECAST));

    const report = await getWeather('Kyoto', 2);

    expect(report).toMatchObject({
      place: 'Kyoto',
      country: 'Japan',
      temperature: 18,
      description: 'rainy',
    });
    expect(report.forecast).toEqual([
      { date: '2027-04-02', high: 21, low: 11, description: 'rainy', precipitationMm: 3.4 },
      { date: '2027-04-03', high: 20, low: 11, description: 'clear', precipitationMm: 0 },
    ]);
  });

  it('asks the provider for exactly the span requested', async () => {
    fetchMock.mockResolvedValueOnce(ok(GEOCODE)).mockResolvedValueOnce(ok(FORECAST));

    await getWeather('Kyoto', 3);

    expect(String(fetchMock.mock.calls[1][0])).toContain('forecast_days=3');
  });

  it('clamps a span the provider will not serve', async () => {
    fetchMock.mockResolvedValueOnce(ok(GEOCODE)).mockResolvedValueOnce(ok(FORECAST));

    await getWeather('Kyoto', 99);

    expect(String(fetchMock.mock.calls[1][0])).toContain(`forecast_days=${MAX_FORECAST_DAYS}`);
  });

  it('caches, so a model that asks twice costs one lookup', async () => {
    fetchMock.mockResolvedValueOnce(ok(GEOCODE)).mockResolvedValueOnce(ok(FORECAST));

    await getWeather('Kyoto');
    await getWeather('kyoto');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a one-day answer out of a seven-day question', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(GEOCODE))
      .mockResolvedValueOnce(ok(FORECAST))
      .mockResolvedValueOnce(ok(GEOCODE))
      .mockResolvedValueOnce(ok(FORECAST));

    await getWeather('Kyoto', 1);
    await getWeather('Kyoto', 7);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('separates an unknown place from an outage', async () => {
    fetchMock.mockResolvedValueOnce(ok({ results: [] }));

    await expect(getWeather('Atlantis')).rejects.toThrow(PlaceNotFoundError);
  });

  it('treats a hit with no coordinates as no hit', async () => {
    fetchMock.mockResolvedValueOnce(ok({ results: [{ name: 'Nowhere' }] }));

    await expect(getWeather('Nowhere')).rejects.toThrow(PlaceNotFoundError);
  });

  it('refuses an empty name without asking the provider', async () => {
    await expect(getWeather('   ')).rejects.toThrow(PlaceNotFoundError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a provider error as an outage', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }));

    await expect(getWeather('Kyoto')).rejects.toThrow(WeatherUnavailableError);
  });

  it('surfaces a dead network as an outage too', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(getWeather('Kyoto')).rejects.toThrow(WeatherUnavailableError);
  });

  it('throws rather than reporting a forecast with no temperature in it', async () => {
    fetchMock.mockResolvedValueOnce(ok(GEOCODE)).mockResolvedValueOnce(ok({ current: {} }));

    await expect(getWeather('Kyoto')).rejects.toThrow(WeatherUnavailableError);
  });

  it('falls back to the current temperature when a day carries no range', async () => {
    fetchMock.mockResolvedValueOnce(ok(GEOCODE)).mockResolvedValueOnce(
      ok({
        current: { temperature_2m: 12.6, weather_code: 3 },
        daily: { time: ['2027-04-02'] },
      }),
    );

    const report = await getWeather('Kyoto');

    expect(report.forecast[0]).toEqual({
      date: '2027-04-02',
      high: 13,
      low: 13,
      description: 'unsettled',
      precipitationMm: 0,
    });
  });

  it('answers with an empty forecast rather than failing when there is no daily block', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(GEOCODE))
      .mockResolvedValueOnce(ok({ current: { temperature_2m: 20, weather_code: 0 } }));

    await expect(getWeather('Kyoto')).resolves.toMatchObject({ temperature: 20, forecast: [] });
  });

  it('uses the name it was given when the provider returns none', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ results: [{ latitude: 1, longitude: 2 }] }))
      .mockResolvedValueOnce(ok(FORECAST));

    await expect(getWeather('Somewhere')).resolves.toMatchObject({ place: 'Somewhere' });
  });
});

describe('describeWeatherCode', () => {
  it('turns the WMO codes into words', () => {
    expect(describeWeatherCode(0)).toBe('clear');
    expect(describeWeatherCode(2)).toBe('mostly clear');
    expect(describeWeatherCode(45)).toBe('foggy');
    expect(describeWeatherCode(65)).toBe('heavy rain');
    expect(describeWeatherCode(75)).toBe('snowy');
    expect(describeWeatherCode(95)).toBe('thundery');
  });

  it('has a word for a code it does not know', () => {
    expect(describeWeatherCode(-1)).toBe('unsettled');
  });
});
