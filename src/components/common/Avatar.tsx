import { cx } from '../../utils/cx';
import styles from './Avatar.module.css';

export type AvatarProps = {
  /** Used for the accessible name and the initials fallback. */
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Round user avatar with an initials fallback when there is no photo. */
export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  return (
    <span className={cx(styles.avatar, styles[size], className)} title={name}>
      {src ? (
        <img className={styles.image} src={src} alt={name} />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {initialsOf(name)}
        </span>
      )}
      {src ? null : <span className="visually-hidden">{name}</span>}
    </span>
  );
}
