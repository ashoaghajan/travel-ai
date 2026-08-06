/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import type { ApiUser } from '@ai-travel/shared';
import { authService } from '../services/auth.service';
import { setAccessToken } from '../services/http';
import { authStore } from '../store/auth.store';
import { RedirectIfAuthenticated } from './RedirectIfAuthenticated';
import { ROUTES } from './routes';

/**
 * The anonymous-only boundary, mounted for real.
 *
 * A cut-down route table rather than the app's own, for the same reason
 * `RequireAuth.test.tsx` uses one: the real auth pages would drag in every
 * service they touch.
 */
const routes: RouteObject[] = [
  { path: ROUTES.planner, element: <p>Planner</p> },
  { path: ROUTES.trips, element: <p>Trips</p> },
  {
    element: <RedirectIfAuthenticated />,
    children: [
      { path: ROUTES.login, element: <p>Sign in form</p> },
      { path: ROUTES.register, element: <p>Register form</p> },
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

/** Settle the session the way the app does, with only the network stubbed. */
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

describe('RedirectIfAuthenticated', () => {
  it('lets an anonymous visitor reach the sign-in form', async () => {
    await settle(null);

    renderAt(ROUTES.login);

    expect(screen.getByText('Sign in form')).toBeInTheDocument();
  });

  it('leaves registration open to an anonymous visitor too', async () => {
    await settle(null);

    renderAt(ROUTES.register);

    expect(screen.getByText('Register form')).toBeInTheDocument();
  });

  // The bug this guard exists for: a session being asked to sign in again.
  it('sends a signed-in reader to the planner instead of the form', async () => {
    await settle(ADA);

    const router = renderAt(ROUTES.login);

    expect(router.state.location.pathname).toBe(ROUTES.planner);
    expect(screen.queryByText('Sign in form')).not.toBeInTheDocument();
  });

  it('does the same for the register page', async () => {
    await settle(ADA);

    const router = renderAt(ROUTES.register);

    expect(router.state.location.pathname).toBe(ROUTES.planner);
  });

  // A guard redirect the reader came back to, or a stale link: resume it rather
  // than dropping them on the dashboard.
  it('honours where they were originally headed', async () => {
    await settle(ADA);

    const router = renderAt(`${ROUTES.login}?next=${encodeURIComponent(ROUTES.trips)}`);

    expect(router.state.location.pathname).toBe(ROUTES.trips);
  });

  // `next` arrives from the URL bar, so it is attacker-controlled. `safeNextPath`
  // is what refuses it; this asserts the guard actually routes through it.
  it('refuses to be turned into an open redirect', async () => {
    await settle(ADA);

    const router = renderAt(
      `${ROUTES.login}?next=${encodeURIComponent('https://elsewhere.example/phish')}`,
    );

    expect(router.state.location.pathname).toBe(ROUTES.planner);
  });

  it('renders nothing while the session is still unknown', () => {
    authStore.reset();

    renderAt(ROUTES.login);

    expect(screen.queryByText('Sign in form')).not.toBeInTheDocument();
    expect(screen.queryByText('Planner')).not.toBeInTheDocument();
  });

  // Replace, not push: Back must not return to a form that redirects again.
  it('replaces the entry so Back does not bounce', async () => {
    await settle(ADA);

    const router = renderAt(ROUTES.login);

    expect(router.state.location.pathname).toBe(ROUTES.planner);
    expect(router.state.historyAction).toBe('REPLACE');
  });
});
