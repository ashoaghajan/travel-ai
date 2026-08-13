import { env } from '../../env';

/**
 * Transcription, through Groq.
 *
 * The only file that knows which provider this is. One call, one answer: audio
 * in, words out — there is no session, nothing to stream and nothing to keep.
 *
 * **Whisper large-v3-turbo**, which is the fast variant: a phone waiting on a
 * sentence is a person waiting, and the accuracy difference against the full
 * model is not worth the seconds on a spoken prompt.
 *
 * A plain `fetch`, as every other provider in this codebase is called, so it
 * stubs at `fetch` in tests rather than needing an SDK's HTTP layer mocked.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';

/** Whether transcription is switched on at all. */
export function isConfigured(): boolean {
  return Boolean(env().GROQ_API_KEY);
}

/** A name for the upload, since the format is only in the content type. */
function filenameFor(contentType: string): string {
  if (contentType.includes('mp4')) return 'audio.mp4';
  if (contentType.includes('ogg')) return 'audio.ogg';
  if (contentType.includes('wav')) return 'audio.wav';

  // What every browser that can record produces, and what Safari calls its
  // own recordings besides.
  return 'audio.webm';
}

/**
 * One recording, transcribed.
 *
 * Throws rather than returning an empty string on failure: a prompt that
 * silently loses what somebody said is worse than one that says it could not
 * hear them.
 */
export async function transcribe(audio: Buffer, contentType: string): Promise<string> {
  const apiKey = env().GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const form = new FormData();
  form.append('file', new Blob([audio], { type: contentType }), filenameFor(contentType));
  form.append('model', MODEL);
  /*
   * Plain text back rather than the JSON envelope: this returns one string and
   * nothing here wants the segments, the timings or the confidence scores.
   */
  form.append('response_format', 'text');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Groq answered ${response.status}: ${await response.text()}`);
  }

  return (await response.text()).trim();
}
