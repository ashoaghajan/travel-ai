import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { resetEnvCache } from '../../env';
import { api, errorCode, signUp } from '../../test/harness';
import { filenameFor } from './groq';
import { resetSpeechRateLimit } from './speech.routes';

/**
 * `POST /api/speech/transcribe` — a recording in, a sentence out.
 *
 * The audio goes through this server because the provider's key is a real
 * secret; what these pin is that it goes through and stops, rather than being
 * kept, and that a reader never sees the provider's own words about a failure.
 */

const PATH = '/api/speech/transcribe';

/** Groq, answering as it does: plain text, because that is what we ask for. */
function groqSays(text: string, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    text: async () => text,
  } as Response);
}

beforeEach(() => {
  resetSpeechRateLimit();
  process.env.GROQ_API_KEY = 'test-key';
  // The environment is read once and cached, at import time — see `env.ts`.
  resetEnvCache();
});

afterEach(() => {
  delete process.env.GROQ_API_KEY;
  resetEnvCache();
});

describe('authentication', () => {
  it('refuses a recording with no token', async () => {
    const response = await api().post(PATH).set('Content-Type', 'audio/webm').send('x').expect(401);

    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });
});

describe('transcribing', () => {
  it('hands back what the provider heard', async () => {
    const { accessToken } = await signUp();
    groqSays('create a trip to Abu Dhabi\n');

    const response = await api()
      .post(PATH)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'audio/webm')
      .send(Buffer.from('fake audio'))
      .expect(200);

    expect(response.body).toEqual({ text: 'create a trip to Abu Dhabi' });
  });

  it('sends the audio to the provider as a file', async () => {
    const { accessToken } = await signUp();
    const fetched = groqSays('hello');

    await api()
      .post(PATH)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'audio/webm')
      .send(Buffer.from('fake audio'))
      .expect(200);

    const [url, init] = fetched.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;

    expect(String(url)).toContain('groq.com');
    expect(headers.authorization).toBe('Bearer test-key');
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('refuses an empty recording', async () => {
    const { accessToken } = await signUp();

    const response = await api()
      .post(PATH)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'audio/webm')
      .send(Buffer.alloc(0))
      .expect(422);

    expect(errorCode(response)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('says dictation is off when there is no key', async () => {
    delete process.env.GROQ_API_KEY;
    resetEnvCache();
    const { accessToken } = await signUp();

    const response = await api()
      .post(PATH)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'audio/webm')
      .send(Buffer.from('fake audio'))
      .expect(503);

    expect(errorCode(response)).toBe(ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  });

  it('keeps the provider’s own words out of the answer', async () => {
    const { accessToken } = await signUp();
    groqSays('rate limit exceeded for model whisper-large-v3-turbo on account acct_123', false);

    const response = await api()
      .post(PATH)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'audio/webm')
      .send(Buffer.from('fake audio'))
      .expect(502);

    // A quota and a model name are for the log; the reader can act on neither.
    expect(errorCode(response)).toBe(ERROR_CODES.PROVIDER_ERROR);
    expect(JSON.stringify(response.body)).not.toContain('acct_123');
  });
});

describe('the format Whisper is told about', () => {
  /**
   * Whisper decides how to decode by the filename's extension, so the name is
   * load-bearing. Getting it wrong fails a recording that was perfectly good,
   * and fails it as "we could not make out that recording" — which sends
   * somebody off to blame their microphone.
   */
  it.each([
    // The native app's own format. It used to be called WebM here, because
    // 'audio/m4a' does not contain the substring 'mp4'.
    ['audio/m4a', 'audio.m4a'],
    ['audio/mp4', 'audio.mp4'],
    ['audio/webm;codecs=opus', 'audio.webm'],
    ['audio/ogg', 'audio.ogg'],
    ['audio/wav', 'audio.wav'],
  ])('sends %s as %s', (contentType, expected) => {
    expect(filenameFor(contentType)).toBe(expected);
  });
});
