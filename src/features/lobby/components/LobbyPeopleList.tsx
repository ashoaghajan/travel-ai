import type { ApiLobbyPerson } from '@ai-travel/shared';
import { Avatar } from '../../../components/common/Avatar';
import styles from './LobbyPeopleList.module.css';

export type LobbyPeopleListProps = {
  people: ApiLobbyPerson[];
  /** The reader, so their own row can say so. */
  selfId?: string;
};

/**
 * Who is in the room.
 *
 * Names and nothing else — no email, because this is a list every account can
 * read and `ApiLobbyPerson` exists precisely so an address cannot arrive here
 * by accident.
 *
 * There is no live badge yet: that is the presence milestone. Until then this
 * is "people who have spoken", which is honest about what it knows.
 */
export function LobbyPeopleList({ people, selfId }: LobbyPeopleListProps) {
  if (people.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <h3 className={styles.heading}>
        {people.length} {people.length === 1 ? 'person' : 'people'}
      </h3>

      <ul className={styles.list}>
        {people.map((person) => (
          <li key={person.id} className={styles.person}>
            {/* Decorative here: `Avatar` carries the name as a hidden label so
                it can stand alone elsewhere, and the visible name is right
                beside it — without this a screen reader says it twice. */}
            <span aria-hidden="true">
              <Avatar name={person.name} size="sm" />
            </span>
            <span className={styles.name}>
              {person.name}
              {person.id === selfId ? <span className={styles.you}> (you)</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
