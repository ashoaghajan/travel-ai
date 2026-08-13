/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { http } from './http';
import { speechService } from './speech.service';

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
});
