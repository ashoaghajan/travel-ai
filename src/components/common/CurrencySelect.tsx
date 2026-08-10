import { useId } from 'react';
import { CURRENCIES } from '@ai-travel/shared';
import { isCurrencyCode } from '@ai-travel/shared';
import { cx } from '../../utils/cx';
import { setDisplayCurrency, useDisplayCurrency } from '../../store/currency.store';
import styles from './CurrencySelect.module.css';

export type CurrencySelectProps = {
  /**
   * `inline` sits beside a heading; `field` is a labelled row on a settings
   * screen. The difference is presentation only — both write the same
   * preference.
   */
  variant?: 'inline' | 'field';
  label?: string;
  className?: string;
};

/**
 * Picks the currency prices are shown in.
 *
 * A native `<select>`, deliberately. Nine options do not need a combobox, and
 * the native control brings keyboard behaviour, screen-reader announcement and
 * a usable picker on a phone that a custom listbox would have to re-earn.
 *
 * Writes straight through to the store rather than taking an `onChange`: there
 * is one display currency for the whole app, so there is nothing for a parent
 * to decide.
 */
export function CurrencySelect({
  variant = 'inline',
  label = 'Currency',
  className,
}: CurrencySelectProps) {
  const id = useId();
  const currency = useDisplayCurrency();

  return (
    <div className={cx(styles.wrap, styles[variant], className)}>
      <label className={cx(styles.label, variant === 'inline' && 'visually-hidden')} htmlFor={id}>
        {label}
      </label>

      <select
        id={id}
        className={styles.select}
        value={currency}
        onChange={(event) => {
          // Guarded because a `<select>`'s value is a string as far as the DOM
          // is concerned, and this is the boundary where it becomes a code.
          if (isCurrencyCode(event.target.value)) setDisplayCurrency(event.target.value);
        }}
      >
        {CURRENCIES.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {entry.code} · {entry.name}
          </option>
        ))}
      </select>
    </div>
  );
}
