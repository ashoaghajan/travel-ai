import { airportService } from './airport.service';
import { geocodeService } from './geocode.service';
import { locationService } from './location.service';
import type { Airport } from '../types/travel.types';

/** Resolve the device's city to a departure airport, using the existing permission/cache rules. */
export const currentCityAirportService = {
  async locate(signal?: AbortSignal): Promise<Airport | null> {
    try {
      const place = await locationService.locate();
      if (!place?.city || !place.countryCode || signal?.aborted) return null;

      const country = place.countryCode.toUpperCase();
      const city = place.city.trim();
      const airports = await airportService.search(city, signal);
      if (signal?.aborted) return null;

      // City names can occur in several countries; a text match alone is not enough.
      let airport = airports.find(
        (candidate) =>
          candidate.countryCode === country &&
          candidate.city.trim().toLowerCase() === city.toLowerCase(),
      );

      if (!airport) {
        // Towns without an airport use the nearest one in their country. Never
        // pick an arbitrary country's first airport when geocoding fails.
        const point = await geocodeService.locate(place.city, country);
        if (!point || signal?.aborted) return null;
        const nearby = await airportService.inCountry(
          country,
          { lat: point.lat, lon: point.lng },
          signal,
        );
        airport = nearby[0];
      }

      if (!airport || signal?.aborted) return null;
      airportService.remember(airport);
      return airport;
    } catch {
      // Automatic defaults are optional; the manual airport picker still works.
      return null;
    }
  },
};
