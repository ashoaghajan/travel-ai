/**
 * @vitest-environment jsdom
 */
import type { ApiUser } from '@ai-travel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { authService } from '../../services/auth.service';
import { authStore } from '../../store/auth.store';
import { UpgradeCard } from './UpgradeCard';

/**
 * The sidebar offer.
 *
 * What matters here is mostly when it is *absent*: it sits on every screen, so
 * showing it to somebody who has already upgraded would advertise at them for
 * the rest of the session.
 */

function user(plan: 'free' | 'pro'): ApiUser {
  return {
    id: 'u_1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    isGuest: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    identities: [],
    hasPassword: true,
    activeTripId: null,
    plan,
    proSince: plan === 'pro' ? '2026-08-13T10:00:00.000Z' : null,
    settings: {
      theme: 'system',
      currency: 'USD',
      notifications: { tripReminders: true, priceAlerts: false },
    },
  };
}

async function settle(as: ApiUser | null) {
  authStore.reset();
  vi.spyOn(authService, 'restore').mockResolvedValue(as);
  await authStore.bootstrap();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  authStore.reset();
  vi.restoreAllMocks();
});

describe('UpgradeCard', () => {
  it('offers the upgrade to a free account', async () => {
    await settle(user('free'));
    render(<UpgradeCard />);

    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
  });

  it('describes what Pro actually changes', async () => {
    await settle(user('free'));
    render(<UpgradeCard />);

    // It used to promise unlimited itineraries, live pricing and offline
    // access — none of which this app withholds, and two of which do not exist.
    expect(screen.getByText(/claude/i)).toBeInTheDocument();
    expect(screen.queryByText(/offline access/i)).not.toBeInTheDocument();
  });

  it('renders nothing at all for a Pro account', async () => {
    await settle(user('pro'));
    const { container } = render(<UpgradeCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when nobody is signed in', async () => {
    await settle(null);
    const { container } = render(<UpgradeCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it('upgrades, and then disappears', async () => {
    await settle(user('free'));
    vi.spyOn(authService, 'setPlan').mockResolvedValue(user('pro'));

    const { container } = render(<UpgradeCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }));

    // The absence is the confirmation — no toast, no navigation.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('says so when it fails, and stays pressable', async () => {
    await settle(user('free'));
    vi.spyOn(authService, 'setPlan').mockRejectedValue(new Error('offline'));

    render(<UpgradeCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not go through/i);
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeEnabled();
  });
});
