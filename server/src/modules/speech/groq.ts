import { env } from '../../env';

/**
 * Transcription, through Groq.
 *
 * The only file that knows which provider this is. One call, one answer: audio
 * in, words out — there is no session, nothing to stream and nothing to keep.
 *
 * **Whisper large-v3, not the turbo variant.** Turbo was chosen here first, on
 * the reasoning that a phone waiting on a sentence is a person waiting and the
 * accuracy difference "is not worth the seconds". Measured against Groq, both
 * halves of that turned out to be wrong.
 *
 * The cost is not seconds. On 6.4 s of audio, five calls each: turbo averaged
 * 755 ms round trip and large-v3 averaged 809 ms. Fifty-four milliseconds is
 * not a wait anybody can feel.
 *
 * The accuracy difference is not small, and it lands exactly where this app
 * cannot afford it — proper nouns. On the same recording degraded to a
 * realistic 15 dB signal-to-noise ratio, six trials each, large-v3 transcribed
 * "Reykjavik and Akureyri" correctly 6 times out of 6 and turbo 0 out of 6,
 * offering "Reiki of the Kandaku area" among others. A travel planner that
 * cannot hear a place name is not doing the job, and a destination is the one
 * word in a spoken prompt that has to survive.
 *
 * On clean audio the two are indistinguishable, which is why the original
 * choice looked fine: the difference only appears once there is a room behind
 * the voice.
 *
 * A plain `fetch`, as every other provider in this codebase is called, so it
 * stubs at `fetch` in tests rather than needing an SDK's HTTP layer mocked.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';

/** Whether transcription is switched on at all. */
export function isConfigured(): boolean {
  return Boolean(env().GROQ_API_KEY);
}

/**
 * A name for the upload, since the format is only in the content type.
 *
 * The extension is not cosmetic — Whisper reads it to decide how to decode the
 * bytes, so a wrong one fails a recording that was perfectly good.
 */
export function filenameFor(contentType: string): string {
  /*
   * The native app's format, and the reason this line exists: `expo-audio`
   * records AAC in an MP4 container and calls it `.m4a`. That string does not
   * contain "mp4", so before this it fell through to the WebM default below and
   * every phone recording was offered to Whisper as something it is not.
   */
  if (contentType.includes('m4a') || contentType.includes('aac')) return 'audio.m4a';
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
