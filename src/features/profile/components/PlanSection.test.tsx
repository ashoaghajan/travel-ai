/**
 * @vitest-environment jsdom
 */
import type { ApiUser } from '@ai-travel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { authService } from '../../../services/auth.service';
import { authStore } from '../../../store/auth.store';
import { PlanSection } from './PlanSection';

/** The plan row on the profile: what it says, and the way back to free. */

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

async function signedInAs(plan: 'free' | 'pro') {
  authStore.reset();
  vi.spyOn(authService, 'restore').mockResolvedValue(user(plan));
  await authStore.bootstrap();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  authStore.reset();
  vi.restoreAllMocks();
});

describe('on a free account', () => {
  it('names the tier and offers the upgrade', async () => {
    await signedInAs('free');
    render(<PlanSection />);

    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeInTheDocument();
  });

  it('says there is no payment behind the button', async () => {
    await signedInAs('free');
    render(<PlanSection />);

    // True, and somebody will notice. The screen that describes the account is
    // the wrong place to be coy about it.
    expect(screen.getByText(/no payment yet/i)).toBeInTheDocument();
  });

  it('upgrades through the store, so everything watching it updates', async () => {
    await signedInAs('free');
    const setPlan = vi.spyOn(authService, 'setPlan').mockResolvedValue(user('pro'));

    render(<PlanSection />);
    await userEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }));

    await waitFor(() => expect(setPlan).toHaveBeenCalledWith('pro'));
    // The row re-reads the store rather than keeping its own copy.
    expect(await screen.findByText('Pro')).toBeInTheDocument();
  });

  it('says so when the upgrade fails, and stays on free', async () => {
    await signedInAs('free');
    vi.spyOn(authService, 'setPlan').mockRejectedValue(new Error('offline'));

    render(<PlanSection />);
    await userEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not go through/i);
    expect(screen.getByText('Free')).toBeInTheDocument();
  });
});

describe('on a Pro account', () => {
  it('shows the tier and when it started', async () => {
    await signedInAs('pro');
    render(<PlanSection />);

    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText(/since 13 august 2026/i)).toBeInTheDocument();
  });

  it('stops selling, and offers the way back', async () => {
    await signedInAs('pro');
    render(<PlanSection />);

    // The half an upgrade flow usually forgets.
    expect(screen.getByRole('button', { name: /back to free/i })).toBeInTheDocument();
    expect(screen.queryByText(/no payment yet/i)).not.toBeInTheDocument();
  });

  it('goes back to free without a confirmation step', async () => {
    await signedInAs('pro');
    const setPlan = vi.spyOn(authService, 'setPlan').mockResolvedValue(user('free'));

    render(<PlanSection />);
    await userEvent.click(screen.getByRole('button', { name: /back to free/i }));

    // Nothing is lost and nothing was paid, so a confirmation would be
    // ceremony around an action that costs nothing to undo.
    await waitFor(() => expect(setPlan).toHaveBeenCalledWith('free'));
  });

  it('omits the date when the account has none', async () => {
    authStore.reset();
    vi.spyOn(authService, 'restore').mockResolvedValue({ ...user('pro'), proSince: null });
    await authStore.bootstrap();

    render(<PlanSection />);

    // An account upgraded before the column existed. "Pro since Invalid Date"
    // is worse than no line at all.
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.queryByText(/^since/i)).not.toBeInTheDocument();
  });
});
