import type { ComponentType } from 'react';
import { ROUTES } from '../../app/routes';
import type { IconProps } from '../common/icons';
import {
  CompassIcon,
  HomeIcon,
  SettingsIcon,
  SuitcaseIcon,
  TicketIcon,
  UserIcon,
  UsersIcon,
} from '../common/icons';

export type NavItem = {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<IconProps>;
};

/**
 * Sidebar navigation from DESIGN_SPEC Screen 2. "Home" is the planner
 * dashboard — the app's home once you are past the landing page.
 */
export const MAIN_NAV: NavItem[] = [
  { id: 'home', label: 'Home', path: ROUTES.planner, icon: HomeIcon },
  { id: 'trips', label: 'Trips', path: ROUTES.trips, icon: SuitcaseIcon },
  { id: 'explore', label: 'Explore', path: ROUTES.activities, icon: CompassIcon },
  { id: 'bookings', label: 'Bookings', path: ROUTES.bookings, icon: TicketIcon },
];

const PROFILE_ITEM: NavItem = {
  id: 'profile',
  label: 'Profile',
  path: ROUTES.profile,
  icon: UserIcon,
};

const FRIENDS_ITEM: NavItem = {
  id: 'friends',
  label: 'Friends',
  path: ROUTES.friends,
  icon: UsersIcon,
};

export const ACCOUNT_NAV: NavItem[] = [
  PROFILE_ITEM,
  /*
   * Beside Profile rather than in the main group, because it is about the
   * account rather than about a trip — and because the main four are the
   * journey the app is for.
   */
  FRIENDS_ITEM,
  { id: 'settings', label: 'Settings', path: ROUTES.settings, icon: SettingsIcon },
];

/**
 * Mobile bottom navigation (DESIGN_SPEC §7): Home, Trips, Explore, Bookings,
 * Friends, Profile. Built from the same items as the sidebar so labels, paths
 * and icons can never drift between the two.
 *
 * Six rather than the five the spec named, because friends became a
 * destination: on a phone there is no sidebar, and a page reachable only from
 * a sidebar is a page a phone cannot reach at all. Six fits — the bar divides
 * evenly and the icon pill is 46px against a 60px cell at the narrowest common
 * width — and the alternative was leaving the feature unreachable on the half
 * of the app that has no sidebar.
 */
export const BOTTOM_NAV: NavItem[] = [...MAIN_NAV, FRIENDS_ITEM, PROFILE_ITEM];
