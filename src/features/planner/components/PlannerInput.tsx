import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpIcon, MicIcon, StopIcon } from '../../../components/common/icons';
import { cx } from '../../../utils/cx';
import { useDictation } from '../useDictation';
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

  /*
   * Dictation appends rather than replaces: somebody may have typed half a
   * sentence before reaching for the microphone, and the words they said are
   * the continuation of it rather than a correction to it.
   */
  const speech = useDictation({
    onText: (text) =>
      setMessage((current) => (current ? `${current.trimEnd()} ${text}` : text)),
  });

  const canSend = message.trim().length > 0;
  /* Stop only while there is nothing to send: a prompt in the field says what
     the reader wants more clearly than a stop would. */
  const isStop = isGenerating && !canSend;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Sending is the end of what was being dictated, whichever way it is sent.
    speech.stop();

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
        /* While listening, the placeholder is the better place for the words
           being revised: the field itself holds only what has been settled. */
        placeholder={
          speech.isTranscribing
            ? 'Transcribing…'
            : speech.isActive
              ? speech.interim || 'Listening…'
              : placeholder
        }
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />

      {/* Only where the browser has it — Firefox has no implementation, and a
          button that cannot work is worse than no button. */}
      {speech.isSupported ? (
        <button
          type="button"
          className={cx(styles.mic, speech.isActive && styles.listening)}
          aria-label={speech.isActive ? 'Stop dictating' : 'Dictate a message'}
          aria-pressed={speech.isActive}
          // Nothing to press while the words are on their way back.
          disabled={speech.isTranscribing}
          onClick={() => speech.toggle()}
        >
          <MicIcon size={18} />
        </button>
      ) : null}
      <button
        type="submit"
        className={styles.send}
        disabled={!isStop && !canSend}
        aria-label={isStop ? 'Stop generating' : 'Send message'}
      >
        {isStop ? <StopIcon size={18} /> : <ArrowUpIcon size={20} />}
      </button>

      {/*
        What the engine actually sent, on screen because a phone cannot easily
        be attached to a debugger. Only with `?speechdebug` in the URL.
      */}
      {speech.debug.length > 0 ? (
        <pre className={styles.speechDebug}>{speech.debug.join('\n')}</pre>
      ) : null}

      {/* Announced rather than only drawn: somebody who has just spoken at a
          microphone may not be looking at the screen. */}
      {speech.error ? (
        <p className={styles.speechError} role="alert">
          {speech.error}
        </p>
      ) : null}
    </form>
  );
}
