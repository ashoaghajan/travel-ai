/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSpeech } from './useSpeech';

/**
 * Dictation, exercised through a fake browser API.
 *
 * jsdom implements no `SpeechRecognition`, which is also the honest state of
 * Firefox — so the first thing these pin is that its absence is a feature that
 * does not appear rather than a crash.
 */

type Handlers = {
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

/** The last recognition the hook constructed, with the wires to drive it. */
let live: (Handlers & { started: number; stopped: number; aborted: number }) | null = null;

function installSpeechApi({ failToStart = false } = {}) {
  class FakeRecognition {
    lang = '';
    continuous = false;
    interimResults = false;
    onresult: Handlers['onresult'] = null;
    onerror: Handlers['onerror'] = null;
    onend: Handlers['onend'] = null;

    constructor() {
      live = Object.assign(this as unknown as Handlers, {
        started: 0,
        stopped: 0,
        aborted: 0,
      }) as never;
    }

    start() {
      if (failToStart) throw new Error('already started');
      (live as { started: number }).started += 1;
    }

    stop() {
      (live as { stopped: number }).stopped += 1;
      this.onend?.();
    }

    abort() {
      (live as { aborted: number }).aborted += 1;
    }
  }

  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
}

/** What the API sends as somebody speaks: revisions, then something settled. */
function said(transcript: string, isFinal: boolean) {
  return {
    resultIndex: 0,
    results: Object.assign([Object.assign([{ transcript }], { isFinal })], { length: 1 }),
  };
}

beforeEach(() => {
  live = null;
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('in a browser without the API', () => {
  it('reports itself unsupported rather than throwing', () => {
    const { result } = renderHook(() => useSpeech({ onText: vi.fn() }));

    // Firefox, today. The control simply does not appear.
    expect(result.current.isSupported).toBe(false);
  });

  it('does nothing when started anyway', () => {
    const { result } = renderHook(() => useSpeech({ onText: vi.fn() }));

    act(() => result.current.start());

    expect(result.current.isListening).toBe(false);
  });
});

describe('listening', () => {
  beforeEach(() => installSpeechApi());

  it('starts and stops', () => {
    const { result } = renderHook(() => useSpeech({ onText: vi.fn() }));

    act(() => result.current.start());
    expect(result.current.isListening).toBe(true);

    act(() => result.current.stop());
    expect(result.current.isListening).toBe(false);
  });

  it('toggles', () => {
    const { result } = renderHook(() => useSpeech({ onText: vi.fn() }));

    act(() => result.current.toggle());
    expect(result.current.isListening).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.isListening).toBe(false);
  });

  it('asks for the reader’s own language', () => {
    const { result } = renderHook(() => useSpeech({ onText: vi.fn() }));

    act(() => result.current.start());

    // A French speaker transcribed as if they were speaking English is worse
    // than no dictation at all.
    expect((live as unknown as { lang: string }).lang).toBe(navigator.language || 'en-US');
  });

  it('keeps listening through the pauses in a sentence', () => {
    const { result } = renderHook(() => useSpeech({ onText: vi.fn() }));

    act(() => result.current.start());

    // Somebody describing a trip thinks mid-sentence.
    expect((live as unknown as { continuous: boolean }).continuous).toBe(true);
  });
});

describe('what it heard', () => {
  beforeEach(() => installSpeechApi());

  it('commits only the settled words', () => {
    const onText = vi.fn();
    const { result } = renderHook(() => useSpeech({ onText }));
    act(() => result.current.start());

    act(() => live?.onresult?.(said('plan a trip to Kyo', false)));

    // The API revises what it thinks it heard as somebody speaks; writing each
    // revision into the field would fight whatever they are typing.
    expect(onText).not.toHaveBeenCalled();
    expect(result.current.interim).toBe('plan a trip to Kyo');

    act(() => live?.onresult?.(said('plan a trip to Kyoto', true)));

    expect(onText).toHaveBeenCalledWith('plan a trip to Kyoto');
  });

  it('forgets the interim words once it stops', () => {
    const { result } = renderHook(() => useSpeech({ onText: vi.fn() }));
    act(() => result.current.start());
    act(() => live?.onresult?.(said('half a sentence', false)));

    act(() => result.current.stop());

    expect(result.current.interim).toBe('');
  });
});

describe('when something goes wrong', () => {
  beforeEach(() => installSpeechApi());

  it('says how to fix a blocked microphone', () => {
    const { result } = renderHook(() => useSpeech({ onText: vi.fn() }));
    act(() => result.current.start());

    act(() => live?.onerror?.({ error: 'not-allowed' }));

    expect(result.current.error).toMatch(/blocked/i);
  });

  it('says nothing about an ordinary pause', () => {
    const { result } = renderHook(() => useSpeech({ onText: vi.fn() }));
    act(() => result.current.start());

    act(() => live?.onerror?.({ error: 'no-speech' }));

    // It fires when somebody is merely thinking. Saying so would be nagging.
    expect(result.current.error).toBeNull();
  });

  it('recovers when the API refuses to start', () => {
    installSpeechApi({ failToStart: true });
    const { result } = renderHook(() => useSpeech({ onText: vi.fn() }));

    act(() => result.current.start());

    expect(result.current.isListening).toBe(false);
    expect(result.current.error).toMatch(/try again/i);

    // And nothing is left holding a microphone that never opened.
    act(() => result.current.stop());
    expect(result.current.isListening).toBe(false);
  });
});

describe('leaving the screen', () => {
  beforeEach(() => installSpeechApi());

  it('closes the microphone', () => {
    const { result, unmount } = renderHook(() => useSpeech({ onText: vi.fn() }));
    act(() => result.current.start());

    unmount();

    // A microphone left open after the screen is gone is a privacy problem
    // rather than a leak of memory.
    expect((live as unknown as { aborted: number }).aborted).toBe(1);
  });
});
