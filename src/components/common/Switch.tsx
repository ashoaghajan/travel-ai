import { useId } from 'react';
import { cx } from '../../utils/cx';
import styles from './Switch.module.css';

export type SwitchProps = {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

/**
 * Labelled on/off control. A native checkbox with `role="switch"` — keyboard
 * and screen-reader behaviour come for free.
 */
export function Switch({ label, description, checked, onChange, className }: SwitchProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={cx(styles.row, className)}>
      <span className={styles.text}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {description ? (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        ) : null}
      </span>

      <input
        id={id}
        type="checkbox"
        role="switch"
        className={styles.input}
        checked={checked}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}
