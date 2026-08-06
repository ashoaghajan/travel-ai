import { SparklesIcon } from '../../../components/common/icons';
import styles from './TypingIndicator.module.css';

/**
 * Loading state for a generation in flight (DESIGN_SPEC rule 17: use loading
 * states even for mock generation). Shaped like an AI chat bubble.
 */
export function TypingIndicator() {
  return (
    <div className={styles.row} role="status">
      <span className={styles.avatar} aria-hidden="true">
        <SparklesIcon size={18} />
      </span>

      <p className={styles.bubble}>
        <span className="visually-hidden">Planning your trip…</span>
        <span className={styles.dots} aria-hidden="true">
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </span>
      </p>
    </div>
  );
}
