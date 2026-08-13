import { ERROR_CODES } from '@ai-travel/shared';
import { ApiError, http } from './http';

/**
 * Turning a recording into words, through our own API.
 *
 * No React component may import this file.
 *
 * The provider's key is a real secret, so the audio goes through our server
 * rather than straight to them — a key in the browser is a key anybody can
 * spend. Nothing is stored at either end: the recording exists for the length
 * of one request.
 *
 * Only phones use this. A desktop browser transcribes on its own, live and for
 * nothing; see `useSpeech`.
 */

/**
 * This deployment has no transcription key.
 *
 * Its own type because it is the one failure that will not come right by trying
 * again: every other way a transcription can fail is worth another press of the
 * button, and this one is worth telling the reader to stop pressing. The server
 * says it with `503 PROVIDER_NOT_CONFIGURED`; it is translated here rather than
 * in the hook, so the component layer never has to know an HTTP code.
 */
export class DictationUnavailableError extends Error {
  constructor() {
    super('This server has no transcription key configured.');
    this.name = 'DictationUnavailableError';
  }
}

export const speechService = {
  /** One recording, transcribed. Rejects rather than returning empty words. */
  async transcribe(audio: Blob): Promise<string> {
    try {
      const { text } = await http.post<{ text: string }>('/speech/transcribe', audio);

      return text.trim();
    } catch (error) {
      if (error instanceof ApiError && error.code === ERROR_CODES.PROVIDER_NOT_CONFIGURED) {
        throw new DictationUnavailableError();
      }

      throw error;
    }
  },
};
