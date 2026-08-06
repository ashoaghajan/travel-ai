import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpIcon } from '../../../components/common/icons';
import styles from './PlannerInput.module.css';

export type PlannerInputProps = {
  placeholder?: string;
  /** Blocks input while a generation is in flight. */
  disabled?: boolean;
  onSend: (message: string) => void;
};

/**
 * Prompt field with the circular purple send button (DESIGN_SPEC Screen 2).
 * The field owns its own text; sending is delegated to the caller.
 */
export function PlannerInput({
  placeholder = 'Ask me anything...',
  disabled = false,
  onSend,
}: PlannerInputProps) {
  const [message, setMessage] = useState('');
  const canSend = !disabled && message.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;

    onSend(message.trim());
    setMessage('');
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className="visually-hidden" htmlFor="planner-prompt">
        Describe the trip you want
      </label>
      <input
        id="planner-prompt"
        className={styles.input}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={message}
        disabled={disabled}
        onChange={(event) => setMessage(event.target.value)}
      />
      <button type="submit" className={styles.send} disabled={!canSend} aria-label="Send message">
        <ArrowUpIcon size={20} />
      </button>
    </form>
  );
}
