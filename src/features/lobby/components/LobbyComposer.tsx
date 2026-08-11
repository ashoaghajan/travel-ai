import { useId, useState } from 'react';
import { LOBBY_MESSAGE_MAX_LENGTH } from '@ai-travel/shared';
import { IconButton } from '../../../components/common/IconButton';
import { ArrowUpIcon } from '../../../components/common/icons';
import styles from './LobbyComposer.module.css';

/** Counts down only once it is close enough to matter. */
const WARN_AT = 100;

export type LobbyComposerProps = {
  onSend: (body: string) => void;
  disabled?: boolean;
};

/**
 * The one place to type into the room.
 *
 * Written rather than lifted from `PlannerInput`, which hardcodes
 * `id="planner-prompt"` — and since this panel is on every page including the
 * planner, sharing it would put two elements with one id on that screen. A
 * `useId()` here means the clash cannot happen at all.
 *
 * Enter sends; Shift+Enter is a newline. The field grows to a few lines and
 * then scrolls, because a composer that grows without limit eventually eats
 * the conversation it belongs to.
 */
export function LobbyComposer({ onSend, disabled = false }: LobbyComposerProps) {
  const fieldId = useId();
  const [value, setValue] = useState('');

  const trimmed = value.trim();
  const remaining = LOBBY_MESSAGE_MAX_LENGTH - value.length;
  const tooLong = remaining < 0;
  const canSend = trimmed.length > 0 && !tooLong && !disabled;

  function submit(): void {
    if (!canSend) return;

    onSend(trimmed);
    setValue('');
  }

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="visually-hidden" htmlFor={fieldId}>
        Write to the lobby
      </label>

      <textarea
        id={fieldId}
        className={styles.field}
        value={value}
        rows={1}
        placeholder="Say something…"
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return;

          event.preventDefault();
          submit();
        }}
      />

      {/* Silent until it is nearly a problem, then it is the only thing on the
          row that has changed — which is what makes it noticeable. */}
      {remaining <= WARN_AT ? (
        <span className={tooLong ? styles.over : styles.remaining} aria-live="polite">
          {remaining}
        </span>
      ) : null}

      <IconButton label="Send" type="submit" variant="primary" disabled={!canSend}>
        <ArrowUpIcon size={18} />
      </IconButton>
    </form>
  );
}
