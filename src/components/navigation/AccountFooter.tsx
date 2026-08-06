import { useCurrentUser } from '../../hooks/useCurrentUser';
import { Avatar } from '../common/Avatar';
import styles from './AccountFooter.module.css';

/**
 * Who is signed in.
 *
 * Identity only — sign-out moved to the avatar menu in the page header, so
 * this no longer keeps a rare, session-ending action permanently on screen
 * next to the navigation. See `AccountMenu`.
 */
export function AccountFooter() {
  const { user } = useCurrentUser();

  if (!user) return null;

  return (
    <div className={styles.account}>
      <Avatar name={user.name} size="sm" />

      <div className={styles.identity}>
        <p className={styles.name}>{user.name}</p>
        <p className={styles.email}>{user.email}</p>
      </div>
    </div>
  );
}
