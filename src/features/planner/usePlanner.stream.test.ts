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
