import { z } from 'zod';

/**
 * Request validation for the auth endpoints.
 *
 * Server-side only. Client validation is UX — it tells someone their password
 * is short before they wait for a round trip — but these are the rules that
 * actually decide, and they must not assume the client ran first.
 */

/** Long enough to resist a guess, with no composition rules to memorise. */
export const MIN_PASSWORD_LENGTH = 10;

/** Longer than any real name; a bound stops a megabyte landing in a column. */
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .max(MAX_EMAIL_LENGTH)
  .email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  // bcrypt-style truncation is not a concern with argon2, but an unbounded
  // password is a cheap way to make hashing expensive.
  .max(200, 'That password is too long.');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(MAX_NAME_LENGTH),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately not `passwordSchema`: an existing account whose password
  // predates a rule change must still be able to sign in and change it.
  password: z.string().min(1, 'Enter your password.'),
});

export const updateMeSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(MAX_NAME_LENGTH).optional(),
});

/**
 * The body of `POST /api/me/plan`.
 *
 * **A placeholder for a payment provider's webhook.** Until one exists, the
 * browser asks for the tier and gets it — so Pro shapes what somebody gets by
 * default rather than restricting anybody, and anyone reading the network tab
 * can have it. The day billing lands, this schema and its route are deleted
 * and the flag moves the way it does everywhere else: from the provider,
 * never from a request the browser can make.
 */
export const setPlanSchema = z.object({
  plan: z.enum(['free', 'pro']),
});

/** `lower(trim(email))` — the form the unique constraint is built on. */
export function toEmailKey(email: string): string {
  return email.trim().toLowerCase();
}
