import { ERROR_CODES } from '@ai-travel/shared';
import { File } from 'expo-file-system';
import { ApiError, http } from './http';

/**
 * Turning a recording into words, through our own API.
 *
 * No React component may import this file.
 *
 * The provider's key is a real secret, so the audio goes through our server
 * rather than straight to them. Nothing is stored at either end: the recording
 * exists for the length of one request.
 *
 * A copy of `src/services/speech.service.ts`, with one thing changed. DIFFERS
 * FROM WEB: what a recording is. The web hands over a `Blob` that
 * `MediaRecorder` produced in memory; here it is a file on disk that
 * `expo-audio` wrote, so this takes a URI and reads it.
 *
 * **The whole file is read into memory before it is sent**, rather than
 * streamed off disk by `File.upload()`. That is a deliberate trade. `upload()`
 * would stream and never hold the bytes, but it opens its own connection —
 * outside `http.ts`, and therefore outside the access token's refresh. A
 * dictation that failed only when the token happened to be fifteen minutes old
 * is the kind of bug that takes a week to reproduce. A spoken prompt at 16 kHz
 * mono is tens of kilobytes, so what is being spent to avoid that is nothing.
 */

/**
 * This deployment has no transcription key.
 *
 * Its own type because it is the one failure that will not come right by trying
 * again: every other way a transcription can fail is worth another press of the
 * button, and this one is worth telling the reader to stop pressing.
 */
export class DictationUnavailableError extends Error {
  constructor() {
    super('This server has no transcription key configured.');
    this.name = 'DictationUnavailableError';
  }
}

export const speechService = {
  /**
   * One recording, transcribed. Rejects rather than returning empty words.
   *
   * `contentType` is passed explicitly rather than guessed from the extension,
   * because the server picks the filename it gives Whisper from this header and
   * Whisper decides how to decode from that filename.
   */
  async transcribe(uri: string, contentType: string): Promise<string> {
    const audio = await new File(uri).arrayBuffer();

    try {
      const { text } = await http.post<{ text: string }>('/speech/transcribe', audio, {
        contentType,
      });

      return text.trim();
    } catch (error) {
      if (error instanceof ApiError && error.code === ERROR_CODES.PROVIDER_NOT_CONFIGURED) {
        throw new DictationUnavailableError();
      }

      throw error;
    }
  },
};
