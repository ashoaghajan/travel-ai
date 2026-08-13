import { useCallback, useRef, useState } from 'react';
import { DictationUnavailableError, speechService } from '../../services/speech.service';

/**
 * Dictation for the devices the browser cannot serve.
 *
 * A phone records, stops, and the recording is transcribed in one pass by
 * Whisper — where a desktop's own engine hands over words as they are spoken.
 * The difference is felt: this waits for the sentence to end. What it buys is a
 * transcript that is right, which the mobile engines were not.
 *
 * **One recording, transcribed once, cannot repeat itself.** The bug this
 * replaces was a stream of revisions arriving in an order nothing here could
 * reconstruct; there is no stream now, and nothing to reconstruct.
 *
 * The audio never touches storage — not here, not on our server, and not at the
 * provider beyond the request. It exists in memory for as long as it takes to
 * turn into a sentence.
 */

/**
 * The formats to ask for, best first.
 *
 * Opus in WebM is small and every recording browser but Safari makes it; Safari
 * makes MP4. An empty string lets the browser choose, which is the honest last
 * resort — `MediaRecorder` refuses a type it cannot write.
 */
const FORMATS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''];

/** How long one recording may run before it is stopped for you. */
const MAX_SECONDS = 60;

function supportedFormat(): string {
  if (typeof MediaRecorder === 'undefined') return '';

  return FORMATS.find((format) => format === '' || MediaRecorder.isTypeSupported(format)) ?? '';
}

export type Recorder = {
  isSupported: boolean;
  isRecording: boolean;
  /** True between the recording stopping and the words arriving. */
  isTranscribing: boolean;
  /**
   * True once the server has said it has no transcription key.
   *
   * Only ever learned by asking: whether a key is set is the server's business
   * and there is no endpoint that volunteers it, so the first recording is what
   * finds out. From then on the button goes away rather than inviting a second
   * recording that cannot succeed either.
   */
  isUnavailable: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

export function useRecorder({ onText }: { onText: (text: string) => void }): Recorder {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const [isSupported] = useState(
    () =>
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia),
  );

  /** Ends the take. The transcript arrives from `onstop`. */
  const stop = useCallback(() => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;

    recorderRef.current?.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;

    setError(null);

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access is blocked. Allow it in your browser settings to dictate.');
      return;
    }

    const mimeType = supportedFormat();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = () => {
      recorderRef.current = null;
      setIsRecording(false);

      /*
       * The microphone is released here rather than left to garbage
       * collection: on a phone the recording indicator stays lit until every
       * track is stopped, and a light that outlives the recording is alarming
       * in a way a leak is not.
       */
      stream.getTracks().forEach((track) => track.stop());

      const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (audio.size === 0) return;

      setIsTranscribing(true);

      void speechService
        .transcribe(audio)
        .then((text) => {
          if (text) onTextRef.current(text);
        })
        .catch((failure: unknown) => {
          /*
           * "Try again" is the right advice for a provider that stumbled and
           * exactly the wrong advice for one that was never switched on: the
           * second recording fails identically, and the reader is left thinking
           * their voice is the problem.
           */
          if (failure instanceof DictationUnavailableError) {
            setIsUnavailable(true);
            setError('Dictation is not switched on for this server.');
            return;
          }

          setError('We could not make out that recording. Try again.');
        })
        .finally(() => setIsTranscribing(false));
    };

    recorder.start();
    setIsRecording(true);

    // A recording nobody ended — a phone in a pocket — should not upload ten
    // minutes of a bus journey.
    stopTimerRef.current = setTimeout(stop, MAX_SECONDS * 1000);
  }, [stop]);

  const toggle = useCallback(() => {
    if (recorderRef.current) stop();
    else void start();
  }, [start, stop]);

  return {
    isSupported,
    isRecording,
    isTranscribing,
    isUnavailable,
    error,
    start: () => void start(),
    stop,
    toggle,
  };
}
