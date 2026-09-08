/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Activity } from '../../../types/travel.types';
import { LocationError, exploreService } from '../../../services/explore.service';
import { ExplorePage } from './ExplorePage';

const COUNTRIES = [
  { code: 'TD', name: 'Chad' },
  { code: 'FR', name: 'France' },
];

const CITIES = ['Abéché', 'Bitkine', 'Moundou'];

const ACTIVITY: Activity = {
  id: 'xid_lake',
  title: 'Lake Fitri',
  category: 'nature',
  description: 'Natural · 2.1 km',
  price: 0,
  rating: 0,
  reviews: 0,
  image: '/photo.jpg',
  source: 'opentripmap',
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ExplorePage />
    </MemoryRouter>,
  );
}

/** Country, then city — the two steps every case below starts with. */
async function chooseChadAndType(user: ReturnType<typeof userEvent.setup>, city: string) {
  // Substring, not exact: the option label carries a flag emoji before the name.
  await screen.findByRole('option', { name: /Chad/ });
  await user.selectOptions(screen.getByLabelText('Country'), 'TD');
  await waitFor(() => expect(screen.getByLabelText('City')).toBeEnabled());
  await user.type(screen.getByLabelText('City'), city);
}

describe('ExplorePage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();

    vi.spyOn(exploreService, 'getCountries').mockResolvedValue(COUNTRIES);
    vi.spyOn(exploreService, 'getCities').mockResolvedValue(CITIES);
    vi.spyOn(exploreService, 'getActivities').mockResolvedValue({
      activities: [ACTIVITY],
      hasMore: false,
      source: 'network',
      fetchedAt: new Date().toISOString(),
    });
  });

  describe('the device’s own location', () => {
    const MOUNDOU = { countryCode: 'TD', countryName: 'Chad', city: 'Moundou' };

    it('is not offered where the browser cannot answer', async () => {
      vi.spyOn(exploreService, 'getLocationPermission').mockResolvedValue('unsupported');
      renderPage();

      await screen.findByRole('option', { name: /Chad/ });

      expect(screen.queryByRole('button', { name: 'Use my location' })).not.toBeInTheDocument();
    });

    it('fills both selectors and explores, when nothing else points them', async () => {
      vi.spyOn(exploreService, 'getLocationPermission').mockResolvedValue('granted');
      vi.spyOn(exploreService, 'getRememberedLocation').mockReturnValue(MOUNDOU);
      renderPage();

      expect(await screen.findByRole('heading', { name: 'Top Activities in Moundou' }))
        .toBeInTheDocument();
      expect(screen.getByText('Near you, in Moundou')).toBeInTheDocument();
      expect(screen.getByLabelText('Country')).toHaveValue('TD');
      expect(screen.getByLabelText('City')).toHaveValue('Moundou');
    });

    it('says where the destination came from, so it does not look typed', async () => {
      vi.spyOn(exploreService, 'getLocationPermission').mockResolvedValue('granted');
      vi.spyOn(exploreService, 'getRememberedLocation').mockReturnValue(MOUNDOU);
      renderPage();

      expect(await screen.findByText('Showing where this device is.')).toBeInTheDocument();
    });

    it('commits the fix as a choice when the button is pressed', async () => {
      const user = userEvent.setup();
      vi.spyOn(exploreService, 'getLocationPermission').mockResolvedValue('prompt');
      const locate = vi.spyOn(exploreService, 'locateDevice').mockResolvedValue(MOUNDOU);
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Use my location' }));

      expect(locate).toHaveBeenCalledWith({ prompt: true });
      expect(await screen.findByLabelText('City')).toHaveValue('Moundou');
      // 'chosen', not 'device' — a press is a statement, so the page stops
      // describing the destination as somewhere the reader merely is.
      expect(screen.queryByText('Showing where this device is.')).not.toBeInTheDocument();
    });

    it('says why, when the reader asked and the device refused', async () => {
      const user = userEvent.setup();
      vi.spyOn(exploreService, 'getLocationPermission').mockResolvedValue('prompt');
      vi.spyOn(exploreService, 'locateDevice').mockRejectedValue(
        new LocationError('denied', 'This device is not sharing its location.'),
      );
      renderPage();

      await user.click(await screen.findByRole('button', { name: 'Use my location' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This device is not sharing its location.',
      );
    });
  });

  it('reopens on the destination last explored, without a press', async () => {
    localStorage.setItem(
      'ai-travel-planner:selectedCountry',
      JSON.stringify({ code: 'TD', name: 'Chad' }),
    );
    localStorage.setItem('ai-travel-planner:selectedCity', JSON.stringify('Moundou'));

    renderPage();

    // A country *and* a city is a settled destination however it was arrived
    // at. Only the draft in the city box is excluded — that is somebody still
    // typing, and this was stored by a press.
    expect(await screen.findByRole('heading', { name: 'Top Activities in Moundou' }))
      .toBeInTheDocument();
  });

  it('waits for a city before spending a search on half a destination', async () => {
    localStorage.setItem(
      'ai-travel-planner:selectedCountry',
      JSON.stringify({ code: 'TD', name: 'Chad' }),
    );

    renderPage();

    expect(await screen.findByText('Choose a city in Chad')).toBeInTheDocument();
    expect(exploreService.getActivities).not.toHaveBeenCalled();
  });

  it('prompts for the city the reader has typed, not the one last committed', async () => {
    const user = userEvent.setup();
    renderPage();

    await chooseChadAndType(user, 'Bitkine');

    expect(screen.queryByText('Choose a city in Chad')).not.toBeInTheDocument();
    expect(screen.getByText('Ready to explore Bitkine')).toBeInTheDocument();
  });

  it('explores on the first press, without a second one', async () => {
    const user = userEvent.setup();
    renderPage();

    await chooseChadAndType(user, 'Bitkine');
    await user.click(screen.getByRole('button', { name: 'Explore' }));

    expect(await screen.findByText('Lake Fitri')).toBeInTheDocument();
    expect(exploreService.getActivities).toHaveBeenCalledTimes(1);
    expect(exploreService.getActivities).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'Bitkine', countryCode: 'TD' }),
    );
  });

  it('clears the typed city when the country is swapped', async () => {
    const user = userEvent.setup();
    renderPage();

    await chooseChadAndType(user, 'Bitkine');
    await user.selectOptions(screen.getByLabelText('Country'), 'FR');

    await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue(''));
    expect(screen.getByText('Choose a city in France')).toBeInTheDocument();
  });
});
