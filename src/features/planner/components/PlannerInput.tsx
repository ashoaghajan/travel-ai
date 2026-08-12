import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpIcon, StopIcon } from '../../../components/common/icons';
import styles from './PlannerInput.module.css';

export type PlannerInputProps = {
  placeholder?: string;
  /** Whether an answer is arriving right now. */
  isGenerating?: boolean;
  onSend: (message: string) => void;
  /** Calls off the answer in flight. Required whenever `isGenerating` can be true. */
  onStop?: () => void;
};

/**
 * Prompt field with the circular purple send button (DESIGN_SPEC Screen 2).
 * The field owns its own text; sending is delegated to the caller.
 *
 * **The field is never disabled**, including while an answer is arriving. It
 * used to be, and that made the most ordinary thing somebody wants to do —
 * change their mind half way through a long generation — impossible without
 * waiting it out.
 *
 * **One button, two jobs.** While an answer is arriving and nothing has been
 * typed it stops; the moment there is something to send it sends, and sending
 * supersedes the turn in flight. Two buttons side by side would be one more
 * thing to read at the only moment the reader is already reading something
 * else.
 */
export function PlannerInput({
  placeholder = 'Ask me anything...',
  isGenerating = false,
  onSend,
  onStop,
}: PlannerInputProps) {
  /*
   * Was a hardcoded `id="planner-prompt"`, which is a latent bug rather than a
   * style point: two of these on one screen would give the document two
   * elements with one id, and every `<label for>` would then point at whichever
   * the browser found first. Nothing renders two today — but a component that
   * cannot be used twice is a trap laid for whoever tries.
   */
  const fieldId = useId();
  const [message, setMessage] = useState('');

  const canSend = message.trim().length > 0;
  /* Stop only while there is nothing to send: a prompt in the field says what
     the reader wants more clearly than a stop would. */
  const isStop = isGenerating && !canSend;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isStop) {
      onStop?.();
      return;
    }

    if (!canSend) return;

    onSend(message.trim());
    setMessage('');
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className="visually-hidden" htmlFor={fieldId}>
        Describe the trip you want
      </label>
      <input
        id={fieldId}
        className={styles.input}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      <button
        type="submit"
        className={styles.send}
        disabled={!isStop && !canSend}
        aria-label={isStop ? 'Stop generating' : 'Send message'}
      >
        {isStop ? <StopIcon size={18} /> : <ArrowUpIcon size={20} />}
      </button>
    </form>
  );
}
