import { useCallback, useEffect, useMemo, useState } from 'react';
import { countryService } from '../../services/country.service';
import type { Country } from '../../services/country.service';
import { cityService } from '../../services/city.service';

/** Matches the explorer: enough to choose from, few enough to render. */
const CITY_SUGGESTIONS = 50;

export type DestinationOptionsState = {
  countries: Country[];
  isLoadingCountries: boolean;
  /** How many cities the chosen country has, so the caller can say so. */
  cityCount: number;
  isLoadingCities: boolean;
  /** Type-ahead matches for the city box, capped so the DOM stays small. */
  suggestCities: (query: string) => string[];
};

/**
 * The country and city lists a destination picker needs.
 *
 * Deliberately not `useExplore`: that hook persists its choice to global
 * storage and follows the active trip, so driving it from a form would repoint
 * the reader's Explore tab. This only reads the two cached reference lists.
 *
 * Both come from CountriesNow and need no API key, so a picker built on this
 * works with nothing configured.
 */
export function useDestinationOptions(countryName: string): DestinationOptionsState {
  const [countries, setCountries] = useState<Country[]>([]);
  const [isLoadingCountries, setIsLoadingCountries] = useState(true);

  const [cities, setCities] = useState<string[]>([]);
  const [isLoadingCities, setIsLoadingCities] = useState(false);

  useEffect(() => {
    let active = true;

    countryService
      .getCountries()
      .then((loaded) => {
        if (active) setCountries(loaded);
      })
      .catch(() => {
        // The form still works as free text without the list.
      })
      .finally(() => {
        if (active) setIsLoadingCountries(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Keyed on the name, because that is what the cities endpoint takes.
  useEffect(() => {
    if (!countryName) {
      setCities([]);
      setIsLoadingCities(false);
      return;
    }

    let active = true;
    setIsLoadingCities(true);

    cityService
      .getCities(countryName)
      .then((loaded) => {
        if (active) setCities(loaded);
      })
      .catch(() => {
        if (active) setCities([]);
      })
      .finally(() => {
        if (active) setIsLoadingCities(false);
      });

    return () => {
      active = false;
    };
  }, [countryName]);

  const suggestCities = useCallback(
    (query: string) => cityService.filter(cities, query, CITY_SUGGESTIONS),
    [cities],
  );

  return useMemo(
    () => ({
      countries,
      isLoadingCountries,
      cityCount: cities.length,
      isLoadingCities,
      suggestCities,
    }),
    [countries, isLoadingCountries, cities.length, isLoadingCities, suggestCities],
  );
}
