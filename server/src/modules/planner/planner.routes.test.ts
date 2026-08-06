import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import type { PlannerStreamEvent } from '@ai-travel/shared';
import { api, errorCode, signUp } from '../../test/harness';
import { resetEnvCache } from '../../env';
import { resetAnthropicClient } from './anthropic';
import { resetPlannerRateLimit } from './planner.routes';
import { resetWeatherCache } from './weather';

/**
 * `POST /api/planner/chat`.
 *
 * Anthropic is stubbed at `fetch`, in its own SSE dialect, so these exercise
 * the real SDK rather than a mock of it — the tool loop, the streaming, and the
 * refusal path all run as they would in production.
 *
 * What matters here: the API key never leaves the server, an unconfigured
 * deployment says so in the ordinary envelope rather than pretending, a refusal
 * does not crash on the empty content array it comes with, and a failure that
 * happens after the stream has opened still reaches the client — as an event,
 * because the status line has already gone.
 */

const CHAT = '/api/planner/chat';

const PROMPT = { messages: [{ author: 'user', content: 'plan 3 days in Kyoto' }] };

/* -------------------------------------------------- a stubbed Anthropic API */

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** One model turn, in the wire format the SDK's stream parser expects. */
function turn(blocks: Block[], stopReason: string): string {
  let body = frame('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  });

  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      body += frame('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      // Two deltas, so a test can prove the chunks are forwarded as they come
      // rather than assembled and sent once.
      const half = Math.ceil(block.text.length / 2);
      for (const piece of [block.text.slice(0, half), block.text.slice(half)]) {
        body += frame('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: piece },
        });
      }
    } else {
      body += frame('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      });
      body += frame('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      });
    }

    body += frame('content_block_stop', { type: 'content_block_stop', index });
  });

  body += frame('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 20 },
  });
  body += frame('message_stop', { type: 'message_stop' });

  return body;
}

function sse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** Answers each call with the next turn in the list. */
function modelSays(...turns: string[]) {
  const queue = [...turns];

  return vi.fn(async (_url: URL | string | Request, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error('The stub ran out of turns.');

    return sse(next);
  });
}

/* --------------------------------------------------------- reading the wire */

function events(text: string): PlannerStreamEvent[] {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data:'))
    .map((chunk) => JSON.parse(chunk.slice('data:'.length).trim()) as PlannerStreamEvent);
}

const replyText = (text: string) =>
  events(text)
    .filter((event) => event.type === 'delta')
    .map((event) => event.text)
    .join('');

async function token(): Promise<string> {
  const { accessToken } = await signUp();
  return accessToken;
}

const PLAN = {
  title: 'Three Days in Kyoto',
  destination: 'Kyoto',
  destinationCity: 'Kyoto',
  destinationCountry: 'Japan',
  startDate: '2027-04-02',
  endDate: '2027-04-04',
  travellers: 2,
  days: [
    {
      destination: 'Higashiyama',
      summary: 'Temples and the old streets',
      activities: [
        {
          time: '09:00',
          title: 'Kiyomizu-dera before the crowds',
          description: 'The hillside temple is quiet for the first hour it is open.',
          category: 'culture',
          priceEstimate: 4,
        },
      ],
    },
  ],
  flightsEstimate: 1800,
  hotelsEstimate: 420,
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  resetEnvCache();
  resetPlannerRateLimit();
  resetWeatherCache();
  resetAnthropicClient();
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  // Back on, as `setup.ts` leaves it: unsetting this would throttle every
  // suite that follows, and a suite that fails logins on purpose would hang.
  process.env.DISABLE_RATE_LIMIT = '1';
  resetPlannerRateLimit();
  resetEnvCache();
  resetAnthropicClient();
  resetWeatherCache();
  vi.unstubAllGlobals();
});

describe('POST /api/planner/chat', () => {
  it('streams the reply back a chunk at a time', async () => {
    vi.stubGlobal('fetch', modelSays(turn([{ type: 'text', text: 'Kyoto in April is lovely.' }], 'end_turn')));

    const response = await api()
      .post(CHAT)
      .set('Authorization', `Bearer ${await token()}`)
      .send(PROMPT);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');

    const stream = events(response.text);
    // Two deltas, not one — the point of the endpoint.
    expect(stream.filter((event) => event.type === 'delta')).toHaveLength(2);
    expect(replyText(response.text)).toBe('Kyoto in April is lovely.');
    expect(stream.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('sends the key as a header, and never in the response', async () => {
    const fetchMock = modelSays(turn([{ type: 'text', text: 'Hello.' }], 'end_turn'));
    vi.stubGlobal('fetch', fetchMock);

    const response = await api()
      .post(CHAT)
      .set('Authorization', `Bearer ${await token()}`)
      .send(PROMPT);

    const [, init] = fetchMock.mock.calls[0];
    // `RequestInit['headers']` rather than the global `HeadersInit`, which the
    // server's lib set does not carry — this is a Node project, not a DOM one.
    const headers = new Headers(init?.headers as RequestInit['headers']);
    expect(headers.get('x-api-key')).toBe('sk-ant-test-key');

    expect(response.text).not.toContain('sk-ant-test-key');
  });

  it('turns a proposed trip into its own event', async () => {
    vi.stubGlobal(
      'fetch',
      modelSays(
        turn([{ type: 'tool_use', id: 'toolu_1', name: 'create_itinerary', input: PLAN }], 'tool_use'),
        turn([{ type: 'text', text: 'I kept the mornings early.' }], 'end_turn'),
      ),
    );

    const response = await api()
      .post(CHAT)
      .set('Authorization', `Bearer ${await token()}`)
      .send(PROMPT);

    const itinerary = events(response.text).find((event) => event.type === 'itinerary');
    expect(itinerary?.plan.destination).toBe('Kyoto');
    expect(itinerary?.plan.days).toHaveLength(1);

    // The second turn's text still streams — the tool call is not the end.
    expect(replyText(response.text)).toContain('I kept the mornings early.');
  });

  it('hands a malformed plan back to the model instead of showing it', async () => {
    const broken = { ...PLAN, startDate: 'next April', days: [] };

    vi.stubGlobal(
      'fetch',
      modelSays(
        turn([{ type: 'tool_use', id: 'toolu_1', name: 'create_itinerary', input: broken }], 'tool_use'),
        turn([{ type: 'text', text: 'Let me try that again.' }], 'end_turn'),
      ),
    );

    const response = await api()
      .post(CHAT)
      .set('Authorization', `Bearer ${await token()}`)
      .send(PROMPT);

    expect(events(response.text).some((event) => event.type === 'itinerary')).toBe(false);
    expect(events(response.text).at(-1)?.type).toBe('done');
  });

  it('runs the weather tool and carries on with the answer', async () => {
    const model = modelSays(
      turn(
        [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { place: 'Kyoto' } }],
        'tool_use',
      ),
      turn([{ type: 'text', text: "It's 18°C in Kyoto." }], 'end_turn'),
    );

    // Open-Meteo answers on its own two calls; the model stub takes the rest.
    const geocode = new Response(
      JSON.stringify({ results: [{ name: 'Kyoto', latitude: 35, longitude: 135, country: 'Japan' }] }),
      { status: 200 },
    );
    const forecast = new Response(
      JSON.stringify({
        current: { temperature_2m: 18.2, weather_code: 0 },
        daily: {
          time: ['2027-04-02'],
          temperature_2m_max: [21],
          temperature_2m_min: [11],
          weather_code: [0],
          precipitation_sum: [0],
        },
      }),
      { status: 200 },
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes('geocoding-api')) return geocode;
        if (href.includes('api.open-meteo.com')) return forecast;
        return model(url, init);
      }),
    );

    const response = await api()
      .post(CHAT)
      .set('Authorization', `Bearer ${await token()}`)
      .send(PROMPT);

    expect(replyText(response.text)).toContain("It's 18°C in Kyoto.");
  });

  it('reports a refusal as an error event rather than crashing on empty content', async () => {
    // A refusal is a 200 with no content blocks at all — the shape that breaks
    // anything reaching for `content[0]` before checking the stop reason.
    vi.stubGlobal('fetch', modelSays(turn([], 'refusal')));

    const response = await api()
      .post(CHAT)
      .set('Authorization', `Bearer ${await token()}`)
      .send(PROMPT);

    expect(response.status).toBe(200);
    const last = events(response.text).at(-1);
    expect(last?.type).toBe('error');
    expect(last).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('gives up rather than looping forever on a tool it keeps re-calling', async () => {
    const call = turn(
      [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { place: 'Kyoto' } }],
      'tool_use',
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string | Request) => {
        const href = String(url);
        if (href.includes('open-meteo')) return new Response('{}', { status: 500 });
        return sse(call);
      }),
    );

    const response = await api()
      .post(CHAT)
      .set('Authorization', `Bearer ${await token()}`)
      .send(PROMPT);

    const last = events(response.text).at(-1);
    expect(last?.type).toBe('error');
  }, 20_000);

  it('turns a provider failure into an error event, once the stream is open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"type":"overloaded_error"}}', { status: 529 })),
    );

    const response = await api()
      .post(CHAT)
      .set('Authorization', `Bearer ${await token()}`)
      .send(PROMPT);

    // 200, because the headers went out before the model was ever called.
    expect(response.status).toBe(200);
    expect(events(response.text).at(-1)?.type).toBe('error');
  }, 20_000);
});

describe('POST /api/planner/chat — before the stream opens', () => {
  it('says the provider is unconfigured, in the ordinary envelope', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    resetEnvCache();

    const response = await api()
      .post(CHAT)
      .set('Authorization', `Bearer ${await token()}`)
      .send(PROMPT);

    expect(response.status).toBe(503);
    expect(errorCode(response)).toBe(ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  });

  it('requires an account — unlike the search routes', async () => {
    const response = await api().post(CHAT).send(PROMPT);

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it('rejects an empty conversation', async () => {
    const response = await api()
      .post(CHAT)
      .set('Authorization', `Bearer ${await token()}`)
      .send({ messages: [] });

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('rejects a history longer than the cap, which is what bounds the bill', async () => {
    const response = await api()
      .post(CHAT)
      .set('Authorization', `Bearer ${await token()}`)
      .send({
        messages: Array.from({ length: 21 }, () => ({ author: 'user', content: 'hello' })),
      });

    expect(response.status).toBe(422);
  });

  it('throttles, because every message costs money', async () => {
    process.env.DISABLE_RATE_LIMIT = '0';
    resetPlannerRateLimit();
    vi.stubGlobal('fetch', vi.fn(async () => sse(turn([{ type: 'text', text: 'hi' }], 'end_turn'))));

    const accessToken = await token();
    const send = () =>
      api().post(CHAT).set('Authorization', `Bearer ${accessToken}`).send(PROMPT);

    // The limit is 20 per quarter-hour; the 21st is refused.
    for (let attempt = 0; attempt < 20; attempt += 1) await send();

    const response = await send();
    expect(response.status).toBe(429);
    expect(errorCode(response)).toBe(ERROR_CODES.RATE_LIMITED);
  }, 30_000);
});
