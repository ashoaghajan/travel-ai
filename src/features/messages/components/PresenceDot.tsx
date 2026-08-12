import type { ReactNode } from 'react';
import { cx } from '../../../utils/cx';
import styles from './PresenceDot.module.css';

export type PresenceDotProps = {
  isOnline: boolean;
  /** The avatar the dot is pinned to. */
  children: ReactNode;
};

/**
 * A dot on the corner of an avatar saying whether that person is here.
 *
 * Wraps the avatar rather than going inside it, and has to: `Avatar` is
 * `overflow: hidden`, so a dot placed within is clipped away at the circle's
 * edge.
 *
 * The state is also written out for anyone not looking at it. Green against
 * grey is exactly the pair WCAG 1.4.1 exists for — the two are
 * indistinguishable to the commonest form of colour blindness, and a roster
 * whose only signal is a hue tells those readers nothing at all.
 */
export function PresenceDot({ isOnline, children }: PresenceDotProps) {
  return (
    <span className={styles.wrap}>
      {children}
      <span className={cx(styles.dot, isOnline && styles.online)} aria-hidden="true" />
      <span className="visually-hidden">{isOnline ? 'Online' : 'Offline'}</span>
    </span>
  );
}
