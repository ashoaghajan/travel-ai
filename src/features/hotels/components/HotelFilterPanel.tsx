import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { formatCurrency } from '../../../utils/currency';
import {
  EMPTY_HOTEL_FILTERS,
  MAX_PRICE_OPTIONS,
  MIN_RATING_OPTIONS,
  countActiveFilters,
} from '../hotel.filters';
import type { HotelFilters } from '../hotel.filters';
import styles from './HotelFilterPanel.module.css';

export type HotelFilterPanelProps = {
  id: string;
  filters: HotelFilters;
  onChange: (filters: HotelFilters) => void;
};

/** Price and rating filters revealed by the toolbar's Filter button. */
export function HotelFilterPanel({ id, filters, onChange }: HotelFilterPanelProps) {
  const hasFilters = countActiveFilters(filters) > 0;

  return (
    <Card id={id} padding="lg" elevation="soft" className={styles.panel}>
      <label className={styles.field}>
        <span className={styles.label}>Max price per night</span>
        <select
          className={styles.control}
          value={filters.maxPrice ?? ''}
          onChange={(event) =>
            onChange({
              ...filters,
              maxPrice: event.target.value === '' ? null : Number(event.target.value),
            })
          }
        >
          <option value="">Any price</option>
          {MAX_PRICE_OPTIONS.map((price) => (
            <option key={price} value={price}>
              Up to {formatCurrency(price)}
            </option>
          ))}
        </select>
      </label>

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
          {MIN_RATING_OPTIONS.map((rating) => (
            <option key={rating} value={rating}>
              {rating.toFixed(1)}+
            </option>
          ))}
        </select>
      </label>

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
