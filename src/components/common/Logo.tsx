import { cx } from '../../utils/cx';
import { PlaneIcon } from './icons';
import styles from './Logo.module.css';

export type LogoProps = {
  /** `light` for dark or photographic backgrounds, `dark` for light surfaces. */
  variant?: 'light' | 'dark';
  size?: 'md' | 'lg';
  /** Hide the wordmark and show the mark only (useful for collapsed navigation). */
  markOnly?: boolean;
  className?: string;
};

/**
 * Brand lockup: purple mark plus the short brand label "AI Travel"
 * (DESIGN_SPEC §3). Purely presentational — wrap it in a link when it needs
 * to navigate.
 */
export function Logo({ variant = 'dark', size = 'md', markOnly = false, className }: LogoProps) {
  return (
    <span className={cx(styles.logo, styles[variant], styles[size], className)}>
      <span className={styles.mark}>
        <PlaneIcon size={size === 'lg' ? 22 : 18} />
      </span>
      {markOnly ? (
        <span className="visually-hidden">AI Travel</span>
      ) : (
        <span className={styles.wordmark}>AI Travel</span>
      )}
    </span>
  );
}
