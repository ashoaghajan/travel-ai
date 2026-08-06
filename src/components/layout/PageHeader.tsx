import type { ReactNode } from 'react';
import { AccountMenu } from '../navigation/AccountMenu';
import { cx } from '../../utils/cx';
import styles from './PageHeader.module.css';

export type PageHeaderProps = {
  title: string;
  subtitle?: string;
  /** Rendered before the title — used for the brand mark on small screens. */
  leading?: ReactNode;
  /** Rendered on the right, before the account menu — typically icon buttons. */
  actions?: ReactNode;
  className?: string;
};

/**
 * Sticky page header shared by every screen inside the app shell.
 *
 * The account menu is added here rather than passed in as an action so it is
 * in the same corner on every screen — it is app chrome, not something a page
 * decides about. It renders nothing when nobody is signed in, which is what
 * keeps this usable on the signed-out screens.
 */
export function PageHeader({ title, subtitle, leading, actions, className }: PageHeaderProps) {
  return (
    <header className={cx(styles.header, className)}>
      {leading ? <div className={styles.leading}>{leading}</div> : null}

      <div className={styles.titles}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>

      <div className={styles.actions}>
        {actions}
        <AccountMenu />
      </div>
    </header>
  );
}
