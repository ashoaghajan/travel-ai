import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { ApiError, setAccessToken, signedOut, stream } from './http';

/**
 * Reading a server-sent event stream.
 *
 * The parser here is the risky part of the planner: a frame is only complete at
 * `\n\n`, and a chunk boundary can fall anywhere — including in the middle of a
 * word inside a `data:` line. Splitting each chunk on its own would corrupt
 * every frame unlucky enough to straddle two, and it would do so intermittently,
 * which is the worst way to find out. Hence the first test.
 */

/** A body delivered in exactly these pieces, boundaries and all. */
function chunked(...pieces: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });

  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function frames(...events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

async function collect<T>(source: AsyncGenerator<T>): Promise<T[]> {
  const received: T[] = [];
  for await (const event of source) received.push(event);

  return received;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setAccessToken('access-token');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
});

describe('stream', () => {
  it('reassembles a frame split across chunk boundaries', async () => {
    // The split falls mid-word inside the JSON, which is what a real socket does.
    fetchMock.mockResolvedValueOnce(
      chunked('data: {"type":"delta","te', 'xt":"Kyoto"}\n\n', 'data: {"type":"done"}\n\n'),
    );

    await expect(collect(stream('/planner/chat'))).resolves.toEqual([
      { type: 'delta', text: 'Kyoto' },
      { type: 'done' },
    ]);
  });

  it('reads several frames arriving in one chunk', async () => {
    fetchMock.mockResolvedValueOnce(chunked(frames({ n: 1 }, { n: 2 }, { n: 3 })));

    await expect(collect(stream('/x'))).resolves.toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('ignores keep-alive comments and blank frames', async () => {
    fetchMock.mockResolvedValueOnce(chunked(': keep-alive\n\n', frames({ n: 1 }), '\n\n'));

    await expect(collect(stream('/x'))).resolves.toEqual([{ n: 1 }]);
  });

  it('skips a frame it cannot parse rather than ending the conversation', async () => {
    fetchMock.mockResolvedValueOnce(chunked('data: {not json}\n\n', frames({ n: 2 })));

    await expect(collect(stream('/x'))).resolves.toEqual([{ n: 2 }]);
  });

  it('joins a payload written across several data lines', async () => {
    fetchMock.mockResolvedValueOnce(chunked('data: {"n":\ndata: 4}\n\n'));

    await expect(collect(stream('/x'))).resolves.toEqual([{ n: 4 }]);
  });

  it('sends the bearer token, which is why this cannot be an EventSource', async () => {
    fetchMock.mockResolvedValueOnce(chunked(frames({ n: 1 })));

    await collect(stream('/planner/chat', { body: { messages: [] } }));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer access-token');
    expect(init.method).toBe('POST');
  });

  it('throws a normal ApiError for a failure before the stream opens', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: ERROR_CODES.PROVIDER_NOT_CONFIGURED, message: 'Not configured.' },
        }),
        { status: 503 },
      ),
    );

    await expect(collect(stream('/planner/chat'))).rejects.toMatchObject({
      status: 503,
      code: ERROR_CODES.PROVIDER_NOT_CONFIGURED,
    });
  });

  it('refreshes a merely stale token and reads the retry', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: ERROR_CODES.TOKEN_EXPIRED, message: 'Old.' } }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'fresh-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(chunked(frames({ n: 1 })));

    await expect(collect(stream('/planner/chat'))).resolves.toEqual([{ n: 1 }]);

    const [, retry] = fetchMock.mock.calls[2];
    expect(retry.headers.Authorization).toBe('Bearer fresh-token');
  });

  it('ends the session when the refresh fails', async () => {
    const listener = vi.fn();
    const unsubscribe = signedOut.subscribe(listener);

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: ERROR_CODES.TOKEN_EXPIRED, message: 'Old.' } }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));

    await expect(collect(stream('/planner/chat'))).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });

  it('says so when the response carries no body at all', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(collect(stream('/x'))).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL });
  });

  it('releases the socket when the reader stops early', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frames({ n: 1 }, { n: 2 })));
      },
      cancel,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    // A component that unmounts mid-reply must not leave this open.
    for await (const _event of stream('/x')) break;

    expect(cancel).toHaveBeenCalled();
  });

  it('does not raise a failing cancel over whatever ended the read', async () => {
    // A source that throws on cancel — a connection the server already tore
    // down — must not surface as an error to the consumer. Cleanup is not the
    // interesting outcome, and by now the interesting one has happened.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frames({ n: 1 })));
      },
      cancel() {
        throw new Error('the connection is already gone');
      },
    });

    fetchMock.mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const received: unknown[] = [];
    for await (const event of stream('/x')) {
      received.push(event);
      break;
    }

    expect(received).toEqual([{ n: 1 }]);
  });
});
