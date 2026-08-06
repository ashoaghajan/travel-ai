/**
 * Weather, from Open-Meteo — the one fact the planner looks up rather than
 * recalls.
 *
 * The model knows Lisbon's climate in October; it cannot know that it is 14°C
 * and raining there right now, and a plausible guess about the week someone is
 * about to fly is worse than no answer. So `get_weather` is a real lookup.
 *
 * Chosen because it needs no key: a fresh clone with only `ANTHROPIC_API_KEY`
 * set still answers weather questions. Two calls — its own geocoder resolves
 * the name, then the forecast endpoint answers for that point.
 *
 * The SPA has its own copy in `src/services/weather.service.ts`, which still
 * backs the offline rules engine. Deliberately duplicated rather than shared:
 * that one is bundled into the browser, this one is not, and the two answer
 * different questions (a sentence for the user, a forecast table for the model).
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** Long enough to spare the free tier a burst, short enough to stay true. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Open-Meteo's own ceiling for a free forecast. */
export const MAX_FORECAST_DAYS = 7;

/**
 * WMO weather codes, as words. Open-Meteo answers with a number, and "code 61"
 * is not something the model should have to interpret.
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

export type WeatherDay = {
  /** ISO calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Degrees Celsius. */
  high: number;
  low: number;
  description: string;
  /** Millimetres expected over the day. */
  precipitationMm: number;
};

export type WeatherReport = {
  /** The place as the provider names it, e.g. "Abu Dhabi". */
  place: string;
  country?: string;
  /** Degrees Celsius, now. */
  temperature: number;
  description: string;
  /** Today first. */
  forecast: WeatherDay[];
};

/**
 * The one failure worth distinguishing: a name that resolves to nothing is an
 * answer the model can repeat back ("I could not find anywhere called X"),
 * where a provider outage is not.
 */
export class PlaceNotFoundError extends Error {
  constructor(place: string) {
    super(`No place called "${place}".`);
    this.name = 'PlaceNotFoundError';
  }
}

export class WeatherUnavailableError extends Error {
  constructor() {
    super('Weather is unavailable right now.');
    this.name = 'WeatherUnavailableError';
  }
}

type GeocodeHit = {
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
};

type Forecast = {
  current?: { temperature_2m?: number; weather_code?: number };
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weather_code?: number[];
    precipitation_sum?: number[];
  };
};

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, { signal });
  } catch {
    throw new WeatherUnavailableError();
  }

  if (!response.ok) throw new WeatherUnavailableError();

  return (await response.json()) as T;
}

type Cached = { at: number; report: WeatherReport };

/**
 * In memory and never persisted: weather is the one answer here that is wrong
 * within the hour. Keyed by name *and* day count, so a one-day question does
 * not serve a stale answer to a seven-day one.
 */
const cache = new Map<string, Cached>();

function toDays(daily: Forecast['daily'], fallback: number): WeatherDay[] {
  const dates = daily?.time ?? [];

  return dates.map((date, index) => ({
    date,
    high: Math.round(daily?.temperature_2m_max?.[index] ?? fallback),
    low: Math.round(daily?.temperature_2m_min?.[index] ?? fallback),
    description: describeWeatherCode(daily?.weather_code?.[index] ?? -1),
    precipitationMm: Math.round((daily?.precipitation_sum?.[index] ?? 0) * 10) / 10,
  }));
}

export async function getWeather(
  place: string,
  days = 1,
  signal?: AbortSignal,
): Promise<WeatherReport> {
  const name = place.trim();
  if (!name) throw new PlaceNotFoundError(place);

  const span = Math.min(Math.max(Math.trunc(days) || 1, 1), MAX_FORECAST_DAYS);
  const key = `${name.toLowerCase()}:${span}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.report;

  const found = await getJson<{ results?: GeocodeHit[] }>(
    `${GEOCODE_URL}?${new URLSearchParams({ name, count: '1', language: 'en', format: 'json' })}`,
    signal,
  );

  const place0 = found.results?.[0];
  if (!place0 || place0.latitude === undefined || place0.longitude === undefined) {
    throw new PlaceNotFoundError(name);
  }

  const forecast = await getJson<Forecast>(
    `${FORECAST_URL}?${new URLSearchParams({
      latitude: String(place0.latitude),
      longitude: String(place0.longitude),
      current: 'temperature_2m,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum',
      forecast_days: String(span),
      timezone: 'auto',
    })}`,
    signal,
  );

  const temperature = forecast.current?.temperature_2m;
  if (temperature === undefined) throw new WeatherUnavailableError();

  const report: WeatherReport = {
    place: place0.name ?? name,
    country: place0.country,
    temperature: Math.round(temperature),
    description: describeWeatherCode(forecast.current?.weather_code ?? -1),
    forecast: toDays(forecast.daily, temperature),
  };

  cache.set(key, { at: Date.now(), report });
  return report;
}

/** Testing seam — the cache outlives a request by design. */
export function resetWeatherCache(): void {
  cache.clear();
}
