import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Activity } from '../../core/types/travel.types';
import { PAGE_SIZE } from '../../core/services/activity.service';
import { exploreService } from '../../core/services/explore.service';
import type {
  ChosenSelection,
  ExploreSelection,
  SelectionSource,
} from '../../core/services/explore.service';
import type { Country } from '../../core/services/country.service';
import { CountryLookupError } from '../../core/services/country.service';
import { CityLookupError } from '../../core/services/city.service';
import { useActiveTripId, useTrips } from '../../core/store/trip.store';
import { describeActivityError } from './activity.messages';

function describeLookupError(error: unknown, fallback: string): string {
  return error instanceof CountryLookupError || error instanceof CityLookupError
    ? error.message
    : fallback;
}

export type ExploreState = {
  /* selection */
  countries: Country[];
  cities: string[];
  selection: ExploreSelection;
  selectionSource: SelectionSource;
  /** True when a trip is offering a destination other than the chosen one. */
  canFollowTrip: boolean;
  tripCity: string | null;

  /* what is on screen */
  activities: Activity[];
  /** The city the activities on screen belong to — not necessarily the selected one. */
  exploredCity: string | null;

  /* states */
  isLoadingCountries: boolean;
  isLoadingCities: boolean;
  isLoadingActivities: boolean;
  isLoadingMore: boolean;
  countriesError: string | null;
  citiesError: string | null;
  activitiesError: string | null;
  hasMore: boolean;

  /* actions */
  selectCountry: (country: Country) => void;
  selectCity: (city: string) => void;
  /** Searches `city`, or the committed selection when it is omitted. */
  explore: (city?: string) => void;
  followTrip: () => void;
  loadMore: () => void;
  filterCities: (query: string, limit?: number) => string[];
};

/**
 * Everything the explorer screen needs: which country, which city, and what is
 * there.
 *
 * The selection is derived rather than held in component state — it comes from
 * `exploreService` (the reader's own choice) and the trip store (the trip they
 * last opened), both external stores. Subscribing to them means a change made
 * in another tab lands here without a reload, and there is no second copy of
 * the answer to keep in step.
 *
 * Activities deliberately do *not* follow the selection automatically. Picking
 * a country then a city is two steps, and searching after the first would spend
 * a request on a city the reader has not chosen yet — so the search is bound to
 * an explicit `explore()`, and `exploredCity` records what is actually on
 * screen.
 */
export function useExplore(): ExploreState {
  const trips = useTrips();
  const activeTripId = useActiveTripId();

  const chosen = useSyncExternalStore(
    exploreService.subscribe,
    getChosenSnapshot,
    getChosenSnapshot,
  );

  const [countries, setCountries] = useState<Country[]>([]);
  const [isLoadingCountries, setIsLoadingCountries] = useState(true);
  const [countriesError, setCountriesError] = useState<string | null>(null);

  const [cities, setCities] = useState<string[]>([]);
  const [isLoadingCities, setIsLoadingCities] = useState(false);
  const [citiesError, setCitiesError] = useState<string | null>(null);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [exploredCity, setExploredCity] = useState<string | null>(null);
  const [exploredCountryCode, setExploredCountryCode] = useState<string | null>(null);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);

  /** Drops responses that a newer search has superseded. */
  const generation = useRef(0);
  /** The scroll sentinel can re-fire before `isLoadingMore` has rendered. */
  const isFetchingMore = useRef(false);

  const selection = useMemo(
    () => exploreService.resolveSelection(trips, activeTripId, countries, chosen),
    [trips, activeTripId, countries, chosen],
  );

  const tripCity = useMemo(() => {
    const fromTrip = exploreService.resolveSelection(trips, activeTripId, countries, {
      country: null,
      city: null,
    });
    return fromTrip.source === 'trip' ? fromTrip.city : null;
  }, [trips, activeTripId, countries]);

  /* ------------------------------------------------------------ countries */

  useEffect(() => {
    let active = true;

    exploreService
      .getCountries()
      .then((loaded) => {
        if (!active) return;
        setCountries(loaded);
        setCountriesError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCountriesError(describeLookupError(error, 'We could not load the list of countries.'));
      })
      .finally(() => {
        if (active) setIsLoadingCountries(false);
      });

    return () => {
      active = false;
    };
  }, []);

  /* --------------------------------------------------------------- cities */

  const countryName = selection.countryName;

  useEffect(() => {
    if (!countryName) {
      setCities([]);
      setCitiesError(null);
      setIsLoadingCities(false);
      return;
    }

    let active = true;
    setIsLoadingCities(true);
    setCitiesError(null);

    exploreService
      .getCities(countryName)
      .then((loaded) => {
        if (!active) return;
        setCities(loaded);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCities([]);
        setCitiesError(
          describeLookupError(error, `We could not load the cities of ${countryName}.`),
        );
      })
      .finally(() => {
        if (active) setIsLoadingCities(false);
      });

    return () => {
      active = false;
    };
  }, [countryName]);

  /* ----------------------------------------------------------- activities */

  const runSearch = useCallback(
    async (city: string, countryCode: string | null, options: { forceRefresh?: boolean } = {}) => {
      const id = (generation.current += 1);
      isFetchingMore.current = false;

      setIsLoadingActivities(true);
      setActivitiesError(null);
      setExploredCity(city);
      setExploredCountryCode(countryCode);

      try {
        const result = await exploreService.getActivities({
          city,
          countryCode,
          offset: 0,
          limit: PAGE_SIZE,
          forceRefresh: options.forceRefresh,
        });

        if (id !== generation.current) return;

        setActivities(result.activities);
        // A stale copy is still worth showing — surface the reason alongside it.
        setActivitiesError(result.warning ?? null);
        setHasMore(result.hasMore && result.activities.length > 0);
      } catch (caught) {
        if (id !== generation.current) return;

        setActivities([]);
        setHasMore(false);
        setActivitiesError(describeActivityError(caught));
      } finally {
        if (id === generation.current) {
          setIsLoadingActivities(false);
          setIsLoadingMore(false);
        }
      }
    },
    [],
  );

  /**
   * The city is passed in rather than read from `selection` because the caller
   * commits it and searches in the same breath: the commit goes through the
   * store, so `selection` is still a render behind when the search starts.
   */
  const explore = useCallback(
    (city?: string) => {
      const target = (city ?? selection.city)?.trim();
      if (!target) return;

      void runSearch(target, selection.countryCode, { forceRefresh: false });
    },
    [runSearch, selection.city, selection.countryCode],
  );

  const loaded = activities.length;

  const loadMore = useCallback(async () => {
    if (!exploredCity || isFetchingMore.current) return;
    isFetchingMore.current = true;

    const id = generation.current;
    setIsLoadingMore(true);

    try {
      const result = await exploreService.getActivities({
        city: exploredCity,
        countryCode: exploredCountryCode,
        offset: loaded,
        limit: PAGE_SIZE,
      });

      if (id !== generation.current) return;

      setActivities((current) => [...current, ...result.activities]);
      // A page that came back empty means the pool is spent, whatever the
      // service reports — without this the sentinel would loop forever.
      setHasMore(result.hasMore && result.activities.length > 0);
      setActivitiesError(result.warning ?? null);
    } catch (caught) {
      if (id !== generation.current) return;

      // The pages already on screen stay; only the growth stops.
      setHasMore(false);
      setActivitiesError(describeActivityError(caught));
    } finally {
      isFetchingMore.current = false;
      if (id === generation.current) setIsLoadingMore(false);
    }
  }, [exploredCity, exploredCountryCode, loaded]);

  /**
   * A trip that already names a city explores it without a click — the reader
   * asked for that city when they made the trip. An explicit choice does not,
   * because choosing a country is only half of choosing a destination.
   */
  const autoExploredRef = useRef<string | null>(null);

  useEffect(() => {
    if (selection.source !== 'trip' || !selection.city) return;

    const key = `${selection.countryCode ?? ''}|${selection.city}`;
    if (autoExploredRef.current === key) return;

    autoExploredRef.current = key;
    void runSearch(selection.city, selection.countryCode);
  }, [runSearch, selection.source, selection.city, selection.countryCode]);

  /* -------------------------------------------------------------- actions */

  const selectCountry = useCallback((country: Country) => {
    exploreService.setCountry(country);
  }, []);

  const selectCity = useCallback((city: string) => {
    exploreService.setCity(city);
  }, []);

  const followTrip = useCallback(() => {
    exploreService.clearSelection();
  }, []);

  const filterCities = useCallback(
    (query: string, limit?: number) => exploreService.filterCities(cities, query, limit),
    [cities],
  );

  return {
    countries,
    cities,
    selection,
    selectionSource: selection.source,
    canFollowTrip: selection.source === 'chosen' && tripCity !== null,
    tripCity,

    activities,
    exploredCity,

    isLoadingCountries,
    isLoadingCities,
    isLoadingActivities,
    isLoadingMore,
    countriesError,
    citiesError,
    activitiesError,
    hasMore,

    selectCountry,
    selectCity,
    explore,
    followTrip,
    loadMore,
    filterCities,
  };
}

/**
 * The persisted choice, as a reference that only changes when the choice does.
 *
 * `useSyncExternalStore` compares snapshots with `Object.is` and re-reads on
 * every render, so returning a freshly built object would loop forever. The
 * serialised form decides when to swap the cached one — which also makes the
 * result a genuine `useMemo` dependency rather than a version counter sitting
 * beside one.
 */
let cachedKey: string | null = null;
let cachedSelection: ChosenSelection = { country: null, city: null };

function getChosenSnapshot(): ChosenSelection {
  const next = exploreService.getChosenSelection();
  const key = JSON.stringify(next);

  if (key !== cachedKey) {
    cachedKey = key;
    cachedSelection = next;
  }

  return cachedSelection;
}
