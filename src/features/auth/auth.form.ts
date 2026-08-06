/**
 * Sign-in and sign-up field rules.
 *
 * Pure — no React, no network. These exist so someone is told their password
 * is short before they wait for a round trip; the server has its own copy in
 * `@ai-travel/shared/schemas` and is the one that decides. Client validation
 * is courtesy, not enforcement.
 */

/** Must match `MIN_PASSWORD_LENGTH` on the server. */
export const MIN_PASSWORD_LENGTH = 10;

export type SignInDraft = {
  email: string;
  password: string;
};

export type SignUpDraft = SignInDraft & {
  name: string;
};

export type AuthErrors = {
  name?: string;
  email?: string;
  password?: string;
};

export function emptySignInDraft(): SignInDraft {
  return { email: '', password: '' };
}

export function emptySignUpDraft(): SignUpDraft {
  return { name: '', email: '', password: '' };
}

/**
 * Deliberately permissive: one `@` with something either side.
 *
 * A stricter pattern rejects addresses that genuinely work, and the only real
 * test of an email is sending to it. This catches the typo, nothing more.
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateSignIn(draft: SignInDraft): AuthErrors {
  const errors: AuthErrors = {};

  if (!draft.email.trim()) errors.email = 'Enter your email address.';
  else if (!looksLikeEmail(draft.email.trim())) errors.email = 'Enter a valid email address.';

  // No length rule here: an account made before the rule changed must still
  // be able to sign in.
  if (!draft.password) errors.password = 'Enter your password.';

  return errors;
}

export function validateSignUp(draft: SignUpDraft): AuthErrors {
  const errors: AuthErrors = validateSignIn(draft);

  if (!draft.name.trim()) errors.name = 'Enter your name.';

  if (draft.password && draft.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  return errors;
}

export function hasErrors(errors: AuthErrors): boolean {
  return Object.keys(errors).length > 0;
}
