import { useId, useRef, useState } from 'react';
import { MESSAGE_MAX_LENGTH } from '@ai-travel/shared';
import { IconButton } from '../../../components/common/IconButton';
import { ArrowUpIcon } from '../../../components/common/icons';
import { messagesService } from '../../../services/messages.service';
import { insertAt } from '../message.filters';
import { EmojiPicker } from './EmojiPicker';
import styles from './MessageComposer.module.css';

/** Counts down only once it is close enough to matter. */
const WARN_AT = 100;

export type MessageComposerProps = {
  onSend: (body: string) => void;
  disabled?: boolean;
};

/**
 * The one place to type into a conversation.
 *
 * Written rather than lifted from `PlannerInput`, which hardcoded
 * `id="planner-prompt"` when this was built — and since this panel is on every
 * page including the planner, sharing it would have put two elements with one
 * id on that screen. That input now uses `useId()` too, but the two composers
 * genuinely differ (character counter, Enter-to-send, pending state), so they
 * stay separate.
 *
 * Enter sends; Shift+Enter is a newline. The field grows to a few lines and
 * then scrolls, because a composer that grows without limit eventually eats
 * the conversation it belongs to.
 */
export function MessageComposer({ onSend, disabled = false }: MessageComposerProps) {
  const fieldId = useId();
  const [value, setValue] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = value.trim();
  const remaining = MESSAGE_MAX_LENGTH - value.length;
  const tooLong = remaining < 0;
  const canSend = trimmed.length > 0 && !tooLong && !disabled;

  function submit(): void {
    if (!canSend) return;

    onSend(trimmed);
    setValue('');
  }

  /**
   * Drops an emoji where the caret is, and puts the caret after it.
   *
   * Appending would be wrong the moment somebody goes back to add a wave to
   * the front of what they have written — and a caret left at the start after
   * an insert is the same bug seen from the other side, so it is moved by hand
   * once React has painted the new value.
   */
  function addEmoji(emoji: string): void {
    const field = fieldRef.current;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? start;

    setValue(insertAt(value, emoji, start, end));

    requestAnimationFrame(() => {
      const caret = Math.min(start, value.length) + emoji.length;

      field?.focus();
      field?.setSelectionRange(caret, caret);
    });
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
        Write a message
      </label>

      <EmojiPicker onPick={addEmoji} disabled={disabled} />

      <textarea
        id={fieldId}
        ref={fieldRef}
        className={styles.field}
        value={value}
        rows={1}
        placeholder="Say something…"
        disabled={disabled}
        /*
         * A person who has just focused this is about to send something, which
         * is the earliest moment worth waking a sleeping API for. See
         * `keepWarm` — it is at most one request per ten minutes, and never a
         * timer.
         */
        onFocus={() => messagesService.wakeUp()}
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
