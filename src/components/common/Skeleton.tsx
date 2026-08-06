import { cx } from '../../utils/cx';
import styles from './Skeleton.module.css';

export type SkeletonProps = {
  /** Any CSS length. */
  width?: string;
  height?: string;
  radius?: 'sm' | 'md' | 'lg' | 'pill';
  className?: string;
};

/**
 * Shimmering placeholder block for loading states. Decorative — mark the
 * surrounding region with `aria-busy` and a status message instead.
 */
export function Skeleton({ width = '100%', height = '1rem', radius = 'sm', className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, styles[radius], className)}
      style={{ width, height }}
    />
  );
}
