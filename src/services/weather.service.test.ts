import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { PlaceNotFoundError, WeatherUnavailableError, weatherService } from './weather.service';

/**
 * The weather client, now that it talks to our API rather than to Open-Meteo.
 *
 * The provider conversation — geocode, then forecast — lives in
 * `server/src/modules/planner/weather.ts` and is tested there. What is left
 * here is the part that stayed: reading today's range out of a multi-day
 * forecast, and keeping "no such place" distinguishable from "the lookup
 * broke". The planner says different sentences for those two, so collapsing
 * them changes what a reader is told.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse({ error: { code, message: 'Nope.', details: null } }, status);
}

function stubFetch(implementation: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn((input: string | URL) => implementation(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const FORECAST = {
  place: 'Abu Dhabi',
  country: 'United Arab Emirates',
  temperature: 34,
  description: 'clear',
  forecast: [{ date: '2026-08-10', high: 38, low: 29, description: 'clear', precipitationMm: 0 }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getWeather', () => {
  it('asks our API, never the provider', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(FORECAST));

    await weatherService.getWeather('Abu Dhabi');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/weather');
    expect(url).not.toContain('open-meteo.com');
  });

  it("reads today's range out of the forecast", async () => {
    stubFetch(async () => jsonResponse(FORECAST));

    await expect(weatherService.getWeather('Abu Dhabi')).resolves.toEqual({
      place: 'Abu Dhabi',
      country: 'United Arab Emirates',
      temperature: 34,
      description: 'clear',
      high: 38,
      low: 29,
    });
  });

  it('falls back to the current reading when the forecast is empty', async () => {
    stubFetch(async () => jsonResponse({ ...FORECAST, forecast: [] }));

    const report = await weatherService.getWeather('Abu Dhabi');

    // Better than showing a high of `undefined°C` in a sentence the planner
    // reads back to the user.
    expect(report.high).toBe(34);
    expect(report.low).toBe(34);
  });

  it('reports an unknown place as its own kind of failure', async () => {
    stubFetch(async () => errorResponse(404, ERROR_CODES.NOT_FOUND));

    // The planner answers "I could not find a place called X" for this, and
    // "the weather service is unreachable" for anything else.
    await expect(weatherService.getWeather('Atlantis')).rejects.toBeInstanceOf(PlaceNotFoundError);
  });

  it('reports an outage as unavailable rather than unknown', async () => {
    stubFetch(async () => errorResponse(502, ERROR_CODES.INTERNAL));

    const caught = await weatherService.getWeather('Abu Dhabi').catch((error) => error);

    expect(caught).toBeInstanceOf(WeatherUnavailableError);
    expect(caught).not.toBeInstanceOf(PlaceNotFoundError);
  });

  it('rejects a blank name without asking the server', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(FORECAST));

    await expect(weatherService.getWeather('   ')).rejects.toBeInstanceOf(PlaceNotFoundError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('findPlace', () => {
  const FACTS = {
    name: 'Abu Dhabi',
    country: 'United Arab Emirates',
    countryCode: 'AE',
    region: 'Abu Dhabi',
    latitude: 24.45,
    longitude: 54.38,
    timezone: 'Asia/Dubai',
    population: 603_492,
  };

  it('returns the facts the geocoder gives', async () => {
    stubFetch(async () => jsonResponse(FACTS));

    await expect(weatherService.findPlace('Abu Dhabi')).resolves.toEqual(FACTS);
  });

  it('asks the place endpoint', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(FACTS));

    await weatherService.findPlace('Abu Dhabi');

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/weather/place');
  });

  it('reports an unknown place', async () => {
    stubFetch(async () => errorResponse(404, ERROR_CODES.NOT_FOUND));

    await expect(weatherService.findPlace('Atlantis')).rejects.toBeInstanceOf(PlaceNotFoundError);
  });

  it('rejects a blank name without asking the server', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(FACTS));

    await expect(weatherService.findPlace('')).rejects.toBeInstanceOf(PlaceNotFoundError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
