import { useEffect, useMemo, useRef, useState } from 'react';
import type { LatLng } from '../../types/trip.types';
import type { ItineraryStop } from '../../utils/trip';
import { geocodeService } from '../../services/geocode.service';
import { countryService } from '../../services/country.service';
import { MissingApiKeyError } from '../../services/opentripmap.service';

const MISSING_KEY_NOTICE =
  'The map cannot place these stops: the server has no OpenTripMap key configured.';

export type LocatedStop = ItineraryStop & { coordinates: LatLng };

export type StopCoordinatesState = {
  /** Stops that can be drawn, in itinerary order. */
  located: LocatedStop[];
  /** Stops with no coordinates to be had — "Departure", or a name the API rejects. */
  unlocated: ItineraryStop[];
  /** True while lookups are outstanding and there is nothing to draw yet. */
  isLoading: boolean;
  /** Set only for a missing API key — actionable, and worth saying once. */
  notice: string | null;
};

/**
 * Resolves a point for each stop of a trip.
 *
 * Coordinates come from the itinerary first — a day's own point, or the centre
 * of the attractions planned there, both already computed by
 * `groupItineraryStops`. Only what remains is geocoded, and those results live
 * in `geocodeService`'s own cache.
 *
 * **Nothing here writes to the trip.** A write would bump `updatedAt`, which
 * re-baselines `useEditTrip` and would silently discard an in-progress
 * itinerary edit — and this hook runs while that edit is open.
 */
export function useStopCoordinates(
  stops: ItineraryStop[],
  countryName: string | null,
): StopCoordinatesState {
  const [geocoded, setGeocoded] = useState<Map<string, LatLng | null>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [countryCode, setCountryCode] = useState<string | undefined>(undefined);

  // The ISO code disambiguates: there is a Valencia in Spain and in Venezuela.
  // A failure here costs precision, not the lookup.
  useEffect(() => {
    if (!countryName) {
      setCountryCode(undefined);
      return;
    }

    let active = true;

    countryService
      .getCountries()
      .then((countries) => {
        if (active) setCountryCode(countryService.findByName(countries, countryName)?.code);
      })
      .catch(() => {
        // Unfiltered is better than not at all.
      });

    return () => {
      active = false;
    };
  }, [countryName]);

  /** Only the names that the itinerary could not answer for itself. */
  const missing = useMemo(
    () => stops.filter((stop) => !stop.coordinates).map((stop) => stop.destination),
    [stops],
  );

  // A string, so an edit-mode re-render that changed nothing relevant does not
  // re-run the lookups.
  const missingKey = missing.join('|');
  const requested = useRef('');

  useEffect(() => {
    const key = `${countryCode ?? ''}::${missingKey}`;
    if (requested.current === key) return;
    requested.current = key;

    if (missing.length === 0) {
      setIsLoading(false);
      return;
    }

    /*
     * The claim on `key` is released if this effect is torn down before its
     * lookup lands, and it has to be. Under StrictMode the effect runs, is
     * cleaned up, and runs again on the same key: the first pass set the ref
     * and started the request, the cleanup set `active = false` so its result
     * was thrown away, and the second pass returned early because the ref
     * already held the key. Nothing was left to write the coordinates, so the
     * map drew none of the stops and said "0 of 2" under itself — with the
     * geocode cache on disk holding the very points it would not show.
     */
    let active = true;
    setIsLoading(true);
    setNotice(null);

    geocodeService
      .locateAll(missing, countryCode)
      .then((results) => {
        if (!active) return;

        const next = new Map<string, LatLng | null>();
        results.forEach((point, name) => {
          next.set(name, point ? { lat: point.lat, lng: point.lng } : null);
        });
        setGeocoded(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        // Only the missing key is worth telling the reader about; everything
        // else simply leaves the stop unplaced.
        if (error instanceof MissingApiKeyError) setNotice(MISSING_KEY_NOTICE);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      // Torn down before the answer arrived: let the next run ask again.
      if (requested.current === key) requested.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, countryCode]);

  return useMemo(() => {
    const located: LocatedStop[] = [];
    const unlocated: ItineraryStop[] = [];

    for (const stop of stops) {
      const point = stop.coordinates ?? geocoded.get(stop.destination) ?? undefined;
      if (point) {
        located.push({ ...stop, coordinates: point });
      } else {
        unlocated.push(stop);
      }
    }

    return { located, unlocated, isLoading: isLoading && located.length === 0, notice };
  }, [stops, geocoded, isLoading, notice]);
}
