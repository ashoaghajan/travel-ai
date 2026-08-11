import { useEffect, useRef } from 'react';
import { IconButton } from '../../../components/common/IconButton';
import { Skeleton } from '../../../components/common/Skeleton';
import { CloseIcon } from '../../../components/common/icons';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { lobbyStore, useLobby } from '../../../store/lobby.store';
import { LobbyComposer } from './LobbyComposer';
import { LobbyMessageItem } from './LobbyMessageItem';
import { LobbyPeopleList } from './LobbyPeopleList';
import styles from './LobbyRoom.module.css';

/**
 * The room's contents — header, people, conversation, composer.
 *
 * Split out from `LobbyPanel` because the panel is two different containers
 * depending on the screen (a grid column, or a modal dialog) and this is the
 * part that does not care which one it is inside.
 */
export function LobbyRoom({ onClose }: { onClose: () => void }) {
  const { messages, pending, people, onlineIds, history, error, connection } = useLobby();
  const { user } = useCurrentUser();
  const endRef = useRef<HTMLDivElement>(null);

  // Follow the conversation. Keyed on the counts rather than the arrays, which
  // are rebuilt on every change.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    endRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'end' });
  }, [messages.length, pending.length]);

  return (
    <div className={styles.room}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Lobby</h2>
          {/*
            Says "everyone signed in" while it is working, and only mentions
            the connection when there is something the reader would otherwise
            be confused by — a room that has quietly stopped updating.
          */}
          <p className={styles.subtitle}>
            {connection === 'online' || connection === 'idle' ? (
              'Everyone signed in'
            ) : connection === 'connecting' ? (
              'Connecting…'
            ) : (
              <span className={styles.stale}>Not live — reopen to refresh</span>
            )}
          </p>
        </div>
        <IconButton label="Close the lobby" onClick={onClose}>
          <CloseIcon size={20} />
        </IconButton>
      </header>

      <LobbyPeopleList people={people} onlineIds={onlineIds} selfId={user?.id} />

      <div className={styles.scroller}>
        {history === 'loading' && messages.length === 0 ? (
          <div className={styles.loading} aria-busy="true">
            <span className="visually-hidden">Loading the room…</span>
            <Skeleton height="40px" radius="lg" />
            <Skeleton height="40px" radius="lg" width="70%" />
            <Skeleton height="40px" radius="lg" />
          </div>
        ) : null}

        {history === 'ready' && messages.length === 0 && pending.length === 0 ? (
          <p className={styles.empty}>
            Nobody has said anything yet. Everyone signed in can see this room and your name.
          </p>
        ) : null}

        <ul className={styles.messages} aria-label="Messages">
          {messages.map((message) => (
            <LobbyMessageItem
              key={message.id}
              authorName={message.authorName}
              body={message.body}
              createdAt={message.createdAt}
              isOwn={message.userId === user?.id}
              onDelete={() => void lobbyStore.remove(message.id)}
            />
          ))}

          {/* Always after the confirmed ones: they are the newest thing said,
              and they have no server time to sort by. */}
          {pending.map((entry) => (
            <LobbyMessageItem
              key={entry.clientMessageId}
              authorName={user?.name ?? 'You'}
              body={entry.body}
              isOwn
              pending={entry.status === 'pending'}
              failed={entry.status === 'failed'}
              onRetry={() => void lobbyStore.retry(entry.clientMessageId)}
              onDiscard={() => lobbyStore.discard(entry.clientMessageId)}
            />
          ))}
        </ul>

        <div ref={endRef} />
      </div>

      {/* The per-message failure already says what went wrong and offers a way
          out, so this is only for what has no bubble of its own. */}
      {error && pending.every((entry) => entry.status !== 'failed') ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <LobbyComposer onSend={(body) => void lobbyStore.send(body)} />
    </div>
  );
}
