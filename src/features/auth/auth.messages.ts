import { ERROR_CODES } from '@ai-travel/shared';
import { ApiError } from '../../services/http';

/**
 * What to put in front of the user when signing in fails.
 *
 * The server's messages are written for people, so the specific ones are
 * passed through; anything unrecognised becomes the generic line, because an
 * unexpected code should not put a raw server string on the screen.
 */

const GENERIC_ERROR = 'We could not sign you in. Please try again.';

const OFFLINE_ERROR = 'We could not reach the server. Check your connection and try again.';

export function describeAuthError(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_ERROR;

  switch (error.code) {
    case ERROR_CODES.NETWORK:
      return OFFLINE_ERROR;
    case ERROR_CODES.INVALID_CREDENTIALS:
      return 'That email or password is not right.';
    case ERROR_CODES.EMAIL_TAKEN:
      return 'An account already uses that email address. Try signing in instead.';
    case ERROR_CODES.RATE_LIMITED:
      return 'Too many attempts. Wait a few minutes and try again.';

    // These name the rule the server actually enforced, which is more precise
    // than anything this module could guess.
    case ERROR_CODES.WEAK_PASSWORD:
    case ERROR_CODES.VALIDATION_FAILED:
    case ERROR_CODES.GOOGLE_LINK_REQUIRED:
    case ERROR_CODES.GOOGLE_ALREADY_LINKED:
    case ERROR_CODES.LAST_SIGN_IN_METHOD:
      return error.message;

    case ERROR_CODES.GOOGLE_EMAIL_UNVERIFIED:
      return 'Google has not verified that email address, so we cannot use it to sign you in.';
    case ERROR_CODES.GOOGLE_TOKEN_INVALID:
      return 'That Google sign-in did not check out. Please try again.';
    case ERROR_CODES.PROVIDER_NOT_CONFIGURED:
      return 'Signing in with Google is not available right now. Use your email instead.';

    default:
      return GENERIC_ERROR;
  }
}
