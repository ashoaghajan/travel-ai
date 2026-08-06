/**
 * How a party of travellers occupies hotel rooms.
 *
 * Shared because both sides have to agree exactly: the server sends this
 * occupancy to the rate provider, and the client tells the reader what the
 * returned price covers. Two copies of the rule would eventually disagree, and
 * the screen would then describe an occupancy nobody was quoted for.
 */

/**
 * Rooms for a party, and how many adults sleep in each.
 *
 * Two to a room. It is wrong for the party of three who want singles, but it
 * is right far more often, and it is the assumption the booking sites make
 * when they size a search.
 *
 * This is also what makes a room rate different from an airfare: a fare is per
 * passenger, but a room is per room, so two travellers are one double rather
 * than two of anything. Quoted rates bear it out — the same Yerevan room came
 * back at $103.79 for one adult and $115.81 for two, not $207.
 */
export function roomsFor(guests: number): { rooms: number; adultsPerRoom: number } {
  const rooms = Math.max(1, Math.ceil(guests / 2));
  const adultsPerRoom = Math.max(1, Math.ceil(guests / rooms));

  return { rooms, adultsPerRoom };
}

/** "2 travellers in 1 room" / "3 travellers in 2 rooms" */
export function describeOccupancy(guests: number): string {
  const { rooms } = roomsFor(guests);
  const party = Math.max(1, guests);

  return `${party} ${party === 1 ? 'traveller' : 'travellers'} in ${rooms} ${
    rooms === 1 ? 'room' : 'rooms'
  }`;
}
