import { ERROR_CODES } from '@ai-travel/shared';
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator, MemoryStore } from 'express-rate-limit';
import { HttpError } from '../../errors';
import { requireAuth, userIdOf } from '../auth/requireAuth';
import { isConfigured, transcribe } from './groq';

/**
 * `POST /api/speech/transcribe` — a recording in, a sentence out.
 *
 * Exists because the browser's own speech engine is not usable on a phone: it
 * repeats itself in ways three attempts failed to tame. A desktop keeps using
 * its own, for nothing; a phone records and sends the audio here.
 *
 * **The audio is not stored.** It is held in memory for the length of one
 * request, forwarded to the provider and dropped. There is no field to write it
 * to and no reason to keep somebody's voice.
 */
export const speechRouter = Router();

/**
 * The most audio one request may carry.
 *
 * A minute of Opus is around 500KB, so this is several minutes of talking — far
 * more than a prompt — and small enough that a phone on a bad connection fails
 * quickly rather than uploading for a minute before finding out.
 */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

const store = new MemoryStore();

/** Held so the suite can clear the counter between tests. */
export function resetSpeechRateLimit(): void {
  store.resetAll?.();
}

/**
 * Transcriptions, throttled by account.
 *
 * Tighter than the message limiter and for a different reason: this one spends
 * somebody else's quota per call and carries megabytes per call. Sized to a
 * person dictating rather than to what the provider will take.
 */
const transcribeRateLimit = rateLimit({
  store,
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.DISABLE_RATE_LIMIT === '1',
  keyGenerator: (request: Request) =>
    request.userId ? `speech:${request.userId}` : ipKeyGenerator(request.ip ?? ''),
  handler: (_request: Request, response: Response) => {
    response.status(429).json({
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'That is a lot of dictation. Give it a moment.',
        details: null,
      },
    });
  },
});

speechRouter.post(
  '/speech/transcribe',
  requireAuth,
  transcribeRateLimit,
  /*
   * The recording arrives as bytes rather than as a form.
   *
   * `express.raw` on the one route that needs it, rather than a multipart
   * parser as a dependency for a single field: the browser has one blob to
   * send and its type is in the header. The global `express.json` above
   * ignores an audio content type, so the two do not collide.
   */
  express.raw({ type: ['audio/*'], limit: MAX_AUDIO_BYTES }),
  async (request: Request, response: Response) => {
    if (!isConfigured()) {
      throw new HttpError(
        503,
        ERROR_CODES.PROVIDER_NOT_CONFIGURED,
        'Dictation is not switched on.',
      );
    }

    const audio = request.body;

    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Send an audio recording.');
    }

    const contentType = request.headers['content-type'] ?? 'audio/webm';

    try {
      const text = await transcribe(audio, contentType);

      response.json({ text });
    } catch (error) {
      // The provider's own words are for the log, never for the reader: they
      // name a model and a quota nobody here can act on.
      console.error('[speech] transcription failed', error, 'for', userIdOf(request));

      throw new HttpError(
        502,
        ERROR_CODES.PROVIDER_ERROR,
        'We could not make out that recording. Try again.',
      );
    }
  },
);
