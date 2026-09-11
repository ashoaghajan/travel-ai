import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConfirmedStay,
  PendingStay,
  PlannerMessage,
  PlannerStatus,
  TravelPreferences,
} from '../../core/types/planner.types';
import type { TripDraft } from '../../core/types/trip.types';
import { PlannerError, plannerService } from '../../core/services/planner.service';
import type { PlannerHandlers } from '../../core/services/planner.service';
import {
  advanceStay,
  asksForATripInstead,
  pickStay,
  rejectStayCandidates,
} from '../../core/services/planner.stay';
import type { StayStep } from '../../core/services/planner.stay';
import { chatService } from '../../core/services/chat.service';
import { settingsService } from '../../core/services/settings.service';
import { tripStore, useTrips } from '../../core/store/trip.store';
import { bookingStore } from '../../core/store/booking.store';
import { SEED_CONVERSATION } from '../../core/mock/planner';
import { useCurrentUser } from '../../core/hooks/useCurrentUser';
import { createId } from '../../core/utils/id';

const GENERATION_ERROR = 'Something went wrong while planning that trip. Please try again.';
const SAVE_ERROR = 'We could not save this trip. Your browser storage may be full or blocked.';
const HISTORY_ERROR = 'This conversation is not being saved — your browser storage may be blocked.';

/**
 * How many turns travel with a prompt.
 *
 * Enough for the model to follow a conversation about one trip; capped because
 * the whole slice is re-sent and re-read on every message, so the cost of a
 * chat would otherwise grow with its length. The server enforces the same
 * ceiling — this is the polite half of it.
 */
const HISTORY_LIMIT = 20;

/** Retires a question that has been answered, and the list it was rendered as. */
function withoutPendingStay(message: PlannerMessage): PlannerMessage {
  return message.pendingStay ? { ...message, pendingStay: undefined } : message;
}

/**
 * The newest stay this conversation has settled, if any.
 *
 * Read back off the transcript rather than held in state, for the same reason
 * the pending question is: a conversation resumed on another device should not
 * re-ask something it has already been told.
 */
function settledStay(messages: PlannerMessage[]): ConfirmedStay | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const confirmed = messages[index].confirmedStay;
    if (confirmed) return confirmed;
  }

  return undefined;
}

/**
 * One step of the stay conversation, put on screen.
 *
 * Either it asks again — a list to pick from, or the address — or it has
 * enough and the interrupted turn carries on from where it stopped. The
 * trailing space matters: a step that has something to say says it in front of
 * whatever the engine then writes, and the two run together without it.
 *
 * Returns what was settled, which the caller records on the reply so the rest
 * of the conversation does not ask again.
 */
async function applyStayStep(
  step: StayStep,
  destination: string | null,
  handlers: PlannerHandlers,
  signal: AbortSignal,
  preferences: TravelPreferences,
): Promise<ConfirmedStay | undefined> {
  if (step.kind === 'ask') {
    handlers.onText(step.reply);
    handlers.onStayNeeded(step.pending);
    return undefined;
  }

  if (step.reply) handlers.onText(`${step.reply} `);

  await plannerService.resume(step.resume, step.stay, handlers, { signal, preferences });

  return { destination, stay: step.stay };
}

/**
 * Owns the planner conversation: sending a prompt, holding the generated
 * itinerary, and saving it.
 *
 * The conversation is persisted through `chatService`, so a reload resumes
 * where the user left off, and which itineraries are already saved is derived
 * from the trip store rather than component state — that survives reload too.
 */
export function usePlanner() {
  const trips = useTrips();
  const { isPro } = useCurrentUser();

  const [messages, setMessages] = useState<PlannerMessage[]>(() =>
    chatService.getMessages(SEED_CONVERSATION),
  );
  // Mirrors `messages` so async work appends to the latest list, not a stale closure.
  const messagesRef = useRef(messages);

  const [status, setStatus] = useState<PlannerStatus>('idle');

  /**
   * The turn in flight, so it can be called off.
   *
   * Deliberately **not** aborted on unmount. The reply is written to storage
   * when it finishes, so navigating away mid-answer and coming back finds it
   * waiting — cancelling on unmount would throw away an answer nobody asked to
   * stop.
   */
  const abortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null);

  /**
   * State and ref, without touching storage.
   *
   * Used for every frame of a streaming reply. Persisting each one would mean a
   * `localStorage` write — and a JSON serialisation of the whole conversation —
   * per handful of characters; the finished message is saved once instead.
   */
  const paintMessages = useCallback((next: PlannerMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  /** Single write path: state, ref and storage always move together. */
  const commitMessages = useCallback(
    (next: PlannerMessage[]) => {
      paintMessages(next);

      try {
        chatService.saveMessages(next);
      } catch {
        // The conversation still works in memory; only persistence failed.
        setError(HISTORY_ERROR);
      }
    },
    [paintMessages],
  );

  // Another tab (or another write in this one) replaced the history.
  useEffect(
    () =>
      chatService.subscribe(() => {
        const next = chatService.getMessages(SEED_CONVERSATION);
        const current = messagesRef.current;

        // Ignore the echo of our own write.
        if (next.length === current.length && next.at(-1)?.id === current.at(-1)?.id) return;

        messagesRef.current = next;
        setMessages(next);
      }),
    [],
  );

  /** draftId → id of the saved trip, rebuilt whenever saved trips change. */
  const savedTripIds = useMemo(() => {
    const byDraft = new Map<string, string>();
    for (const trip of trips) {
      if (trip.draftId) byDraft.set(trip.draftId, trip.id);
    }
    return byDraft;
  }, [trips]);

  const savedTripIdFor = useCallback(
    (draft: TripDraft | undefined) =>
      draft?.draftId ? savedTripIds.get(draft.draftId) : undefined,
    [savedTripIds],
  );

  /**
   * One turn, from an opening transcript to a committed reply.
   *
   * Shared by the two things that can start a turn — typing, and picking a
   * hotel off a list — because everything around the answer is the same either
   * way: supersede whatever is in flight, paint the reply as it grows, commit
   * once at the end, and tell a stop from a failure. Only `run` differs, and
   * what it does with the handlers is the whole difference between them.
   *
   * The answer is streamed, so there is one assistant message rewritten on
   * every chunk rather than one appended when it is complete. `base` is fixed
   * before the first token: the reply is always rendered as `[...base, reply]`,
   * which needs no reasoning about what the previous frame left behind.
   */
  const runTurn = useCallback(
    async (
      base: PlannerMessage[],
      run: (
        handlers: PlannerHandlers,
        signal: AbortSignal,
      ) => Promise<ConfirmedStay | undefined>,
    ) => {
      /*
       * A new turn supersedes the one in flight.
       *
       * Which is what somebody means by typing while an answer is arriving:
       * they have changed their mind, and waiting for a reply they no longer
       * want before asking is the behaviour this exists to remove.
       */
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      commitMessages(base);
      setStatus('generating');

      const replyId = createId('message');
      let content = '';
      let trip: TripDraft | undefined;
      let pendingStay: PendingStay | undefined;
      let confirmedStay: ConfirmedStay | undefined;

      const reply = (): PlannerMessage[] => [
        ...base,
        { id: replyId, author: 'ai', content, trip, pendingStay, confirmedStay },
      ];

      const handlers: PlannerHandlers = {
        onText: (text: string) => {
          content += text;
          paintMessages(reply());
        },
        onTrip: (draft: TripDraft) => {
          trip = draft;
          paintMessages(reply());
        },
        /*
         * The planner needs to know where they are staying before it can
         * build anything. The question is already in `content` — this is the
         * part the reader cannot see: what it is waiting for, and how to
         * carry on once they answer. It rides on the message so a reload or a
         * second device picks the conversation up mid-question.
         */
        onStayNeeded: (waiting: PendingStay) => {
          pendingStay = waiting;
          paintMessages(reply());
        },
      };

      try {
        // Recorded before the commit below, so the answer and the fact that it
        // was answered are written to storage together.
        confirmedStay = await run(handlers, controller.signal);

        // A turn that produced neither words nor a trip has nothing to show,
        // and an empty bubble is worse than saying so.
        if (!content && !trip) throw new Error('empty reply');

        // The one write to storage for this turn.
        commitMessages(reply());
        setStatus('idle');
        abortRef.current = null;
      } catch (caught) {
        /*
         * Stopped, rather than broken.
         *
         * Read from the signal rather than from the error, because what
         * arrives here is whatever `fetch` chose to reject with — and a turn
         * the reader called off is not a failure to report. No banner, no
         * error state, and however much had arrived stays where it is.
         *
         * **Only while this is still the turn in flight.** When the stop came
         * from a newer prompt, that turn is already painting its own answer
         * and its `base` contains whatever this one had said — so writing this
         * snapshot back would undo a live conversation with a stale copy of
         * itself, and setting the status would claim nothing is happening
         * while something is.
         */
        if (controller.signal.aborted) {
          if (abortRef.current !== controller) return;

          if (content || trip) commitMessages(reply());
          setStatus('idle');
          abortRef.current = null;

          return;
        }

        // Whatever arrived before the failure stays on screen — losing half an
        // answer is more confusing than keeping it beside the error.
        if (content || trip) commitMessages(reply());

        setStatus('error');
        setError(caught instanceof PlannerError ? caught.message : GENERATION_ERROR);
      }
    },
    [commitMessages, paintMessages],
  );

  /** Send a prompt, or answer the question the planner is waiting on. */
  const generate = useCallback(
    async (prompt: string): Promise<void> => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      const previous = messagesRef.current;

      /*
       * A stay question outstanding makes this prompt its answer, whatever it
       * says. The engines are not consulted: a hotel name is not a sentence
       * either of them could classify, and "Astoria" would read to the rule
       * engine as a request for a trip to somewhere called Astoria.
       *
       * Only the newest message counts. A reader who scrolled past the
       * question and typed something else is answering it — but one who
       * answered it already has moved on, and the question is cleared as it is
       * consumed so it cannot catch a later sentence.
       *
       * **Unless they have plainly asked for a different trip.** Then the
       * question is abandoned rather than answered: sending "create a new trip
       * in Tbilisi from 14 to 18 of September" to the hotel lookup produced "I
       * could not find 'create a new trip in Tbilisi from 14 to 18 of
       * September' on the map", which is a planner arguing with somebody who
       * has moved on. The new prompt asks its own stay question, so nothing is
       * lost by dropping this one.
       */
      const pending = previous.at(-1)?.pendingStay;
      const waiting = pending && !asksForATripInstead(trimmed) ? pending : undefined;

      const base: PlannerMessage[] = [
        // Retired either way: a question that has been answered and one that
        // has been walked away from are both finished with.
        ...(pending ? previous.map(withoutPendingStay) : previous),
        { id: createId('message'), author: 'user', content: trimmed },
      ];

      /*
       * Read at send time from the cache rather than held in state.
       * `settingsService` is synchronous and always current — a preference
       * changed in the settings screen a moment ago applies to this prompt,
       * without this hook subscribing to a store it otherwise has no use for.
       */
      const preferences = settingsService.getSettings().travel;

      const known = settledStay(previous);

      return runTurn(base, async (handlers, signal) => {
        if (waiting) {
          return applyStayStep(
            await advanceStay(waiting, trimmed),
            waiting.destination,
            handlers,
            signal,
            preferences,
          );
        }

        /*
         * The engine comes from the account, not from whether the server
         * answered.
         *
         * A free account never calls the chat endpoint — it would be refused
         * with `PRO_REQUIRED`, and asking in order to be told no would put a
         * round trip in front of every free reply. The tier is read at send
         * time rather than captured, so upgrading takes effect on the next
         * prompt with no reload.
         *
         * `chat` keeps its own fallback to this same rule engine for a Pro
         * account on a server with no key — so the two tiers are two ways of
         * reaching one implementation, not two implementations.
         */
        await (isPro
          ? plannerService.chat(
              // Only the recent turns: the whole history is re-sent and re-read
              // on every message, so an unbounded conversation would cost more
              // with each one. Matches the server's own cap.
              base
                .slice(-HISTORY_LIMIT)
                .map(({ author, content: text }) => ({ author, content: text })),
              handlers,
              // The same preferences the free engine gets. The model may
              // override one for this trip; the scheduler builds the days
              // either way, so a Pro trip keeps the reader's own hours.
              { signal, preferences, knownStay: known },
            )
          : plannerService.answerLocally(trimmed, handlers, {
              signal,
              preferences,
              knownStay: known,
            }));

        // Nothing settled here: this branch either planned or asked, and the
        // asking branch records its answer on the turn that supplies it.
        return undefined;
      });
    },
    // `isPro` belongs here: an upgrade must change which engine the next
    // prompt runs, and a callback that closed over the old tier would keep
    // answering from templates until something else happened to remake it.
    [runTurn, isPro],
  );

  /**
   * A hotel picked off the list, or none of them.
   *
   * `candidateId` is null for "none of these", which asks for an address
   * rather than for the name again — the name has already been tried and the
   * list is what it produced.
   *
   * Keyed by message rather than taken from the end of the conversation, so a
   * tap on a list that has since been answered does nothing instead of
   * answering the wrong question. Clearing the pending state is what retires
   * the list on screen.
   */
  const chooseStay = useCallback(
    async (messageId: string, candidateId: string | null) => {
      const previous = messagesRef.current;
      const index = previous.findIndex((message) => message.id === messageId);
      const pending = index === -1 ? undefined : previous[index].pendingStay;

      if (!pending) return;

      const step =
        candidateId === null ? rejectStayCandidates(pending) : pickStay(pending, candidateId);

      // A candidate id the message does not carry — a stale render, or a
      // transcript written by an older version. A tap that does not land.
      if (!step) return;

      const base = previous.map((message, at) =>
        at === index ? withoutPendingStay(message) : message,
      );
      const preferences = settingsService.getSettings().travel;

      await runTurn(base, (handlers, signal) =>
        applyStayStep(step, pending.destination, handlers, signal, preferences),
      );
    },
    [runTurn],
  );

  /**
   * Persist a suggested itinerary.
   *
   * Returns the trip so a caller can act on it — `customiseTrip` needs its id
   * to navigate. Null means the write failed and `error` now says so; the
   * caller should stay where it is.
   */
  const saveTrip = useCallback(async (messageId: string, draft: TripDraft) => {
    setSavingMessageId(messageId);
    setError(null);

    try {
      // Idempotent by draftId — saving twice returns the existing trip.
      const trip = await tripStore.saveTrip(draft);

      /*
       * The schedule, filed as bookings, so the trip arrives with its Bookings
       * tab already showing what it involves rather than "Nothing booked yet"
       * beside three full days.
       *
       * Deliberately not fatal. The trip is saved by this point, and a full or
       * blocked storage must not report that as a failure and send the reader
       * back to press Save again — the schedule is on the trip either way, and
       * every stop can still be added from the catalogue by hand. Idempotent,
       * so a later save of the same draft fills in whatever did not land.
       */
      try {
        await bookingStore.createFromItinerary(trip);
      } catch {
        // Nothing to tell the reader: what they asked for succeeded.
      }

      return trip;
    } catch {
      setError(SAVE_ERROR);
      return null;
    } finally {
      setSavingMessageId(null);
    }
  }, []);

  /**
   * Save, so there is something to edit, and hand back the trip to open.
   *
   * Customising a suggestion means committing to it — there is no editing
   * surface for a draft, and building one would duplicate everything
   * `TripDetailsPage` already does. The save is idempotent, so pressing Save
   * Trip first and then Customise still yields a single trip.
   */
  const customiseTrip = useCallback(
    async (messageId: string, draft: TripDraft) => saveTrip(messageId, draft),
    [saveTrip],
  );

  /**
   * Calls off the turn in flight.
   *
   * Whatever arrived stays: it is half an answer rather than a mistake, and
   * deleting words somebody has already read is a strange thing for a Stop
   * button to do.
   */
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearConversation = useCallback(() => {
    // Nothing should go on writing into a conversation that has been emptied.
    abortRef.current?.abort();
    chatService.clear();
    messagesRef.current = SEED_CONVERSATION;
    setMessages(SEED_CONVERSATION);
    setStatus('idle');
    setError(null);
  }, []);

  return {
    messages,
    status,
    error,
    savingMessageId,
    isGenerating: status === 'generating',
    savedTripIdFor,
    generate,
    chooseStay,
    stop,
    saveTrip,
    customiseTrip,
    clearConversation,
  };
}
