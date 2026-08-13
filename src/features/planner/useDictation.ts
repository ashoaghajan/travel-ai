import { useRecorder } from './useRecorder';
import { useSpeech } from './useSpeech';

/**
 * Dictation, by whichever route this device can actually manage.
 *
 * **A desktop uses its own engine**: live, free, and it works. **A phone
 * records and sends the audio to be transcribed**, because the mobile engines
 * repeat themselves — the same phrase two or three times over — in a way three
 * attempts at reading their event stream failed to tame.
 *
 * Told apart by pointer rather than by user agent. A coarse pointer is a
 * finger, and the question being asked is really "is this a phone or tablet",
 * which no user-agent string has answered honestly in a decade. Both hooks are
 * called either way — hooks cannot be conditional — and only the chosen one is
 * ever started.
 */

export type Dictation = {
  /** Whether this device can dictate at all, by either route. */
  isSupported: boolean;
  /** Listening, or recording — from the reader's side they are the same state. */
  isActive: boolean;
  /** Only the recorded route has this: the wait between speaking and words. */
  isTranscribing: boolean;
  /** Only the live route has this: words still being revised. */
  interim: string;
  error: string | null;
  /** Empty unless `?speechdebug` is in the URL. */
  debug: string[];
  toggle: () => void;
  stop: () => void;
};

/** Whether the pointer is a finger. See the note above about user agents. */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;

  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Which route the URL demands, if it demands one.
 *
 * `?dictate=record` forces the recorded route and `?dictate=live` forces the
 * live one. Neither is for a reader — this is the same admission `?speechdebug`
 * makes: the recorded route only ever runs on a phone, which is the hardest
 * place to watch a network panel or read a stack trace. Being able to exercise
 * it from a desktop, where the developer tools are, is worth a query parameter.
 *
 * Absent, which is the normal case, the device decides as it always has.
 */
function forcedRoute(): 'record' | 'live' | null {
  if (typeof window === 'undefined') return null;

  const asked = new URLSearchParams(window.location.search).get('dictate');

  return asked === 'record' || asked === 'live' ? asked : null;
}

export function useDictation({ onText }: { onText: (text: string) => void }): Dictation {
  const speech = useSpeech({ onText });
  const recorder = useRecorder({ onText });

  /*
   * Recorded on a touch device, live everywhere else — and live as a fallback
   * where a phone has no recorder, rather than nothing at all.
   *
   * The URL overrides the device, but cannot conjure an API the browser does
   * not have: forcing the recorded route where nothing can record still yields
   * no button, because the alternative is a button that lies.
   */
  const forced = forcedRoute();
  const wantsRecording = forced === 'record' || (forced === null && isTouchDevice());
  const useRecording = wantsRecording && recorder.isSupported;

  if (useRecording) {
    return {
      /*
       * A deployment with no transcription key cannot dictate on a phone, and
       * the live engine is not the consolation it looks like: it is the engine
       * whose repeating this route exists to escape. So the button goes rather
       * than falling back to something known to produce a mangled sentence.
       * The message stays on screen after it does.
       */
      isSupported: !recorder.isUnavailable,
      isActive: recorder.isRecording,
      isTranscribing: recorder.isTranscribing,
      interim: '',
      error: recorder.error,
      debug: [],
      toggle: recorder.toggle,
      stop: recorder.stop,
    };
  }

  return {
    isSupported: speech.isSupported,
    isActive: speech.isListening,
    isTranscribing: false,
    interim: speech.interim,
    error: speech.error,
    debug: speech.debug,
    toggle: speech.toggle,
    stop: speech.stop,
  };
}
