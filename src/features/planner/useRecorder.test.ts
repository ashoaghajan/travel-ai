/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { speechService } from '../../services/speech.service';
import { useRecorder } from './useRecorder';

/**
 * Dictation for a phone: record, stop, transcribe once.
 *
 * The live engine repeated itself because it delivered a stream of revisions.
 * There is no stream here — one recording produces one transcript — so the
 * whole class of bug is gone by construction rather than by care.
 */

let recorder: {
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  mimeType: string;
  started: number;
  stopped: number;
} | null = null;

const tracks: { stopped: number }[] = [];

function installRecorderApi({ deny = false } = {}) {
  class FakeRecorder {
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    mimeType = 'audio/webm';

    constructor() {
      recorder = Object.assign(this as never, { started: 0, stopped: 0 });
    }

    start() {
      (recorder as { started: number }).started += 1;
    }

    stop() {
      (recorder as { stopped: number }).stopped += 1;
      this.onstop?.();
    }

    static isTypeSupported() {
      return true;
    }
  }

  (window as unknown as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;

  const track = { stopped: 0, stop() { this.stopped += 1; } };
  tracks.push(track);

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: deny
        ? vi.fn().mockRejectedValue(new Error('denied'))
        : vi.fn().mockResolvedValue({ getTracks: () => [track] }),
    },
  });
}

/** What the browser hands over as a recording finishes. */
function recorded(bytes = 1024) {
  recorder?.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
}

beforeEach(() => {
  recorder = null;
  tracks.length = 0;
});

afterEach(() => {
  delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  vi.restoreAllMocks();
});

describe('where nothing can record', () => {
  it('says so rather than offering a button that cannot work', () => {
    const { result } = renderHook(() => useRecorder({ onText: vi.fn() }));

    expect(result.current.isSupported).toBe(false);
  });
});

describe('recording', () => {
  beforeEach(() => installRecorderApi());

  it('transcribes one recording once', async () => {
    const transcribe = vi
      .spyOn(speechService, 'transcribe')
      .mockResolvedValue('create a trip to Abu Dhabi');
    const onText = vi.fn();

    const { result } = renderHook(() => useRecorder({ onText }));

    await act(async () => result.current.start());
    await waitFor(() => expect(result.current.isRecording).toBe(true));

    act(() => recorded());
    act(() => result.current.stop());

    await waitFor(() => expect(onText).toHaveBeenCalledWith('create a trip to Abu Dhabi'));
    // One take, one pass, one sentence: there is no stream of revisions to
    // reassemble and so nothing to reassemble wrongly.
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledTimes(1);
  });

  it('says it is working while the words are on their way', async () => {
    let finish: (text: string) => void = () => undefined;
    vi.spyOn(speechService, 'transcribe').mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );

    const { result } = renderHook(() => useRecorder({ onText: vi.fn() }));
    await act(async () => result.current.start());
    act(() => recorded());
    act(() => result.current.stop());

    await waitFor(() => expect(result.current.isTranscribing).toBe(true));

    await act(async () => finish('done'));
    expect(result.current.isTranscribing).toBe(false);
  });

  it('releases the microphone when the take ends', async () => {
    vi.spyOn(speechService, 'transcribe').mockResolvedValue('');

    const { result } = renderHook(() => useRecorder({ onText: vi.fn() }));
    await act(async () => result.current.start());
    act(() => recorded());
    act(() => result.current.stop());

    // On a phone the recording indicator stays lit until every track is
    // stopped, and a light that outlives the recording is alarming.
    expect(tracks[0].stopped).toBe(1);
  });

  it('sends nothing when nothing was said', async () => {
    const transcribe = vi.spyOn(speechService, 'transcribe').mockResolvedValue('');

    const { result } = renderHook(() => useRecorder({ onText: vi.fn() }));
    await act(async () => result.current.start());
    act(() => result.current.stop());

    expect(transcribe).not.toHaveBeenCalled();
  });

  it('says so when the transcription fails, and keeps the button usable', async () => {
    vi.spyOn(speechService, 'transcribe').mockRejectedValue(new Error('502'));

    const { result } = renderHook(() => useRecorder({ onText: vi.fn() }));
    await act(async () => result.current.start());
    act(() => recorded());
    act(() => result.current.stop());

    await waitFor(() => expect(result.current.error).toMatch(/could not make out/i));
    expect(result.current.isTranscribing).toBe(false);
  });
});

describe('when the microphone is refused', () => {
  beforeEach(() => installRecorderApi({ deny: true }));

  it('says how to fix it and records nothing', async () => {
    const { result } = renderHook(() => useRecorder({ onText: vi.fn() }));

    await act(async () => result.current.start());

    expect(result.current.error).toMatch(/blocked/i);
    expect(result.current.isRecording).toBe(false);
  });
});
