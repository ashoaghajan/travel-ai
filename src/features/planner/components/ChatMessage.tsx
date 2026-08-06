import type { ReactNode } from 'react';
import { SparklesIcon } from '../../../components/common/icons';
import { cx } from '../../../utils/cx';
import type { ChatAuthor } from '../../../types/planner.types';
import styles from './ChatMessage.module.css';

export type ChatMessageProps = {
  author: ChatAuthor;
  content: string;
  /** Rendered under the bubble, e.g. an itinerary preview on an AI turn. */
  children?: ReactNode;
};

/**
 * Chat bubble (DESIGN_SPEC Screen 2): user messages sit right on purple with
 * white text, AI messages sit left on soft grey with dark text.
 */
export function ChatMessage({ author, content, children }: ChatMessageProps) {
  const isAi = author === 'ai';

  return (
    <article className={cx(styles.row, isAi ? styles.ai : styles.user)}>
      {isAi ? (
        <span className={styles.aiAvatar} aria-hidden="true">
          <SparklesIcon size={18} />
        </span>
      ) : null}

      <div className={styles.column}>
        <h3 className="visually-hidden">{isAi ? 'AI Travel Planner' : 'You'}</h3>
        <p className={styles.bubble}>{content}</p>
        {children}
      </div>
    </article>
  );
}
