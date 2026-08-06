import { useId, useMemo } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../../../components/common/Button';
import type { Country } from '../../../services/country.service';
import { flagOf } from '../../../utils/flag';
import styles from './DestinationSelector.module.css';

/** How many cities the type-ahead offers at once. */
const CITY_SUGGESTIONS = 50;

export type DestinationSelectorProps = {
  countries: Country[];
  /** ISO 3166-1 alpha-2 of the selected country, or null. */
  countryCode: string | null;
  /** Falls back to the raw name when the country list has not matched it. */
  countryName: string | null;
  /** What is in the city box — a draft the page owns, not a settled choice. */
  city: string;
  onSelectCountry: (country: Country) => void;
  onCityChange: (city: string) => void;
  /** Called with the trimmed city, which may not have been committed yet. */
  onExplore: (city: string) => void;
  /** Type-ahead over the loaded city list, kept out of the DOM until typed. */
  filterCities: (query: string, limit?: number) => string[];
  cityCount: number;
  isLoadingCountries?: boolean;
  isLoadingCities?: boolean;
  isLoadingActivities?: boolean;
  /** Offered when a trip suggests somewhere other than the current choice. */
  tripCity?: string | null;
  onFollowTrip?: () => void;
};

/**
 * Country then city.
 *
 * The country is a real `<select>` — a closed list of about 200, which is what
 * a dropdown is for. The city cannot be: France alone returns close to 16,000,
 * and putting that many `<option>` nodes in the document is slow to build and
 * miserable to scroll. It is a combobox instead, backed by a `<datalist>` that
 * only ever holds the current type-ahead matches, so the DOM stays small
 * whatever the country.
 */
export function DestinationSelector({
  countries,
  countryCode,
  countryName,
  city,
  onSelectCountry,
  onCityChange,
  onExplore,
  filterCities,
  cityCount,
  isLoadingCountries = false,
  isLoadingCities = false,
  isLoadingActivities = false,
  tripCity,
  onFollowTrip,
}: DestinationSelectorProps) {
  const countryId = useId();
  const cityId = useId();
  const cityListId = useId();

  const suggestions = useMemo(
    () => (cityCount > 0 ? filterCities(city, CITY_SUGGESTIONS) : []),
    [filterCities, city, cityCount],
  );

  function chooseCountry(code: string) {
    const country = countries.find((candidate) => candidate.code === code);
    if (country) onSelectCountry(country);
  }

  function submit(event: FormEvent) {
    event.preventDefault();

    const next = city.trim();
    if (!next) return;

    onExplore(next);
  }

  const canExplore = city.trim().length > 0 && !isLoadingActivities;

  return (
    <form className={styles.selector} onSubmit={submit}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={countryId}>
            Country
          </label>
          <select
            id={countryId}
            className={styles.control}
            value={countryCode ?? ''}
            onChange={(event) => chooseCountry(event.target.value)}
            disabled={isLoadingCountries || countries.length === 0}
          >
            <option value="" disabled>
              {isLoadingCountries ? 'Loading countries…' : (countryName ?? 'Choose a country')}
            </option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {flagOf(country.code)} {country.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={cityId}>
            City
          </label>
          <input
            id={cityId}
            className={styles.control}
            list={cityListId}
            value={city}
            onChange={(event) => onCityChange(event.target.value)}
            placeholder={cityPlaceholder(countryName, cityCount, isLoadingCities)}
            autoComplete="off"
            enterKeyHint="search"
            disabled={!countryName || isLoadingCities}
          />
          <datalist id={cityListId}>
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </div>

        <Button type="submit" variant="primary" disabled={!canExplore}>
          {isLoadingActivities ? 'Exploring…' : 'Explore'}
        </Button>
      </div>

      {tripCity && onFollowTrip ? (
        <p className={styles.revert}>
          Your trip goes to {tripCity}.{' '}
          <button type="button" className={styles.revertButton} onClick={onFollowTrip}>
            Explore {tripCity} instead
          </button>
        </p>
      ) : null}
    </form>
  );
}

function cityPlaceholder(
  countryName: string | null,
  cityCount: number,
  isLoadingCities: boolean,
): string {
  if (!countryName) return 'Choose a country first';
  if (isLoadingCities) return 'Loading cities…';
  if (cityCount === 0) return 'No cities listed — type one';

  return `Search ${cityCount.toLocaleString()} cities`;
}
