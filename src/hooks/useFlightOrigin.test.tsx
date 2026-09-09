/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentCityAirportService } from '../services/currentCityAirport.service';
import type { Airport } from '../types/travel.types';
import { useFlightOrigin } from './useFlightOrigin';

const AIRPORT: Airport = { code: 'EVN', city: 'Yerevan', name: 'Zvartnots', countryCode: 'AM' };
let finish: (airport: Airport | null) => void;

beforeEach(() => {
  vi.spyOn(currentCityAirportService, 'locate').mockImplementation(
    () => new Promise((resolve) => { finish = resolve; }),
  );
});

describe('useFlightOrigin', () => {
  it('replaces a stale default and updates the booking search', async () => {
    const onDefaulted = vi.fn();
    const { result } = renderHook(() => useFlightOrigin('JFK', true, onDefaulted));
    await act(async () => finish(AIRPORT));
    expect(result.current.from).toBe('EVN');
    expect(onDefaulted).toHaveBeenCalledWith('EVN');
  });

  it.each(['focus', 'change'] as const)('preserves manual %s before location finishes', async (action) => {
    const onDefaulted = vi.fn();
    const { result } = renderHook(() => useFlightOrigin('JFK', true, onDefaulted));
    act(() => {
      if (action === 'focus') result.current.keepOrigin();
      else result.current.changeFrom('LHR');
    });
    await act(async () => finish(AIRPORT));
    expect(result.current.from).toBe(action === 'focus' ? 'JFK' : 'LHR');
    expect(onDefaulted).not.toHaveBeenCalled();
  });

  it('keeps the fallback if permission is denied or no airport is found', async () => {
    const { result } = renderHook(() => useFlightOrigin('JFK', true));
    await act(async () => finish(null));
    expect(result.current.from).toBe('JFK');
  });

  it('does not locate for forms that have not enabled the default', () => {
    renderHook(() => useFlightOrigin('JFK', false));
    expect(currentCityAirportService.locate).not.toHaveBeenCalled();
  });

  it('ignores results from an unmounted form', async () => {
    const onDefaulted = vi.fn();
    const { unmount } = renderHook(() => useFlightOrigin('JFK', true, onDefaulted));
    const signal = vi.mocked(currentCityAirportService.locate).mock.calls[0][0];
    unmount();
    await act(async () => finish(AIRPORT));
    expect(signal?.aborted).toBe(true);
    expect(onDefaulted).not.toHaveBeenCalled();
  });

  it('does not locate again after the parent applies the new origin', async () => {
    const onDefaulted = vi.fn();
    const { result, rerender } = renderHook(
      ({ from }) => useFlightOrigin(from, true, onDefaulted),
      { initialProps: { from: 'JFK' } },
    );
    await act(async () => finish(AIRPORT));
    rerender({ from: 'EVN' });
    await waitFor(() => expect(result.current.from).toBe('EVN'));
    expect(currentCityAirportService.locate).toHaveBeenCalledTimes(1);
  });
});
