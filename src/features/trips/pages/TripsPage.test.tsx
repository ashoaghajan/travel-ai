/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { messagesService } from '../../../services/messages.service';
import { shareService } from '../../../services/share.service';
import { tripService } from '../../../services/trip.service';
import { seedTrips } from '../../../test/seedTrips';
import type { Trip } from '../../../types/trip.types';
import { buildTripFile, serialiseTripFile } from '../../../utils/tripFile';
import { TripsPage } from './TripsPage';

/**
 * The trips list, as the way in for a file.
 *
 * The dialog's own behaviour is covered next to it; what this pins down is
 * that the list offers the door at all — including on an empty account, which
 * is where someone holding a file they were sent will actually arrive — and
 * that a finished import lands on the trip it created.
 */

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    title: 'One week in Yerevan',
    destination: 'Yerevan',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    coverImage: '',
    itinerary: [
      {
        id: 'day_1',
        dayNumber: 1,
        date: '2027-09-02',
        destination: 'Yerevan',
        summary: '',
        activities: [],
      },
    ],
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/trips']}>
      <Routes>
        <Route path="/trips" element={<TripsPage />} />
        <Route path="/trips/:tripId" element={<h1>Trip page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
  });

  await seedTrips([]);
});

describe('importing from the trips list', () => {
  it('offers the import from the empty state, where a newcomer will look', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Import a trip' }));

    expect(screen.getByRole('heading', { name: 'Import a trip' })).toBeInTheDocument();
  });

  it('opens the dialog from the header action', async () => {
    await seedTrips([makeTrip()]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Import trip' }));

    expect(screen.getByRole('heading', { name: 'Import a trip' })).toBeInTheDocument();
  });

  it('lands on the imported trip once it is saved', async () => {
    const saved = makeTrip({ id: 'trip_imported' });
    vi.spyOn(tripService, 'createTrip').mockResolvedValue(saved);

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Import a trip' }));
    await user.upload(
      screen.getByLabelText('Choose file'),
      new File([serialiseTripFile(buildTripFile(makeTrip()))], 'yerevan.trip.json', {
        type: 'application/json',
      }),
    );
    // Scoped to the dialog: the page header carries a button of the same name.
    const dialog = within(screen.getByRole('dialog'));
    await user.click(await dialog.findByRole('button', { name: 'Import trip' }));

    expect(await screen.findByRole('heading', { name: 'Trip page' })).toBeInTheDocument();
  });
});

/**
 * Handing a trip to somebody, from the list.
 *
 * The same dialog the trip screen opens — what this pins is that the card
 * offers the door, since the list is where somebody scanning their trips
 * actually decides to send one.
 */
describe('sharing from the list', () => {
  beforeEach(() => {
    vi.spyOn(messagesService, 'getConversations').mockResolvedValue([
      { id: 'u_grace', name: 'Grace', lastMessage: null, unread: 0 },
    ]);
  });

  it('offers a share control on each trip', async () => {
    await seedTrips([makeTrip()]);
    renderPage();

    expect(
      await screen.findByRole('button', { name: 'Share One week in Yerevan with somebody' }),
    ).toBeInTheDocument();
  });

  it('sends the trip that was pressed, not the first one', async () => {
    await seedTrips([makeTrip(), makeTrip({ id: 'trip_2', title: 'Berlin in Early Autumn' })]);
    const share = vi.spyOn(shareService, 'shareTrip').mockResolvedValue({} as never);

    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Share Berlin in Early Autumn with somebody' }),
    );
    await user.click(await screen.findByRole('button', { name: /Grace/ }));

    expect(share.mock.calls[0][0]).toBe('trip_2');
  });
});
