import type { ApiLobbyPerson } from '@ai-travel/shared';

/**
 * The roster, in the order it reads best.
 *
 * Pure, and in its own file for the reason the other `*.filters.ts` modules
 * are: ordering rules are the part worth asserting directly, and a test that
 * has to render a panel to check that online people come first is testing the
 * wrong thing.
 */

export type LobbyPerson = ApiLobbyPerson & {
  isOnline: boolean;
  /** The reader themselves, whose row says "(you)". */
  isSelf: boolean;
};

/**
 * Online first, then alphabetical inside each group.
 *
 * The reader is not pinned to the front. They are in the list because seeing
 * your own name is how you know the room can see it too, but a room sorted
 * around one member reads as being about them — and on a roster this short,
 * finding yourself is not a problem that needs solving.
 *
 * `onlineIds` may name somebody `people` does not: presence is instant and the
 * directory is a request behind it. Those are dropped rather than shown as a
 * blank row — a name arrives a moment later and the row appears then.
 */
export function groupPeople(
  people: ApiLobbyPerson[],
  onlineIds: string[],
  selfId?: string | null,
): LobbyPerson[] {
  const online = new Set(onlineIds);

  return people
    .map((person) => ({
      ...person,
      isOnline: online.has(person.id),
      isSelf: person.id === selfId,
    }))
    .sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;

      return a.name.localeCompare(b.name);
    });
}

/**
 * How many of the roster are here now.
 *
 * Counted from the people who have names rather than from `onlineIds`, so the
 * number never disagrees with the rows underneath it.
 */
export function countOnline(people: LobbyPerson[]): number {
  return people.filter((person) => person.isOnline).length;
}
