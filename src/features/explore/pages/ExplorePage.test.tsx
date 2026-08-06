/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Activity } from '../../../types/travel.types';
import { exploreService } from '../../../services/explore.service';
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
