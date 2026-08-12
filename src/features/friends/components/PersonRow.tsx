import type { ReactNode } from 'react';
import { Avatar } from '../../../components/common/Avatar';
import styles from './PersonRow.module.css';

export type PersonRowProps = {
  name: string;
  /** Where the reader stands, in words. "Friends", "You asked", "Wants to be friends". */
  standing?: string;
  /** The buttons for this row. */
  children?: ReactNode;
};

/**
 * One person, on any of this page's three lists.
 *
 * Shared because the three lists differ only in their verbs: the same face, the
 * same name, and a different thing to press. Three components would have been
 * three chances for the rows to stop looking alike.
 *
 * **The standing is written out, not left to the button.** "Add" and "Cancel"
 * describe what pressing does; they do not say where the reader already
 * stands, and a screen about relationships should be readable without inferring
 * one from a verb.
 */
export function PersonRow({ name, standing, children }: PersonRowProps) {
  return (
    <li className={styles.row}>
      {/* Decorative: `Avatar` carries the name as a hidden label and the visible
          name is right beside it. */}
      <span aria-hidden="true">
        <Avatar name={name} size="sm" />
      </span>

      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {standing ? <span className={styles.standing}>{standing}</span> : null}
      </span>

      {children ? <span className={styles.actions}>{children}</span> : null}
    </li>
  );
}
