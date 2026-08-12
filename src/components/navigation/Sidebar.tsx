import { NavLink } from 'react-router-dom';
import { ROUTES } from '../../app/routes';
import { useFriendStats } from '../../store/friend.store';
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

function NavItemLink({ item, badge = 0 }: { item: NavItem; badge?: number }) {
  const { label, path, icon: ItemIcon } = item;

  return (
    <li>
      <NavLink
        to={path}
        className={({ isActive }) => cx(styles.navLink, isActive && styles.active)}
      >
        <span className={styles.navIcon}>
          <ItemIcon size={20} />
        </span>
        {label}
        {/*
          The count is inside the link's own text rather than beside it, so a
          screen reader says "Friends, 2 waiting" as one thing. A bare "2" next
          to a word says nothing about what two of.
        */}
        {badge > 0 ? (
          <span className={styles.badge}>
            <span className="visually-hidden">, {badge} waiting</span>
            <span aria-hidden="true">{badge}</span>
          </span>
        ) : null}
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
  /*
   * Read here rather than in `navigation.config.ts`, which is a list of links
   * and should stay one. Reading the stats also loads them, which is what
   * makes a request that arrived while the reader was on another page show up
   * in the corner of the sidebar rather than only on the friends page.
   */
  const friendStats = useFriendStats();
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
            <NavItemLink
              key={item.id}
              item={item}
              // Only friends has one today. Passing it by id rather than
              // putting a count in the nav config keeps that file a list of
              // links rather than a thing that reads stores.
              badge={item.id === 'friends' ? friendStats.incoming : 0}
            />
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
