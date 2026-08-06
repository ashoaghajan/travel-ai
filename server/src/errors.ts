import type { ErrorCode } from '@ai-travel/shared';
import { ERROR_CODES } from '@ai-travel/shared';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/**
 * The single shape every failure leaves the server in.
 *
 * `{ error: { code, message, details } }`. The status says what class of
 * failure; the code says which one. Handlers throw `HttpError`, this module
 * turns it into the envelope, and nothing else is allowed to write an error
 * body by hand.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode, message: string, details: unknown = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: ErrorCode, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);

export const unauthorized = (code: ErrorCode, message: string) => new HttpError(401, code, message);

export const notFound = (message: string) => new HttpError(404, ERROR_CODES.NOT_FOUND, message);

export const conflict = (code: ErrorCode, message: string) => new HttpError(409, code, message);

export const unprocessable = (code: ErrorCode, message: string, details?: unknown) =>
  new HttpError(422, code, message, details);

/** Field-keyed messages, which is what a form wants back. */
function zodDetails(error: ZodError): Record<string, string> {
  const details: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = issue.path.join('.') || '_';
    details[field] ??= issue.message;
  }

  return details;
}

export function notFoundHandler(_request: Request, _response: Response, next: NextFunction): void {
  next(notFound('That endpoint does not exist.'));
}

/**
 * Express 5 forwards a rejected async handler here automatically, so route
 * bodies need no try/catch of their own.
 */
export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  // Express identifies an error handler by arity — the fourth parameter has to
  // be declared even though it is never called.
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    response.status(422).json({
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Some of those details are not valid.',
        details: zodDetails(error),
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  // Genuinely unexpected: log it in full, tell the client nothing. A stack
  // trace in a response body is a gift to whoever caused the crash.
  console.error('[unhandled]', error);

  response.status(500).json({
    error: {
      code: ERROR_CODES.INTERNAL,
      message: 'Something went wrong on our end.',
      details: null,
    },
  });
}
