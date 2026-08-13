/**
 * @vitest-environment jsdom
 */
import { ERROR_CODES } from '@ai-travel/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, http } from './http';
import { DictationUnavailableError, speechService } from './speech.service';

/** The wire shape. What to do with a recording is the recorder's problem. */

describe('speechService', () => {
  it('posts the recording as it is', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({ text: 'create a trip' });
    const audio = new Blob([new Uint8Array(8)], { type: 'audio/webm' });

    await expect(speechService.transcribe(audio)).resolves.toBe('create a trip');

    // The blob goes through untouched: serialising it would produce `{}`, which
    // is a silent and baffling failure rather than a loud one.
    expect(post).toHaveBeenCalledWith('/speech/transcribe', audio);
  });

  it('trims what comes back', async () => {
    vi.spyOn(http, 'post').mockResolvedValue({ text: '  hello  \n' });

    await expect(speechService.transcribe(new Blob([]))).resolves.toBe('hello');
  });

  it('names an unset key as its own failure', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(
      new ApiError(503, ERROR_CODES.PROVIDER_NOT_CONFIGURED, 'Dictation is not switched on.'),
    );

    // The one failure another recording cannot fix, so the recorder needs to
    // tell it apart from a provider that merely stumbled.
    await expect(speechService.transcribe(new Blob([]))).rejects.toBeInstanceOf(
      DictationUnavailableError,
    );
  });

  it('leaves every other failure alone', async () => {
    vi.spyOn(http, 'post').mockRejectedValue(
      new ApiError(502, ERROR_CODES.PROVIDER_ERROR, 'We could not make out that recording.'),
    );

    await expect(speechService.transcribe(new Blob([]))).rejects.toBeInstanceOf(ApiError);
  });
});
