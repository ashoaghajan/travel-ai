import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '../../../components/common/Avatar';
import { Skeleton } from '../../../components/common/Skeleton';
import { messagesStore } from '../../../store/messages.store';
import { cx } from '../../../utils/cx';
import type { Conversation } from '../conversation.filters';
import { previewOf } from '../conversation.filters';
import { PresenceDot } from './PresenceDot';
import styles from './ConversationList.module.css';

/**
 * How long to wait after a keystroke before asking the server.
 *
 * Searching is a query against every account, and a request per character
 * would send five of them for a three-letter name — four of which nobody ever
 * sees the answer to. A short pause is imperceptible while typing and turns
 * that into one.
 */
const SEARCH_DEBOUNCE_MS = 250;

export type ConversationListProps = {
  conversations: Conversation[];
  activeUserId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  onSelect: (userId: string) => void;
};

/**
 * Everyone you could talk to, and the state of each conversation.
 *
 * **Every account appears, not only the people already talked to** — you
 * cannot message somebody you cannot find. That is a deliberate reversal of the
 * public room's rule that accounts must not be enumerable, and the search box
 * is what keeps it usable once there are more names than fit on a screen.
 *
 * Names and previews only, never an email: `ApiConversation` exists precisely
 * so an address cannot arrive here by accident.
 */
export function ConversationList({
  conversations,
  activeUserId,
  status,
  onSelect,
}: ConversationListProps) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const hasTyped = useRef(false);

  /*
   * The typed value drives the field immediately and the server a beat later.
   *
   * Skipped until something is actually typed: `useMessagesList` already loads
   * the list when the panel opens, and a debounce that fired on mount would
   * repeat that query for every reader who never searches — which is most of
   * them.
   */
  useEffect(() => {
    if (!hasTyped.current) return;

    const timer = setTimeout(
      () => void messagesStore.refreshConversations(query),
      SEARCH_DEBOUNCE_MS,
    );

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className={styles.wrap}>
      <div className={styles.search}>
        <label className="visually-hidden" htmlFor={searchId}>
          Search for someone
        </label>
        <input
          id={searchId}
          type="search"
          className={styles.field}
          value={query}
          placeholder="Search people…"
          onChange={(event) => {
            hasTyped.current = true;
            setQuery(event.target.value);
          }}
        />
      </div>

      {status === 'loading' && conversations.length === 0 ? (
        <div className={styles.loading} aria-busy="true">
          <span className="visually-hidden">Loading people…</span>
          <Skeleton height="44px" radius="lg" />
          <Skeleton height="44px" radius="lg" />
          <Skeleton height="44px" radius="lg" />
        </div>
      ) : null}

      {status === 'error' && conversations.length === 0 ? (
        <p className={styles.empty}>We could not load the list of people.</p>
      ) : null}

      {status === 'ready' && conversations.length === 0 ? (
        <p className={styles.empty}>
          {query ? `Nobody here is called “${query}”.` : 'There is nobody else signed up yet.'}
        </p>
      ) : null}

      <ul className={styles.list} aria-label="People">
        {conversations.map((conversation) => {
          const preview = previewOf(conversation);

          return (
            <li key={conversation.id}>
              <button
                type="button"
                className={cx(styles.row, conversation.id === activeUserId && styles.active)}
                aria-current={conversation.id === activeUserId ? 'true' : undefined}
                onClick={() => onSelect(conversation.id)}
              >
                {/* The avatar is decorative — `Avatar` carries the name as a
                    hidden label and the visible name is right beside it. The
                    dot is not decorative, and sits outside the `aria-hidden`
                    for that reason: it says something the name does not. */}
                <PresenceDot isOnline={conversation.isOnline}>
                  <span aria-hidden="true">
                    <Avatar name={conversation.name} size="sm" />
                  </span>
                </PresenceDot>

                <span className={styles.text}>
                  <span className={styles.name}>{conversation.name}</span>
                  {/* One line, clipped. A preview that wrapped would let one
                      long message push every other person off the screen. */}
                  <span className={styles.preview}>{preview ?? 'No messages yet'}</span>
                </span>

                {conversation.unread > 0 ? (
                  <span className={styles.unread}>
                    <span className="visually-hidden">{conversation.unread} unread, </span>
                    {conversation.unread > 9 ? '9+' : conversation.unread}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
