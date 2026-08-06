/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import type { ApiUser } from '@ai-travel/shared';
import { authService } from '../services/auth.service';
import { setAccessToken } from '../services/http';
import { authStore } from '../store/auth.store';
import { RequireAuth } from './RequireAuth';
import { ROUTES } from './routes';

/**
 * The account boundary, mounted for real.
 *
 * A cut-down route table rather than the app's own: this is a test of the
 * guard, and the real pages would drag in every service they touch.
 */
const routes: RouteObject[] = [
  { path: ROUTES.landing, element: <p>Landing</p> },
  { path: ROUTES.login, element: <p>Sign in form</p> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: (
          <>
            <p>Shell</p>
            <Outlet />
          </>
        ),
        children: [
          { path: ROUTES.planner, element: <p>Planner</p> },
          { path: ROUTES.trips, element: <p>Trips</p> },
        ],
      },
    ],
  },
];

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);

  return router;
}

const ADA: ApiUser = {
  id: 'u_1',
  name: 'Ada',
  email: 'ada@example.com',
  isGuest: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  identities: [],
  hasPassword: true,
};

/**
 * Settle the session the way the app does — through `bootstrap`, with only the
 * network stubbed. Testing the real path rather than a state setter.
 */
async function settle(as: ApiUser | null) {
  authStore.reset();
  vi.spyOn(authService, 'restore').mockResolvedValue(as);
  await authStore.bootstrap();
}

afterEach(() => {
  authStore.reset();
  setAccessToken(null);
  localStorage.clear();
});

describe('RequireAuth', () => {
  it('sends an anonymous visitor to the sign-in page', async () => {
    await settle(null);

    renderAt(ROUTES.planner);

    expect(screen.getByText('Sign in form')).toBeInTheDocument();
    expect(screen.queryByText('Planner')).not.toBeInTheDocument();
  });

  // Otherwise signing in drops everyone on the dashboard, losing the link they
  // actually followed.
  it('remembers where they were going, query string and all', async () => {
    await settle(null);

    const router = renderAt(`${ROUTES.trips}?filter=upcoming`);

    expect(router.state.location.pathname).toBe(ROUTES.login);
    expect(router.state.location.search).toBe(
      `?next=${encodeURIComponent(`${ROUTES.trips}?filter=upcoming`)}`,
    );
  });

  it('lets a signed-in user through to the shell', async () => {
    await settle(ADA);

    renderAt(ROUTES.planner);

    expect(screen.getByText('Shell')).toBeInTheDocument();
    expect(screen.getByText('Planner')).toBeInTheDocument();
  });

  // Rendering the guard before boot has answered would bounce a signed-in user
  // to the login page on every reload — the failure mode of an in-memory token.
  it('renders nothing while the session is still unknown', () => {
    authStore.reset();

    renderAt(ROUTES.planner);

    expect(screen.queryByText('Sign in form')).not.toBeInTheDocument();
    expect(screen.queryByText('Planner')).not.toBeInTheDocument();
  });

  it('leaves the public pages alone', async () => {
    await settle(null);

    renderAt(ROUTES.landing);

    expect(screen.getByText('Landing')).toBeInTheDocument();
  });
});
