import { ERROR_CODES } from '@ai-travel/shared';
import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../../errors';
import { verifyAccessToken } from './tokens';

/**
 * Gate for anything that belongs to somebody.
 *
 * It puts the caller's id on the request and nowhere else. No endpoint may
 * read a `userId` from a body or a query string — that is the difference
 * between authentication and a suggestion.
 */

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

export function requireAuth(request: Request, _response: Response, next: NextFunction): void {
  const header = request.get('authorization');

  if (!header?.startsWith('Bearer ')) {
    next(unauthorized(ERROR_CODES.UNAUTHENTICATED, 'Sign in to continue.'));
    return;
  }

  try {
    // Throws `TOKEN_EXPIRED` for a merely stale token, which is the client's
    // signal to refresh rather than to give up.
    request.userId = verifyAccessToken(header.slice('Bearer '.length));
    next();
  } catch (caught) {
    next(caught);
  }
}

/** The authenticated id, for handlers that run behind `requireAuth`. */
export function userIdOf(request: Request): string {
  const { userId } = request;
  if (!userId) throw unauthorized(ERROR_CODES.UNAUTHENTICATED, 'Sign in to continue.');

  return userId;
}
