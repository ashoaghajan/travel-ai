import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Activity } from '../../types/travel.types';
import { PAGE_SIZE } from '../../services/activity.service';
import { LocationError, exploreService } from '../../services/explore.service';
import type {
  ChosenSelection,
  DevicePlace,
  ExploreSelection,
  LocationPermission,
  SelectionSource,
} from '../../services/explore.service';
import type { Country } from '../../services/country.service';
import { CountryLookupError } from '../../services/country.service';
import { CityLookupError } from '../../services/city.service';
import { useActiveTripId, useTrips } from '../../store/trip.store';
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

  /* where the device says it is */
  /** False only where the platform cannot answer at all. */
  canUseLocation: boolean;
  locationPermission: LocationPermission;
  isLocating: boolean;
  locationError: string | null;

  /* what is on screen */
  activities: Activity[];
  /** The city the activities on screen belong to — not necessarily the selected one. */
  exploredCity: string | null;
  /** Country of the results currently on screen (not the possibly edited selector). */
  exploredCountryCode: string | null;

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
  /** Locates the device, asks for permission if it must, and commits the result. */
  useMyLocation: () => void;
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
 *
 * The device is the third source, behind both of those and consulted only when
 * neither has anything to say — see `explore.service`. It is held in component
 * state rather than subscribed to because, unlike the other two, nothing else
 * in the app can change it: a fix is taken here or not at all.
 */
export function useExplore(options: { preferredTripId?: string | null } = {}): ExploreState {
  const trips = useTrips();
  const activeTripId = useActiveTripId();
  const contextTripId = trips.some((trip) => trip.id === options.preferredTripId)
    ? options.preferredTripId ?? activeTripId
    : activeTripId;

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

  const [device, setDevice] = useState<DevicePlace | null>(() =>
    exploreService.getRememberedLocation(),
  );
  const [locationPermission, setLocationPermission] = useState<LocationPermission>('prompt');
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  /**
   * Whether the device has been given its chance to answer.
   *
   * The barrier the automatic search waits behind. Without it a reader with a
   * trip would watch that trip's city load and then be replaced by their own a
   * second later — two searches, one of them wasted, and a screen that changes
   * its mind in front of them.
   */
  const [isLocationSettled, setIsLocationSettled] = useState(false);

  /** Drops responses that a newer search has superseded. */
  const generation = useRef(0);
  /** The scroll sentinel can re-fire before `isLoadingMore` has rendered. */
  const isFetchingMore = useRef(false);
  /** The destination already searched, so the effect below never repeats one. */
  const autoExploredRef = useRef<string | null>(null);

  const selection = useMemo(
    () => exploreService.resolveSelection(
      trips,
      contextTripId,
      countries,
      options.preferredTripId ? { country: null, city: null } : chosen,
      device,
    ),
    [trips, contextTripId, countries, chosen, device, options.preferredTripId],
  );

  /**
   * Where the active trip would send the explorer, resolved as if nothing else
   * had a view. The whole selection rather than just the city, because
   * `followTrip` has to be able to store it.
   */
  const fromTrip = useMemo(() => {
    const resolved = exploreService.resolveSelection(trips, contextTripId, countries, {
      country: null,
      city: null,
    });
    return resolved.source === 'trip' ? resolved : null;
  }, [trips, contextTripId, countries]);

  const tripCity = fromTrip?.city ?? null;

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
      // Recorded here rather than at the one call site that used to care, so
      // that *every* route to a search — typed, pressed, or automatic —
      // inoculates the effect below against running the same one again.
      autoExploredRef.current = `${countryCode ?? ''}|${city}`;

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
   * A settled destination explores itself.
   *
   * *Settled* is the whole test, and it is why this asks for a city rather
   * than for a particular source. A country with no city is half a
   * destination — searching it would spend a request on somewhere the reader
   * has not finished naming — but a country *and* a city is an answer, however
   * it was arrived at: a trip they made, the city they are standing in, or a
   * place they explored on their last visit. Only the draft in the city box is
   * excluded, because a draft is somebody still typing.
   *
   * Held until the device has answered: a trip's city would otherwise be
   * searched, drawn, and then replaced by the reader's own a moment later.
   */
  useEffect(() => {
    if (!isLocationSettled || !selection.city) return;

    const key = `${selection.countryCode ?? ''}|${selection.city}`;
    if (autoExploredRef.current === key) return;

    void runSearch(selection.city, selection.countryCode);
  }, [isLocationSettled, runSearch, selection.city, selection.countryCode]);

  /* -------------------------------------------------------------- location */

  useEffect(() => {
    let active = true;

    exploreService.getLocationPermission().then((state) => {
      if (active) setLocationPermission(state);
    });

    return () => {
      active = false;
    };
  }, []);

  /**
   * The one automatic fix.
   *
   * Runs even when a trip is offering a destination, because the device
   * outranks it — see `explore.service`. It stands down only for a choice the
   * reader made themselves, which there is nothing to improve on.
   *
   * Held back until the country list has arrived, which is not about the list:
   * it is what turns the fix's ISO code into a country name the city lookup
   * accepts, and waiting one request for it is cheaper than seating the reader
   * in a country whose cities then fail to load.
   *
   * `locateDevice` decides for itself whether a permission prompt is raised at
   * all — see `location.service`. From here it is one call that either fills
   * the selectors in or does not, and a null is not worth reporting: nobody
   * asked.
   */
  const locatedRef = useRef(false);

  useEffect(() => {
    if (locatedRef.current || isLoadingCountries) return;

    locatedRef.current = true;

    if (chosen.country) {
      // Nothing to ask about, but the barrier above still has to lift.
      setIsLocationSettled(true);
      return;
    }

    let active = true;
    setIsLocating(true);

    exploreService
      .locateDevice()
      .then((place) => {
        if (active && place) setDevice(place);
      })
      .catch(() => {
        // The silent path answers null rather than throwing; a rejection here
        // would be a bug in that promise, not something to put on the screen.
      })
      .finally(() => {
        if (!active) return;

        setIsLocating(false);
        setIsLocationSettled(true);
        void exploreService.getLocationPermission().then(setLocationPermission);
      });

    return () => {
      active = false;
    };
  }, [isLoadingCountries, chosen.country]);

  /**
   * The button.
   *
   * Unlike the automatic path this commits — `adoptDeviceLocation` writes the
   * country and city as the reader's own choice, so it outranks an active trip
   * and survives a reload. Somebody who pressed "use my location" has said
   * where they want to be as plainly as if they had picked it from the list.
   */
  const useMyLocation = useCallback(() => {
    setIsLocating(true);
    setLocationError(null);

    void exploreService
      .locateDevice({ prompt: true })
      .then((place) => {
        if (!place) {
          setLocationError('We could not work out where you are. Try again in a moment.');
          return;
        }

        setDevice(place);
        exploreService.adoptPlace(place, countries);

        if (place.city) void runSearch(place.city, place.countryCode);
      })
      .catch((error: unknown) => {
        setLocationError(
          error instanceof LocationError
            ? error.message
            : 'We could not work out where you are. Try again in a moment.',
        );
      })
      .finally(() => {
        setIsLocating(false);
        void exploreService.getLocationPermission().then(setLocationPermission);
      });
  }, [countries, runSearch]);

  /* -------------------------------------------------------------- actions */

  const selectCountry = useCallback((country: Country) => {
    exploreService.setCountry(country);
  }, []);

  const selectCity = useCallback((city: string) => {
    exploreService.setCity(city);
  }, []);

  /**
   * Takes the trip up on its offer.
   *
   * Stored as a choice rather than simply un-choosing, because the device now
   * outranks the trip: clearing would hand the screen straight back to the
   * city the reader just pressed *away* from. `adoptPlace` does nothing when
   * the trip names a country the list has never heard of — dropping the device
   * is what carries that case, at the cost of surviving a reload.
   */
  const followTrip = useCallback(() => {
    if (!fromTrip) return;

    exploreService.clearSelection();
    exploreService.adoptPlace(fromTrip, countries);

    setDevice(null);
    setLocationError(null);

    if (fromTrip.city) void runSearch(fromTrip.city, fromTrip.countryCode);
  }, [countries, fromTrip, runSearch]);

  const filterCities = useCallback(
    (query: string, limit?: number) => exploreService.filterCities(cities, query, limit),
    [cities],
  );

  return {
    countries,
    cities,
    selection,
    selectionSource: selection.source,
    // A difference, not a source: the offer is only worth making while the
    // trip names somewhere other than what is on screen.
    canFollowTrip: tripCity !== null && tripCity !== selection.city,
    tripCity,

    canUseLocation: locationPermission !== 'unsupported',
    locationPermission,
    isLocating,
    locationError,

    activities,
    exploredCity,
    exploredCountryCode,

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
    useMyLocation,
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
