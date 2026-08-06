import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../../../components/common/Button';
import { CategoryChips } from '../../../components/common/CategoryChips';
import { EmptyState } from '../../../components/common/EmptyState';
import { Skeleton } from '../../../components/common/Skeleton';
import { CompassIcon } from '../../../components/common/icons';
import { CATEGORY_IMAGES } from '../../../assets/category-images';
import type { Activity } from '../../../types/travel.types';
import type { ItineraryDay } from '../../../types/trip.types';
import { cx } from '../../../utils/cx';
import { formatShortDate } from '../../../utils/date';
import {
  ACTIVITY_CHIPS,
  ALL_ACTIVITIES,
  categoryLabel,
  filterActivitiesByCategory,
  filterActivitiesByText,
} from '../../explore/activity.filters';
import type { ActivityFilterId } from '../../explore/activity.filters';
import { DEFAULT_ACTIVITY_TIME } from '../editTrip';
import { useAttractionSearch } from '../useAttractionSearch';
import styles from './AttractionPickerDialog.module.css';

/** Rows drawn at once. The pool is bigger; the filter is how you reach the rest. */
const MAX_VISIBLE = 40;
const SKELETON_COUNT = 4;

export type AttractionPickerDialogProps = {
  /**
   * The day the pick lands on — read from the *draft*, not the saved trip, so
   * an attraction added a moment ago already reads as "already on this day".
   */
  day: ItineraryDay;
  /** The trip's country, matched to an ISO code so the city resolves correctly. */
  countryName: string | null;
  /** Used when the day names no destination of its own. */
  fallbackDestination: string;
  onPick: (activity: Activity, time: string) => void;
  /** The blank-row path — the same append the timeline used to do directly. */
  onAddBlank: () => void;
  onClose: () => void;
};

/**
 * Pick a real attraction for one day.
 *
 * Two kinds of "search" live here, and are kept visibly apart: the destination
 * field runs a network search for a city's pool, while the chips and the filter
 * box narrow that pool locally. There is no keyword endpoint to ask — see
 * `filterActivitiesByText`.
 *
 * The layout is three regions: a fixed head, one scrolling list, and a footer
 * pinned to the bottom. Only the list scrolls, so the actions are reachable at
 * any window height without hunting for them.
 */
export function AttractionPickerDialog({
  day,
  countryName,
  fallbackDestination,
  onPick,
  onAddBlank,
  onClose,
}: AttractionPickerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const destinationId = useId();
  const countryId = useId();
  const filterFieldId = useId();
  const timeId = useId();
  const groupName = useId();
  const pickerFormId = useId();

  const home = day.destination.trim() || fallbackDestination;

  const {
    countries,
    isLoadingCountries,
    tripCountryCode,
    searchedDestination,
    activities,
    isLoading,
    error,
    warning,
    search,
  } = useAttractionSearch({ destination: home, countryName });

  const [destinationDraft, setDestinationDraft] = useState(home);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [category, setCategory] = useState<ActivityFilterId>(ALL_ACTIVITIES);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [time, setTime] = useState(DEFAULT_ACTIVITY_TIME);

  // `showModal` is the only way to get the backdrop and the focus trap; it
  // cannot be expressed as a prop, so it happens on mount.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected || dialog.open) return;

    dialog.showModal();
    return () => dialog.close();
  }, []);

  // The trip's country is only an ISO code once the list has resolved it.
  useEffect(() => {
    setCountryCode(tripCountryCode);
  }, [tripCountryCode]);

  const added = useMemo(
    () =>
      new Set(
        day.activities
          .map((entry) => entry.sourceActivityId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    [day.activities],
  );

  const matches = useMemo(
    () => filterActivitiesByText(filterActivitiesByCategory(activities, category), query),
    [activities, category, query],
  );
  const visible = matches.slice(0, MAX_VISIBLE);
  const selected = activities.find((candidate) => candidate.id === selectedId) ?? null;

  function runSearch(event: FormEvent) {
    event.preventDefault();
    setSelectedId(null);
    search(destinationDraft, countryCode);
  }

  function add(event: FormEvent) {
    event.preventDefault();
    if (!selected || added.has(selected.id)) return;

    onPick(selected, time || DEFAULT_ACTIVITY_TIME);
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => {
        // A click on the dialog element itself is a click on the backdrop —
        // its children stop the event reaching here.
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className={styles.body}>
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            Add an attraction
          </h2>
          <p className={styles.subtitle}>
            Day {day.dayNumber} · {formatShortDate(day.date)}
            {day.destination ? ` · ${day.destination}` : ''}
          </p>

          {/* Where to look — a network search for a city's pool. */}
          <form className={styles.destination} onSubmit={runSearch}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={destinationId}>
                Attractions near
              </label>
              <input
                id={destinationId}
                className={styles.control}
                value={destinationDraft}
                onChange={(event) => setDestinationDraft(event.target.value)}
                placeholder="A city or town"
                autoComplete="off"
                enterKeyHint="search"
                disabled={isLoading}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={countryId}>
                Country
              </label>
              <select
                id={countryId}
                className={styles.control}
                value={countryCode ?? ''}
                onChange={(event) => setCountryCode(event.target.value || null)}
                disabled={isLoadingCountries || countries.length === 0}
              >
                <option value="">{isLoadingCountries ? 'Loading countries…' : 'Anywhere'}</option>
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>
            </div>

            <Button
              type="submit"
              variant="secondary"
              disabled={isLoading || !destinationDraft.trim()}
            >
              {isLoading ? 'Searching…' : 'Search'}
            </Button>
          </form>

          {/* Narrowing the pool already in hand — not another request. */}
          <div className={styles.filters}>
            <CategoryChips
              items={ACTIVITY_CHIPS}
              activeId={category}
              onChange={setCategory}
              label="Filter attractions by category"
            />

            <div className={styles.field}>
              <label className={cx(styles.label, 'visually-hidden')} htmlFor={filterFieldId}>
                Filter these attractions
              </label>
              <input
                id={filterFieldId}
                type="search"
                className={styles.control}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter these attractions — temple, beach, museum…"
                autoComplete="off"
                disabled={isLoading || activities.length === 0}
              />
            </div>
          </div>
        </div>

        {/* The only scrolling region. */}
        <div className={styles.results}>
          {/* Stale data is still data: a warning beside the list, not instead. */}
          {warning ? (
            <p className={styles.warning} role="status">
              {warning}
            </p>
          ) : null}

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          {isLoading ? (
            <div aria-busy="true">
              <span className="visually-hidden">
                Loading attractions in {destinationDraft || home}…
              </span>
              {Array.from({ length: SKELETON_COUNT }, (_, index) => (
                <div key={index} className={styles.skeletonOption}>
                  <Skeleton width="44px" height="44px" radius="md" />
                  <div className={styles.skeletonText}>
                    <Skeleton width="60%" height="14px" />
                    <Skeleton width="40%" height="10px" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <EmptyState
              icon={<CompassIcon size={24} />}
              title="We could not load attractions"
              description="Try another city, or add your own stop instead."
            />
          ) : activities.length === 0 ? (
            <EmptyState
              icon={<CompassIcon size={24} />}
              title={`We found nothing to do in ${searchedDestination ?? home}`}
              description="Try a larger city nearby, or add your own stop instead."
            />
          ) : matches.length === 0 ? (
            <EmptyState
              icon={<CompassIcon size={24} />}
              title="Nothing matches"
              description="Clear the filter, or pick another category."
            />
          ) : (
            <>
              <p className={styles.count} role="status">
                {matches.length} {matches.length === 1 ? 'attraction' : 'attractions'}
                {matches.length > MAX_VISIBLE
                  ? ` — showing the first ${MAX_VISIBLE}. Keep typing to narrow it down.`
                  : ''}
              </p>

              {/* A real radio group: arrow keys, Space and the announcement all
                  come from the browser. */}
              <fieldset className={styles.options}>
                <legend className="visually-hidden">
                  Attractions in {searchedDestination ?? home}
                </legend>
                {visible.map((activity) => (
                  <AttractionOption
                    key={activity.id}
                    activity={activity}
                    name={groupName}
                    isSelected={activity.id === selectedId}
                    isAdded={added.has(activity.id)}
                    onSelect={setSelectedId}
                  />
                ))}
              </fieldset>
            </>
          )}
        </div>

        {/* Pinned: the way out must not depend on how tall the list is. */}
        <div className={styles.footer}>
          <div className={styles.timeField}>
            <label className={styles.label} htmlFor={timeId}>
              Time
            </label>
            <input
              id={timeId}
              type="time"
              form={pickerFormId}
              className={cx(styles.control, styles.timeControl)}
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </div>

          <div className={styles.actions}>
            {/* Outside every error branch on purpose: without an API key the
                list above never arrives, and this is the way out. */}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onAddBlank();
                onClose();
              }}
            >
              Add my own
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={pickerFormId} variant="primary" disabled={!selected}>
              Add to day
            </Button>
          </div>
        </div>

        {/* The pick's form owns no layout — its controls live in the regions
            above and below, wired to it by `form=`. Keeping it out of the flex
            column is what lets the footer stay pinned. */}
        <form id={pickerFormId} onSubmit={add} />
      </div>
    </dialog>
  );
}

/** One selectable attraction: a hidden radio, wearing the whole row as its label. */
function AttractionOption({
  activity,
  name,
  isSelected,
  isAdded,
  onSelect,
}: {
  activity: Activity;
  name: string;
  isSelected: boolean;
  isAdded: boolean;
  onSelect: (id: string) => void;
}) {
  // Wikimedia URLs rot; the category artwork keeps a broken-image icon out of
  // the list, the same way `ActivityCard` does.
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    setHasFailed(false);
  }, [activity.image]);

  return (
    <label className={cx(styles.option, isAdded && styles.optionAdded)}>
      <input
        type="radio"
        className="visually-hidden"
        name={name}
        value={activity.id}
        checked={isSelected}
        disabled={isAdded}
        onChange={() => onSelect(activity.id)}
      />
      <img
        className={styles.optionImage}
        src={hasFailed ? CATEGORY_IMAGES[activity.category] : activity.image}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setHasFailed(true)}
      />
      <span className={styles.optionBody}>
        <span className={styles.optionTitle}>{activity.title}</span>
        <span className={styles.optionDescription}>{activity.description}</span>
      </span>
      <span className={styles.optionMeta}>
        {isAdded ? 'Already on this day' : categoryLabel(activity.category)}
      </span>
    </label>
  );
}
