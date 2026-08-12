import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '../../../components/common/IconButton';
import { Skeleton } from '../../../components/common/Skeleton';
import { ArrowLeftIcon, CloseIcon } from '../../../components/common/icons';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { messagesStore, threadFor, useMessages } from '../../../store/messages.store';
import { MessageComposer } from './MessageComposer';
import { MessageItem } from './MessageItem';
import styles from './MessageThread.module.css';

/** How far from the end still counts as following the conversation. */
const NEAR_BOTTOM_PX = 40;

export type MessageThreadProps = {
  /** Whose conversation this is, or null when nobody has been picked. */
  userId: string | null;
  name: string;
  isOnline: boolean;
  /** Only on small screens, where this pane replaced the list. */
  onBack?: () => void;
  onClose?: () => void;
};

/**
 * One conversation: who it is with, what has been said, and the composer.
 *
 * Reads its own thread out of the store rather than taking it as a prop, so an
 * inbound message lands here without the panel above having to re-thread
 * anything — the store keys every thread by the person on the other end.
 */
export function MessageThread({ userId, name, isOnline, onBack, onClose }: MessageThreadProps) {
  const state = useMessages();
  const { messages, pending, history } = threadFor(state, userId);
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
   * through a thread — and this panel is on every page, so that happens while
   * they are doing something else entirely. Someone who has scrolled up has
   * said where they want to be; a new message is told to them instead.
   *
   * Keyed on the counts rather than the arrays, which are rebuilt on every
   * change, and on `userId` so that switching person starts at the newest.
   */
  useEffect(() => {
    if (isAtBottom.current) goToBottom(false);
    else setHasMissed(true);
  }, [userId, messages.length, pending.length, goToBottom]);

  if (!userId) {
    return (
      <div className={styles.thread}>
        <p className={styles.blank}>Pick someone to talk to.</p>
      </div>
    );
  }

  return (
    <div className={styles.thread}>
      <header className={styles.header}>
        {onBack ? (
          <IconButton label="Back to people" onClick={onBack}>
            <ArrowLeftIcon size={20} />
          </IconButton>
        ) : null}

        <div className={styles.who}>
          <h3 className={styles.name}>{name}</h3>
          <p className={styles.status}>{isOnline ? 'Online' : 'Offline'}</p>
        </div>

        {onClose ? (
          <IconButton label="Close messages" onClick={onClose}>
            <CloseIcon size={20} />
          </IconButton>
        ) : null}
      </header>

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
            <span className="visually-hidden">Loading the conversation…</span>
            <Skeleton height="40px" radius="lg" />
            <Skeleton height="40px" radius="lg" width="70%" />
            <Skeleton height="40px" radius="lg" />
          </div>
        ) : null}

        {history === 'error' ? (
          <p className={styles.empty} role="alert">
            We could not load this conversation.
          </p>
        ) : null}

        {history === 'ready' && messages.length === 0 && pending.length === 0 ? (
          <p className={styles.empty}>
            This is the start of your conversation with {name}. Only the two of you can read it.
          </p>
        ) : null}

        {/* Named for the person rather than "Messages": the dialog around it
            is already called that, and two things with one name is a list a
            screen-reader user cannot tell apart from the panel holding it. */}
        <ul className={styles.messages} aria-label={`Conversation with ${name}`}>
          {messages.map((message) => (
            <MessageItem
              key={message.id}
              body={message.body}
              createdAt={message.createdAt}
              isOwn={message.senderId === user?.id}
              onDelete={() => void messagesStore.remove(userId, message.id)}
            />
          ))}

          {/* Always after the confirmed ones: they are the newest thing said,
              and they have no server time to sort by. */}
          {pending.map((entry) => (
            <MessageItem
              key={entry.clientMessageId}
              body={entry.body}
              isOwn
              pending={entry.status === 'pending'}
              failed={entry.status === 'failed'}
              onRetry={() => void messagesStore.retry(userId, entry.clientMessageId)}
              onDiscard={() => messagesStore.discard(userId, entry.clientMessageId)}
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
      {state.error && pending.every((entry) => entry.status !== 'failed') ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}

      <MessageComposer onSend={(body) => void messagesStore.send(userId, body)} />
    </div>
  );
}
