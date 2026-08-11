import { describe, expect, it } from 'vitest';
import type { ApiLobbyPerson } from '@ai-travel/shared';
import { countOnline, groupPeople } from './people.filters';

const PEOPLE: ApiLobbyPerson[] = [
  { id: 'u_zoe', name: 'Zoe' },
  { id: 'u_adam', name: 'Adam' },
  { id: 'u_mia', name: 'Mia' },
];

describe('groupPeople', () => {
  it('puts the people who are here first', () => {
    const roster = groupPeople(PEOPLE, ['u_mia'], null);

    expect(roster.map((person) => person.name)).toEqual(['Mia', 'Adam', 'Zoe']);
  });

  it('sorts alphabetically inside each group', () => {
    const roster = groupPeople(PEOPLE, ['u_zoe', 'u_mia'], null);

    expect(roster.map((person) => person.name)).toEqual(['Mia', 'Zoe', 'Adam']);
  });

  it('marks who is online', () => {
    const roster = groupPeople(PEOPLE, ['u_adam'], null);

    expect(roster.find((person) => person.id === 'u_adam')?.isOnline).toBe(true);
    expect(roster.find((person) => person.id === 'u_zoe')?.isOnline).toBe(false);
  });

  it('marks the reader', () => {
    const roster = groupPeople(PEOPLE, [], 'u_mia');

    expect(roster.filter((person) => person.isSelf).map((p) => p.name)).toEqual(['Mia']);
  });

  it('does not pin the reader to the front', () => {
    // They are in the list so they can see the room sees them; a roster sorted
    // around one member reads as being about them.
    const roster = groupPeople(PEOPLE, ['u_zoe'], 'u_adam');

    expect(roster[0].name).toBe('Zoe');
  });

  it('ignores an online id nobody has a name for', () => {
    // Presence is instant and the directory is a request behind it. A blank
    // row is worse than a row that appears a moment later.
    const roster = groupPeople(PEOPLE, ['u_stranger'], null);

    expect(roster).toHaveLength(3);
    expect(roster.every((person) => !person.isOnline)).toBe(true);
  });

  it('leaves the original list alone', () => {
    const original = [...PEOPLE];
    groupPeople(PEOPLE, ['u_mia'], null);

    expect(PEOPLE).toEqual(original);
  });
});

describe('countOnline', () => {
  it('counts the rows that are here', () => {
    expect(countOnline(groupPeople(PEOPLE, ['u_mia', 'u_zoe'], null))).toBe(2);
  });

  it('counts nobody when the connection is down', () => {
    expect(countOnline(groupPeople(PEOPLE, [], null))).toBe(0);
  });
});
