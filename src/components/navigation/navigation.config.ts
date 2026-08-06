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

export const ACCOUNT_NAV: NavItem[] = [
  PROFILE_ITEM,
  { id: 'settings', label: 'Settings', path: ROUTES.settings, icon: SettingsIcon },
];

/**
 * Mobile bottom navigation (DESIGN_SPEC §7): Home, Trips, Explore, Bookings,
 * Profile. Built from the same items as the sidebar so labels, paths and icons
 * can never drift between the two.
 */
export const BOTTOM_NAV: NavItem[] = [...MAIN_NAV, PROFILE_ITEM];
