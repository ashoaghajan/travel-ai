/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { ApiUser } from '@ai-travel/shared';
import { ROUTES } from '../../../app/routes';
import { authService } from '../../../services/auth.service';
import { setAccessToken } from '../../../services/http';
import { authStore } from '../../../store/auth.store';
import { LANDING_HERO } from '../landing.content';
import { LandingPage } from './LandingPage';

/**
 * The landing page is reachable in both states — by bookmark, by typed URL, or
 * from the auth pages' brand link — so what it offers has to depend on the
 * session. Everything else about the page is the same either way.
 */
const ADA: ApiUser = {
  id: 'u_1',
  name: 'Ada',
  email: 'ada@example.com',
  isGuest: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  identities: [],
  hasPassword: true,
  activeTripId: null,
  plan: 'free',
  proSince: null,
  settings: {
    theme: 'system' as const,
    currency: 'USD',
    notifications: { tripReminders: true, priceAlerts: false },
  },
};

async function settle(as: ApiUser | null) {
  authStore.reset();
  vi.spyOn(authService, 'restore').mockResolvedValue(as);
  await authStore.bootstrap();
}

/** A router is required: the page renders `Link`s and `Button to=`. */
function renderPage() {
  const router = createMemoryRouter([{ path: ROUTES.landing, element: <LandingPage /> }], {
    initialEntries: [ROUTES.landing],
  });

  render(<RouterProvider router={router} />);
}

afterEach(() => {
  authStore.reset();
  setAccessToken(null);
  localStorage.clear();
});

describe('LandingPage', () => {
  describe('signed out', () => {
    it('offers both ways to get an account', async () => {
      await settle(null);

      renderPage();

      expect(screen.getByRole('link', { name: LANDING_HERO.primaryCta })).toHaveAttribute(
        'href',
        ROUTES.register,
      );
      expect(screen.getByRole('link', { name: LANDING_HERO.secondaryCta })).toHaveAttribute(
        'href',
        ROUTES.login,
      );
    });

    it('does not offer the planner, which is behind the auth boundary', async () => {
      await settle(null);

      renderPage();

      expect(
        screen.queryByRole('link', { name: LANDING_HERO.authenticatedCta }),
      ).not.toBeInTheDocument();
    });
  });

  describe('signed in', () => {
    // The dead end this replaced: "Get Started" and "Sign In" both led to an
    // account the reader already had.
    it('offers the planner instead of an account form', async () => {
      await settle(ADA);

      renderPage();

      expect(screen.getByRole('link', { name: LANDING_HERO.authenticatedCta })).toHaveAttribute(
        'href',
        ROUTES.planner,
      );
    });

    it('drops both anonymous calls to action', async () => {
      await settle(ADA);

      renderPage();

      expect(screen.queryByRole('link', { name: LANDING_HERO.primaryCta })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: LANDING_HERO.secondaryCta }),
      ).not.toBeInTheDocument();
    });

    // Only the calls to action change; the page is still worth reading.
    it('keeps the hero and the feature cards', async () => {
      await settle(ADA);

      renderPage();

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(LANDING_HERO.headline);
      expect(screen.getByText('Smart Itineraries')).toBeInTheDocument();
      expect(screen.getByText('Real-time Options')).toBeInTheDocument();
      expect(screen.getByText('Book with Confidence')).toBeInTheDocument();
    });
  });
});
