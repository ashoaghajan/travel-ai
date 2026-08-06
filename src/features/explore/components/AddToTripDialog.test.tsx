/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Trip } from '../../../types/trip.types';
import type { Activity } from '../../../types/travel.types';
import { STORAGE_KEYS, storageService } from '../../../services/localStorage.service';
import { AddToTripDialog } from './AddToTripDialog';

/**
 * Keeping a place off a trip on the other side of the world.
 *
 * The explorer browses anywhere, so nothing about the listing tells you which
 * trip it belongs to — until now an attraction in Djibouti could be dropped
 * onto an itinerary for Yerevan, and the trip map would draw a line to it.
 *
 * Trips in the wrong country stay *visible* here rather than disappearing: a
 * picker that silently omits the trip you were looking for is worse than one
 * that says why you cannot pick it.
 */

// jsdom does not implement the native dialog methods.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
  });

  storageService.remove(STORAGE_KEYS.trips);
});

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_am',
    title: 'One week in Yerevan',
    destination: 'Yerevan',
    destinationCity: 'Yerevan',
    destinationCountry: 'Armenia',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    coverImage: '/yerevan.jpg',
    itinerary: [
      {
        id: 'day_1',
        dayNumber: 1,
        date: '2027-09-02',
        destination: 'Yerevan',
        summary: 'Arrival',
        activities: [],
      },
    ],
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}

const ACTIVITY: Activity = {
  id: 'act_ardoukoba',
  title: 'Ardoukoba',
  category: 'nature',
  description: 'A young volcano in the Afar rift.',
  price: 0,
  rating: 5,
  reviews: 0,
  image: '/ardoukoba.jpg',
};

function open(placeCountry: string | null, onAdded = vi.fn()) {
  render(
    <MemoryRouter>
      <AddToTripDialog
        activity={ACTIVITY}
        placeCountry={placeCountry}
        onClose={vi.fn()}
        onAdded={onAdded}
      />
    </MemoryRouter>,
  );

  return { onAdded };
}

const tripOption = (name: RegExp) => screen.getByRole('option', { name });

describe('a place in another country', () => {
  it('cannot be put on a trip that goes somewhere else', () => {
    storageService.set(STORAGE_KEYS.trips, [
      makeTrip(),
      makeTrip({ id: 'trip_jp', title: 'Tokyo in October', destinationCountry: 'Japan' }),
    ]);

    // A place in Japan: the Tokyo trip can take it, the Yerevan one cannot.
    open('Japan');

    // The Armenian trip is still listed — and says where it goes.
    expect(tripOption(/One week in Yerevan/)).toBeDisabled();
    expect(tripOption(/goes to Armenia/)).toBeInTheDocument();
    expect(tripOption(/Tokyo in October/)).not.toBeDisabled();
  });

  it('explains itself when no trip goes there at all', () => {
    storageService.set(STORAGE_KEYS.trips, [makeTrip()]);

    open('Djibouti');

    expect(screen.getByText('None of your trips go to Djibouti')).toBeInTheDocument();
    expect(screen.getByText(/Ardoukoba is in Djibouti/)).toBeInTheDocument();
    // Nothing to submit, so the button is gone rather than merely disabled.
    expect(screen.queryByRole('button', { name: 'Add to trip' })).not.toBeInTheDocument();
  });
});

describe('a place in the trip’s own country', () => {
  it('can be added as before', async () => {
    storageService.set(STORAGE_KEYS.trips, [makeTrip()]);
    const { onAdded } = open('Armenia');

    expect(tripOption(/One week in Yerevan/)).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Add to trip' }));

    expect(onAdded).toHaveBeenCalledWith('One week in Yerevan');
  });

  it('starts on a trip that can actually take it', () => {
    // The Armenian trip is first in the list, but Japan is the one on offer.
    storageService.set(STORAGE_KEYS.trips, [
      makeTrip(),
      makeTrip({ id: 'trip_jp', title: 'Tokyo in October', destinationCountry: 'Japan' }),
    ]);

    open('Japan');

    expect(screen.getByLabelText('Trip')).toHaveValue('trip_jp');
  });
});

describe('a trip with no country recorded', () => {
  it('still accepts anything, because nothing can be proven about it', async () => {
    // Trips saved before `destinationCountry` existed carry only a label.
    storageService.set(STORAGE_KEYS.trips, [makeTrip({ destinationCountry: undefined })]);
    const { onAdded } = open('Djibouti');

    await userEvent.click(screen.getByRole('button', { name: 'Add to trip' }));

    expect(onAdded).toHaveBeenCalled();
  });
});

describe('when the browsing country is unknown', () => {
  it('allows every trip, since there is no mismatch to show', () => {
    storageService.set(STORAGE_KEYS.trips, [
      makeTrip(),
      makeTrip({ id: 'trip_jp', title: 'Tokyo in October', destinationCountry: 'Japan' }),
    ]);

    open(null);

    expect(tripOption(/One week in Yerevan/)).not.toBeDisabled();
    expect(tripOption(/Tokyo in October/)).not.toBeDisabled();
  });
});
