import { describe, expect, it } from 'vitest';
import {
  emptySignInDraft,
  emptySignUpDraft,
  hasErrors,
  MIN_PASSWORD_LENGTH,
  validateSignIn,
  validateSignUp,
} from './auth.form';

describe('validateSignIn', () => {
  it('accepts a filled-in form', () => {
    expect(validateSignIn({ email: 'ada@example.com', password: 'anything' })).toEqual({});
  });

  it('asks for the missing fields', () => {
    const errors = validateSignIn(emptySignInDraft());

    expect(errors.email).toBe('Enter your email address.');
    expect(errors.password).toBe('Enter your password.');
  });

  it('catches an address that is obviously a typo', () => {
    expect(validateSignIn({ email: 'ada@example', password: 'x' }).email).toBe(
      'Enter a valid email address.',
    );
  });

  it('ignores surrounding whitespace', () => {
    expect(validateSignIn({ email: '  ada@example.com  ', password: 'x' }).email).toBeUndefined();
  });

  // An account made before the length rule existed must still be able to get
  // in and change its password.
  it('does not impose the length rule on an existing password', () => {
    expect(validateSignIn({ email: 'ada@example.com', password: 'short' }).password).toBeUndefined();
  });
});

describe('validateSignUp', () => {
  it('accepts a filled-in form', () => {
    expect(
      validateSignUp({ name: 'Ada', email: 'ada@example.com', password: 'correct-horse' }),
    ).toEqual({});
  });

  it('asks for a name as well', () => {
    expect(validateSignUp(emptySignUpDraft()).name).toBe('Enter your name.');
  });

  it('rejects a whitespace-only name', () => {
    expect(
      validateSignUp({ name: '   ', email: 'ada@example.com', password: 'correct-horse' }).name,
    ).toBe('Enter your name.');
  });

  it('names the length rule rather than just refusing', () => {
    const errors = validateSignUp({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'x'.repeat(MIN_PASSWORD_LENGTH - 1),
    });

    expect(errors.password).toBe(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  });

  it('accepts a password of exactly the minimum length', () => {
    const errors = validateSignUp({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'x'.repeat(MIN_PASSWORD_LENGTH),
    });

    expect(errors.password).toBeUndefined();
  });

  // "Enter your password" is the right message for an empty box; "use at
  // least ten characters" is not.
  it('asks for a password before complaining about its length', () => {
    expect(validateSignUp({ name: 'Ada', email: 'ada@example.com', password: '' }).password).toBe(
      'Enter your password.',
    );
  });
});

describe('hasErrors', () => {
  it('is false for a clean form and true for a broken one', () => {
    expect(hasErrors({})).toBe(false);
    expect(hasErrors({ email: 'Enter your email address.' })).toBe(true);
  });
});
