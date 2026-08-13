import { http } from './http';

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
export const speechService = {
  /** One recording, transcribed. Rejects rather than returning empty words. */
  async transcribe(audio: Blob): Promise<string> {
    const { text } = await http.post<{ text: string }>('/speech/transcribe', audio);

    return text.trim();
  },
};
