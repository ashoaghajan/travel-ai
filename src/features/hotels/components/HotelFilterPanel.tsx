import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { EMPTY_HOTEL_FILTERS, countActiveFilters, priceHandle } from '@ai-travel/shared';
import type { HotelFilters, PriceBounds } from '@ai-travel/shared';
import { PriceRangeSlider } from './PriceRangeSlider';
import styles from './HotelFilterPanel.module.css';

export type HotelFilterPanelProps = {
  id: string;
  filters: HotelFilters;
  onChange: (filters: HotelFilters) => void;
  /** The span the results cover, or null when they cannot be ranged over. */
  priceBounds: PriceBounds | null;
  /** Floors the results can actually meet — see `ratingFilterOptions`. */
  ratingOptions: number[];
};

/**
 * Price and rating filters revealed by the toolbar's Filter button.
 *
 * A control with nothing to work on is omitted rather than shown inert, which
 * is what happens on an unpriced or unrated result: a price slider whose two
 * ends are the same figure, or a rating select offering nothing but "Any
 * rating", invites a reader to use a control that was never going to do
 * anything.
 */
export function HotelFilterPanel({
  id,
  filters,
  onChange,
  priceBounds,
  ratingOptions,
}: HotelFilterPanelProps) {
  const hasFilters = countActiveFilters(filters) > 0;
  // An unpriced, unrated list — every `listing` result. The name box still
  // works there, so the panel is no longer empty and no longer returns early.
  const hasRanges = Boolean(priceBounds) || ratingOptions.length > 0;

  return (
    <Card id={id} padding="lg" elevation="soft" className={styles.panel}>
      {/*
        First, because it is the one control that always has something to work
        on: a stay has a name whether or not anybody has priced or rated it.

        `type="search"` for the clear affordance the platform draws itself.
        Narrowing what is already on screen rather than asking the provider
        again — the catalogue is searched by city and dates and cannot be asked
        for a property by name — which is what the hint under it has to say, or
        an empty result reads as "this hotel does not exist".
      */}
      <label className={styles.field}>
        <span className={styles.label}>Hotel name</span>
        <input
          type="search"
          className={styles.control}
          placeholder="Search these results"
          value={filters.name ?? ''}
          onChange={(event) =>
            onChange({ ...filters, name: event.target.value === '' ? null : event.target.value })
          }
        />
      </label>

      {priceBounds ? (
        <PriceRangeSlider
          bounds={priceBounds}
          // A handle that has never been moved rests on the end of the range,
          // which is where "no filter" is drawn.
          min={filters.minPrice ?? priceBounds.min}
          max={filters.maxPrice ?? priceBounds.max}
          onChange={(next) =>
            onChange({
              ...filters,
              minPrice: priceHandle(next.min, priceBounds.min),
              maxPrice: priceHandle(next.max, priceBounds.max),
            })
          }
        />
      ) : null}

      {ratingOptions.length > 0 ? (
        <label className={styles.field}>
          <span className={styles.label}>Minimum rating</span>
          <select
            className={styles.control}
            value={filters.minRating ?? ''}
            onChange={(event) =>
              onChange({
                ...filters,
                minRating: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          >
            <option value="">Any rating</option>
            {ratingOptions.map((rating) => (
              <option key={rating} value={rating}>
                {rating.toFixed(1)}+
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {hasRanges ? null : (
        <p className={styles.note}>
          These listings carry no prices or ratings of their own, so the name is all there is to
          filter on.
        </p>
      )}

      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="md"
          disabled={!hasFilters}
          onClick={() => onChange(EMPTY_HOTEL_FILTERS)}
        >
          Clear
        </Button>
      </div>
    </Card>
  );
}
