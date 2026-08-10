import { hash, verify } from '@node-rs/argon2';
import { ERROR_CODES } from '@ai-travel/shared';
import type { ApiIdentity, ApiUser } from '@ai-travel/shared';
import { toEmailKey } from '@ai-travel/shared/schemas';
import type { AuthIdentity, User, UserSettings } from '@prisma/client';
import { prisma } from '../../prisma';
import { conflict, unauthorized } from '../../errors';
import { toApiSettings } from '../settings/settings.service';
import {
  createRefreshToken,
  hashRefreshToken,
  newFamilyId,
  sessionExpiry,
  signAccessToken,
} from './tokens';

/**
 * Accounts and sessions.
 *
 * Two tabs waking from sleep will both present the same refresh cookie within
 * milliseconds of each other. That is not an attack, and the grace window
 * below is what stops it being treated as one — see `rotateRefreshToken`.
 */

/**
 * OWASP's second recommended argon2id configuration: 19 MiB, two passes.
 * Tuned to cost roughly 50ms, which is slow enough to matter to someone
 * grinding a stolen table and fast enough to be invisible on a login.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * How long a just-rotated token stays acceptable.
 *
 * Without this, a second tab replaying the cookie its sibling rotated a
 * moment ago looks exactly like a thief replaying a stolen one, and we would
 * sign both of them out. Five seconds covers the race and is far too short to
 * be useful to an attacker who stole the cookie minutes ago.
 */
const ROTATION_GRACE_MS = 5_000;

export type SessionContext = {
  userAgent?: string;
  ip?: string;
};

export type IssuedSession = {
  user: ApiUser;
  accessToken: string;
  expiresIn: number;
  /** The raw refresh token — belongs in a cookie and nowhere else. */
  refreshToken: string;
  /** The row it was stored as, so a rotation can point the old one at it. */
  refreshTokenId: string;
  /**
   * When the whole sign-in ends. Fixed when the session opened and unchanged
   * by every rotation since, so the cookie can be set to expire with it.
   */
  expiresAt: Date;
};

/**
 * The user as the wire sees them.
 *
 * `identities` is optional on the way in because most callers already hold a
 * bare `User`; when it is absent the list is simply empty rather than wrong —
 * only `GET /api/me` and the sign-in responses need it populated.
 */
/**
 * `settings` is passed in rather than looked up here.
 *
 * This is a pure mapper — every caller already has the row in hand or can
 * include it in the query it was making anyway, and a lookup hidden inside a
 * mapper is a query nobody can see when they read the call site.
 */
export function toApiUser(
  user: User,
  identities: AuthIdentity[] = [],
  settings: UserSettings | null = null,
): ApiUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isGuest: false,
    createdAt: user.createdAt.toISOString(),
    identities: identities.map((identity) => ({
      provider: identity.provider as ApiIdentity['provider'],
      email: identity.email,
    })),
    hasPassword: user.passwordHash !== null,
    activeTripId: user.activeTripId,
    settings: toApiSettings(settings),
  };
}

/** Everything a session response needs, in one read. */
async function loadIdentities(userId: string): Promise<AuthIdentity[]> {
  return prisma.authIdentity.findMany({ where: { userId } });
}

/**
 * Open a session for a user, however they proved who they are.
 *
 * `familyId` defaults to a fresh one — a new sign-in starts a new rotation
 * family. Only `rotateRefreshToken` passes an existing one, to keep a
 * refreshed token in the family it came from.
 *
 * `expiresAt` defaults to a fresh deadline, which is what a sign-in wants.
 * `rotateRefreshToken` passes the deadline the family already had, so every
 * member of a family dies at the same instant and refreshing buys no extra
 * time. That is the whole of the absolute cap: one argument, passed through.
 */
export async function issueSession(
  user: User,
  familyId: string = newFamilyId(),
  context: SessionContext = {},
  expiresAt: Date = sessionExpiry(),
): Promise<IssuedSession> {
  const { raw, hash: tokenHash } = createRefreshToken();

  const row = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      familyId,
      expiresAt,
      userAgent: context.userAgent?.slice(0, 255),
      ip: context.ip,
    },
    select: { id: true },
  });

  const { token, expiresIn } = signAccessToken(user.id);

  return {
    user: toApiUser(
      user,
      await loadIdentities(user.id),
      await prisma.userSettings.findUnique({ where: { userId: user.id } }),
    ),
    accessToken: token,
    expiresIn,
    refreshToken: raw,
    refreshTokenId: row.id,
    expiresAt,
  };
}

export async function register(
  input: { name: string; email: string; password: string },
  context: SessionContext = {},
): Promise<IssuedSession> {
  const emailKey = toEmailKey(input.email);

  if (await prisma.user.findUnique({ where: { emailKey } })) {
    throw conflict(ERROR_CODES.EMAIL_TAKEN, 'An account already uses that email address.');
  }

  const user = await prisma.user.create({
    data: {
      email: input.email.trim(),
      emailKey,
      name: input.name.trim(),
      passwordHash: await hash(input.password, ARGON2_OPTIONS),
    },
  });

  return issueSession(user, newFamilyId(), context);
}

export async function login(
  input: { email: string; password: string },
  context: SessionContext = {},
): Promise<IssuedSession> {
  const user = await prisma.user.findUnique({ where: { emailKey: toEmailKey(input.email) } });

  // One message for both halves: telling an unknown email apart from a wrong
  // password hands over a list of who has an account here.
  const rejected = () =>
    unauthorized(ERROR_CODES.INVALID_CREDENTIALS, 'That email or password is not right.');

  if (!user) throw rejected();

  // A Google-only account has no hash. `verify` would throw on null, turning a
  // wrong guess into a 500 — and a 500 here is an oracle: it tells an attacker
  // that this address exists and signs in with Google. Same rejection as every
  // other failure.
  if (!user.passwordHash) throw rejected();

  if (!(await verify(user.passwordHash, input.password))) throw rejected();

  return issueSession(user, newFamilyId(), context);
}

/**
 * Exchange a refresh token for a new one, and a new access token with it.
 *
 * The interesting case is a token that has already been rotated. Inside the
 * grace window that is a second tab; outside it, the only explanation is that
 * someone kept a copy — so the entire family dies, signing out the thief and
 * the owner alike. The owner can sign in again; the thief cannot.
 */
export async function rotateRefreshToken(
  raw: string,
  context: SessionContext = {},
): Promise<Omit<IssuedSession, 'user'> & { user: ApiUser }> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(raw) },
    include: { user: true },
  });

  const rejected = () => unauthorized(ERROR_CODES.UNAUTHENTICATED, 'Please sign in again.');

  if (!existing) throw rejected();
  if (existing.expiresAt.getTime() <= Date.now()) throw rejected();

  if (existing.revokedAt) {
    // `replacedById` is what tells the two kinds of revocation apart. Rotation
    // always records a successor; logout and a family kill never do. Only the
    // first kind can be an innocent race, so only it gets the grace window —
    // otherwise signing out would not take effect for five seconds.
    const wasRotated = existing.replacedById !== null;

    if (!wasRotated) throw rejected();

    if (Date.now() - existing.revokedAt.getTime() > ROTATION_GRACE_MS) {
      await prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      throw unauthorized(
        ERROR_CODES.REFRESH_REUSED,
        'That session was already used elsewhere. Please sign in again.',
      );
    }
    // Inside the window: fall through and mint a sibling. Both tabs end up
    // holding live tokens in the same family, which is the honest outcome.
  }

  // The inherited `expiresAt` is the point. Recomputing it here would let a
  // reader refresh their way to an endless session, which is what an idle
  // timeout does and an absolute cap must not.
  const issued = await issueSession(existing.user, existing.familyId, context, existing.expiresAt);

  if (!existing.revokedAt) {
    await prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: issued.refreshTokenId },
    });
  }

  return issued;
}

/** Ends this sign-in everywhere it was rotated to, but leaves other devices alone. */
export async function logout(raw: string | undefined): Promise<void> {
  if (!raw) return;

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(raw) },
    select: { familyId: true },
  });

  if (!existing) return;

  await prisma.refreshToken.updateMany({
    where: { familyId: existing.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
