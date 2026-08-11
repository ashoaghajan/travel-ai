/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as fileTransfer from '../../services/fileTransfer.service';
import type { Trip, TripDraft } from '../../types/trip.types';
import { useTripExport } from './useTripExport';

/**
 * Writing a trip out.
 *
 * The case worth pinning is the unsaved one: the planner offers this on an
 * itinerary that has no row behind it yet, and it has to work, because nothing
 * a file carries comes from the database.
 */

function makeDraft(overrides: Partial<TripDraft> = {}): TripDraft {
  return {
    title: 'One week in Yerevan',
    destination: 'Yerevan',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    coverImage: '',
    itinerary: [],
    ...overrides,
  };
}

describe('useTripExport', () => {
  it('hands the browser a named file', () => {
    const download = vi.spyOn(fileTransfer, 'downloadTextFile').mockImplementation(() => undefined);
    const { result } = renderHook(() => useTripExport());

    const trip: Trip = { ...makeDraft(), id: 'trip_1', createdAt: 'x', updatedAt: 'x' };
    act(() => result.current.exportTrip(trip));

    const [filename, contents] = download.mock.calls[0];
    expect(filename).toBe('one-week-in-yerevan-2027-09-02.trip.json');
    expect(JSON.parse(contents).trip.title).toBe('One week in Yerevan');
    expect(result.current.error).toBeNull();
  });

  it('exports an itinerary that has not been saved yet', () => {
    const download = vi.spyOn(fileTransfer, 'downloadTextFile').mockImplementation(() => undefined);
    const { result } = renderHook(() => useTripExport());

    // Straight off the planner: no id, no timestamps, and none needed.
    act(() => result.current.exportTrip(makeDraft({ title: 'Bali Adventure' })));

    expect(download.mock.calls[0][0]).toBe('bali-adventure-2027-09-02.trip.json');
    expect(JSON.parse(download.mock.calls[0][1]).trip).not.toHaveProperty('id');
  });

  it('says so when the browser refuses the download', () => {
    vi.spyOn(fileTransfer, 'downloadTextFile').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useTripExport());

    act(() => result.current.exportTrip(makeDraft()));

    expect(result.current.error).toMatch(/blocked the download/i);
  });
});
