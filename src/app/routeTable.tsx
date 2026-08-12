import type { RouteObject } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { RootLayout } from './RootLayout';
import { LandingPage } from '../features/landing/pages/LandingPage';
import { PlannerPage } from '../features/planner/pages/PlannerPage';
import { TripsPage } from '../features/trips/pages/TripsPage';
import { CreateTripPage } from '../features/trips/pages/CreateTripPage';
import { TripDetailsPage } from '../features/trips/pages/TripDetailsPage';
import { TripSummaryPage } from '../features/trips/pages/TripSummaryPage';
import { FlightsPage } from '../features/flights/pages/FlightsPage';
import { HotelsPage } from '../features/hotels/pages/HotelsPage';
import { ExplorePage } from '../features/explore/pages/ExplorePage';
import { ActivityDetailsPage } from '../features/explore/pages/ActivityDetailsPage';
import { BookingsPage } from '../features/bookings/pages/BookingsPage';
import { FriendsPage } from '../features/friends/pages/FriendsPage';
import { ProfilePage } from '../features/profile/pages/ProfilePage';
import { SettingsPage } from '../features/settings/pages/SettingsPage';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { RegisterPage } from '../features/auth/pages/RegisterPage';
import { NotFoundPage } from '../features/errors/pages/NotFoundPage';
import { RouteErrorPage } from '../features/errors/pages/RouteErrorPage';
import { RedirectIfAuthenticated } from './RedirectIfAuthenticated';
import { RequireAuth } from './RequireAuth';
import { ROUTES } from './routes';

/**
 * Route table.
 *
 * `RootLayout` wraps everything (skip link, document title, focus management).
 * The landing page is full-bleed and sits outside the dashboard shell; every
 * in-app screen renders inside `AppShell` via a pathless layout route, so the
 * chrome mounts once and survives navigation.
 *
 * `handle.title` feeds the document title and the route announcement.
 * Kept separate from `router.tsx` so the table can be mounted in a memory
 * router by tests without constructing a browser history.
 */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        path: ROUTES.landing,
        element: <LandingPage />,
        handle: { title: 'Plan the perfect trip' },
      },
      // Outside the shell, like the landing page: there is no sidebar to draw
      // for someone who has no account yet. And gated the other way — a reader
      // who already has a session is sent on rather than asked to sign in.
      {
        element: <RedirectIfAuthenticated />,
        children: [
          {
            path: ROUTES.login,
            element: <LoginPage />,
            handle: { title: 'Sign in' },
          },
          {
            path: ROUTES.register,
            element: <RegisterPage />,
            handle: { title: 'Create account' },
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              {
                path: ROUTES.planner,
                element: <PlannerPage />,
                handle: { title: 'Planner' },
              },
              {
                path: ROUTES.trips,
                element: <TripsPage />,
                handle: { title: 'Your trips' },
              },
              // Declared before the `:tripId` route for the reader; react-router
              // ranks a static segment above a dynamic one regardless of order.
              {
                path: ROUTES.tripNew,
                element: <CreateTripPage />,
                handle: { title: 'New trip' },
              },
              {
                path: ROUTES.tripDetails,
                element: <TripDetailsPage />,
                handle: { title: 'Trip details' },
              },
              {
                path: ROUTES.tripSummary,
                element: <TripSummaryPage />,
                handle: { title: 'Trip summary' },
              },
              {
                path: ROUTES.flights,
                element: <FlightsPage />,
                handle: { title: 'Flights' },
              },
              {
                path: ROUTES.hotels,
                element: <HotelsPage />,
                handle: { title: 'Hotels' },
              },
              {
                path: ROUTES.activities,
                element: <ExplorePage />,
                handle: { title: 'Explore' },
              },
              {
                path: ROUTES.activityDetails,
                element: <ActivityDetailsPage />,
                handle: { title: 'Attraction' },
              },
              {
                path: ROUTES.bookings,
                element: <BookingsPage />,
                handle: { title: 'Bookings' },
              },
              {
                path: ROUTES.friends,
                element: <FriendsPage />,
                handle: { title: 'Friends' },
              },
              {
                path: ROUTES.profile,
                element: <ProfilePage />,
                handle: { title: 'Profile' },
              },
              {
                path: ROUTES.settings,
                element: <SettingsPage />,
                handle: { title: 'Settings' },
              },
              // Unmatched URLs keep the navigation rather than bouncing to the
              // marketing page.
              {
                path: '*',
                element: <NotFoundPage />,
                handle: { title: 'Page not found' },
              },
            ],
          },
        ],
      },
    ],
  },
];
