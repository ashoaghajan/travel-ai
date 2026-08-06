import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/common/Button';
import { Card } from '../../../components/common/Card';
import { SparklesIcon } from '../../../components/common/icons';
import { COVER_IMAGES } from '../../../assets/cover-images';
import { formatDayCount } from '../../../utils/trip';
import { formatWeekdayDate } from '../../../utils/date';
import { flagOf } from '../../../utils/flag';
import { hasErrors } from '../editTrip';
import { MAX_TRIP_DAYS, todayIso } from '../createTrip';
import { useCreateTrip } from '../useCreateTrip';
import { useDestinationOptions } from '../useDestinationOptions';
import { BackLink } from '../components/BackLink';
import { CityField } from '../components/CityField';
import styles from './CreateTripPage.module.css';

/**
 * Make a trip by hand — the planner is the other door into the same place.
 *
 * Scope is the basics: what it is called, where, when, how many. The days are
 * scaffolded empty from the date range and shown here read-only; activities go
 * in on the trip page, where the timeline, the photographs and the map are.
 */
export function CreateTripPage() {
  const navigate = useNavigate();
  const {
    draft,
    errors,
    days,
    requestedDays,
    isSaving,
    saveError,
    hasAttemptedSave,
    setField,
    create,
  } = useCreateTrip();

  const fieldId = useId();
  const showErrors = hasAttemptedSave && hasErrors(errors);
  const isTooLong = requestedDays > MAX_TRIP_DAYS;

  // Stable for the life of the form — the picker's floor must not shift under
  // the reader mid-edit.
  const [today] = useState(() => todayIso());

  const { countries, isLoadingCountries, cityCount, isLoadingCities, suggestCities } =
    useDestinationOptions(draft.destinationCountry);

  function selectCountry(name: string) {
    setField('destinationCountry', name);
    // A city belongs to the country it was chosen from; keeping it would leave
    // the trip claiming Paris, Armenia.
    if (draft.destinationCity) setField('destinationCity', '');
  }

  function cityPlaceholderFor(): string {
    if (!draft.destinationCountry) return 'Choose a country first';
    if (isLoadingCities) return 'Loading cities…';
    if (cityCount === 0) return 'Type a city name';
    return `Search ${cityCount.toLocaleString()} cities`;
  }

  const cityPlaceholder = cityPlaceholderFor();

  async function submit(event: FormEvent) {
    event.preventDefault();

    const trip = await create();
    // `replace` so Back returns to the trips list rather than to a form whose
    // trip has already been created.
    if (trip) navigate(`/trips/${trip.id}`, { replace: true });
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="New trip"
        subtitle="Set the basics — activities come next, on the trip itself."
        leading={<BackLink to={ROUTES.trips} label="Back to your trips" />}
        actions={
          <Button
            to={ROUTES.planner}
            variant="secondary"
            size="md"
            leadingIcon={<SparklesIcon size={18} />}
          >
            Plan with AI
          </Button>
        }
      />

      <form className={styles.content} onSubmit={submit} noValidate>
        <Card padding="lg" elevation="soft" className={styles.section}>
          <h2 className={styles.sectionTitle}>Trip details</h2>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fieldId}-title`}>
              Trip title
            </label>
            <input
              id={`${fieldId}-title`}
              className={styles.control}
              value={draft.title}
              onChange={(event) => setField('title', event.target.value)}
              disabled={isSaving}
              placeholder="Two weeks in Portugal"
              aria-invalid={showErrors && Boolean(errors.title)}
              aria-describedby={
                showErrors && errors.title ? `${fieldId}-title-error` : undefined
              }
            />
            {showErrors && errors.title ? (
              <p id={`${fieldId}-title-error`} className={styles.fieldError}>
                {errors.title}
              </p>
            ) : null}
          </div>

          {/* Country is a real dropdown — a closed list of about 200. City
              cannot be: France alone returns close to 16,000, so it is a
              combobox over a capped set of matches. See `CityField`. */}
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${fieldId}-country`}>
                Country
              </label>
              <select
                id={`${fieldId}-country`}
                className={styles.control}
                value={draft.destinationCountry}
                onChange={(event) => selectCountry(event.target.value)}
                disabled={isSaving || isLoadingCountries}
                aria-invalid={showErrors && Boolean(errors.destination)}
              >
                <option value="">
                  {isLoadingCountries ? 'Loading countries…' : 'Choose a country'}
                </option>
                {countries.map((country) => (
                  <option key={country.code} value={country.name}>
                    {flagOf(country.code)} {country.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${fieldId}-city`}>
                City
              </label>
              <CityField
                id={`${fieldId}-city`}
                className={styles.control}
                value={draft.destinationCity}
                onChange={(city) => setField('destinationCity', city)}
                suggest={suggestCities}
                disabled={isSaving}
                placeholder={cityPlaceholder}
                invalid={showErrors && Boolean(errors.destination)}
                describedBy={
                  showErrors && errors.destination ? `${fieldId}-destination-error` : undefined
                }
              />
            </div>
          </div>
          {showErrors && errors.destination ? (
            <p id={`${fieldId}-destination-error`} className={styles.fieldError}>
              {errors.destination}
            </p>
          ) : null}

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${fieldId}-start`}>
                Start date
              </label>
              <input
                id={`${fieldId}-start`}
                type="date"
                className={styles.control}
                // Past dates are greyed out in the picker; `validateCreate`
                // enforces it for anything typed straight in.
                min={today}
                value={draft.startDate}
                onChange={(event) => setField('startDate', event.target.value)}
                disabled={isSaving}
                aria-invalid={showErrors && Boolean(errors.startDate)}
                aria-describedby={
                  showErrors && errors.startDate ? `${fieldId}-start-error` : undefined
                }
              />
              {showErrors && errors.startDate ? (
                <p id={`${fieldId}-start-error`} className={styles.fieldError}>
                  {errors.startDate}
                </p>
              ) : null}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${fieldId}-end`}>
                End date
              </label>
              <input
                id={`${fieldId}-end`}
                type="date"
                className={styles.control}
                value={draft.endDate}
                // Falls back to today, so the end date cannot be dragged into
                // the past before a start date has been chosen.
                min={draft.startDate || today}
                onChange={(event) => setField('endDate', event.target.value)}
                disabled={isSaving}
                aria-invalid={showErrors && Boolean(errors.endDate)}
                aria-describedby={
                  showErrors && errors.endDate ? `${fieldId}-end-error` : undefined
                }
              />
              {showErrors && errors.endDate ? (
                <p id={`${fieldId}-end-error`} className={styles.fieldError}>
                  {errors.endDate}
                </p>
              ) : null}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${fieldId}-travellers`}>
                Travellers
              </label>
              <input
                id={`${fieldId}-travellers`}
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                className={styles.control}
                value={draft.travellers}
                onChange={(event) => setField('travellers', Number(event.target.value))}
                disabled={isSaving}
                aria-invalid={showErrors && Boolean(errors.travellers)}
                aria-describedby={
                  showErrors && errors.travellers ? `${fieldId}-travellers-error` : undefined
                }
              />
              {showErrors && errors.travellers ? (
                <p id={`${fieldId}-travellers-error`} className={styles.fieldError}>
                  {errors.travellers}
                </p>
              ) : null}
            </div>
          </div>
        </Card>

        <Card padding="lg" elevation="soft" className={styles.section}>
          <fieldset className={styles.covers}>
            <legend className={styles.sectionTitle}>Cover image</legend>

            <div className={styles.coverGrid}>
              {COVER_IMAGES.map((cover) => (
                <div key={cover.id} className={styles.coverOption}>
                  {/* A real radio: arrow-key navigation and the roving tab stop
                      come from the browser, and the selected state lives in one
                      place rather than in a class as well. */}
                  <input
                    type="radio"
                    id={`${fieldId}-cover-${cover.id}`}
                    name={`${fieldId}-cover`}
                    className="visually-hidden"
                    value={cover.src}
                    checked={draft.coverImage === cover.src}
                    onChange={() => setField('coverImage', cover.src)}
                    disabled={isSaving}
                  />
                  <label className={styles.coverTile} htmlFor={`${fieldId}-cover-${cover.id}`}>
                    <img
                      className={styles.coverImage}
                      src={cover.src}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                    <span className={styles.coverLabel}>{cover.label}</span>
                  </label>
                </div>
              ))}
            </div>
          </fieldset>
        </Card>

        <Card padding="lg" elevation="soft" className={styles.section}>
          <div className={styles.previewHeader}>
            <h2 className={styles.sectionTitle}>Schedule</h2>
            {days.length > 0 ? (
              <p className={styles.previewCount}>{formatDayCount(days.length)}</p>
            ) : null}
          </div>

          <p className={styles.previewNote}>
            One empty day per date. Add activities from the trip page once it is saved.
          </p>

          {/* Ungated by `hasAttemptedSave`: the day list silently clamps, so
              without this the preview would look correct until submit. */}
          {isTooLong ? (
            <p className={styles.fieldError}>
              These dates cover {requestedDays} days. A trip can cover at most {MAX_TRIP_DAYS} —
              shorten the range.
            </p>
          ) : null}

          {days.length === 0 ? (
            <p className={styles.empty}>Pick your dates to see the days.</p>
          ) : (
            <ol className={styles.days}>
              {days.map((day) => (
                <li key={day.id} className={styles.day}>
                  <span className={styles.dayNumber}>Day {day.dayNumber}</span>
                  <span className={styles.dayDate}>{formatWeekdayDate(day.date)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <footer className={styles.footer}>
          {saveError ? (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          ) : null}
          {showErrors && !saveError ? (
            <p className={styles.error} role="alert">
              Fix the highlighted fields before creating this trip.
            </p>
          ) : null}

          <div className={styles.actions}>
            <Button to={ROUTES.trips} variant="secondary" size="md">
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={isSaving}>
              {isSaving ? 'Creating…' : 'Create trip'}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}
