import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../../utils/cx';
import styles from './IconButton.module.css';

/*
 * `ComponentPropsWithRef` rather than `ButtonHTMLAttributes`, so a caller can
 * hold the button: the emoji picker has to hand focus back to its trigger when
 * it closes. React 19 passes `ref` through `...rest` like any other prop, so
 * this is a type change and nothing more.
 */
export type IconButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
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
