/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Activity } from '../../../types/travel.types';
import type { ItineraryDay } from '../../../types/trip.types';
import { activityService } from '../../../services/activity.service';
import { countryService } from '../../../services/country.service';
import { MissingApiKeyError } from '../../../services/opentripmap.service';
import { AttractionPickerDialog } from './AttractionPickerDialog';

// jsdom does not implement the native dialog methods. The `open` attribute is
// not decoration here: without it the dialog's contents stay out of the
// accessibility tree and every query below misses.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
  });
});

function activity(id: string, title: string, description = 'Monuments · 0.8 km'): Activity {
  return {
    id,
    title,
    category: 'culture',
    description,
    price: 0,
    rating: 0,
    reviews: 0,
    image: '/photo.jpg',
  };
}

const POOL = [
  activity('xid_cascade', 'Cascade Complex'),
  activity('xid_republic', 'Republic Square'),
  activity('xid_aqua', 'Aquaworld', 'Water parks · 4.4 km'),
];

function makeDay(overrides: Partial<ItineraryDay> = {}): ItineraryDay {
  return {
    id: 'day-1',
    dayNumber: 1,
    date: '2027-09-03',
    destination: 'Yerevan',
    summary: '',
    activities: [],
    ...overrides,
  };
}

function renderDialog(props: Partial<Parameters<typeof AttractionPickerDialog>[0]> = {}) {
  const onPick = vi.fn();
  const onAddBlank = vi.fn();
  const onClose = vi.fn();

  render(
    <AttractionPickerDialog
      day={makeDay()}
      countryName="Armenia"
      fallbackDestination="Armenia"
      onPick={onPick}
      onAddBlank={onAddBlank}
      onClose={onClose}
      {...props}
    />,
  );

  return { onPick, onAddBlank, onClose };
}

beforeEach(() => {
  vi.spyOn(countryService, 'getCountries').mockResolvedValue([{ name: 'Armenia', code: 'AM' }]);
  vi.spyOn(activityService, 'getActivities').mockResolvedValue({
    activities: POOL,
    hasMore: false,
    source: 'network',
    fetchedAt: '2027-01-01T00:00:00.000Z',
  });
});

describe('AttractionPickerDialog', () => {
  it('adds the selected attraction at the chosen time', async () => {
    const user = userEvent.setup();
    const { onPick, onClose } = renderDialog();

    await screen.findByLabelText(/Cascade Complex/);
    await user.click(screen.getByRole('radio', { name: /Cascade Complex/ }));
    await user.clear(screen.getByLabelText('Time'));
    await user.type(screen.getByLabelText('Time'), '09:30');
    await user.click(screen.getByRole('button', { name: 'Add to day' }));

    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'xid_cascade' }),
      '09:30',
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('cannot add until something is selected', async () => {
    renderDialog();

    await screen.findByLabelText(/Cascade Complex/);
    expect(screen.getByRole('button', { name: 'Add to day' })).toBeDisabled();
  });

  it('narrows the list as you filter', async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByLabelText(/Cascade Complex/);
    await user.type(screen.getByLabelText('Filter these attractions'), 'water');

    expect(screen.getByRole('radio', { name: /Aquaworld/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Cascade Complex/ })).not.toBeInTheDocument();
  });

  it('refuses an attraction already on the day', async () => {
    renderDialog({
      day: makeDay({
        activities: [
          {
            id: 'act-1',
            time: '12:00',
            title: 'Cascade Complex',
            description: '',
            category: 'culture',
            sourceActivityId: 'xid_cascade',
          },
        ],
      }),
    });

    const option = await screen.findByRole('radio', { name: /Cascade Complex/ });

    expect(option).toBeDisabled();
    expect(screen.getByText('Already on this day')).toBeInTheDocument();
  });

  it('falls through to a blank row on "Add my own"', async () => {
    const user = userEvent.setup();
    const { onAddBlank, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Add my own' }));

    expect(onAddBlank).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a stale copy as a status, not an alert', async () => {
    vi.spyOn(activityService, 'getActivities').mockResolvedValue({
      activities: POOL,
      hasMore: false,
      source: 'stale-cache',
      fetchedAt: '2027-01-01T00:00:00.000Z',
      warning: 'Showing the last saved copy.',
    });

    renderDialog();

    expect(await screen.findByText('Showing the last saved copy.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Cascade Complex/ })).toBeInTheDocument();
  });

  // Without a key the list never arrives — the escape hatch has to survive.
  it('keeps "Add my own" usable when the lookup fails', async () => {
    vi.spyOn(activityService, 'getActivities').mockRejectedValue(new MissingApiKeyError());

    const user = userEvent.setup();
    const { onAddBlank } = renderDialog();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    const escape = screen.getByRole('button', { name: 'Add my own' });
    expect(escape).toBeEnabled();

    await user.click(escape);
    expect(onAddBlank).toHaveBeenCalled();
  });
});
