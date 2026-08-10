/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ExchangeRates } from '@ai-travel/shared';
import type { Activity } from '../../types/travel.types';
import { STORAGE_KEYS, storageService } from '../../services/localStorage.service';
import { ratesService } from '../../services/rates.service';
import { resetCurrencyStore } from '../../store/currency.store';
import { ActivityCard } from '../cards/ActivityCard';
import { CurrencySelect } from './CurrencySelect';
import { settingsService } from '../../services/settings.service';

/**
 * The picker, wired to a real priced card.
 *
 * The store has its own suite; this one exists because the thing that would
 * actually break in front of a reader is the join between them — a card that
 * formats through a stale closure, or a picker that writes a preference no
 * rendered price is listening to. Rendering both together is the only way to
 * catch either.
 */

const RATES: ExchangeRates = {
  base: 'USD',
  rates: {
    USD: 1,
    EUR: 0.865507,
    GBP: 0.741549,
    AED: 3.6725,
    AMD: 366.050039,
    JPY: 157.880961,
    CHF: 0.79,
    CAD: 1.37,
    AUD: 1.51,
  },
  updatedAt: '2026-08-10T00:02:31.000Z',
  isStale: false,
};

const activity: Activity = {
  id: 'a1',
  title: 'Neues Museum',
  category: 'culture',
  description: 'Nefertiti’s bust and the Egyptian collection.',
  price: 16,
  rating: 0,
  reviews: 0,
  image: '/museum.jpg',
};

function renderPricedScreen() {
  return render(
    <MemoryRouter>
      <CurrencySelect />
      <ActivityCard activity={activity} />
    </MemoryRouter>,
  );
}

/**
 * The settings round trip, without a server.
 *
 * `setDisplayCurrency` writes through the API now and refreshes the cache from
 * the response — so an unstubbed switch fails the request and the currency
 * never changes. This stands in for the server agreeing.
 */
function settingsSaveSucceeds() {
  vi.spyOn(settingsService, 'save').mockImplementation(async (patch) =>
    settingsService.adopt({ ...settingsService.getSettings(), ...patch }),
  );
}

beforeEach(() => {
  settingsSaveSucceeds();
  storageService.remove(STORAGE_KEYS.settings);
  storageService.remove(STORAGE_KEYS.exchangeRates);
  vi.spyOn(ratesService, 'readSync').mockReturnValue(RATES);
  vi.spyOn(ratesService, 'load').mockResolvedValue(RATES);
  resetCurrencyStore();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetCurrencyStore();
});

describe('CurrencySelect', () => {
  it('offers the currencies by code and name', () => {
    renderPricedScreen();

    const picker = screen.getByLabelText('Currency');

    expect(picker).toHaveValue('USD');
    expect(screen.getByRole('option', { name: 'AMD · Armenian Dram' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'AED · UAE Dirham' })).toBeInTheDocument();
  });

  it('reprices a card that is already on screen', async () => {
    const user = userEvent.setup();
    renderPricedScreen();

    expect(screen.getByText('$16')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Currency'), 'AMD');

    // The whole feature, in one assertion: a price rendered before the switch
    // follows it without a reload.
    await waitFor(() => expect(screen.getByText('֏5,857')).toBeInTheDocument());
    expect(screen.queryByText('$16')).not.toBeInTheDocument();
  });

  it('remembers the choice for the next visit', async () => {
    const user = userEvent.setup();
    const first = renderPricedScreen();

    await user.selectOptions(screen.getByLabelText('Currency'), 'AED');
    await waitFor(() => expect(screen.getByLabelText('Currency')).toHaveValue('AED'));
    first.unmount();

    resetCurrencyStore();
    renderPricedScreen();

    expect(screen.getByLabelText('Currency')).toHaveValue('AED');
    expect(screen.getByText('AED 59')).toBeInTheDocument();
  });
});
