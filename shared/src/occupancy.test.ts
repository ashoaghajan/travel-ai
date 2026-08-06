import { describe, expect, it } from 'vitest';
import { describeOccupancy, roomsFor } from './occupancy';

/**
 * The rule both sides depend on: the server sends this occupancy to the rate
 * provider, and the client tells the reader what the returned price covers.
 */

describe('roomsFor', () => {
  it('puts two travellers in one room', () => {
    expect(roomsFor(2)).toEqual({ rooms: 1, adultsPerRoom: 2 });
  });

  it('gives a lone traveller a single room', () => {
    expect(roomsFor(1)).toEqual({ rooms: 1, adultsPerRoom: 1 });
  });

  it('rounds an odd party up to a whole room', () => {
    expect(roomsFor(3)).toEqual({ rooms: 2, adultsPerRoom: 2 });
    expect(roomsFor(5)).toEqual({ rooms: 3, adultsPerRoom: 2 });
  });

  it('never asks for zero rooms', () => {
    expect(roomsFor(0).rooms).toBe(1);
  });
});

describe('describeOccupancy', () => {
  it('says who a two-traveller rate covers', () => {
    expect(describeOccupancy(2)).toBe('2 travellers in 1 room');
  });

  it('uses the singular for one of each', () => {
    expect(describeOccupancy(1)).toBe('1 traveller in 1 room');
  });

  it('names the second room once the party needs one', () => {
    expect(describeOccupancy(3)).toBe('3 travellers in 2 rooms');
  });

  // A trip with no party recorded still describes somebody.
  it('never describes a party of none', () => {
    expect(describeOccupancy(0)).toBe('1 traveller in 1 room');
  });
});
