/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PlannerMessage } from '../../types/planner.types';
import type { TripDraft } from '../../types/trip.types';
import { PlannerError, plannerService } from '../../services/planner.service';
import { chatService } from '../../services/chat.service';
import { usePlanner } from './usePlanner';

/**
 * A reply that arrives a few words at a time.
 *
 * The conversation holds one assistant message that is rewritten on every
 * chunk, not one appended when the answer is complete — so what these pin is
 * that the chunks accumulate into a single bubble rather than a dozen, that the
 * trip lands on that same bubble, and that a failure half way through keeps
 * whatever had already been said.
 */

function draft(): TripDraft {
  return {
    draftId: 'draft_kyoto',
    title: 'Three Days in Kyoto',
    destination: 'Kyoto',
    startDate: '2027-04-02',
    endDate: '2027-04-04',
    travellers: 2,
    coverImage: '/kyoto.jpg',
    itinerary: [],
  };
}

/** Replays a script through the handlers the hook passes in. */
function modelSays(...chunks: string[]) {
  return vi.spyOn(plannerService, 'chat').mockImplementation(async (_history, handlers) => {
    for (const chunk of chunks) handlers.onText(chunk);
  });
}

const aiMessages = (messages: PlannerMessage[]) =>
  messages.filter((message) => message.author === 'ai');

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generate', () => {
  it('gathers the chunks into one message, not one each', async () => {
    modelSays('Kyoto in ', 'April is ', 'lovely.');

    const { result } = renderHook(() => usePlanner());
    const before = aiMessages(result.current.messages).length;

    await act(async () => {
      await result.current.generate('plan 3 days in Kyoto');
    });

    const replies = aiMessages(result.current.messages);
    expect(replies).toHaveLength(before + 1);
    expect(replies.at(-1)?.content).toBe('Kyoto in April is lovely.');
    expect(result.current.status).toBe('idle');
  });

  it('shows the reply growing rather than appearing at the end', async () => {
    let emit: ((text: string) => void) | null = null;

    vi.spyOn(plannerService, 'chat').mockImplementation(
      (_history, handlers) =>
        new Promise((resolve) => {
          emit = (text) => {
            handlers.onText(text);
            resolve();
          };
        }),
    );

    const { result } = renderHook(() => usePlanner());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.generate('hello');
    });

    // Nothing said yet, but the composer is already busy.
    await waitFor(() => expect(result.current.isGenerating).toBe(true));

    await act(async () => {
      emit!('Half a sen');
      await pending;
    });

    expect(aiMessages(result.current.messages).at(-1)?.content).toBe('Half a sen');
  });

  it('attaches the trip to the message it was said in', async () => {
    vi.spyOn(plannerService, 'chat').mockImplementation(async (_history, handlers) => {
      handlers.onText('Here it is.');
      handlers.onTrip(draft());
    });

    const { result } = renderHook(() => usePlanner());

    await act(async () => {
      await result.current.generate('plan 3 days in Kyoto');
    });

    const reply = aiMessages(result.current.messages).at(-1);
    expect(reply?.trip?.destination).toBe('Kyoto');
    expect(reply?.content).toBe('Here it is.');
  });

  it('sends the prompt with the turns before it, capped', async () => {
    const chat = modelSays('ok');

    const { result } = renderHook(() => usePlanner());
    await act(async () => {
      await result.current.generate('plan 3 days in Kyoto');
    });

    const [history] = chat.mock.calls[0];
    expect(history.length).toBeLessThanOrEqual(20);
    expect(history.at(-1)).toEqual({ author: 'user', content: 'plan 3 days in Kyoto' });
  });

  it('saves the finished conversation once, not once per chunk', async () => {
    const save = vi.spyOn(chatService, 'saveMessages');
    modelSays('a', 'b', 'c', 'd');

    const { result } = renderHook(() => usePlanner());
    await act(async () => {
      await result.current.generate('hello');
    });

    // The user's message, then the completed reply. Four chunks, no extra writes.
    expect(save).toHaveBeenCalledTimes(2);
    expect(chatService.getMessages([]).at(-1)?.content).toBe('abcd');
  });

  it('keeps what was said before a failure, beside the error', async () => {
    vi.spyOn(plannerService, 'chat').mockImplementation(async (_history, handlers) => {
      handlers.onText('It is ');
      throw new PlannerError('The planner is busy. Try again in a moment.');
    });

    const { result } = renderHook(() => usePlanner());
    await act(async () => {
      await result.current.generate('what is the weather in Kyoto?');
    });

    expect(aiMessages(result.current.messages).at(-1)?.content).toBe('It is ');
    expect(result.current.status).toBe('error');
    // The server's own words, not a generic apology.
    expect(result.current.error).toBe('The planner is busy. Try again in a moment.');
  });

  it('falls back to a generic message for a failure that carries none', async () => {
    vi.spyOn(plannerService, 'chat').mockRejectedValue(new Error('socket hang up'));

    const { result } = renderHook(() => usePlanner());
    await act(async () => {
      await result.current.generate('hello');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Something went wrong');
  });

  it('treats a turn that said nothing as a failure, not an empty bubble', async () => {
    vi.spyOn(plannerService, 'chat').mockResolvedValue(undefined);

    const { result } = renderHook(() => usePlanner());
    const before = aiMessages(result.current.messages).length;

    await act(async () => {
      await result.current.generate('hello');
    });

    expect(aiMessages(result.current.messages)).toHaveLength(before);
    expect(result.current.status).toBe('error');
  });

  it('ignores an empty prompt without asking the model', async () => {
    const chat = modelSays('ok');

    const { result } = renderHook(() => usePlanner());
    await act(async () => {
      await result.current.generate('   ');
    });

    expect(chat).not.toHaveBeenCalled();
  });
});

/**
 * Changing your mind while an answer is arriving.
 *
 * The planner's replies are long, and the field used to be disabled until one
 * finished — so the most ordinary thing somebody wants to do, interrupt, meant
 * waiting the whole thing out.
 */
describe('stopping', () => {
  /** A reply that streams a word, then waits until the caller gives up. */
  function modelStalls() {
    return vi.spyOn(plannerService, 'chat').mockImplementation(
      async (_history, handlers, options) =>
        new Promise((_resolve, reject) => {
          handlers.onText('Kyoto is ');

          options?.signal?.addEventListener('abort', () => {
            // What `fetch` does with an aborted read.
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
  }

  it('keeps the half that arrived', async () => {
    modelStalls();
    const { result } = renderHook(() => usePlanner());

    act(() => void result.current.generate('Plan Kyoto'));
    await waitFor(() => expect(result.current.isGenerating).toBe(true));

    act(() => result.current.stop());

    await waitFor(() => expect(result.current.isGenerating).toBe(false));
    // Half an answer rather than a mistake: deleting words somebody has already
    // read is a strange thing for a Stop button to do.
    expect(aiMessages(result.current.messages).at(-1)?.content).toBe('Kyoto is ');
  });

  it('is not a failure', async () => {
    modelStalls();
    const { result } = renderHook(() => usePlanner());

    act(() => void result.current.generate('Plan Kyoto'));
    await waitFor(() => expect(result.current.isGenerating).toBe(true));

    act(() => result.current.stop());

    await waitFor(() => expect(result.current.status).toBe('idle'));
    // A turn the reader called off leaves no banner.
    expect(result.current.error).toBeNull();
  });

  it('does nothing when nothing is running', () => {
    const { result } = renderHook(() => usePlanner());

    expect(() => result.current.stop()).not.toThrow();
    expect(result.current.status).toBe('idle');
  });

  it('lets a new prompt supersede the answer in flight', async () => {
    const chat = vi.spyOn(plannerService, 'chat').mockImplementation(
      async (history, handlers, options) => {
        const prompt = history.at(-1)?.content ?? '';

        if (prompt === 'Plan Kyoto') {
          handlers.onText('Kyoto is ');
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          });
        }

        handlers.onText('Osaka it is.');
      },
    );

    const { result } = renderHook(() => usePlanner());

    act(() => void result.current.generate('Plan Kyoto'));
    await waitFor(() => expect(result.current.isGenerating).toBe(true));

    // Typing a second prompt is how somebody says they have changed their mind.
    act(() => void result.current.generate('Actually, Osaka'));

    await waitFor(() => expect(result.current.isGenerating).toBe(false));
    expect(chat).toHaveBeenCalledTimes(2);

    const contents = aiMessages(result.current.messages).map((message) => message.content);
    expect(contents.at(-1)).toBe('Osaka it is.');
    // And the abandoned half is still there, above the new question.
    expect(contents).toContain('Kyoto is ');
    expect(result.current.error).toBeNull();
  });

  it('does not answer offline a question that was withdrawn', async () => {
    // The one case where "the API is not configured" and "the reader changed
    // their mind" look identical from inside the service.
    const chat = vi.spyOn(plannerService, 'chat');
    chat.mockImplementation(async (_history, _handlers, options) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    });

    const { result } = renderHook(() => usePlanner());

    act(() => void result.current.generate('Plan Kyoto'));
    act(() => result.current.stop());

    await waitFor(() => expect(result.current.isGenerating).toBe(false));
    expect(result.current.error).toBeNull();
  });
});
