import { describe, expect, it } from 'vitest';
import { formatDuration, formatStops } from './duration';

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(1725)).toBe('28h 45m');
  });

  it('drops the minutes on the hour', () => {
    expect(formatDuration(720)).toBe('12h');
  });

  it('handles under an hour', () => {
    expect(formatDuration(45)).toBe('45m');
  });

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('matches every mock flight duration string', async () => {
    const { MOCK_FLIGHTS } = await import('../mock/flights');

    for (const flight of MOCK_FLIGHTS) {
      expect(flight.duration).toBe(formatDuration(flight.durationMinutes));
    }
  });
});

describe('formatStops', () => {
  it.each([
    [0, 'Direct'],
    [1, '1 stop'],
    [2, '2 stops'],
    [3, '3 stops'],
  ])('%i → %s', (stops, expected) => {
    expect(formatStops(stops)).toBe(expected);
  });
});
