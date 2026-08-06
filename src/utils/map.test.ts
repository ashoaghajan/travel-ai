import { describe, expect, it } from 'vitest';
import type { LatLng } from '../types/trip.types';
import { boundsOf, centroidOf, isDegenerate, isPlottable } from './map';

const UBUD: LatLng = { lat: -8.5069, lng: 115.2625 };
const CANGGU: LatLng = { lat: -8.6478, lng: 115.1385 };

describe('isPlottable', () => {
  it('accepts a real point', () => {
    expect(isPlottable(UBUD)).toBe(true);
  });

  it('accepts the origin', () => {
    expect(isPlottable({ lat: 0, lng: 0 })).toBe(true);
  });

  it('rejects nothing at all', () => {
    expect(isPlottable(undefined)).toBe(false);
  });

  it.each([
    ['NaN latitude', { lat: Number.NaN, lng: 0 }],
    ['NaN longitude', { lat: 0, lng: Number.NaN }],
    ['infinite latitude', { lat: Number.POSITIVE_INFINITY, lng: 0 }],
    ['latitude past the pole', { lat: 91, lng: 0 }],
    ['longitude past the antimeridian', { lat: 0, lng: 181 }],
  ])('rejects %s', (_label, point) => {
    expect(isPlottable(point)).toBe(false);
  });

  it('accepts the extremes themselves', () => {
    expect(isPlottable({ lat: -90, lng: 180 })).toBe(true);
  });
});

describe('centroidOf', () => {
  it('is undefined for no points', () => {
    expect(centroidOf([])).toBeUndefined();
  });

  it('is the point itself for one', () => {
    expect(centroidOf([UBUD])).toEqual(UBUD);
  });

  it('averages several', () => {
    expect(centroidOf([{ lat: 0, lng: 0 }, { lat: 10, lng: 20 }])).toEqual({ lat: 5, lng: 10 });
  });

  it('handles southern and western hemispheres', () => {
    const centre = centroidOf([UBUD, CANGGU]);

    expect(centre?.lat).toBeCloseTo(-8.57735, 4);
    expect(centre?.lng).toBeCloseTo(115.2005, 4);
  });

  // One unusable point would otherwise drag the average into the sea.
  it('skips points it cannot plot', () => {
    expect(centroidOf([UBUD, undefined, { lat: Number.NaN, lng: 5 }])).toEqual(UBUD);
  });

  it('is undefined when nothing is plottable', () => {
    expect(centroidOf([undefined, { lat: 999, lng: 999 }])).toBeUndefined();
  });
});

describe('boundsOf', () => {
  it('is null for no points', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('is null when nothing is plottable', () => {
    expect(boundsOf([undefined])).toBeNull();
  });

  it('collapses to a single point', () => {
    expect(boundsOf([UBUD])).toEqual([
      [UBUD.lat, UBUD.lng],
      [UBUD.lat, UBUD.lng],
    ]);
  });

  it('returns south-west then north-east', () => {
    expect(
      boundsOf([
        { lat: 10, lng: 40 },
        { lat: -5, lng: 20 },
        { lat: 3, lng: 60 },
      ]),
    ).toEqual([
      [-5, 20],
      [10, 60],
    ]);
  });

  it('ignores unplottable points when measuring', () => {
    expect(boundsOf([UBUD, { lat: 500, lng: 500 }])).toEqual([
      [UBUD.lat, UBUD.lng],
      [UBUD.lat, UBUD.lng],
    ]);
  });
});

describe('isDegenerate', () => {
  it('is true for a single point', () => {
    expect(isDegenerate(boundsOf([UBUD]) as [[number, number], [number, number]])).toBe(true);
  });

  it('is true for points a few metres apart', () => {
    expect(
      isDegenerate([
        [-8.5069, 115.2625],
        [-8.5071, 115.2627],
      ]),
    ).toBe(true);
  });

  it('is false for two towns', () => {
    expect(
      isDegenerate([
        [CANGGU.lat, CANGGU.lng],
        [UBUD.lat, UBUD.lng],
      ]),
    ).toBe(false);
  });

  it('respects a supplied epsilon', () => {
    const bounds: [[number, number], [number, number]] = [
      [0, 0],
      [0.01, 0.01],
    ];

    expect(isDegenerate(bounds)).toBe(false);
    expect(isDegenerate(bounds, 0.5)).toBe(true);
  });

  // Latitude close but longitude far apart is still a real spread.
  it('needs both axes to be small', () => {
    expect(
      isDegenerate([
        [0, 0],
        [0.001, 30],
      ]),
    ).toBe(false);
  });
});
