/**
 * Route paths from README "Stage 1 Recommended Routes".
 *
 * Declared up front so links are never stringly-typed, even though only the
 * landing route is implemented so far.
 */
export const ROUTES = {
  landing: '/',
  /**
   * `login`/`register` rather than sign-in/sign-up, matching the API's
   * `POST /api/auth/register`. The visible copy still says "Sign in".
   */
  login: '/login',
  register: '/register',
  planner: '/planner',
  trips: '/trips',
  tripNew: '/trips/new',
  tripDetails: '/trips/:tripId',
  tripSummary: '/trips/:tripId/summary',
  flights: '/flights',
  hotels: '/hotels',
  activities: '/activities',
  activityDetails: '/activities/:activityId',
  bookings: '/bookings',
  friends: '/friends',
  profile: '/profile',
  settings: '/settings',
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteKey];
