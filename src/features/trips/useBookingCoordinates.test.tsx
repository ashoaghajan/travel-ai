/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Booking } from '../../types/booking.types';
import { geocodeService } from '../../services/geocode.service';
import { countryService } from '../../services/country.service';
import { useBookingCoordinates } from './useBookingCoordinates';

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    tripId: 'trip_1',
    kind: 'hotel',
    status: 'booked',
    title: 'Hotel Indigo',
    date: '2027-05-20',
    reference: '',
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(countryService, 'getCountries').mockResolvedValue([
    { code: 'AM', name: 'Armenia' },
  ]);
});

describe('useBookingCoordinates', () => {
  it('uses the point an attraction already carries, with no lookup', async () => {
    const locateAll = vi.spyOn(geocodeService, 'locateAll');
    const booking = makeBooking({
      kind: 'activity',
      title: 'Cascade Complex',
      source: {
        provider: 'opentripmap',
        resultId: 'a1',
        coordinates: { lat: 40.19, lng: 44.51 },
        capturedAt: 'x',
      },
    });

    const { result } = renderHook(() => useBookingCoordinates([booking], 'Armenia', 'Yerevan'));

    expect(result.current.located).toEqual([
      { id: 'b1', label: 'Cascade Complex', kind: 'activity', coordinates: { lat: 40.19, lng: 44.51 } },
    ]);
    // OpenTripMap already knew where it was.
    expect(locateAll).not.toHaveBeenCalled();
  });

  it('geocodes a hotel, which never carries coordinates of its own', async () => {
    const locateAll = vi
      .spyOn(geocodeService, 'locateAll')
      .mockResolvedValue(
        new Map([['Hotel Indigo Yerevan', { lat: 40.18, lng: 44.51, name: 'Hotel Indigo' }]]),
      );

    const { result } = renderHook(() => useBookingCoordinates([makeBooking()], 'Armenia', 'Yerevan'));

    await waitFor(() => expect(result.current.located).toHaveLength(1));
    expect(result.current.located[0].coordinates).toEqual({ lat: 40.18, lng: 44.51 });

    /*
     * Waited for, not asserted once: the effect runs first with no country
     * code and again when `getCountries` resolves one, so the call this cares
     * about is the second. Asserting immediately races that resolution.
     */
    // The city narrows it — "Hotel Indigo" alone matches a chain, not a building.
    await waitFor(() =>
      expect(locateAll).toHaveBeenCalledWith(['Hotel Indigo Yerevan'], 'AM'),
    );
  });

  it('does not repeat the city when the name already carries it', async () => {
    const locateAll = vi.spyOn(geocodeService, 'locateAll').mockResolvedValue(new Map());
    renderHook(() =>
      useBookingCoordinates([makeBooking({ title: 'Yerevan Grand Hotel' })], 'Armenia', 'Yerevan'),
    );

    // See the note above on why this waits rather than asserting once.
    await waitFor(() => expect(locateAll).toHaveBeenCalledWith(['Yerevan Grand Hotel'], 'AM'));
  });

  it('reports what could not be placed rather than dropping it', async () => {
    vi.spyOn(geocodeService, 'locateAll').mockResolvedValue(
      new Map([['Nowhere Inn Yerevan', null]]),
    );

    const { result } = renderHook(() =>
      useBookingCoordinates([makeBooking({ title: 'Nowhere Inn' })], 'Armenia', 'Yerevan'),
    );

    await waitFor(() => expect(result.current.unlocated).toHaveLength(1));
    expect(result.current.located).toEqual([]);
    expect(result.current.unlocated[0].title).toBe('Nowhere Inn');
  });

  it('leaves flights off the map — a fare is a route, not one pin', () => {
    const locateAll = vi.spyOn(geocodeService, 'locateAll');
    const { result } = renderHook(() =>
      useBookingCoordinates(
        [makeBooking({ kind: 'flight', title: 'Air Arabia · AUH → EVN' })],
        'Armenia',
        'Yerevan',
      ),
    );

    expect(result.current.located).toEqual([]);
    expect(result.current.unlocated).toEqual([]);
    expect(locateAll).not.toHaveBeenCalled();
  });

  it('ignores a booking with no name to look up', () => {
    const locateAll = vi.spyOn(geocodeService, 'locateAll');
    const { result } = renderHook(() =>
      useBookingCoordinates([makeBooking({ title: '   ' })], 'Armenia', 'Yerevan'),
    );

    expect(result.current.located).toEqual([]);
    expect(locateAll).not.toHaveBeenCalled();
  });

  it('still geocodes without a country, losing only the disambiguation', async () => {
    const locateAll = vi.spyOn(geocodeService, 'locateAll').mockResolvedValue(new Map());
    renderHook(() => useBookingCoordinates([makeBooking()], null, 'Yerevan'));

    await waitFor(() => expect(locateAll).toHaveBeenCalled());
    expect(locateAll).toHaveBeenCalledWith(['Hotel Indigo Yerevan'], undefined);
  });

  it('survives the geocoder failing', async () => {
    vi.spyOn(geocodeService, 'locateAll').mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useBookingCoordinates([makeBooking()], 'Armenia', 'Yerevan'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.unlocated).toHaveLength(1);
  });
});
