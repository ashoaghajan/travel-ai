import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '../../../components/common/IconButton';
import { Skeleton } from '../../../components/common/Skeleton';
import { CloseIcon } from '../../../components/common/icons';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { lobbyStore, useLobby } from '../../../store/lobby.store';
import { LobbyComposer } from './LobbyComposer';
import { LobbyMessageItem } from './LobbyMessageItem';
import { LobbyPeopleList } from './LobbyPeopleList';
import styles from './LobbyRoom.module.css';

/** How far from the end still counts as following the conversation. */
const NEAR_BOTTOM_PX = 40;

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
  const scrollerRef = useRef<HTMLDivElement>(null);

  /*
   * Whether the reader is at the live edge of the conversation.
   *
   * A ref rather than state: it is read inside the effect below and must not
   * be what makes that effect run again. `hasMissed` is the state, because
   * that one is on screen.
   */
  const isAtBottom = useRef(true);
  const [hasMissed, setHasMissed] = useState(false);

  const goToBottom = useCallback((smooth = true) => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    endRef.current?.scrollIntoView({
      behavior: smooth && !reduced ? 'smooth' : 'auto',
      block: 'end',
    });
    setHasMissed(false);
  }, []);

  /*
   * Follow the conversation, but only from the bottom of it.
   *
   * Scrolling unconditionally yanks the view away from anybody reading back
   * through the room — and this panel is on every page, so that happens while
   * they are doing something else entirely. Someone who has scrolled up has
   * said where they want to be; a new message is told to them instead.
   *
   * Keyed on the counts rather than the arrays, which are rebuilt on every
   * change.
   */
  useEffect(() => {
    if (isAtBottom.current) goToBottom();
    else setHasMissed(true);
  }, [messages.length, pending.length, goToBottom]);

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

      <div
        className={styles.scroller}
        ref={scrollerRef}
        /*
         * "Near enough" rather than exactly at the end: a couple of pixels of
         * rounding, or one line of a message part-way onto the screen, should
         * still count as following along.
         */
        onScroll={() => {
          const el = scrollerRef.current;
          if (!el) return;

          isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
          if (isAtBottom.current) setHasMissed(false);
        }}
      >
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

      {/* Only for somebody who has read back and would otherwise not know.
          Anyone at the live edge already has the message on screen. */}
      {hasMissed ? (
        <button type="button" className={styles.missed} onClick={() => goToBottom()}>
          New messages ↓
        </button>
      ) : null}

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
