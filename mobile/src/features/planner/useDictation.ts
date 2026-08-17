import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioQuality,
  IOSOutputFormat,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { DictationUnavailableError, speechService } from '../../core/services/speech.service';

/**
 * Dictation, on the device the web version could never serve properly.
 *
 * The phone records, stops, and the recording is transcribed in one pass by
 * Whisper. It waits for the sentence to end; what that buys is a transcript
 * that is right, which the browser speech engines on mobile were not — they
 * repeated themselves in ways three attempts failed to tame.
 *
 * This is `src/features/planner/useRecorder.ts` in shape and in wording, but
 * not in mechanism, so it is written rather than copied: there is no
 * `MediaRecorder`, no `getUserMedia` and no `MediaStream` to release. The
 * states it exposes are the same four the composer already knows how to draw.
 *
 * **The recording is deleted after it is sent.** The web's could not outlive
 * the page; this one is a real file in the cache directory, and leaving
 * somebody's voice on their disk because the upload already succeeded is not a
 * defensible default.
 */

/**
 * What to record, tuned for one spoken sentence rather than for music.
 *
 * Neither preset fits. `HIGH_QUALITY` is 44.1 kHz stereo at 128 kbps — about
 * 16 KB per second, uploaded over mobile data, to describe one voice. And
 * `LOW_QUALITY` drops to AMR narrowband in a `.3gp` container on Android,
 * which is a codec built for 1999 phone calls and a container Whisper is not
 * documented to accept.
 *
 * 16 kHz mono is what Whisper resamples everything to anyway, so asking for it
 * directly costs no accuracy and roughly quarters the upload.
 */
const SPEECH: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  extension: '.m4a',
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

/**
 * AAC in an MP4 container, which is what `.m4a` is.
 *
 * Sent as a header rather than left for the server to infer, because the server
 * turns it into the filename it hands Whisper, and Whisper reads the extension
 * to decide how to decode. See `filenameFor` in `server/src/modules/speech`.
 */
const CONTENT_TYPE = 'audio/m4a';

/** How long one recording may run before it is stopped for you. */
const MAX_SECONDS = 60;

export type Dictation = {
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
  toggle: () => void;
};

export function useDictation({ onText }: { onText: (text: string) => void }): Dictation {
  const recorder = useAudioRecorder(SPEECH);

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirrors `isRecording` for the unmount cleanup, which cannot read state: it
  // is declared with `[recorder]` deps and would close over a stale `false`.
  // A ref rather than the recorder's own getter, for the reason given there.
  const isRecordingRef = useRef(false);

  // Read through a ref so `stop` does not change identity every time the
  // composer re-renders — it is held by a timer that outlives the render.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(async () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;

    await recorder.stop();
    isRecordingRef.current = false;
    setIsRecording(false);

    const uri = recorder.uri;
    if (!uri) return;

    setIsTranscribing(true);

    try {
      const text = await speechService.transcribe(uri, CONTENT_TYPE);
      if (text) onTextRef.current(text);
    } catch (failure) {
      /*
       * "Try again" is the right advice for a provider that stumbled and
       * exactly the wrong advice for one that was never switched on: the second
       * recording fails identically, and the reader is left thinking their
       * voice is the problem.
       */
      if (failure instanceof DictationUnavailableError) {
        setIsUnavailable(true);
        setError('Dictation is not switched on for this server.');
      } else {
        setError('We could not make out that recording. Try again.');
      }
    } finally {
      setIsTranscribing(false);

      try {
        new File(uri).delete();
      } catch {
        // Best effort. The cache directory is the OS's to reclaim, and failing
        // to tidy up is not worth telling somebody about mid-sentence.
      }
    }
  }, [recorder]);

  const start = useCallback(async () => {
    setError(null);

    const permission = await requestRecordingPermissionsAsync();

    if (!permission.granted) {
      setError(
        permission.canAskAgain
          ? 'Dictation needs the microphone.'
          : 'Microphone access is blocked. Allow it in Settings to dictate.',
      );
      return;
    }

    /*
     * Announces that this app is about to record. On iOS the audio session has
     * to be put in a recording category or `record()` produces silence, and on
     * both platforms it is what stops other apps' audio being interrupted for
     * longer than the take.
     */
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

    await recorder.prepareToRecordAsync();
    recorder.record();
    isRecordingRef.current = true;
    setIsRecording(true);

    // A recording nobody ended — a phone back in a pocket — should not upload
    // ten minutes of a bus journey.
    stopTimer.current = setTimeout(() => void stop(), MAX_SECONDS * 1000);
  }, [recorder, stop]);

  /*
   * A component that unmounts mid-take must not leave the microphone open and
   * the OS's recording indicator lit. Nothing is transcribed on this path —
   * there is no longer anywhere for the words to go.
   *
   * **Neither the recorder's getter nor its `stop()` may be trusted here.**
   * `useAudioRecorder` registers its own unmount cleanup, and it is called
   * above this effect, so React — which runs cleanups in the order the effects
   * were declared — has already released the native AudioRecorder by the time
   * this runs. Touching it then throws ERR_USING_RELEASED_SHARED_OBJECT out of
   * an effect nobody can catch, which is a native crash on launch rather than
   * an error on screen: react-freeze unmounts the passive effects of a tab the
   * navigator freezes, so this fires while the tabs are merely being set up.
   *
   * So the flag is read from the ref, and the stop is guarded both ways —
   * `try` for the synchronous throw, `catch` on the promise for the async one.
   * Losing the stop costs nothing when expo-audio has already released the
   * recorder, because releasing it is what ends the recording.
   */
  useEffect(
    () => () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (!isRecordingRef.current) return;
      isRecordingRef.current = false;

      try {
        recorder.stop().catch(() => {});
      } catch {
        // Already released; the microphone is closed either way.
      }
    },
    [recorder],
  );

  const toggle = useCallback(() => {
    if (isRecording) void stop();
    else void start();
  }, [isRecording, start, stop]);

  return { isRecording, isTranscribing, isUnavailable, error, toggle };
}
