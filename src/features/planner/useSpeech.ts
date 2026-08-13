import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dictating a prompt instead of typing it.
 *
 * **The browser does this, not a provider.** `SpeechRecognition` has shipped in
 * Chrome, Edge and Safari for years; it needs no key, no account, no audio
 * upload of ours and no server code — which makes it the only option here that
 * costs nothing to run and nothing to keep working. A hosted transcription API
 * would mean recording audio, sending somebody's voice through our server, and
 * a bill that grows with use, to do a thing the browser already does.
 *
 * The cost is honest and worth stating: **Firefox has no implementation**, and
 * in Chrome the audio goes to Google's servers rather than staying on the
 * device. So the control appears only where the API exists, and nothing about
 * the composer depends on it.
 *
 * Interim words are held apart from final ones. The API revises what it thinks
 * it heard as you speak — "to Kyoto" becomes "to Kyoto in April" becomes
 * something else — and writing each revision into the field would fight
 * whatever the reader is typing. Finals are appended; the interim text is only
 * shown.
 */

/** The parts of the API this file uses, named rather than pulled from `lib.dom`. */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/**
 * The constructor, if this browser has one.
 *
 * Read at call time rather than at module load: a test can define it, and a
 * module-level snapshot would have been taken before it could.
 */
function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;

  const holder = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return holder.SpeechRecognition ?? holder.webkitSpeechRecognition ?? null;
}

/** What went wrong, in words somebody can act on. */
function messageFor(error: string | undefined): string {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Microphone access is blocked. Allow it in your browser settings to dictate.';
  }

  if (error === 'no-speech') return 'I did not catch that. Try again.';
  if (error === 'audio-capture') return 'No microphone found.';

  return 'Dictation stopped working. Try again.';
}

export type SpeechInput = {
  /** False in a browser without the API — Firefox, today. */
  isSupported: boolean;
  isListening: boolean;
  /** The words being revised as somebody speaks, shown but never committed. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

export function useSpeech({ onText }: { onText: (text: string) => void }): SpeechInput {
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  /*
   * Held in a ref so the recognition's handlers always call the current one.
   * They are attached once, at start, and would otherwise close over whatever
   * the caller passed on that render.
   */
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const [isSupported] = useState(() => recognitionConstructor() !== null);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (recognitionRef.current) return;

    const Recognition = recognitionConstructor();
    if (!Recognition) return;

    const recognition = new Recognition();
    recognitionRef.current = recognition;

    // The reader's own language, so a French speaker is not transcribed as if
    // they were speaking English.
    recognition.lang = navigator.language || 'en-US';
    // Keeps listening through the pauses in a sentence rather than stopping at
    // the first one — somebody describing a trip thinks mid-sentence.
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let pending = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? '';

        if (result.isFinal) onTextRef.current(text.trim());
        else pending += text;
      }

      setInterim(pending.trim());
    };

    recognition.onerror = (event) => {
      // `no-speech` fires on an ordinary pause and stops the session; saying
      // so would be nagging somebody who is merely thinking.
      if (event.error !== 'no-speech') setError(messageFor(event.error));
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      setInterim('');
    };

    setError(null);
    setInterim('');

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      // Already running, or refused outright. Either way there is nothing
      // listening and nothing to clean up.
      recognitionRef.current = null;
      setError(messageFor(undefined));
    }
  }, []);

  const toggle = useCallback(() => {
    if (recognitionRef.current) stop();
    else start();
  }, [start, stop]);

  // A microphone left listening after the screen is gone is the one thing here
  // worth being careful about.
  useEffect(() => () => recognitionRef.current?.abort(), []);

  return { isSupported, isListening, interim, error, start, stop, toggle };
}
