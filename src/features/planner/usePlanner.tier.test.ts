/**
 * @vitest-environment jsdom
 */
import type { ApiUser } from '@ai-travel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { plannerService } from '../../services/planner.service';
import { authService } from '../../services/auth.service';
import { authStore } from '../../store/auth.store';
import { usePlanner } from './usePlanner';

/**
 * Which planner answers, and why it is decided here rather than by the server.
 *
 * A free account must never call `/api/planner/chat` — it would be refused
 * with `PRO_REQUIRED`, and asking in order to be told no would put a round
 * trip in front of every free reply. So the tier is what picks the engine, and
 * that is what these pin.
 */

function user(plan: 'free' | 'pro'): ApiUser {
  return {
    id: `u_${plan}`,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    isGuest: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    identities: [],
    hasPassword: true,
    activeTripId: null,
    plan,
    proSince: plan === 'pro' ? '2026-08-13T00:00:00.000Z' : null,
    settings: {
      theme: 'system',
      currency: 'USD',
      notifications: { tripReminders: true, priceAlerts: false },
    },
  };
}

async function signedInAs(plan: 'free' | 'pro') {
  authStore.reset();
  vi.spyOn(authService, 'restore').mockResolvedValue(user(plan));
  await authStore.bootstrap();
}

/** Both engines, stubbed, so which one ran is the only thing under test. */
function bothEngines() {
  const chat = vi.spyOn(plannerService, 'chat').mockImplementation(async (_history, handlers) => {
    handlers.onText('from the model');
  });

  const local = vi
    .spyOn(plannerService, 'answerLocally')
    .mockImplementation(async (_prompt, handlers) => {
      handlers.onText('from the templates');
    });

  return { chat, local };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  authStore.reset();
  vi.restoreAllMocks();
});

describe('choosing a planner by tier', () => {
  it('answers a free account from the rule engine, without calling the API', async () => {
    await signedInAs('free');
    const { chat, local } = bothEngines();

    const { result } = renderHook(() => usePlanner());
    await act(async () => {
      await result.current.generate('Five days in Kyoto');
    });

    expect(local).toHaveBeenCalledWith('Five days in Kyoto', expect.anything(), expect.anything());
    // The endpoint would answer 403. Asking anyway would cost a round trip to
    // be told something the client already knew.
    expect(chat).not.toHaveBeenCalled();
  });

  it('answers a Pro account from the model', async () => {
    await signedInAs('pro');
    const { chat, local } = bothEngines();

    const { result } = renderHook(() => usePlanner());
    await act(async () => {
      await result.current.generate('Five days in Kyoto');
    });

    expect(chat).toHaveBeenCalled();
    expect(local).not.toHaveBeenCalled();
  });

  it('sends only the prompt to the rule engine, not the history', async () => {
    await signedInAs('free');
    const { local } = bothEngines();

    const { result } = renderHook(() => usePlanner());
    await act(async () => {
      await result.current.generate('Five days in Kyoto');
    });

    // The rule engine reads one sentence. Handing it a transcript would imply
    // a conversation it cannot hold — that is the Pro planner's job.
    expect(local.mock.calls[0][0]).toBe('Five days in Kyoto');
  });

  it('switches engine on the next prompt after an upgrade, with no reload', async () => {
    await signedInAs('free');
    const { chat, local } = bothEngines();

    const { result } = renderHook(() => usePlanner());
    await act(async () => {
      await result.current.generate('Five days in Kyoto');
    });
    expect(local).toHaveBeenCalledTimes(1);

    // What clicking Upgrade does, through the real store action.
    vi.spyOn(authService, 'setPlan').mockResolvedValue(user('pro'));
    await act(async () => {
      await authStore.setPlan('pro');
    });

    await act(async () => {
      await result.current.generate('Make it seven');
    });

    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    // The upgrade must not re-run the engine the account has left behind.
    expect(local).toHaveBeenCalledTimes(1);
  });

  it('puts the rule engine reply in the transcript like any other', async () => {
    await signedInAs('free');
    bothEngines();

    const { result } = renderHook(() => usePlanner());
    await act(async () => {
      await result.current.generate('Five days in Kyoto');
    });

    // Same bubble, same shape. Save and Customise cannot tell the tiers apart,
    // and neither should the reader beyond the note above the composer.
    const last = result.current.messages.at(-1);
    expect(last?.author).toBe('ai');
    expect(last?.content).toBe('from the templates');
  });
});
