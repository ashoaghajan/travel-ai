import type { Airport } from '../types/travel.types';

/**
 * The airports the app knows without asking anyone.
 *
 * No longer the whole picker — `airport.service.ts` searches the API's full
 * directory. These remain as the offline fallback and as the defaults, so the
 * flight search still works with no network and no provider token.
 */
export const AIRPORTS: Airport[] = [
  { code: 'JFK', city: 'New York', name: 'John F. Kennedy International', countryCode: 'US' },
  { code: 'DPS', city: 'Denpasar Bali', name: 'Ngurah Rai International', countryCode: 'ID' },
  { code: 'LHR', city: 'London', name: 'Heathrow', countryCode: 'GB' },
  { code: 'CDG', city: 'Paris', name: 'Charles de Gaulle', countryCode: 'FR' },
  { code: 'DXB', city: 'Dubai', name: 'Dubai International', countryCode: 'AE' },
  { code: 'DOH', city: 'Doha', name: 'Hamad International', countryCode: 'QA' },
  { code: 'SIN', city: 'Singapore', name: 'Changi', countryCode: 'SG' },
  { code: 'HND', city: 'Tokyo', name: 'Haneda', countryCode: 'JP' },
];

/** "JFK - New York" — DESIGN_SPEC Screen 4 field format. */
export function formatAirport(airport: Airport): string {
  return `${airport.code} - ${airport.city}`;
}

export function findAirport(code: string): Airport | undefined {
  return AIRPORTS.find((airport) => airport.code === code);
}

/** Defaults from DESIGN_SPEC Screen 4. */
export const DEFAULT_ORIGIN = 'JFK';
export const DEFAULT_DESTINATION = 'DPS';
