/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tripService } from '../../../services/trip.service';
import { seedTrips } from '../../../test/seedTrips';
import type { Trip } from '../../../types/trip.types';
import { buildTripFile, serialiseTripFile } from '../../../utils/tripFile';
import { ImportTripDialog } from './ImportTripDialog';

/**
 * The step between picking a file and owning its contents.
 *
 * Nothing may be saved until the reader has seen what is in the file, and a
 * trip they already have has to be said out loud rather than quietly doubled.
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
        activities: [
          { id: 'act_1', time: '10:00', title: 'Cascade', description: '', category: 'culture' },
        ],
      },
    ],
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}

function tripFile(trip: Trip = makeTrip()): File {
  return new File([serialiseTripFile(buildTripFile(trip))], 'yerevan.trip.json', {
    type: 'application/json',
  });
}

beforeEach(async () => {
  // jsdom implements neither, and a dialog that never opens renders nothing.
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
  });

  await seedTrips([]);
});

function open(onImported = vi.fn(), onClose = vi.fn()) {
  render(<ImportTripDialog onClose={onClose} onImported={onImported} />);

  return { onImported, onClose };
}

describe('ImportTripDialog', () => {
  it('has nothing to import until a file is chosen', () => {
    open();

    expect(screen.getByRole('button', { name: 'Import trip' })).toBeDisabled();
  });

  it('shows what the file holds', async () => {
    const user = userEvent.setup();
    open();

    await user.upload(screen.getByLabelText('Choose file'), tripFile());

    expect(await screen.findByText('One week in Yerevan')).toBeInTheDocument();
    expect(screen.getByText(/1 day · 1 activity · 0 notes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import trip' })).toBeEnabled();
  });

  it('says why a file it cannot read was refused', async () => {
    const user = userEvent.setup();
    open();

    await user.upload(
      screen.getByLabelText('Choose file'),
      new File(['nonsense'], 'notes.json', { type: 'application/json' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/not JSON/i);
    expect(screen.getByRole('button', { name: 'Import trip' })).toBeDisabled();
  });

  it('imports the trip and hands it back', async () => {
    const user = userEvent.setup();
    const saved = makeTrip({ id: 'trip_new' });
    vi.spyOn(tripService, 'createTrip').mockResolvedValue(saved);

    const { onImported } = open();

    await user.upload(screen.getByLabelText('Choose file'), tripFile());
    await user.click(await screen.findByRole('button', { name: 'Import trip' }));

    expect(onImported).toHaveBeenCalledWith(saved);
  });

  it('warns before doubling a trip the account already has', async () => {
    await seedTrips([makeTrip()]);
    const create = vi.spyOn(tripService, 'createTrip');
    const user = userEvent.setup();

    open();

    await user.upload(screen.getByLabelText('Choose file'), tripFile());
    await user.click(await screen.findByRole('button', { name: 'Import trip' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already have a trip called/i);
    expect(create).not.toHaveBeenCalled();

    // Nothing is overwritten either way — the second press adds a copy.
    expect(screen.getByRole('button', { name: 'Import anyway' })).toBeEnabled();
  });

  it('adds the copy when the reader insists', async () => {
    await seedTrips([makeTrip()]);
    const saved = makeTrip({ id: 'trip_second' });
    vi.spyOn(tripService, 'createTrip').mockResolvedValue(saved);
    const user = userEvent.setup();

    const { onImported } = open();

    await user.upload(screen.getByLabelText('Choose file'), tripFile());
    await user.click(await screen.findByRole('button', { name: 'Import trip' }));
    await user.click(await screen.findByRole('button', { name: 'Import anyway' }));

    expect(onImported).toHaveBeenCalledWith(saved);
  });

  it('leaves the account alone when cancelled', async () => {
    const create = vi.spyOn(tripService, 'createTrip');
    const user = userEvent.setup();

    const { onClose, onImported } = open();

    await user.upload(screen.getByLabelText('Choose file'), tripFile());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('says that bookings do not travel', async () => {
    const user = userEvent.setup();
    open();

    await user.upload(screen.getByLabelText('Choose file'), tripFile());

    // The one thing about this feature a reader could otherwise get wrong.
    expect(await screen.findByText(/Bookings do not/)).toBeInTheDocument();
  });
});
