import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { ApiError } from '../../services/http';
import { describeAuthError } from './auth.messages';

function apiError(code: keyof typeof ERROR_CODES, message = 'Server copy.') {
  return new ApiError(400, ERROR_CODES[code], message);
}

describe('describeAuthError', () => {
  it('names the specific failure for wrong credentials', () => {
    expect(describeAuthError(apiError('INVALID_CREDENTIALS'))).toBe(
      'That email or password is not right.',
    );
  });

  it('suggests signing in when the email is taken', () => {
    expect(describeAuthError(apiError('EMAIL_TAKEN'))).toContain('Try signing in');
  });

  it('blames the connection, not the user, when the server is unreachable', () => {
    expect(describeAuthError(apiError('NETWORK'))).toContain('Check your connection');
  });

  /*
   * The collision case. The server's message explains what to do about it —
   * sign in with the password, then connect Google from the profile — and no
   * paraphrase here would be more useful than that.
   */
  it('passes the server’s own wording through for a linking collision', () => {
    expect(describeAuthError(apiError('GOOGLE_LINK_REQUIRED', 'Sign in with your password.'))).toBe(
      'Sign in with your password.',
    );
  });

  it('passes through the last-sign-in-method refusal', () => {
    expect(describeAuthError(apiError('LAST_SIGN_IN_METHOD', 'Set a password first.'))).toBe(
      'Set a password first.',
    );
  });

  it('explains an unverified Google address in our own words', () => {
    expect(describeAuthError(apiError('GOOGLE_EMAIL_UNVERIFIED'))).toContain('has not verified');
  });

  it('points at the email form when Google is not set up', () => {
    expect(describeAuthError(apiError('PROVIDER_NOT_CONFIGURED'))).toContain('Use your email');
  });

  // An unrecognised code must not put a raw server string on the screen.
  it('falls back to the generic line for anything unexpected', () => {
    expect(describeAuthError(apiError('INTERNAL', 'Segfault in module 7'))).toBe(
      'We could not sign you in. Please try again.',
    );
  });

  it('falls back for something that is not an ApiError at all', () => {
    expect(describeAuthError(new TypeError('undefined is not a function'))).toBe(
      'We could not sign you in. Please try again.',
    );
  });
});
