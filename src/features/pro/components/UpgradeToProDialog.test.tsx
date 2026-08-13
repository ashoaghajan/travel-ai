/**
 * @vitest-environment jsdom
 */
import type { ApiUser } from '@ai-travel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { authService } from '../../../services/auth.service';
import { authStore } from '../../../store/auth.store';
import { UpgradeToProDialog } from './UpgradeToProDialog';

/**
 * The question, and the request behind it.
 *
 * Both ways in share this, so what somebody agrees to is written once — and
 * this is the seam a payment provider lands on, which is why the request lives
 * here rather than in either caller.
 */

const PRO: ApiUser = {
  id: 'u_1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  isGuest: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  identities: [],
  hasPassword: true,
  activeTripId: null,
  plan: 'pro',
  proSince: '2026-08-13T10:00:00.000Z',
  settings: {
    theme: 'system',
    currency: 'USD',
    notifications: { tripReminders: true, priceAlerts: false },
  },
};

// jsdom does not implement the native dialog methods.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
  });
});

afterEach(() => {
  authStore.reset();
  vi.restoreAllMocks();
});

describe('what it asks', () => {
  it('opens as a modal, so Escape and the focus trap come from the browser', () => {
    render(<UpgradeToProDialog onClose={vi.fn()} />);

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it('says what changes and what does not', () => {
    render(<UpgradeToProDialog onClose={vi.fn()} />);

    expect(screen.getByText(/writing trips with claude/i)).toBeInTheDocument();
    // Somebody deciding whether to upgrade is also deciding what they lose by
    // not, and the answer is nothing.
    expect(screen.getByText(/everything else stays as it is/i)).toBeInTheDocument();
  });

  it('says there is nothing to pay', () => {
    render(<UpgradeToProDialog onClose={vi.fn()} />);

    // The one line somebody might otherwise feel misled about later.
    expect(screen.getByText(/nothing to pay/i)).toBeInTheDocument();
  });
});

describe('answering it', () => {
  it('upgrades and closes on confirm', async () => {
    const setPlan = vi.spyOn(authService, 'setPlan').mockResolvedValue(PRO);
    const onClose = vi.fn();
    const onUpgraded = vi.fn();

    render(<UpgradeToProDialog onClose={onClose} onUpgraded={onUpgraded} />);
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }));

    await waitFor(() => expect(setPlan).toHaveBeenCalledWith('pro'));
    expect(onUpgraded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('changes nothing on "Not now"', async () => {
    const setPlan = vi.spyOn(authService, 'setPlan');
    const onClose = vi.fn();

    render(<UpgradeToProDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /not now/i }));

    expect(setPlan).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a failure on the dialog, and stays open', async () => {
    vi.spyOn(authService, 'setPlan').mockRejectedValue(new Error('offline'));
    const onClose = vi.fn();

    render(<UpgradeToProDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not go through/i);
    // Closing on failure would put the error nowhere, and leave the reader
    // unsure whether it worked.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeEnabled();
  });

  it('cannot be answered twice while the request is in flight', async () => {
    const setPlan = vi
      .spyOn(authService, 'setPlan')
      .mockImplementation(() => new Promise(() => {}));

    render(<UpgradeToProDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }));

    expect(await screen.findByRole('button', { name: /upgrading/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /not now/i })).toBeDisabled();
    expect(setPlan).toHaveBeenCalledTimes(1);
  });
});
