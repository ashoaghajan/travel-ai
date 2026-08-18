import type { Airport } from '../types/travel.types';
import { AIRPORTS, formatAirport } from '../mock/airports';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { http } from './http';

/**
 * Airport lookup for the search fields.
 *
 * The picker used to be a `<select>` over eight hardcoded airports, which was
 * right while the fares were invented. A real provider will price any route,
 * so this asks the API — 3,673 airports — and falls back to the built-in eight
 * when it cannot.
 *
 * It also remembers every airport the reader picks. That is not a cache for
 * speed: `partner.links.ts` needs a *city* to build a hotel or activity search
 * ("Milan", not "Milano Malpensa Airport") and it is pure and synchronous, so
 * the city has to be on hand locally by the time it runs.
 */

const SEARCH_LIMIT = 8;

/** Airports the reader has chosen, by code. Small, and never evicted. */
type KnownAirports = Record<string, Airport>;

function readKnown(): KnownAirports {
  return storageService.get<KnownAirports>(STORAGE_KEYS.airports, {});
}

export const airportService = {
  /** Matches for what the reader has typed. Empty query, empty list. */
  async search(query: string, signal?: AbortSignal): Promise<Airport[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    try {
      return await http.get<Airport[]>('/airports', {
        query: { q: trimmed, limit: SEARCH_LIMIT },
        signal,
      });
    } catch (error) {
      // An abort is the caller replacing this search with a newer one, not a
      // failure — let it through so the component can ignore it.
      if (error instanceof DOMException && error.name === 'AbortError') throw error;

      return this.searchOffline(trimmed);
    }
  },

  /** The built-in eight, filtered the same way. Used when the API is unreachable. */
  searchOffline(query: string): Airport[] {
    const wanted = query.toLowerCase();

    return AIRPORTS.filter(
      (airport) =>
        airport.code.toLowerCase().includes(wanted) ||
        airport.city.toLowerCase().includes(wanted) ||
        airport.name.toLowerCase().includes(wanted),
    ).slice(0, SEARCH_LIMIT);
  },

  /**
   * Every airport in one country, nearest a point first.
   *
   * For a trip's destination, where the choice is closed rather than open: a
   * trip to Armenia is flown into an Armenian airport, and the picker offers
   * that shortlist instead of the whole world. `near` is the destination
   * itself, so a trip to a town with no airport is offered the ones around it
   * in order of distance.
   *
   * Empty when the API cannot be reached — the caller falls back to the free
   * search rather than to a wrong shortlist.
   */
  async inCountry(
    countryCode: string,
    near?: { lat: number; lon: number } | null,
    signal?: AbortSignal,
  ): Promise<Airport[]> {
    const code = countryCode.trim().toUpperCase();
    if (code.length !== 2) return [];

    try {
      return await http.get<Airport[]>('/airports', {
        query: near ? { country: code, lat: near.lat, lon: near.lon } : { country: code },
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;

      return [];
    }
  },

  /**
   * Specific airports by IATA code.
   *
   * For the trip map, which knows the codes a flight runs between but may not
   * hold their positions: `resolve` only answers for airports the reader has
   * picked, and a booking restored from storage on a fresh device has not.
   */
  async byCode(codes: string[]): Promise<Airport[]> {
    const wanted = codes.map((code) => code.trim().toUpperCase()).filter(Boolean);
    if (wanted.length === 0) return [];

    try {
      return await http.get<Airport[]>('/airports', { query: { codes: wanted.join(',') } });
    } catch {
      return [];
    }
  },

  /**
   * What we know about a code without asking anyone.
   *
   * Checks the airports the reader has picked before, then the built-ins.
   * Synchronous on purpose — `partner.links.ts` and the booking context are
   * pure functions and making them async to name a city would be a poor trade.
   */
  resolve(code: string): Airport | undefined {
    if (!code) return undefined;

    const upper = code.toUpperCase();

    return readKnown()[upper] ?? AIRPORTS.find((airport) => airport.code === upper);
  },

  /** Remember one the reader chose, so `resolve` can name its city later. */
  remember(airport: Airport): void {
    try {
      storageService.set<KnownAirports>(STORAGE_KEYS.airports, {
        ...readKnown(),
        [airport.code.toUpperCase()]: airport,
      });
    } catch {
      // Storage full or blocked. The picker still works; only the city lookup
      // for this airport degrades, and it degrades to the airport's own name.
    }
  },

  /** "JFK - New York", the DESIGN_SPEC Screen 4 field format. */
  format: formatAirport,
};
