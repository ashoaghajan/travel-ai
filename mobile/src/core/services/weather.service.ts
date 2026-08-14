import { ApiError, http } from './http';

/**
 * Weather, through our own `/api/weather`.
 *
 * Open-Meteo is keyless, so this did not move server-side for secrecy — it
 * moved so the browser makes no third-party request of its own, and so the
 * server's existing weather client (the one the planner's `get_weather` tool
 * uses) answers both callers from one cache. Two implementations of "what is
 * the weather in X" would drift.
 *
 * No React component may import this file.
 */

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
  /**
   * The country's name. No country *code* here, unlike `PlaceFacts` — the
   * forecast endpoint does not carry one, nothing ever read it, and a field
   * that is always `undefined` is worse than an absent one.
   */
  country?: string;
  /** Degrees Celsius, now. */
  temperature: number;
  /** Plain-language sky, e.g. "clear", "light rain". */
  description: string;
  /** Today's range in Celsius. */
  high: number;
  low: number;
};

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

/** What the endpoint answers with: a forecast spanning one or more days. */
type ApiWeatherReport = {
  place: string;
  country?: string;
  temperature: number;
  description: string;
  forecast?: { high: number; low: number }[];
};

/**
 * A name that resolves to nothing is the one failure worth distinguishing —
 * the planner repeats it back ("I could not find anywhere called X") rather
 * than reporting that the lookup broke. The server sends it as a 404.
 */
function asWeatherError(error: unknown, place: string): Error {
  if (error instanceof ApiError && error.status === 404) return new PlaceNotFoundError(place);

  return new WeatherUnavailableError();
}

export const weatherService = {
  /**
   * Where a named place is.
   *
   * Answerable from the geocoder alone — country, region, coordinates and
   * timezone, with nothing invented.
   */
  async findPlace(place: string, signal?: AbortSignal): Promise<PlaceFacts> {
    const name = place.trim();
    if (!name) throw new PlaceNotFoundError(place);

    try {
      return await http.get<PlaceFacts>('/weather/place', { query: { place: name }, signal });
    } catch (error) {
      throw asWeatherError(error, name);
    }
  },

  /** Today's weather for a named place. */
  async getWeather(place: string, signal?: AbortSignal): Promise<WeatherReport> {
    const name = place.trim();
    if (!name) throw new PlaceNotFoundError(place);

    let report: ApiWeatherReport;

    try {
      report = await http.get<ApiWeatherReport>('/weather', { query: { place: name }, signal });
    } catch (error) {
      throw asWeatherError(error, name);
    }

    // The endpoint speaks in days because the planner's tool asks for a span.
    // This screen only ever wants today, so the range is read off the first
    // day and falls back to the current reading when the forecast is empty.
    const today = report.forecast?.[0];

    return {
      place: report.place,
      country: report.country,
      temperature: report.temperature,
      description: report.description,
      high: today?.high ?? report.temperature,
      low: today?.low ?? report.temperature,
    };
  },
};
