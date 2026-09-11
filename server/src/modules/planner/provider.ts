import type { PlannerChatMessage, PlannerTripBrief } from '@ai-travel/shared';
import type { HttpError } from '../../errors';
import { env } from '../../env';
import * as anthropic from './anthropic';
import type { TurnContext } from './anthropic';

/**
 * The planner's model, behind an interface.
 *
 * There are two reasons this exists, and only one of them is "you might swap
 * providers".
 *
 * **The app must work with no model at all.** That is not a degraded mode any
 * more — the scheduler builds every trip, for every tier, and a free account
 * never reaches this file. What a model adds is understanding a paragraph and
 * writing a reply, which is worth paying for and is not worth depending on. So
 * "no provider" is a first-class configuration rather than an outage, and
 * `isConfigured()` is what the route asks before it opens a stream.
 *
 * **And the model is not a particular company's.** Everything above this line
 * speaks in `PlannerChatMessage` and `PlannerTripBrief` — a conversation in,
 * prose and constraints out. Nothing about that shape is Anthropic's, which is
 * what makes a second implementation a new file rather than a refactor: an
 * OpenAI-compatible endpoint, or a model running on the reader's own machine
 * through Ollama, implements the same three functions and is selected by
 * `PLANNER_PROVIDER`.
 *
 * What a new provider owes this interface, beyond the obvious: `streamChat`
 * must call `onText` as the words arrive rather than at the end, and must
 * validate its own tool input before `onBrief` — the client renders a trip
 * from that brief, and a malformed one should become a retry the model can
 * see rather than a broken card in somebody's chat.
 */

export type { TurnContext };

export type PlannerHandlers = {
  /** One chunk of the reply, as it is generated. */
  onText: (text: string) => void;
  /** The model understood the trip. At most once per turn. */
  onBrief: (brief: PlannerTripBrief) => void;
};

export type PlannerProvider = {
  /** For logs and for the `PLANNER_PROVIDER` value that selects it. */
  readonly id: string;
  /** Whether this deployment has what the provider needs — usually a key. */
  isConfigured(): boolean;
  /** The refusal to send when it does not. A fact about the deployment. */
  notConfigured(): HttpError;
  /**
   * One turn. Resolves with the reason the model stopped.
   *
   * `context` is what is true of this reader right now rather than of the app
   * — today's date, and the radius they plan within. A provider is free to
   * present it however its API wants, but it may not drop it: the radius is
   * what makes the model stop and ask which hotel, and a provider that
   * ignored it would plan trips around the middle of the wrong city.
   */
  streamChat(
    history: PlannerChatMessage[],
    handlers: PlannerHandlers,
    options?: { context?: TurnContext; signal?: AbortSignal },
  ): Promise<string | null>;
  /** This provider's own failures, as errors the chat can show a person. */
  toHttpError(caught: unknown): HttpError;
};

export const anthropicProvider: PlannerProvider = {
  id: 'anthropic',
  isConfigured: anthropic.isConfigured,
  notConfigured: anthropic.providerNotConfigured,
  streamChat: anthropic.streamChat,
  toHttpError: anthropic.toHttpError,
};

const PROVIDERS: Record<string, PlannerProvider> = {
  [anthropicProvider.id]: anthropicProvider,
};

/**
 * The provider this deployment uses.
 *
 * Read per call rather than resolved once at import: the tests swap the
 * environment between cases, and a module-level constant would freeze whichever
 * value happened to be set when the file was first loaded.
 *
 * An unknown name falls back to Anthropic rather than throwing. A typo in an
 * environment variable should not take the server down at boot, and the client
 * has a fallback for a provider that turns out not to be configured — which is
 * the same place a wrong name lands.
 */
export function plannerProvider(): PlannerProvider {
  const configured = env().PLANNER_PROVIDER?.trim().toLowerCase();

  return (configured && PROVIDERS[configured]) || anthropicProvider;
}
