import { ERROR_CODES } from '@ai-travel/shared';
import type { PlannerStreamEvent } from '@ai-travel/shared';
import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { z } from 'zod';
import { HttpError } from '../../errors';
import { prisma } from '../../prisma';
import { requireAuth, userIdOf } from '../auth/requireAuth';
import { isConfigured, providerNotConfigured, streamChat, toHttpError } from './anthropic';

/**
 * The planner conversation — `POST /api/planner/chat`.
 *
 * The only streaming endpoint in this API, and the only one that costs money
 * per call. Both facts shape it:
 *
 * **It requires an account.** The search routes are deliberately public — a
 * visitor should be able to look at a fare. This one bills Anthropic per
 * message, and every screen that can reach it already sits behind a sign-in.
 *
 * **Errors change shape halfway through.** Anything that fails before the first
 * byte is thrown as an `HttpError` and leaves through `errorHandler` in the
 * usual envelope. Once the stream has opened the status line is already sent,
 * so a later failure can only be reported as an `error` event on the stream
 * itself. That is the one place in this server where the error convention does
 * not apply, and `PlannerErrorEvent` carries the same `code`/`message` pair so
 * the client can treat both paths alike.
 */

export const plannerRouter = Router();

/**
 * The history the client replays on every message.
 *
 * Capped at twenty turns because history is what makes a turn expensive: the
 * whole conversation is re-sent and re-read each time, so an unbounded chat
 * would cost more with every message. Twenty is far more than any planning
 * exchange needs and still bounds the bill.
 */
const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        author: z.enum(['user', 'ai']),
        content: z.string().trim().min(1).max(8_000),
      }),
    )
    .min(1)
    .max(20),
});

const store = new MemoryStore();

export function resetPlannerRateLimit(): void {
  store.resetAll?.();
}

/**
 * Far stricter than the search throttle, and for a different reason.
 *
 * Sixty flight searches cost a slice of a quota we already pay for. Sixty
 * planner messages cost real money per message, so this one is sized to what a
 * person actually types in a sitting — a long back-and-forth about one trip —
 * rather than to what the provider will tolerate.
 */
const chatRateLimit = rateLimit({
  store,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.DISABLE_RATE_LIMIT === '1',
  handler: (_request: Request, response: Response) => {
    response.status(429).json({
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'That is a lot of planning. Give it a few minutes and carry on.',
        details: null,
      },
    });
  },
});

/** One SSE frame. `\n\n` terminates it — a client cannot parse a partial one. */
function send(response: Response, event: PlannerStreamEvent): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function openStream(response: Response): void {
  response.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx buffers proxied responses by default, which would hold the whole
    // reply back and deliver it at once — the opposite of streaming.
    'X-Accel-Buffering': 'no',
  });

  // Commits the headers now, so the browser starts reading before the model
  // has produced its first token.
  response.flushHeaders();
}

/**
 * Rate limit first, then auth — the same order as the search routes. Rejecting
 * a flood should be the cheapest thing this endpoint does, and verifying a
 * signature before saying "too many" is work done for nothing.
 */
plannerRouter.post('/planner/chat', chatRateLimit, requireAuth, async (request, response) => {
  const { messages } = chatSchema.parse(request.body);

  /*
   * The tier, checked here rather than only in the browser.
   *
   * A free client never reaches this — it answers from the rule engine and
   * makes no request at all — so in ordinary use this refusal is unreachable.
   * It exists because a gate the client alone enforces is a suggestion, and
   * this endpoint is the one thing in the app that spends money per call.
   *
   * Read fresh rather than taken from the token: upgrading must work on the
   * next prompt, and an access token minted before the upgrade would otherwise
   * carry a stale tier until it expired.
   */
  const account = await prisma.user.findUnique({
    where: { id: userIdOf(request) },
    select: { plan: true },
  });

  if (account?.plan !== 'pro') {
    throw new HttpError(
      403,
      ERROR_CODES.PRO_REQUIRED,
      'The conversational planner is a Pro feature.',
    );
  }

  // Before the stream opens, so this arrives as a normal envelope and the
  // client can fall back to its offline planner on the code alone.
  if (!isConfigured()) throw providerNotConfigured();

  openStream(response);

  // The reader closed the tab or navigated away. Nothing is worth generating
  // for a socket nobody is holding, and the model call is billed either way.
  const aborter = new AbortController();
  request.on('close', () => aborter.abort());

  try {
    const stopReason = await streamChat(
      messages,
      {
        onText: (text) => send(response, { type: 'delta', text }),
        onItinerary: (plan) => send(response, { type: 'itinerary', plan }),
      },
      aborter.signal,
    );

    send(response, { type: 'done', stopReason });
  } catch (caught) {
    if (aborter.signal.aborted) {
      response.end();
      return;
    }

    const error: HttpError = toHttpError(caught);
    if (error.status >= 500) console.error('[planner]', caught);

    send(response, { type: 'error', code: error.code, message: error.message });
  }

  response.end();
});
