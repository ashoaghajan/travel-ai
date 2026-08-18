import type { FlightResults, FlightSearchQuery } from '../types/travel.types';
import { MOCK_FLIGHTS } from '../mock/flights';
import { http } from './http';

/**
 * Flight search.
 *
 * Live prices come from `GET /api/flights/search`, which holds the provider
 * token server-side. When that is unavailable — no token configured, provider
 * down, network gone — this falls back to the mock results and marks them
 * `source: 'sample'`, so the screens can say so rather than pass invented
 * numbers off as quotes.
 *
 * The fallback lives here, at the I/O boundary, so nothing above this file
 * knows which mode it is in.
 *
 * Note the return type. It used to be `Promise<Flight[]>`, and the comment
 * here promised the provider swap would not change it. It had to: provenance
 * belongs to the answer rather than to any one fare in it, and no screen
 * should be able to render a price without knowing whether it is real.
 */

/** Only on the sample path, so the results list still exercises its skeletons. */
const SAMPLE_DELAY_MS = 700;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function sampleFlights(query: FlightSearchQuery): Promise<FlightResults> {
  await delay(SAMPLE_DELAY_MS);

  return {
    results: MOCK_FLIGHTS.map((flight) => ({ ...flight, from: query.from, to: query.to })),
    source: 'sample',
    quotedAt: null,
  };
}

export const flightService = {
  async searchFlights(query: FlightSearchQuery): Promise<FlightResults> {
    try {
      // A configured provider that knows nothing about this route answers with
      // an empty list, and that is returned as-is: no fares is a true answer,
      // and inventing five would not be.
      return await http.get<FlightResults>('/flights/search', {
        query: {
          from: query.from,
          to: query.to,
          departDate: query.departDate,
          returnDate: query.returnDate,
          travellers: query.travellers,
        },
      });
    } catch {
      // Every failure lands here deliberately. Whether the token is missing or
      // the provider is down, the reader gets a working screen and a label
      // telling them these particular prices are illustrative.
      return sampleFlights(query);
    }
  },
};
