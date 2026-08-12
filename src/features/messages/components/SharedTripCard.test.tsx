/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ApiTripShare } from '@ai-travel/shared';
import { SharedTripCard } from './SharedTripCard';

/**
 * The four states of an offer, and the fact that each of them says something
 * different depending on which end you are standing at.
 */

function share(overrides: Partial<ApiTripShare> = {}): ApiTripShare {
  return {
    id: 's_1',
    title: 'Berlin in Early Autumn',
    destination: 'Berlin, Germany',
    startDate: '2026-09-07',
    endDate: '2026-09-11',
    dayCount: 5,
    acceptedAt: null,
    acceptedTripId: null,
    revokedAt: null,
    ...overrides,
  };
}

function renderCard(props: Partial<Parameters<typeof SharedTripCard>[0]> = {}) {
  const handlers = { onPreview: vi.fn(), onAccept: vi.fn(), onRevoke: vi.fn() };

  render(
    <MemoryRouter>
      <SharedTripCard share={share()} isOwn={false} {...handlers} {...props} />
    </MemoryRouter>,
  );

  return handlers;
}

describe('an offer nobody has taken up', () => {
  it('names the trip and how long it is', () => {
    renderCard();

    expect(screen.getByText('Berlin in Early Autumn')).toBeInTheDocument();
    expect(screen.getByText('Berlin, Germany')).toBeInTheDocument();
    expect(screen.getByText('5 days')).toBeInTheDocument();
  });

  it('offers the recipient a look and a copy', async () => {
    const user = userEvent.setup();
    const handlers = renderCard();

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Add to my trips' }));

    expect(handlers.onPreview).toHaveBeenCalled();
    expect(handlers.onAccept).toHaveBeenCalled();
    // Taking up your own offer is not a thing.
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  it('offers the sender a look and a way back', async () => {
    const user = userEvent.setup();
    const handlers = renderCard({ isOwn: true });

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));

    expect(handlers.onRevoke).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Add to my trips' })).not.toBeInTheDocument();
  });
});

describe('once it has been taken up', () => {
  it('tells the recipient where it went', () => {
    renderCard({
      share: share({ acceptedAt: '2026-08-12T10:00:00.000Z', acceptedTripId: 'trip_9' }),
    });

    expect(screen.getByText(/Added to your trips/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/trips/trip_9');
  });

  it('tells the sender, without a link into somebody else’s account', () => {
    renderCard({
      isOwn: true,
      share: share({ acceptedAt: '2026-08-12T10:00:00.000Z', acceptedTripId: 'trip_9' }),
    });

    // The same fact, and not the same sentence.
    expect(screen.getByText('Added to their trips.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('stops offering it', () => {
    renderCard({ share: share({ acceptedAt: '2026-08-12T10:00:00.000Z' }) });

    expect(screen.queryByRole('button', { name: 'Add to my trips' })).not.toBeInTheDocument();
  });
});

describe('once it has been withdrawn', () => {
  it('says so, to each of them, and does nothing', () => {
    const { unmount } = render(
      <MemoryRouter>
        <SharedTripCard
          share={share({ revokedAt: '2026-08-12T10:00:00.000Z' })}
          isOwn={false}
          onPreview={vi.fn()}
          onAccept={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    );

    // The card stays: a message vanishing off somebody's screen is worse than
    // one that explains itself.
    expect(screen.getByText('This trip is no longer being shared.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();

    renderCard({ isOwn: true, share: share({ revokedAt: '2026-08-12T10:00:00.000Z' }) });
    expect(screen.getByText('You withdrew this trip.')).toBeInTheDocument();
  });

  it('is outranked by an acceptance', () => {
    // Revoking after acceptance is refused by the server, but a card holding
    // both must not tell somebody a trip they already have is unavailable.
    renderCard({
      share: share({
        acceptedAt: '2026-08-12T10:00:00.000Z',
        revokedAt: '2026-08-12T10:01:00.000Z',
      }),
    });

    expect(screen.getByText(/Added to your trips/)).toBeInTheDocument();
  });
});
