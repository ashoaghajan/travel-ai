import type { ApiLobbyPerson } from '@ai-travel/shared';
import { Avatar } from '../../../components/common/Avatar';
import { countOnline, groupPeople } from '../people.filters';
import { PresenceDot } from './PresenceDot';
import styles from './LobbyPeopleList.module.css';

export type LobbyPeopleListProps = {
  people: ApiLobbyPerson[];
  /** Account ids in the presence set right now. */
  onlineIds?: string[];
  /** The reader, so their own row can say so. */
  selfId?: string;
};

/**
 * Who is in the room, and which of them are here now.
 *
 * Names and nothing else — no email, because this is a list every account can
 * read and `ApiLobbyPerson` exists precisely so an address cannot arrive here
 * by accident.
 *
 * The heading counts both, because they answer different questions and the
 * difference is the interesting part: "3 of 11 here" says the room has eleven
 * regulars and three of them are around. When nobody is connected — no Ably
 * key, a dropped socket — it falls back to the plain total rather than
 * announcing that zero people are here, which would read as a fault.
 */
export function LobbyPeopleList({ people, onlineIds = [], selfId }: LobbyPeopleListProps) {
  if (people.length === 0) return null;

  const roster = groupPeople(people, onlineIds, selfId);
  const here = countOnline(roster);

  return (
    <div className={styles.wrap}>
      <h3 className={styles.heading}>
        {here > 0
          ? `${here} of ${roster.length} here`
          : `${roster.length} ${roster.length === 1 ? 'person' : 'people'}`}
      </h3>

      <ul className={styles.list}>
        {roster.map((person) => (
          <li key={person.id} className={styles.person}>
            {/* The avatar is decorative — `Avatar` carries the name as a hidden
                label so it can stand alone elsewhere, and the visible name is
                right beside it. The dot is not decorative, and lives outside
                the `aria-hidden` for that reason: it says something the name
                does not. */}
            <PresenceDot isOnline={person.isOnline}>
              <span aria-hidden="true">
                <Avatar name={person.name} size="sm" />
              </span>
            </PresenceDot>

            <span className={styles.name}>
              {person.name}
              {person.isSelf ? <span className={styles.you}> (you)</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
