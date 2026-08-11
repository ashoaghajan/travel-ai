/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExchangeRates } from '@ai-travel/shared';
import type { ItineraryDay } from '../../../types/trip.types';
import { STORAGE_KEYS, storageService } from '../../../services/localStorage.service';
import { ratesService } from '../../../services/rates.service';
import { settingsService } from '../../../services/settings.service';
import { resetCurrencyStore, setDisplayCurrency } from '../../../store/currency.store';
import { ItineraryTimeline } from './ItineraryTimeline';

/**
 * The prices on a timeline row belong to the same currency preference as every
 * other price on the trip screen — the picker sits directly above them.
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

beforeEach(() => {
  vi.spyOn(settingsService, 'save').mockImplementation(async (patch) =>
    settingsService.adopt({ ...settingsService.getSettings(), ...patch }),
  );
  storageService.remove(STORAGE_KEYS.settings);
  storageService.remove(STORAGE_KEYS.exchangeRates);
  resetCurrencyStore();
  vi.spyOn(ratesService, 'readSync').mockReturnValue(null);
  vi.spyOn(ratesService, 'load').mockResolvedValue(RATES);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetCurrencyStore();
});

function days(): ItineraryDay[] {
  return [
    {
      id: 'day_1',
      dayNumber: 1,
      date: '2027-10-02',
      destination: 'Yerevan',
      summary: 'Old town on foot',
      activities: [
        {
          id: 'act_1',
          time: '10:00',
          title: 'Cascade complex',
          description: 'Steps, sculpture and the view from the top',
          category: 'culture',
          priceEstimate: 15,
        },
      ],
    },
  ];
}

describe('ItineraryTimeline', () => {
  it('shows activity estimates in the chosen currency', async () => {
    render(<ItineraryTimeline days={days()} />);

    expect(screen.getByText('$15')).toBeInTheDocument();

    act(() => setDisplayCurrency('AMD'));

    await waitFor(() => expect(screen.getByText('֏5,491')).toBeInTheDocument());
  });
});
