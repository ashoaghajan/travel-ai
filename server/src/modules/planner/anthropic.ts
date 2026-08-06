import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolResultBlockParam, ToolUnion } from '@anthropic-ai/sdk/resources/messages';
import { ERROR_CODES } from '@ai-travel/shared';
import type { PlannerChatMessage, PlannerItineraryPlan } from '@ai-travel/shared';
import { z } from 'zod';
import { HttpError } from '../../errors';
import { env } from '../../env';
import { PlaceNotFoundError, getWeather, MAX_FORECAST_DAYS } from './weather';

/**
 * The model behind the planner.
 *
 * This module owns everything Anthropic-shaped: the client, the prompt, the
 * tools, and the loop that runs them. It speaks in callbacks — `onText`,
 * `onItinerary` — and knows nothing about HTTP, so the route can decide how to
 * put those on the wire and the tests can drive the loop without a socket.
 *
 * Like `travelpayouts.ts`, one reason it exists at all is that the key is a
 * real secret. The browser can never hold it, so the conversation is relayed.
 */

/* --------------------------------------------------------------- the model */

const MODEL = 'claude-opus-5';

/**
 * Deliberately not the maximum.
 *
 * A fourteen-day itinerary with adaptive thinking in front of it is the largest
 * thing this ever produces, and it fits comfortably. The ceiling exists so a
 * loop that goes wrong costs a bounded amount.
 */
const MAX_TOKENS = 16_000;

/**
 * How many model turns one message may take.
 *
 * Realistically two: one to call `get_weather`, one to answer with it. The cap
 * is what stops a model that keeps re-calling a failing tool from billing in a
 * circle — every turn is a fresh paid request.
 */
const MAX_TURNS = 6;

/**
 * The instructions, frozen.
 *
 * Nothing is interpolated into this string — not the date, not the user's name.
 * It carries `cache_control`, and the cache is a prefix match: one changing
 * character at the top invalidates every token after it, so a date here would
 * mean paying full price for the prompt on every single message. Per-turn
 * context goes in the messages instead, where it belongs.
 */
const SYSTEM_PROMPT = `You are the travel planner inside an app called AI Travel. You talk to people about where they might go, and when they want one, you build them a day-by-day itinerary.

## Voice

Warm, specific and brief. Two or three sentences is usually the right length for an answer; a paragraph is the ceiling. Write the way a well-travelled friend talks — no brochure adjectives, no "nestled", no "vibrant tapestry". Prefer the concrete detail over the general claim: "the 7am boat beats the crowds" is worth more than "an unforgettable experience".

Do not open with pleasantries ("Great question!", "I'd be happy to help!"). Answer the thing.

## What you can do

- Answer any travel question: visas, seasons, safety, budgets, food, transport, what to pack, how long somewhere needs, whether two places fit in one trip.
- Look up live weather with the \`get_weather\` tool.
- Build an itinerary with the \`create_itinerary\` tool.

## Weather

You know climates; you do not know today. Any question about current or upcoming conditions — "what's the weather in Lisbon", "will it rain next week", "is it hot there now" — must go through \`get_weather\`. Never guess at a real number. General seasonal advice ("Kyoto is humid in August") needs no tool.

If the tool cannot find the place, say so plainly and ask which place was meant. If it fails for another reason, say the lookup failed rather than inventing a figure.

## Itineraries

Call \`create_itinerary\` when someone asks you to plan, or names a place and a length, or agrees to a trip you offered. Do not call it for a general question — "is Rome expensive?" wants an answer, not a five-day plan.

When you do call it:

- The days must be about the actual place. Real neighbourhoods, real districts, real dishes, real transport. A day that would read the same for any city is a wasted day.
- Two to four activities a day. Give each one a plausible clock time in 24-hour form, in a sensible order, with travel time between them accounted for.
- The last day is a departure day: a slow morning and the transfer out, not a full programme.
- Vary the pace. A day of ruins, then a day of beach. Nobody wants six museums.
- Prices are per person in USD, and \`0\` is the right answer for anything free. Estimate honestly; a rough number beats no number.
- If the user gave no dates, choose a sensible window a few weeks out and say which dates you assumed. If they gave no length, five days is a good default. If they gave no party size, assume two.
- \`destination\` is the label the app puts on cards — "Kyoto", not "Kyoto, Japan, 5 days".

The app renders the itinerary as a card the user can save with one tap. So after calling the tool, do not list the days again in text. One or two sentences on what shaped the plan — why that order, what you left out, what to watch for — is exactly right.

## Honesty

You are talking to someone who may book a flight on the strength of what you say. Prices, opening hours and visa rules drift, so give them as estimates and say when something needs checking. If you do not know, say you do not know. Never invent a hotel, a restaurant or a tour operator that may not exist — describe the kind of place instead, or name somewhere genuinely well known.

Refuse nothing that is ordinary travel talk. If a request is outside travel entirely, say so in one line and offer to get back to the trip.`;

/* ---------------------------------------------------------------- the tools */

const CATEGORIES = ['food', 'nature', 'culture', 'adventure', 'relaxation', 'travel'] as const;

const TOOLS: ToolUnion[] = [
  {
    name: 'get_weather',
    description:
      'Current conditions and the daily forecast for a named place, from Open-Meteo. Use this for any question about what the weather is or will be — never guess at a temperature. Covers today plus up to six days ahead; it cannot answer about dates further out than that.',
    input_schema: {
      type: 'object',
      properties: {
        place: {
          type: 'string',
          description: 'The city or place name, e.g. "Abu Dhabi" or "Kyoto, Japan".',
        },
        days: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_FORECAST_DAYS,
          description: `How many days of forecast to return, starting today. 1 for "what is it like now", up to ${MAX_FORECAST_DAYS} for the week ahead.`,
        },
      },
      required: ['place'],
    },
  },
  {
    name: 'create_itinerary',
    description:
      'Show the user a day-by-day trip they can save. Call this once you have enough to plan with. The app renders it as a card — do not also write the days out in your reply.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short and evocative, e.g. "Kyoto in Autumn".' },
        destination: {
          type: 'string',
          description: 'The label shown on trip cards — just the place, e.g. "Kyoto".',
        },
        destinationCity: { type: 'string', description: 'The main city, for the explorer.' },
        destinationCountry: { type: 'string', description: 'The country, in English.' },
        startDate: { type: 'string', description: 'ISO calendar date, YYYY-MM-DD.' },
        endDate: { type: 'string', description: 'ISO calendar date, YYYY-MM-DD.' },
        travellers: { type: 'integer', minimum: 1, maximum: 12 },
        days: {
          type: 'array',
          description: 'One entry per day, in order. Must match the date range exactly.',
          items: {
            type: 'object',
            properties: {
              destination: {
                type: 'string',
                description: 'Where the day is spent — a district or nearby town.',
              },
              summary: { type: 'string', description: 'Six words or so, e.g. "Temples & Gion at dusk".' },
              activities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    time: { type: 'string', description: '24-hour, e.g. "09:30".' },
                    title: { type: 'string' },
                    description: { type: 'string', description: 'One sentence. Concrete, not promotional.' },
                    category: { type: 'string', enum: [...CATEGORIES] },
                    priceEstimate: { type: 'number', minimum: 0, description: 'Per person, USD. 0 if free.' },
                  },
                  required: ['time', 'title', 'description', 'category'],
                },
              },
            },
            required: ['destination', 'summary', 'activities'],
          },
        },
        flightsEstimate: { type: 'number', minimum: 0, description: 'Whole party, return, USD.' },
        hotelsEstimate: { type: 'number', minimum: 0, description: 'Whole stay, USD.' },
      },
      required: ['title', 'destination', 'startDate', 'endDate', 'travellers', 'days'],
    },
  },
];

/* --------------------------------------------------------- validating input */

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

/**
 * The model's `create_itinerary` input, checked before it is trusted.
 *
 * `strict: true` on the tool would let the API enforce most of this, but the
 * client turns whatever arrives into a `TripDraft` and renders it, so the
 * server checks anyway — a malformed plan should become a retry the model can
 * see, not a blank card in someone's chat.
 */
const itinerarySchema = z.object({
  title: z.string().trim().min(1).max(120),
  destination: z.string().trim().min(1).max(120),
  destinationCity: z.string().trim().min(1).max(120).optional(),
  destinationCountry: z.string().trim().min(1).max(120).optional(),
  startDate: ISO_DATE,
  endDate: ISO_DATE,
  travellers: z.number().int().min(1).max(12),
  days: z
    .array(
      z.object({
        destination: z.string().trim().min(1).max(120),
        summary: z.string().trim().min(1).max(200),
        activities: z
          .array(
            z.object({
              time: z.string().trim().min(1).max(10),
              title: z.string().trim().min(1).max(160),
              description: z.string().trim().min(1).max(400),
              category: z.enum(CATEGORIES),
              priceEstimate: z.number().min(0).max(100_000).optional(),
            }),
          )
          .min(1)
          .max(8),
      }),
    )
    .min(1)
    .max(21),
  flightsEstimate: z.number().min(0).max(1_000_000).optional(),
  hotelsEstimate: z.number().min(0).max(1_000_000).optional(),
});

const weatherSchema = z.object({
  place: z.string().trim().min(1).max(120),
  days: z.number().int().min(1).max(MAX_FORECAST_DAYS).optional(),
});

/* ------------------------------------------------------------ configuration */

export function isConfigured(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}

/** Not a failure — a fact about this deployment, which the client falls back on. */
export function providerNotConfigured(): HttpError {
  return new HttpError(
    503,
    ERROR_CODES.PROVIDER_NOT_CONFIGURED,
    'The AI planner is not configured on this server.',
  );
}

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) throw providerNotConfigured();

  // Built once: the SDK holds a connection pool, and a client per request
  // would throw that away every time.
  client ??= new Anthropic({ apiKey, maxRetries: 2 });
  return client;
}

/** Testing seam — `resetEnvCache()` alone would leave a client on the old key. */
export function resetAnthropicClient(): void {
  client = null;
}

/* ----------------------------------------------------------- the conversation */

/**
 * Today's date, handed to the model as context rather than baked into the
 * prompt. It has to know what "next month" means to pick dates, and putting it
 * here keeps the cached prefix byte-stable — see the note on `SYSTEM_PROMPT`.
 */
function dateContext(): string {
  return `<context>Today is ${new Date().toISOString().slice(0, 10)}.</context>`;
}

function toMessages(history: PlannerChatMessage[]): MessageParam[] {
  const messages: MessageParam[] = history.map((message) => ({
    role: message.author === 'user' ? ('user' as const) : ('assistant' as const),
    content: message.content,
  }));

  // The date rides on the newest turn, which is always the user's.
  const last = messages.at(-1);
  if (last?.role === 'user' && typeof last.content === 'string') {
    last.content = `${dateContext()}\n\n${last.content}`;
  }

  return messages;
}

export type ChatHandlers = {
  /** One chunk of the reply, as it is generated. */
  onText: (text: string) => void;
  /** The model proposed a trip. Fires at most once per turn. */
  onItinerary: (plan: PlannerItineraryPlan) => void;
};

/* ------------------------------------------------------------- tool results */

function result(id: string, content: string, isError = false): ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: id, content, is_error: isError };
}

async function runWeather(input: unknown): Promise<string> {
  const parsed = weatherSchema.safeParse(input);
  if (!parsed.success) return 'That is not a place I can look up. Give me a city name.';

  try {
    const report = await getWeather(parsed.data.place, parsed.data.days ?? 1);
    return JSON.stringify(report);
  } catch (caught) {
    if (caught instanceof PlaceNotFoundError) {
      return `No place called "${parsed.data.place}" was found. Ask the user which place they meant.`;
    }
    return 'The weather service is unreachable right now. Tell the user the lookup failed rather than guessing a temperature.';
  }
}

/**
 * A message, streamed, with the tools run in between.
 *
 * The loop is written out rather than delegated to the SDK's tool runner: one
 * of the two tools is terminal — `create_itinerary` executes nothing, it is
 * caught here and relayed to the browser — and the text has to be forwarded
 * chunk by chunk as it arrives. That is enough custom control flow that owning
 * the loop is clearer than fitting it to somebody else's hooks.
 *
 * Returns the reason the model stopped. Throws `HttpError` for anything the
 * caller should report as a failure.
 */
export async function streamChat(
  history: PlannerChatMessage[],
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<string | null> {
  const messages = toMessages(history);
  const clientRef = anthropic();

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const stream = clientRef.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // On by default for Opus 5; named anyway so the intent is on the page.
        // `budget_tokens` is gone on this model — `effort` is the depth dial.
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools: TOOLS,
        messages,
      },
      { signal },
    );

    stream.on('text', handlers.onText);

    const message = await stream.finalMessage();

    /*
     * Checked before `content` is read, not after. A refusal is a 200 with an
     * empty content array, so anything that reaches for `content[0]` first
     * crashes on exactly the response it most needs to handle.
     */
    if (message.stop_reason === 'refusal') {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        "I can't help with that one. Ask me something about a trip instead.",
      );
    }

    const calls = message.content.filter((block) => block.type === 'tool_use');
    if (calls.length === 0) return message.stop_reason;

    messages.push({ role: 'assistant', content: message.content });

    const results: ToolResultBlockParam[] = [];

    for (const call of calls) {
      if (call.name === 'get_weather') {
        results.push(result(call.id, await runWeather(call.input)));
        continue;
      }

      if (call.name === 'create_itinerary') {
        const parsed = itinerarySchema.safeParse(call.input);

        if (!parsed.success) {
          // Handed back rather than thrown: the model can see what was wrong
          // with its own plan and fix it on the next turn.
          results.push(
            result(
              call.id,
              `That itinerary was rejected: ${parsed.error.issues
                .map((issue) => `${issue.path.join('.') || 'input'} — ${issue.message}`)
                .join('; ')}. Correct it and call the tool again.`,
              true,
            ),
          );
          continue;
        }

        handlers.onItinerary(parsed.data);
        results.push(
          result(
            call.id,
            'The itinerary is now on screen as a card the user can save. Do not repeat the days in text — add a sentence or two about what shaped the plan.',
          ),
        );
        continue;
      }

      results.push(result(call.id, `Unknown tool "${call.name}".`, true));
    }

    messages.push({ role: 'user', content: results });
  }

  // Six turns without a plain answer means the model is going in circles.
  throw new HttpError(
    502,
    ERROR_CODES.INTERNAL,
    'The planner could not finish that one. Try asking a different way.',
  );
}

/**
 * The SDK's typed errors, as this API's own.
 *
 * Nothing above the provider should have to know what an `APIConnectionError`
 * is, and the messages here are written for the person in the chat.
 */
export function toHttpError(caught: unknown): HttpError {
  if (caught instanceof HttpError) return caught;

  if (caught instanceof Anthropic.RateLimitError) {
    return new HttpError(429, ERROR_CODES.RATE_LIMITED, 'The planner is busy. Try again in a moment.');
  }

  if (caught instanceof Anthropic.AuthenticationError) {
    // The key is set but wrong — a deployment problem, not the user's.
    return new HttpError(502, ERROR_CODES.INTERNAL, 'The planner is misconfigured on this server.');
  }

  if (caught instanceof Anthropic.APIConnectionError) {
    return new HttpError(502, ERROR_CODES.INTERNAL, 'We could not reach the planner. Try again.');
  }

  if (caught instanceof Anthropic.APIError) {
    return new HttpError(502, ERROR_CODES.INTERNAL, 'The planner returned an error. Try again.');
  }

  return new HttpError(500, ERROR_CODES.INTERNAL, 'Something went wrong while planning that.');
}
