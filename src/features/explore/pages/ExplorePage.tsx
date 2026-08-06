import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/common/Button';
import { Card } from '../../../components/common/Card';
import { CategoryChips } from '../../../components/common/CategoryChips';
import { EmptyState } from '../../../components/common/EmptyState';
import { Skeleton } from '../../../components/common/Skeleton';
import { ActivityCard } from '../../../components/cards/ActivityCard';
import { CompassIcon } from '../../../components/common/icons';
import { DestinationSelector } from '../components/DestinationSelector';
import {
  ACTIVITY_CHIPS,
  ALL_ACTIVITIES,
  categoryLabel,
  filterActivitiesByCategory,
  isActivityFilter,
} from '../activity.filters';
import type { ActivityFilterId } from '../activity.filters';
import { ROUTES } from '../../../app/routes';
import { useExplore } from '../useExplore';
import { useInfiniteScroll } from '../useInfiniteScroll';
import styles from './ExplorePage.module.css';

const SKELETON_COUNT = 3;

/** `/activities/:activityId` for one attraction. */
function activityPath(activityId: string): string {
  return ROUTES.activityDetails.replace(':activityId', encodeURIComponent(activityId));
}

/** Screen 6 — Activities explorer (DESIGN_SPEC §8), driven by country and city. */
export function ExplorePage() {
  const {
    countries,
    cities,
    selection,
    selectionSource,
    tripCity,
    canFollowTrip,
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
  } = useExplore();

  // The city box is a draft until Explore is pressed, and the prompt below has
  // to read it too — otherwise it goes on asking for a city that is already
  // typed.
  //
  // The committed destination seeds the draft and reclaims it whenever it
  // changes underneath — a trip opened in another tab, or the country being
  // swapped, which invalidates a typed city as surely as a new one does. It is
  // adjusted during render rather than in an effect so the box never paints a
  // frame holding a city from the country before.
  const destination = `${selection.countryCode ?? ''}|${selection.city ?? ''}`;
  const [cityDraft, setCityDraft] = useState(selection.city ?? '');
  const [lastDestination, setLastDestination] = useState(destination);

  if (destination !== lastDestination) {
    setLastDestination(destination);
    setCityDraft(selection.city ?? '');
  }

  function exploreCity(city: string) {
    selectCity(city);
    explore(city);
  }

  // The chip lives in the URL so a filtered view can be linked and survives reload.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('category');
  const activeCategory: ActivityFilterId = isActivityFilter(requested)
    ? requested
    : ALL_ACTIVITIES;

  function selectCategory(next: ActivityFilterId) {
    const params = new URLSearchParams(searchParams);
    if (next === ALL_ACTIVITIES) {
      params.delete('category');
    } else {
      params.set('category', next);
    }
    setSearchParams(params, { replace: true });
  }

  const visible = useMemo(
    () => filterActivitiesByCategory(activities, activeCategory),
    [activities, activeCategory],
  );

  // The sentinel sits below the grid, so a filtered view that has matched
  // nothing yet keeps pulling pages until it finds some or the list runs out.
  const sentinelRef = useInfiniteScroll(
    loadMore,
    hasMore && !isLoadingActivities && !isLoadingMore,
  );

  const hasExplored = exploredCity !== null;
  const typedCity = cityDraft.trim() || null;

  return (
    <div className={styles.page}>
      <PageHeader
        title={exploredCity ? `Top Activities in ${exploredCity}` : 'Explore Activities'}
        subtitle={
          selectionSource === 'trip' && exploredCity
            ? `Following your trip to ${exploredCity}`
            : undefined
        }
      />

      <div className={styles.content}>
        <DestinationSelector
          countries={countries}
          countryCode={selection.countryCode}
          countryName={selection.countryName}
          city={cityDraft}
          onSelectCountry={selectCountry}
          onCityChange={setCityDraft}
          onExplore={exploreCity}
          filterCities={filterCities}
          cityCount={cities.length}
          isLoadingCountries={isLoadingCountries}
          isLoadingCities={isLoadingCities}
          isLoadingActivities={isLoadingActivities}
          tripCity={canFollowTrip ? tripCity : null}
          onFollowTrip={followTrip}
        />

        {countriesError ? (
          <p className={styles.error} role="alert">
            {countriesError}
          </p>
        ) : null}

        {citiesError ? (
          <p className={styles.error} role="alert">
            {citiesError}
          </p>
        ) : null}

        {hasExplored ? (
          <CategoryChips
            items={ACTIVITY_CHIPS}
            activeId={activeCategory}
            onChange={selectCategory}
            label="Filter activities by category"
          />
        ) : null}

        {activitiesError ? (
          <p className={styles.error} role="alert">
            {activitiesError}
          </p>
        ) : null}

        {isLoadingActivities ? (
          <div className={styles.grid} aria-busy="true">
            <span className="visually-hidden">
              Loading activities in {exploredCity ?? typedCity}…
            </span>
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <Card key={index} padding="none" elevation="soft" className={styles.skeletonCard}>
                <Skeleton height="170px" radius="sm" className={styles.skeletonMedia} />
                <div className={styles.skeletonBody}>
                  <Skeleton width="70%" height="18px" />
                  <Skeleton width="45%" height="12px" />
                  <Skeleton width="30%" height="20px" />
                </div>
              </Card>
            ))}
          </div>
        ) : !hasExplored ? (
          <EmptyState
            icon={<CompassIcon size={26} />}
            title={emptyTitle(selection.countryName, typedCity)}
            description={emptyDescription(
              selection.countryName,
              typedCity,
              cities.length,
              isLoadingCities,
            )}
          />
        ) : (
          <>
            {visible.length === 0 ? (
              <EmptyState
                icon={<CompassIcon size={26} />}
                title={
                  activities.length === 0
                    ? `We found nothing to do in ${exploredCity}`
                    : 'Nothing in this category yet'
                }
                description={
                  activities.length === 0
                    ? 'Try a larger city nearby, or a different one in this country.'
                    : 'Pick another category to see what else is on offer here.'
                }
              />
            ) : (
              <>
                <p className={styles.count} role="status">
                  {visible.length} {visible.length === 1 ? 'activity' : 'activities'}
                </p>

                <ul className={styles.grid}>
                  {visible.map((activity) => (
                    <ActivityCard
                      key={activity.id}
                      as="li"
                      activity={activity}
                      categoryLabel={categoryLabel(activity.category)}
                      to={activityPath(activity.id)}
                    />
                  ))}
                </ul>
              </>
            )}

            {/* Doubles as the scroll trigger and a keyboard-reachable control. */}
            <div className={styles.more} ref={sentinelRef}>
              {hasMore ? (
                <Button variant="secondary" onClick={loadMore} disabled={isLoadingMore}>
                  {isLoadingMore ? 'Loading more…' : 'Load more activities'}
                </Button>
              ) : activities.length > 0 ? (
                <p className={styles.endOfList}>That is everything we found here.</p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The prompt walks the reader through whichever step they have not done. */
function emptyTitle(countryName: string | null, city: string | null): string {
  if (!countryName) return 'Choose a destination to explore activities';
  if (!city) return `Choose a city in ${countryName}`;

  return `Ready to explore ${city}`;
}

function emptyDescription(
  countryName: string | null,
  city: string | null,
  cityCount: number,
  isLoadingCities: boolean,
): string {
  if (!countryName) return 'Pick a country above, then a city in it.';
  if (isLoadingCities) return `Loading the cities of ${countryName}…`;
  if (cityCount === 0) {
    return `We have no city list for ${countryName}. Type a city name and we will still look it up.`;
  }
  if (!city) return `Search ${cityCount.toLocaleString()} cities, then press Explore.`;

  return 'Press Explore to see what is there.';
}
