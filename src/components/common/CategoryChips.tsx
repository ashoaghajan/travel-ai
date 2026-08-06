import { cx } from '../../utils/cx';
import styles from './CategoryChips.module.css';

export type CategoryChip<Id extends string = string> = {
  id: Id;
  label: string;
};

export type CategoryChipsProps<Id extends string = string> = {
  items: readonly CategoryChip<Id>[];
  activeId: Id;
  onChange: (id: Id) => void;
  /** Accessible name for the chip group. */
  label: string;
  className?: string;
};

/**
 * Single-select filter chips (DESIGN_SPEC component inventory). Controlled —
 * the caller owns which chip is active.
 *
 * Rendered as a group of toggle buttons rather than tabs: these filter a list
 * in place, they do not switch between panels.
 */
export function CategoryChips<Id extends string = string>({
  items,
  activeId,
  onChange,
  label,
  className,
}: CategoryChipsProps<Id>) {
  return (
    <div className={cx(styles.chips, className)} role="group" aria-label={label}>
      {items.map((item) => {
        const isActive = item.id === activeId;

        return (
          <button
            key={item.id}
            type="button"
            className={cx(styles.chip, isActive && styles.active)}
            aria-pressed={isActive}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
