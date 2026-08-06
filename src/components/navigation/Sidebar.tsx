import { NavLink } from 'react-router-dom';
import { ROUTES } from '../../app/routes';
import { useTrips } from '../../store/trip.store';
import { Button } from '../common/Button';
import { Logo } from '../common/Logo';
import { PlusIcon, SparklesIcon } from '../common/icons';
import { cx } from '../../utils/cx';
import { ACCOUNT_NAV, MAIN_NAV } from './navigation.config';
import type { NavItem } from './navigation.config';
import { AccountFooter } from './AccountFooter';
import { RecentTrips } from './RecentTrips';
import { UpgradeCard } from './UpgradeCard';
import styles from './Sidebar.module.css';

function NavItemLink({ item }: { item: NavItem }) {
  const { label, path, icon: ItemIcon } = item;

  return (
    <li>
      <NavLink to={path} className={({ isActive }) => cx(styles.navLink, isActive && styles.active)}>
        <span className={styles.navIcon}>
          <ItemIcon size={20} />
        </span>
        {label}
      </NavLink>
    </li>
  );
}

export type SidebarProps = {
  className?: string;
};

/**
 * Desktop sidebar (DESIGN_SPEC §7 and Screen 2): brand, new-trip action,
 * navigation, recent trips and the upgrade promo. Hidden below 1024px — the
 * shell decides that, so this component stays layout-agnostic.
 */
/** How many saved trips the sidebar lists. */
const RECENT_TRIPS_LIMIT = 5;

export function Sidebar({ className }: SidebarProps) {
  const trips = useTrips();

  return (
    <aside className={cx(styles.sidebar, className)}>
      <div className={styles.top}>
        {/*
          Not a link. This sidebar only renders inside `RequireAuth`, so the
          brand is only ever seen by someone already signed in — and for them
          it has nowhere useful to go: the landing page is a sales pitch they
          have already accepted, and "Home" is right below in the navigation.
          The brand stays a link on the landing and auth screens, where it is
          the way back out. See `LandingPage` and `AuthLayout`.
        */}
        <div className={styles.brand}>
          <Logo variant="dark" size="md" />
        </div>

        <div className={styles.cta}>
          <Button
            to={ROUTES.tripNew}
            variant="primary"
            size="md"
            fullWidth
            leadingIcon={<PlusIcon size={18} />}
          >
            New Trip
          </Button>
          <Button
            to={ROUTES.planner}
            variant="secondary"
            size="md"
            fullWidth
            leadingIcon={<SparklesIcon size={18} />}
          >
            Plan with AI
          </Button>
        </div>
      </div>

      <nav className={styles.nav} aria-label="Main">
        <ul className={styles.navList}>
          {MAIN_NAV.map((item) => (
            <NavItemLink key={item.id} item={item} />
          ))}
        </ul>

        <hr className={styles.divider} />

        <ul className={styles.navList}>
          {ACCOUNT_NAV.map((item) => (
            <NavItemLink key={item.id} item={item} />
          ))}
        </ul>
      </nav>

      <RecentTrips trips={trips.slice(0, RECENT_TRIPS_LIMIT)} />

      <div className={styles.footer}>
        <UpgradeCard />
        <AccountFooter />
      </div>
    </aside>
  );
}
