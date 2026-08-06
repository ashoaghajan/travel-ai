/**
 * Weather, from Open-Meteo.
 *
 * Chosen because it needs no key and no signup — the planner can answer "what
 * is the weather in Abu Dhabi?" on a fresh clone with nothing configured,
 * which is the same bar `country.service` and `city.service` already meet.
 * Its free tier asks only for non-commercial use and reasonable volume.
 *
 * Two calls: its own geocoder resolves the name, then the forecast endpoint
 * answers for that point. Deliberately not `geocodeService` — that one is
 * OpenTripMap, needs a key, and returns attractions as readily as cities.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** Long enough to spare the free tier a burst, short enough to stay true. */
const CACHE_TTL_MS = 10 * 60 * 1000;

export class WeatherUnavailableError extends Error {
  constructor() {
    super('Weather is unavailable right now.');
    this.name = 'WeatherUnavailableError';
  }
}

export class PlaceNotFoundError extends Error {
  constructor(place: string) {
    super(`No place called "${place}".`);
    this.name = 'PlaceNotFoundError';
  }
}

export type WeatherReport = {
  /** The place as the provider names it, e.g. "Abu Dhabi". */
  place: string;
  /** ISO 3166-1 alpha-2, when the provider gives one. */
  countryCode?: string;
  country?: string;
  /** Degrees Celsius, now. */
  temperature: number;
  /** Plain-language sky, e.g. "clear", "light rain". */
  description: string;
  /** Today's range in Celsius. */
  high: number;
  low: number;
};

/**
 * WMO weather codes, as words.
 *
 * Open-Meteo answers with a number; nobody wants to read "code 61". Grouped
 * rather than enumerated to the last variant — "light rain" is the useful
 * answer, and "light freezing drizzle" is not worth four more branches.
 */
const WEATHER_CODES: [codes: number[], text: string][] = [
  [[0], 'clear'],
  [[1, 2], 'mostly clear'],
  [[3], 'overcast'],
  [[45, 48], 'foggy'],
  [[51, 53, 55, 56, 57], 'drizzly'],
  [[61, 63, 66, 80, 81], 'rainy'],
  [[65, 82], 'heavy rain'],
  [[71, 73, 75, 77, 85, 86], 'snowy'],
  [[95, 96, 99], 'thundery'],
];

export function describeWeatherCode(code: number): string {
  return WEATHER_CODES.find(([codes]) => codes.includes(code))?.[1] ?? 'unsettled';
}

type Cached = { at: number; report: WeatherReport };

/**
 * In memory only, unlike the other caches here.
 *
 * Weather is the one answer in this app that is wrong within the hour, so it
 * has no business surviving a reload in localStorage.
 */
const cache = new Map<string, Cached>();

type GeocodeHit = {
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  timezone?: string;
  population?: number;
};

/** A place as the provider knows it — enough to answer "where is X?". */
export type PlaceFacts = {
  name: string;
  country?: string;
  countryCode?: string;
  /** State, province or emirate, when the provider names one. */
  region?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  population?: number;
};

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new WeatherUnavailableError();

  return (await response.json()) as T;
}

export const weatherService = {
  /**
   * Where a named place is.
   *
   * The same geocoder the forecast uses, exposed on its own because "where is
   * Abu Dhabi?" is answerable from it alone — country, region, coordinates and
   * timezone, with nothing invented.
   */
  async findPlace(place: string, signal?: AbortSignal): Promise<PlaceFacts> {
    const name = place.trim();
    if (!name) throw new PlaceNotFoundError(place);

    const found = await getJson<{ results?: GeocodeHit[] }>(
      `${GEOCODE_URL}?${new URLSearchParams({ name, count: '1', language: 'en', format: 'json' })}`,
      signal,
    );

    const hit = found.results?.[0];
    if (!hit || hit.latitude === undefined || hit.longitude === undefined) {
      throw new PlaceNotFoundError(name);
    }

    return {
      name: hit.name ?? name,
      country: hit.country,
      countryCode: hit.country_code,
      region: hit.admin1,
      latitude: hit.latitude,
      longitude: hit.longitude,
      timezone: hit.timezone,
      population: hit.population,
    };
  },

  /**
   * Today's weather for a named place.
   *
   * Throws `PlaceNotFoundError` when the name resolves to nothing — that is an
   * answer the planner can repeat back, unlike a generic failure.
   */
  async getWeather(place: string, signal?: AbortSignal): Promise<WeatherReport> {
    const name = place.trim();
    if (!name) throw new PlaceNotFoundError(place);

    const key = name.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.report;

    const place0 = await weatherService.findPlace(name, signal);

    const forecast = await getJson<{
      current?: { temperature_2m?: number; weather_code?: number };
      daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
    }>(
      `${FORECAST_URL}?${new URLSearchParams({
        latitude: String(place0.latitude),
        longitude: String(place0.longitude),
        current: 'temperature_2m,weather_code',
        daily: 'temperature_2m_max,temperature_2m_min',
        forecast_days: '1',
        timezone: 'auto',
      })}`,
      signal,
    );

    const temperature = forecast.current?.temperature_2m;
    if (temperature === undefined) throw new WeatherUnavailableError();

    const report: WeatherReport = {
      place: place0.name,
      country: place0.country,
      countryCode: place0.countryCode,
      temperature: Math.round(temperature),
      description: describeWeatherCode(forecast.current?.weather_code ?? -1),
      high: Math.round(forecast.daily?.temperature_2m_max?.[0] ?? temperature),
      low: Math.round(forecast.daily?.temperature_2m_min?.[0] ?? temperature),
    };

    cache.set(key, { at: Date.now(), report });
    return report;
  },

  /** Only for tests and a hard refresh — the TTL handles the normal case. */
  clearCache(): void {
    cache.clear();
  },
};
