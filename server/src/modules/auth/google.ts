import { ERROR_CODES } from '@ai-travel/shared';
import { toEmailKey } from '@ai-travel/shared/schemas';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../env';
import { HttpError, conflict, unauthorized } from '../../errors';
import { prisma } from '../../prisma';
import type { IssuedSession, SessionContext } from './auth.service';
import { issueSession } from './auth.service';

/**
 * Signing in with Google.
 *
 * The browser gets an ID token from Google's button and posts it here; we
 * check it and mint our *own* session. Nothing downstream knows or cares which
 * door someone came through.
 *
 * Only the public client id is needed — verification checks Google's signature
 * against their published keys and that the token was issued for us. There is
 * no client secret in this flow at all, which is what makes it safe for an
 * app whose frontend is a static bundle.
 */

export const GOOGLE = 'google';

/** What we take from a verified token. Everything else Google sends is ignored. */
export type GoogleProfile = {
  /** The `sub` claim — stable for the life of the Google account. */
  providerUserId: string;
  email: string;
  name: string;
};

let client: OAuth2Client | null = null;

function googleClient(): OAuth2Client {
  client ??= new OAuth2Client();
  return client;
}

function clientId(): string {
  const id = env().GOOGLE_CLIENT_ID;

  if (!id) {
    throw new HttpError(
      503,
      ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      'Signing in with Google is not set up on this server.',
    );
  }

  return id;
}

/**
 * Check the token and pull out the profile.
 *
 * `verifyIdToken` does the work that matters: Google's signature, the issuer,
 * the expiry, and — via `audience` — that this token was minted for us rather
 * than for some other site the user also visited. Without that last check any
 * site's token would sign someone in here.
 */
export async function verifyGoogleCredential(credential: string): Promise<GoogleProfile> {
  const audience = clientId();

  let payload;
  try {
    const ticket = await googleClient().verifyIdToken({ idToken: credential, audience });
    payload = ticket.getPayload();
  } catch {
    throw unauthorized(ERROR_CODES.GOOGLE_TOKEN_INVALID, 'That Google sign-in could not be verified.');
  }

  if (!payload?.sub || !payload.email) {
    throw unauthorized(ERROR_CODES.GOOGLE_TOKEN_INVALID, 'That Google sign-in could not be verified.');
  }

  // The entire linking policy rests on Google vouching for the address. An
  // unverified one proves only that somebody typed it.
  if (payload.email_verified !== true) {
    throw new HttpError(
      403,
      ERROR_CODES.GOOGLE_EMAIL_UNVERIFIED,
      'Google has not verified that email address.',
    );
  }

  return {
    providerUserId: payload.sub,
    email: payload.email,
    name: payload.name?.trim() || payload.email.split('@')[0],
  };
}

/**
 * Sign in, or open an account.
 *
 * The one case that is deliberately refused: the address already belongs to a
 * password account. Linking on a matching email is what most products do, and
 * it is unsafe here — our own signups are unverified, so anyone can register
 * an address they do not own and wait for its owner to arrive through Google.
 * They connect it from their profile instead, having proved the password.
 */
export async function signInWithGoogle(
  credential: string,
  context: SessionContext = {},
): Promise<IssuedSession> {
  const profile = await verifyGoogleCredential(credential);

  const identity = await prisma.authIdentity.findUnique({
    where: { provider_providerUserId: { provider: GOOGLE, providerUserId: profile.providerUserId } },
    include: { user: true },
  });

  if (identity) return issueSession(identity.user, undefined, context);

  const existing = await prisma.user.findUnique({
    where: { emailKey: toEmailKey(profile.email) },
  });

  if (existing?.passwordHash) {
    throw conflict(
      ERROR_CODES.GOOGLE_LINK_REQUIRED,
      'That email already uses a password. Sign in with your password, then connect Google from your profile.',
    );
  }

  if (existing) {
    // No password, and no identity matched — so this is a Google-only account
    // whose provider id we have not seen. Same verified address, so attaching
    // it gives nobody access they did not already have.
    await prisma.authIdentity.create({
      data: {
        userId: existing.id,
        provider: GOOGLE,
        providerUserId: profile.providerUserId,
        email: profile.email,
      },
    });

    return issueSession(existing, undefined, context);
  }

  const user = await prisma.user.create({
    data: {
      email: profile.email,
      emailKey: toEmailKey(profile.email),
      name: profile.name,
      identities: {
        create: { provider: GOOGLE, providerUserId: profile.providerUserId, email: profile.email },
      },
    },
  });

  return issueSession(user, undefined, context);
}

/** Attach Google to an account that is already signed in. */
export async function linkGoogle(userId: string, credential: string): Promise<void> {
  const profile = await verifyGoogleCredential(credential);

  const existing = await prisma.authIdentity.findUnique({
    where: { provider_providerUserId: { provider: GOOGLE, providerUserId: profile.providerUserId } },
    select: { userId: true },
  });

  if (existing) {
    if (existing.userId === userId) return;

    throw conflict(
      ERROR_CODES.GOOGLE_ALREADY_LINKED,
      'That Google account is already connected to another account here.',
    );
  }

  // The Google address is deliberately not required to match the account's
  // own — people routinely sign in with a different address than they
  // registered with, and the account holder has already proved who they are.
  await prisma.authIdentity.create({
    data: { userId, provider: GOOGLE, providerUserId: profile.providerUserId, email: profile.email },
  });
}

/** Detach Google, unless it is the only way back in. */
export async function unlinkGoogle(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { identities: true },
  });

  if (!user) throw unauthorized(ERROR_CODES.UNAUTHENTICATED, 'Sign in to continue.');

  const remaining = user.identities.filter((identity) => identity.provider !== GOOGLE);

  if (!user.passwordHash && remaining.length === 0) {
    throw conflict(
      ERROR_CODES.LAST_SIGN_IN_METHOD,
      'Set a password before disconnecting Google, or you will not be able to sign in.',
    );
  }

  await prisma.authIdentity.deleteMany({ where: { userId, provider: GOOGLE } });
}
