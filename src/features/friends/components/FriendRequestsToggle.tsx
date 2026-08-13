import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { Avatar } from '../../../components/common/Avatar';
import { Button } from '../../../components/common/Button';
import { IconButton } from '../../../components/common/IconButton';
import { UsersIcon } from '../../../components/common/icons';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useFriendRequests } from '../../../store/friend.store';
import { useFriendActions } from '../useFriendActions';
import styles from './FriendRequestsToggle.module.css';

/**
 * Friend requests, answerable from wherever the reader happens to be.
 *
 * They used to live only on `/friends`, which meant somebody had to go and
 * look — and nobody goes and looks. This is the same claim the messages toggle
 * makes from the same corner: something is waiting for you, and it can be dealt
 * with here.
 *
 * **Rendered only when something is waiting.** A permanent third icon in the
 * header would be clutter on every screen for the sake of a state most accounts
 * are in most of the time; a mark that appears when there is news and vanishes
 * when there is none says more by being absent.
 *
 * Answering takes two presses at most, because that is the whole interaction:
 * accept, or decline. Anything more belongs on the page this links to.
 */
export function FriendRequestsToggle() {
  const { isAuthenticated } = useCurrentUser();
  const requests = useFriendRequests();
  const actions = useFriendActions();

  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const incoming = requests.incoming;

  // A click anywhere else is a dismissal, as everywhere else here.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  // Answering the last one closes it: an empty popover hanging open is a
  // question about nothing.
  useEffect(() => {
    if (incoming.length === 0) setIsOpen(false);
  }, [incoming.length]);

  if (!isAuthenticated || incoming.length === 0) return null;

  return (
    <div
      className={styles.root}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !isOpen) return;

        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <IconButton
        ref={triggerRef}
        label={`Friend requests, ${incoming.length} waiting`}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        onClick={() => setIsOpen((open) => !open)}
      >
        <UsersIcon size={20} />
      </IconButton>

      <span className={styles.badge} aria-hidden="true">
        {incoming.length > 9 ? '9+' : incoming.length}
      </span>

      {isOpen ? (
        <div className={styles.popover} id={listId} role="group" aria-label="Friend requests">
          <ul className={styles.list}>
            {incoming.map((request) => (
              <li key={request.id} className={styles.request}>
                <span aria-hidden="true">
                  <Avatar name={request.name} size="sm" />
                </span>

                <span className={styles.text}>
                  <span className={styles.name}>{request.name}</span>
                  <span className={styles.standing}>Wants to be friends</span>
                </span>

                <span className={styles.actions}>
                  <Button
                    variant="primary"
                    size="md"
                    disabled={actions.busyId === request.id}
                    onClick={() => void actions.accept(request.id)}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={actions.busyId === request.id}
                    onClick={() => void actions.remove(request.id)}
                  >
                    Decline
                  </Button>
                </span>
              </li>
            ))}
          </ul>

          {actions.error ? (
            <p className={styles.error} role="alert">
              {actions.error}
            </p>
          ) : null}

          <Link className={styles.all} to={ROUTES.friends} onClick={() => setIsOpen(false)}>
            See all friends
          </Link>
        </div>
      ) : null}
    </div>
  );
}
