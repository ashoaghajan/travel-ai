import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../utils/cx';
import styles from './IconButton.module.css';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Accessible name — icon-only controls have no visible label. */
  label: string;
  variant?: 'ghost' | 'surface' | 'primary';
  size?: 'md' | 'lg';
  children: ReactNode;
};

/** Square, rounded, icon-only control (DESIGN_SPEC component inventory). */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={cx(styles.iconButton, styles[variant], styles[size], className)}
    >
      {children}
    </button>
  );
}
