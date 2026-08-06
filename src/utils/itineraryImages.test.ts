import { describe, expect, it } from 'vitest';
import { coverImage, dayImage } from './itineraryImages';

/**
 * The photographs a generated itinerary gets.
 *
 * These assert relationships rather than filenames — the assets are bundled, so
 * their URLs are hashes that change with the build. What is worth pinning is
 * that a day of museums and a day on the beach do not get the same picture, and
 * that nothing is ever left without one.
 */

describe('dayImage', () => {
  it('reads the day by what it is mostly made of', () => {
    const museums = dayImage(['culture', 'culture', 'food']);
    const beach = dayImage(['relaxation', 'relaxation', 'food']);

    expect(museums).not.toBe(beach);
  });

  it('breaks a tie towards the morning, which sets the day’s tone', () => {
    expect(dayImage(['nature', 'food'])).toBe(dayImage(['nature']));
  });

  it('still returns something for a day with nothing planned', () => {
    expect(dayImage([])).toBeTruthy();
  });
});

describe('coverImage', () => {
  it('leads with the landscape rather than the street', () => {
    // One beach day is what the trip is remembered for, even among museums.
    expect(coverImage(['culture', 'culture', 'relaxation'])).not.toBe(coverImage(['culture']));
  });

  it('treats the outdoors as one look', () => {
    expect(coverImage(['nature'])).toBe(coverImage(['adventure']));
  });

  it('falls back to the city for a trip that is all indoors', () => {
    expect(coverImage(['food', 'culture'])).toBe(coverImage([]));
  });
});
