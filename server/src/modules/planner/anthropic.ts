import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolResultBlockParam, ToolUnion } from '@anthropic-ai/sdk/resources/messages';
import { ERROR_CODES } from '@ai-travel/shared';
import type { PlannerChatMessage, PlannerTripBrief } from '@ai-travel/shared';
import { z } from 'zod';
import { HttpError } from '../../errors';
import { env } from '../../env';
import { PlaceNotFoundError, getWeather, MAX_FORECAST_DAYS } from './weather';

/**
 * The model behind the planner.
 *
 * This module owns everything Anthropic-shaped: the client, the prompt, the
 * tools, and the loop that runs them. It speaks in callbacks — `onText`,
 * `onBrief` — and knows nothing about HTTP, so the route can decide how to
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
 * Far more than a turn needs now that the model writes prose and a brief
 * rather than fourteen days of activities. Left where it was: the ceiling
 * exists so a loop that goes wrong costs a bounded amount, and it is not a
 * budget to spend.
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
const SYSTEM_PROMPT = `You are the travel planner inside an app called AI Travel. You talk to people about where they might go, and when they want a trip, you hand the app what it needs to build one.

## Voice

Warm, specific and brief. Two or three sentences is usually the right length for an answer; a paragraph is the ceiling. Write the way a well-travelled friend talks — no brochure adjectives, no "nestled", no "vibrant tapestry". Prefer the concrete detail over the general claim: "the 7am boat beats the crowds" is worth more than "an unforgettable experience".

Do not open with pleasantries ("Great question!", "I'd be happy to help!"). Answer the thing.

## What you can do

- Answer any travel question: visas, seasons, safety, budgets, food, transport, what to pack, how long somewhere needs, whether two places fit in one trip.
- Look up live weather with the \`get_weather\` tool.
- Plan a trip with the \`plan_trip\` tool.

## Weather

You know climates; you do not know today. Any question about current or upcoming conditions — "what's the weather in Lisbon", "will it rain next week", "is it hot there now" — must go through \`get_weather\`. Never guess at a real number. General seasonal advice ("Kyoto is humid in August") needs no tool.

If the tool cannot find the place, say so plainly and ask which place was meant. If it fails for another reason, say the lookup failed rather than inventing a figure.

## Trips

You do not write itineraries. The app does — it holds a catalogue of real attractions with real locations, and it schedules the days itself so that every stop exists, nothing overlaps, the walk between two places is accounted for, and the user's hours and budget are respected. Your job is to understand what they want and hand it over.

Call \`plan_trip\` when someone asks you to plan, or names a place and a length, or agrees to a trip you offered. Do not call it for a general question — "is Rome expensive?" wants an answer, not a five-day plan.

When you do call it:

- \`destination\` is one searchable place name — "Kyoto", not "Kyoto, Japan", not "Kyoto and Osaka". A two-city trip is two trips; ask which they want planned first.
- If they gave no dates, choose a sensible window a few weeks out and say which dates you assumed. No length given, five days is a good default. No party size, assume two.
- \`preferences\` carries only what this conversation actually said. They have settings of their own — hours, pace, budget, what they like — and anything you leave out keeps their setting. So an empty object is usually right. "We're not early risers" is a \`dayStart\`; "somewhere between museums" is not a preference at all. Never infer a budget from how someone writes.
- A zero weight means never plan that category. Use it for a refusal — "no museums, please" — and never for mild disinterest, which is what the middle of the scale is for.

**You will not know which places it chose.** The card appears after you have finished talking, and its contents are the app's, not yours. So do not name attractions, restaurants or neighbourhoods as though they are in the plan, and do not list days. What is worth saying instead: the shape of the trip, what the dates mean for the weather, what you assumed, and anything they should check before booking.

If someone asks to change the trip — later mornings, more food, cheaper — call \`plan_trip\` again with the new preferences. It is rebuilt from scratch, which is cheap and exact.

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
    name: 'plan_trip',
    description:
      'Plan a trip for the user. You give the constraints — where, when, how long, for how many, and anything they said about how they like to travel. The app schedules the days itself from a catalogue of real places, respecting the hours and budget on their account. Call this once you know where and roughly when; do not write the days out yourself.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short and evocative, e.g. "Kyoto in Autumn".' },
        destination: {
          type: 'string',
          description:
            'The place to search for attractions in, and the label on trip cards. One place name — "Kyoto", not "Kyoto, Japan" and not "Kyoto and Osaka".',
        },
        destinationCity: { type: 'string', description: 'The main city, for the explorer.' },
        destinationCountry: { type: 'string', description: 'The country, in English.' },
        startDate: { type: 'string', description: 'ISO calendar date, YYYY-MM-DD.' },
        days: {
          type: 'integer',
          minimum: 1,
          maximum: 21,
          description: 'Dated days the trip covers — nights plus one.',
        },
        travellers: { type: 'integer', minimum: 1, maximum: 12 },
        preferences: {
          type: 'object',
          description:
            'Only what this conversation actually said. Anything you leave out keeps the value from their settings, so an empty object is the right answer when they said nothing about how they travel. Do not infer a budget from a tone, or hours from a season.',
          properties: {
            dayStart: { type: 'string', description: '24-hour HH:MM. Only if they said so.' },
            dayEnd: {
              type: 'string',
              description:
                '24-hour HH:MM, the hour after which nothing new starts. Dinner is planned regardless.',
            },
            pace: {
              type: 'string',
              enum: ['relaxed', 'balanced', 'packed'],
              description: 'Two, three or five things a day.',
            },
            categoryWeights: {
              type: 'object',
              description:
                'How much they want each kind of thing, 0 to 1. Zero means never plan it — use that only for a clear refusal ("no museums"), never for mild disinterest.',
              properties: Object.fromEntries(
                CATEGORIES.filter((category) => category !== 'travel').map((category) => [
                  category,
                  { type: 'number', minimum: 0, maximum: 1 },
                ]),
              ),
            },
            maxActivityPrice: {
              type: 'number',
              minimum: 0,
              description: 'Most per activity, per person, USD.',
            },
            dailyActivityBudget: {
              type: 'number',
              minimum: 0,
              description: 'Most per day, per person, USD.',
            },
            meals: {
              type: 'object',
              properties: { lunch: { type: 'boolean' }, dinner: { type: 'boolean' } },
            },
          },
        },
        flightsEstimate: { type: 'number', minimum: 0, description: 'Whole party, return, USD.' },
        hotelsEstimate: { type: 'number', minimum: 0, description: 'Whole stay, USD.' },
      },
      required: ['destination', 'startDate', 'days', 'travellers'],
    },
  },
];

/* --------------------------------------------------------- validating input */

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

/**
 * The model's `plan_trip` input, checked before it is trusted.
 *
 * `strict: true` on the tool would let the API enforce the shape, but the
 * client turns whatever arrives into a real trip, so the server checks anyway
 * — and the checks here are narrower than a shape. A `dayStart` of "morning"
 * is a valid string and an invalid time; a weight of 4 is a valid number and
 * not a weight. Both are handed back to the model as a retry rather than
 * thrown, because it can see what it got wrong and fix it.
 *
 * The bounds are the ones in `settings.schemas.ts`, deliberately: a preference
 * the model proposes and a preference somebody types must be the same set of
 * values, or the model could ask for a trip the settings screen cannot show.
 */
const TIME_OF_DAY = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 09:30.');

const preferencesSchema = z.object({
  dayStart: TIME_OF_DAY.optional(),
  dayEnd: TIME_OF_DAY.optional(),
  pace: z.enum(['relaxed', 'balanced', 'packed']).optional(),
  categoryWeights: z.partialRecord(z.enum(CATEGORIES), z.number().min(0).max(1)).optional(),
  maxActivityPrice: z.number().int().min(0).max(100_000).nullable().optional(),
  dailyActivityBudget: z.number().int().min(0).max(100_000).nullable().optional(),
  meals: z.object({ lunch: z.boolean().optional(), dinner: z.boolean().optional() }).optional(),
});

const briefSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  destination: z.string().trim().min(1).max(120),
  destinationCity: z.string().trim().min(1).max(120).optional(),
  destinationCountry: z.string().trim().min(1).max(120).optional(),
  startDate: ISO_DATE,
  days: z.number().int().min(1).max(21),
  travellers: z.number().int().min(1).max(12),
  /*
   * Dropped rather than fatal, unlike everything above it. A trip with the
   * account's own preferences is a good trip; refusing to plan at all because
   * one weight came back as 1.5 would cost the user the thing they asked for
   * over a detail they never mentioned.
   */
  preferences: preferencesSchema.optional().catch(undefined),
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
  /** The model has understood the trip. Fires at most once per turn. */
  onBrief: (brief: PlannerTripBrief) => void;
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
 * of the two tools is terminal — `plan_trip` executes nothing, it is caught
 * here and relayed to the browser — and the text has to be forwarded
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

      if (call.name === 'plan_trip') {
        const parsed = briefSchema.safeParse(call.input);

        if (!parsed.success) {
          // Handed back rather than thrown: the model can see what was wrong
          // with its own brief and fix it on the next turn.
          results.push(
            result(
              call.id,
              `That brief was rejected: ${parsed.error.issues
                .map((issue) => `${issue.path.join('.') || 'input'} — ${issue.message}`)
                .join('; ')}. Correct it and call the tool again.`,
              true,
            ),
          );
          continue;
        }

        handlers.onBrief(parsed.data);
        results.push(
          result(
            call.id,
            'The trip is being scheduled and will appear as a card the user can save. You do not know which places it picked, so do not name any — say a sentence or two about the shape of the trip and what to watch for.',
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
