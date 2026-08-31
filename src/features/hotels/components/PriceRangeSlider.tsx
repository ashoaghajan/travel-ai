import { useMoney } from '../../../store/currency.store';
import type { PriceBounds } from '@ai-travel/shared';
import styles from './PriceRangeSlider.module.css';

export type PriceRangeSliderProps = {
  /** The span the results cover — see `priceBounds`. */
  bounds: PriceBounds;
  /** Where the handles are now, in the same units as the bounds. */
  min: number;
  max: number;
  onChange: (next: { min: number; max: number }) => void;
};

/**
 * A two-handle price range, the way the booking sites do it.
 *
 * Two overlapping `<input type="range">` rather than a drag library. They are
 * real sliders: arrow keys move them, Home and End jump to the ends, screen
 * readers announce them, and none of that had to be reimplemented. The inputs
 * themselves are transparent and `pointer-events: none`; only their thumbs take
 * the pointer, so the one underneath is still reachable where they overlap, and
 * the coloured track behind them is drawn by the two divs.
 *
 * The handles cannot cross. Each is clamped a step short of the other, which
 * also stops them landing on the same pixel — two thumbs stacked exactly is a
 * range a reader can see but not pull back apart.
 */
export function PriceRangeSlider({ bounds, min, max, onChange }: PriceRangeSliderProps) {
  const money = useMoney();

  const span = bounds.max - bounds.min;
  const percent = (value: number) => ((value - bounds.min) / span) * 100;

  return (
    <div className={styles.field}>
      <span className={styles.label}>Price per night</span>

      {/* The chosen span in figures, because a thumb on a track is not a
          price — and it is what a reader reads back to check. */}
      <output className={styles.readout}>
        {money.format(min)} – {money.format(max)}
      </output>

      <div className={styles.slider}>
        <div className={styles.track} aria-hidden="true" />
        <div
          className={styles.fill}
          aria-hidden="true"
          style={{ left: `${percent(min)}%`, right: `${100 - percent(max)}%` }}
        />

        <input
          type="range"
          className={styles.input}
          aria-label="Minimum price per night"
          min={bounds.min}
          max={bounds.max}
          step={bounds.step}
          value={min}
          onChange={(event) =>
            onChange({ min: Math.min(Number(event.target.value), max - bounds.step), max })
          }
        />

        <input
          type="range"
          className={styles.input}
          aria-label="Maximum price per night"
          min={bounds.min}
          max={bounds.max}
          step={bounds.step}
          value={max}
          onChange={(event) =>
            onChange({ min, max: Math.max(Number(event.target.value), min + bounds.step) })
          }
        />
      </div>
    </div>
  );
}
