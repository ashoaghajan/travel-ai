/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Activity } from '../../types/travel.types';
import { activityService } from '../../services/activity.service';
import { countryService } from '../../services/country.service';
import { MissingApiKeyError } from '../../services/opentripmap.service';
import { useAttractionSearch } from './useAttractionSearch';

const COUNTRIES = [
  { name: 'Armenia', code: 'AM' },
  { name: 'Indonesia', code: 'ID' },
];

function activity(id: string): Activity {
  return {
    id,
    title: id,
    category: 'culture',
    description: 'Monuments · 0.8 km from centre',
    price: 0,
    rating: 0,
    reviews: 0,
    image: '/photo.jpg',
  };
}

function result(activities: Activity[], warning?: string) {
  return {
    activities,
    hasMore: false,
    source: 'network' as const,
    fetchedAt: '2027-01-01T00:00:00.000Z',
    warning,
  };
}

beforeEach(() => {
  vi.spyOn(countryService, 'getCountries').mockResolvedValue(COUNTRIES);
  vi.spyOn(activityService, 'getActivities').mockResolvedValue(result([activity('cascade')]));
});

describe('useAttractionSearch', () => {
  it('searches the destination once the country list has resolved its code', async () => {
    const { result: hook } = renderHook(() =>
      useAttractionSearch({ destination: 'Yerevan', countryName: 'Armenia' }),
    );

    await waitFor(() => {
      expect(hook.current.isLoading).toBe(false);
    });

    expect(activityService.getActivities).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'Yerevan', countryCode: 'AM' }),
    );
    expect(hook.current.activities).toHaveLength(1);
  });

  it('asks for the whole pool, so the filter can see all of it', async () => {
    const { result: hook } = renderHook(() =>
      useAttractionSearch({ destination: 'Yerevan', countryName: 'Armenia' }),
    );

    await waitFor(() => {
      expect(hook.current.isLoading).toBe(false);
    });

    expect(activityService.getActivities).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 200 }),
    );
  });

  it('still searches when the country list fails, just without a code', async () => {
    vi.spyOn(countryService, 'getCountries').mockRejectedValue(new Error('offline'));

    const { result: hook } = renderHook(() =>
      useAttractionSearch({ destination: 'Yerevan', countryName: 'Armenia' }),
    );

    await waitFor(() => {
      expect(hook.current.isLoading).toBe(false);
    });

    expect(activityService.getActivities).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'Yerevan', countryCode: undefined }),
    );
  });

  it('does not search a day that names nowhere', async () => {
    const { result: hook } = renderHook(() =>
      useAttractionSearch({ destination: '   ', countryName: null }),
    );

    await waitFor(() => {
      expect(hook.current.isLoading).toBe(false);
    });

    expect(activityService.getActivities).not.toHaveBeenCalled();
  });

  // A stale copy is still a usable list — it must not be reported as a failure.
  it('reports a stale copy as a warning, keeping the results', async () => {
    vi.spyOn(activityService, 'getActivities').mockResolvedValue(
      result([activity('cascade')], 'Showing the last saved copy.'),
    );

    const { result: hook } = renderHook(() =>
      useAttractionSearch({ destination: 'Yerevan', countryName: 'Armenia' }),
    );

    await waitFor(() => {
      expect(hook.current.isLoading).toBe(false);
    });

    expect(hook.current.warning).toBe('Showing the last saved copy.');
    expect(hook.current.error).toBeNull();
    expect(hook.current.activities).toHaveLength(1);
  });

  it('reports a missing API key as an error, with nothing to show', async () => {
    vi.spyOn(activityService, 'getActivities').mockRejectedValue(new MissingApiKeyError());

    const { result: hook } = renderHook(() =>
      useAttractionSearch({ destination: 'Yerevan', countryName: 'Armenia' }),
    );

    await waitFor(() => {
      expect(hook.current.isLoading).toBe(false);
    });

    // Names the server, not a file the reader could edit — the key moved out
    // of the bundle and there is nothing on their side to fix.
    expect(hook.current.error).toContain('server has no OpenTripMap key');
    expect(hook.current.activities).toEqual([]);
  });

  it('drops a response a newer search has superseded', async () => {
    const slow = result([activity('stale')]);
    const fast = result([activity('fresh')]);

    vi.spyOn(activityService, 'getActivities')
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(slow), 30)),
      )
      .mockResolvedValueOnce(fast);

    const { result: hook } = renderHook(() =>
      useAttractionSearch({ destination: 'Yerevan', countryName: 'Armenia' }),
    );

    // Supersede the opening search before it lands.
    await waitFor(() => {
      expect(activityService.getActivities).toHaveBeenCalledTimes(1);
    });
    hook.current.search('Gyumri', 'AM');

    await waitFor(() => {
      expect(hook.current.activities).toEqual([activity('fresh')]);
    });

    // Give the superseded response time to arrive and be ignored.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hook.current.activities).toEqual([activity('fresh')]);
  });
});
