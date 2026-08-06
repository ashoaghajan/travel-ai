import { FilterIcon, MapIcon, SortIcon } from '../../../components/common/icons';
import { cx } from '../../../utils/cx';
import { HOTEL_SORTS } from '../hotel.filters';
import type { HotelSortId } from '../hotel.filters';
import styles from './HotelToolbar.module.css';

export type HotelToolbarProps = {
  sort: HotelSortId;
  onSortChange: (sort: HotelSortId) => void;
  isFilterOpen: boolean;
  onToggleFilter: () => void;
  isMapOpen: boolean;
  onToggleMap: () => void;
  activeFilterCount: number;
  /** Id of the panel the filter button controls. */
  filterPanelId: string;
};

/**
 * Filter · Sort · Map action row (DESIGN_SPEC Screen 5).
 *
 * Filter and Map are toggles that own no state of their own; Sort is a native
 * select styled as a pill so it stays usable on touch.
 */
export function HotelToolbar({
  sort,
  onSortChange,
  isFilterOpen,
  onToggleFilter,
  isMapOpen,
  onToggleMap,
  activeFilterCount,
  filterPanelId,
}: HotelToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <button
        type="button"
        className={cx(styles.pill, isFilterOpen && styles.active)}
        aria-expanded={isFilterOpen}
        aria-controls={filterPanelId}
        onClick={onToggleFilter}
      >
        <FilterIcon size={18} />
        Filter
        {activeFilterCount > 0 ? <span className={styles.badge}>{activeFilterCount}</span> : null}
      </button>

      <label className={styles.pill}>
        <SortIcon size={18} />
        <span className="visually-hidden">Sort stays</span>
        <select
          className={styles.select}
          value={sort}
          onChange={(event) => onSortChange(event.target.value as HotelSortId)}
        >
          {HOTEL_SORTS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={cx(styles.pill, isMapOpen && styles.active)}
        aria-pressed={isMapOpen}
        onClick={onToggleMap}
      >
        <MapIcon size={18} />
        Map
      </button>
    </div>
  );
}
