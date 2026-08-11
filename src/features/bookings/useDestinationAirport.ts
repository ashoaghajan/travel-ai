import { useEffect, useState } from 'react';
import type { BookingContext } from '../../types/travel.types';
import { airportService } from '../../services/airport.service';
import { countryService } from '../../services/country.service';
import { geocodeService } from '../../services/geocode.service';

/**
 * The airport a trip flies into, when nothing has said which.
 *
 * A trip records a city and a country; a fare search needs an IATA code. On
 * `/bookings` the search form supplies one and this never fires. On a trip's
 * Bookings tab there is no form — and `resolveBookingContext` deliberately
 * drops a searched airport that belongs to a different city — so without this
 * the Flights tab there would sit empty for anyone who had not already run a
 * flight search for that exact trip.
 *
 * It used to live inside `FlightLegs`, as the default of a destination picker
 * the reader could override. The picker is gone — the route comes from the
 * search now — but the lookup behind it was never really about being editable,
 * so it stays here with no UI attached.
 *
 * Every failure costs precision and nothing else: an unknown country means no
 * shortlist, a city the geocoder does not hold means the country's airports in
 * the order they came, and either way `canSearchFlights` stays false and the
 * tab says so.
 */
export function useDestinationAirport(context: BookingContext): string | null {
  const [code, setCode] = useState<string | null>(null);

  const { destinationCountry, destinationCity, destinationCode } = context;

  useEffect(() => {
    // Already answered — by the search form, or by a trip whose city matched.
    if (destinationCode || !destinationCountry) {
      setCode(null);
      return;
    }

    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const countries = await countryService.getCountries();
        const match = countries.find(
          (candidate) => candidate.name.toLowerCase() === destinationCountry.toLowerCase(),
        );
        if (!match || !active) return;

        const point = destinationCity
          ? await geocodeService.locate(destinationCity, match.code)
          : null;

        const found = await airportService.inCountry(
          match.code,
          point ? { lat: point.lat, lon: point.lng } : null,
          controller.signal,
        );

        // Ordered by distance from the trip's own city, so the first is the
        // closest airport to where the reader is going.
        if (active) setCode(found[0]?.code ?? null);
      } catch {
        if (active) setCode(null);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [destinationCountry, destinationCity, destinationCode]);

  return destinationCode ? null : code;
}
