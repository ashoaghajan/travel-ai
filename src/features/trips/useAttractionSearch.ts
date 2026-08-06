import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Activity } from '../../types/travel.types';
import { activityService } from '../../services/activity.service';
import { countryService } from '../../services/country.service';
import type { Country } from '../../services/country.service';
import { describeActivityError } from '../explore/activity.messages';

/**
 * The whole pool in one request.
 *
 * `limit` never reaches the network: `activity.service` always fetches every
 * candidate and then slices a pool it already holds. Asking for all of it is
 * therefore free, and it is the only way the text filter can see a place that
 * would otherwise sit on page four — there is no keyword endpoint to ask.
 * Two hundred is the service's ceiling: four category searches of fifty,
 * before de-duplication.
 */
const POOL_LIMIT = 200;

export type AttractionSearchState = {
  countries: Country[];
  isLoadingCountries: boolean;
  /** The trip's country as an ISO code, once the list has resolved it. */
  tripCountryCode: string | null;
  /** The destination the results on screen belong to. */
  searchedDestination: string | null;
  activities: Activity[];
  isLoading: boolean;
  /** Fatal: there is nothing on screen. */
  error: string | null;
  /** Not fatal: the list below is a stale copy, and still worth showing. */
  warning: string | null;
  search: (destination: string, countryCode: string | null) => void;
};

/**
 * Attractions for one city, for the itinerary picker.
 *
 * Deliberately not `useExplore`: that hook persists its country and city to
 * global storage through `exploreService.setCountry`/`setCity` and follows the
 * active trip, so driving it from a dialog would silently repoint the reader's
 * Explore tab. Nothing here is persisted except the service's own result cache.
 */
export function useAttractionSearch(options: {
  /** The day's city; searched once, as soon as the country list resolves. */
  destination: string;
  /** The trip's country name, matched against the list for an ISO code. */
  countryName: string | null;
}): AttractionSearchState {
  const { destination, countryName } = options;

  const [countries, setCountries] = useState<Country[]>([]);
  const [isLoadingCountries, setIsLoadingCountries] = useState(true);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [searchedDestination, setSearchedDestination] = useState<string | null>(null);
  // Starts true: an automatic search is already on its way, and painting the
  // empty state in the gap would flash "nothing here" at every reader.
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  /** Drops responses a newer search has superseded. */
  const generation = useRef(0);

  useEffect(() => {
    let active = true;

    countryService
      .getCountries()
      .then((loaded) => {
        if (active) setCountries(loaded);
      })
      .catch(() => {
        // A missing list costs disambiguation, not the search itself.
      })
      .finally(() => {
        if (active) setIsLoadingCountries(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const tripCountryCode = useMemo(
    () => countryService.findByName(countries, countryName)?.code ?? null,
    [countries, countryName],
  );

  const search = useCallback((next: string, countryCode: string | null) => {
    const city = next.trim();
    if (!city) return;

    const id = (generation.current += 1);

    setIsLoading(true);
    setError(null);
    setWarning(null);
    setSearchedDestination(city);

    activityService
      .getActivities({
        destination: city,
        countryCode: countryCode ?? undefined,
        offset: 0,
        limit: POOL_LIMIT,
      })
      .then((result) => {
        if (id !== generation.current) return;
        setActivities(result.activities);
        // A stale copy is still a usable list: it sits beside the results as a
        // warning, never in place of them.
        setWarning(result.warning ?? null);
      })
      .catch((caught: unknown) => {
        if (id !== generation.current) return;
        setActivities([]);
        setError(describeActivityError(caught));
      })
      .finally(() => {
        if (id === generation.current) setIsLoading(false);
      });
  }, []);

  /**
   * The opening search waits for the country list.
   *
   * Not only so the geoname lookup picks the right city of that name — the
   * result cache is keyed on destination *and* country code, so searching
   * before the code is known writes a slot the explorer will never read, and
   * turns a near-certain cache hit into a guaranteed request.
   */
  const hasSearched = useRef(false);

  useEffect(() => {
    if (isLoadingCountries || hasSearched.current) return;
    hasSearched.current = true;

    // A day scaffolded by the create form may name nowhere at all; without this
    // the dialog would show skeletons that never resolve.
    if (!destination.trim()) {
      setIsLoading(false);
      return;
    }

    search(destination, tripCountryCode);
  }, [isLoadingCountries, tripCountryCode, destination, search]);

  return {
    countries,
    isLoadingCountries,
    tripCountryCode,
    searchedDestination,
    activities,
    isLoading,
    error,
    warning,
    search,
  };
}
