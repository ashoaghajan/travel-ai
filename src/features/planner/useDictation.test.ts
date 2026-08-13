/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDictation } from './useDictation';

/**
 * Which of the two routes a device takes, and when the URL may overrule it.
 *
 * Both hooks are stubbed: what is under test here is the choosing, not the
 * recording or the listening, and each of those has a suite of its own.
 */

const speech = {
  isSupported: true,
  isListening: false,
  interim: 'half a sentence',
  error: null as string | null,
  debug: ['a line'],
  start: vi.fn(),
  stop: vi.fn(),
  toggle: vi.fn(),
};

const recorder = {
  isSupported: true,
  isRecording: false,
  isTranscribing: false,
  isUnavailable: false,
  error: null as string | null,
  start: vi.fn(),
  stop: vi.fn(),
  toggle: vi.fn(),
};

vi.mock('./useSpeech', () => ({ useSpeech: () => speech }));
vi.mock('./useRecorder', () => ({ useRecorder: () => recorder }));

/** A finger, or a mouse. The question the pointer is really being asked. */
function setPointer(coarse: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query.includes('coarse') && coarse }),
  });
}

function visit(search = '') {
  window.history.replaceState({}, '', `/${search}`);
}

beforeEach(() => {
  speech.isSupported = true;
  recorder.isSupported = true;
  recorder.isUnavailable = false;
  visit();
});

afterEach(() => vi.clearAllMocks());

describe('choosing a route by device', () => {
  it('records on a touch device', () => {
    setPointer(true);

    const { result } = renderHook(() => useDictation({ onText: vi.fn() }));
    result.current.toggle();

    expect(recorder.toggle).toHaveBeenCalled();
    expect(speech.toggle).not.toHaveBeenCalled();
    // The recorded route has no revisions to show, only a wait.
    expect(result.current.interim).toBe('');
  });

  it('listens everywhere else', () => {
    setPointer(false);

    const { result } = renderHook(() => useDictation({ onText: vi.fn() }));
    result.current.toggle();

    expect(speech.toggle).toHaveBeenCalled();
    expect(recorder.toggle).not.toHaveBeenCalled();
    expect(result.current.interim).toBe('half a sentence');
  });

  it('listens on a phone that cannot record, rather than offering nothing', () => {
    setPointer(true);
    recorder.isSupported = false;

    const { result } = renderHook(() => useDictation({ onText: vi.fn() }));
    result.current.toggle();

    expect(speech.toggle).toHaveBeenCalled();
  });
});

describe('the URL overriding the device', () => {
  it('records on a desktop when asked to', () => {
    setPointer(false);
    visit('?dictate=record');

    // The whole point: the recorded route runs on a phone, which is the worst
    // place to watch a network panel. This exercises it where the tools are.
    const { result } = renderHook(() => useDictation({ onText: vi.fn() }));
    result.current.toggle();

    expect(recorder.toggle).toHaveBeenCalled();
    expect(speech.toggle).not.toHaveBeenCalled();
  });

  it('listens on a phone when asked to', () => {
    setPointer(true);
    visit('?dictate=live');

    const { result } = renderHook(() => useDictation({ onText: vi.fn() }));
    result.current.toggle();

    expect(speech.toggle).toHaveBeenCalled();
    expect(recorder.toggle).not.toHaveBeenCalled();
  });

  it('ignores a value it does not know', () => {
    setPointer(false);
    visit('?dictate=yes');

    const { result } = renderHook(() => useDictation({ onText: vi.fn() }));
    result.current.toggle();

    expect(speech.toggle).toHaveBeenCalled();
  });

  it('cannot conjure a recorder the browser does not have', () => {
    setPointer(false);
    recorder.isSupported = false;
    visit('?dictate=record');

    // A button that lies is worse than no button, whatever the URL asked for.
    const { result } = renderHook(() => useDictation({ onText: vi.fn() }));

    expect(result.current.toggle).toBe(speech.toggle);
  });
});

describe('a server with no transcription key', () => {
  it('withdraws the button on the recorded route', () => {
    setPointer(true);
    recorder.isUnavailable = true;
    recorder.error = 'Dictation is not switched on for this server.';

    const { result } = renderHook(() => useDictation({ onText: vi.fn() }));

    expect(result.current.isSupported).toBe(false);
    // The message outlives the button, or nobody learns why it went.
    expect(result.current.error).toMatch(/not switched on/i);

    recorder.error = null;
  });
});
