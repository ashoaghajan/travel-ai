/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { messagesService } from '../../../services/messages.service';
import { shareService } from '../../../services/share.service';
import type { TripDraft } from '../../../types/trip.types';
import { ShareTripDialog } from './ShareTripDialog';

/**
 * Handing a trip to somebody, from the trip.
 *
 * The point worth pinning here is what goes up the wire: the same document
 * `Export` writes to a file, photograph names and all, because that is what
 * makes the recipient's copy look like the original rather than like a trip
 * with broken pictures.
 */

const TRIP = {
  id: 'trip_1',
  title: 'Berlin in Early Autumn',
  destination: 'Berlin, Germany',
  destinationCity: 'Berlin',
  destinationCountry: 'Germany',
  startDate: '2026-09-07',
  endDate: '2026-09-11',
  travellers: 2,
  coverImage: '/assets/city.jpg',
  itinerary: [],
} as unknown as TripDraft & { id: string };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
  });

  vi.spyOn(messagesService, 'getConversations').mockResolvedValue([
    { id: 'u_grace', name: 'Grace', lastMessage: null, unread: 0 },
    { id: 'u_bo', name: 'Bo', lastMessage: null, unread: 0 },
  ]);
});

describe('ShareTripDialog', () => {
  it('lists the people this trip could go to', async () => {
    render(<ShareTripDialog trip={TRIP} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /Grace/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bo/ })).toBeInTheDocument();
  });

  it('sends the trip as the file format, to the person picked', async () => {
    const share = vi.spyOn(shareService, 'shareTrip').mockResolvedValue({} as never);

    const user = userEvent.setup();
    render(<ShareTripDialog trip={TRIP} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Grace/ }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    const [tripId, toUserId, snapshot, clientMessageId] = share.mock.calls[0];

    expect(tripId).toBe('trip_1');
    expect(toUserId).toBe('u_grace');
    expect(snapshot).toMatchObject({ title: 'Berlin in Early Autumn', startDate: '2026-09-07' });
    // Minted here, so a second press cannot become a second offer.
    expect(clientMessageId).toMatch(/^share_/);
  });

  it('says it has gone, and will not send it twice', async () => {
    vi.spyOn(shareService, 'shareTrip').mockResolvedValue({} as never);

    const user = userEvent.setup();
    render(<ShareTripDialog trip={TRIP} onClose={vi.fn()} />);

    const row = await screen.findByRole('button', { name: /Grace/ });
    await user.click(row);

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(row).toBeDisabled();
  });

  it('says so when the send fails, and lets them try again', async () => {
    vi.spyOn(shareService, 'shareTrip').mockRejectedValue(new Error('offline'));

    const user = userEvent.setup();
    render(<ShareTripDialog trip={TRIP} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Grace/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not share/i);
    expect(screen.getByRole('button', { name: /Grace/ })).not.toBeDisabled();
  });

  it('says what sharing means before the first send', async () => {
    render(<ShareTripDialog trip={TRIP} onClose={vi.fn()} />);

    // A copy is permanent once taken up, and that is worth knowing before
    // rather than after.
    expect(await screen.findByText(/once somebody has added a trip it is theirs/)).toBeInTheDocument();
  });

  it('says so when the list will not load', async () => {
    vi.spyOn(messagesService, 'getConversations').mockRejectedValue(new Error('offline'));

    render(<ShareTripDialog trip={TRIP} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
  });
});
