import { NavLink } from 'react-router-dom';
import { cx } from '../../utils/cx';
import { BOTTOM_NAV } from './navigation.config';
import styles from './BottomNavigation.module.css';

export type BottomNavigationProps = {
  className?: string;
};

/**
 * Mobile bottom navigation (DESIGN_SPEC §7). The shell hides it from 1024px
 * up, where the sidebar takes over.
 */
export function BottomNavigation({ className }: BottomNavigationProps) {
  return (
    <nav className={cx(styles.bar, className)} aria-label="Primary">
      <ul className={styles.list}>
        {BOTTOM_NAV.map(({ id, label, path, icon: ItemIcon }) => (
          <li key={id} className={styles.item}>
            <NavLink
              to={path}
              className={({ isActive }) => cx(styles.link, isActive && styles.active)}
            >
              <span className={styles.iconWrap}>
                <ItemIcon size={22} />
              </span>
              <span className={styles.label}>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
