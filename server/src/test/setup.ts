import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach } from 'vitest';

/**
 * A real database for the test run, kept apart from the one you develop against.
 *
 * Not a mocked Prisma client: the things most worth testing here — the unique
 * constraint on `emailKey`, cascade deletes, the family-wide revoke — are
 * behaviours of the database, and a mock would assert only that we called it.
 *
 * This used to be a throwaway SQLite file per run, which cost nothing and
 * depended on nothing. Postgres cannot be conjured that way, so the suite now
 * needs a server: `docker compose up -d` from the repo root. The trade was
 * forced by deployment — a file-backed database does not survive a release —
 * and it buys something back, because these tests now run against the same
 * engine production does rather than one that merely resembles it.
 *
 * Its own database, never a schema inside the development one. `migrate
 * deploy` and the truncation below are both destructive, and pointing them at
 * a database holding an afternoon's manual testing is a mistake you get to
 * make exactly once.
 *
 * The environment has to be set before anything imports `env.ts` or
 * `prisma.ts`, which is why this runs as a setup file rather than in a hook.
 */

/** Where the server lives. Overridable so CI can point at its own service. */
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://aitravel:aitravel@localhost:5433/aitravel';

const TEST_DATABASE = 'aitravel_test';

function testDatabaseUrl(): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DATABASE}`;
  return url.toString();
}

const databaseUrl = testDatabaseUrl();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-to-pass-validation';
// Most suites fail login on purpose and would throttle themselves; the
// rate-limit suite switches this back on for itself.
process.env.DISABLE_RATE_LIMIT = '1';

const NO_SERVER = [
  `Could not reach Postgres at ${new URL(ADMIN_URL).host}.`,
  '',
  'The server suite needs a database. From the repo root:',
  '',
  '  docker compose up -d',
  '',
  'Set TEST_DATABASE_URL to point somewhere else.',
].join('\n');

/**
 * Creates the test database when it is not there yet.
 *
 * Done here rather than in an init script on the container, because those run
 * only when the data volume is first created — a clone that already had
 * Postgres up before this existed would never get one, and the failure would
 * arrive as a confusing migration error rather than as a missing database.
 */
async function ensureTestDatabase(): Promise<void> {
  const { Client } = await import('pg');
  const admin = new Client({ connectionString: ADMIN_URL });

  try {
    await admin.connect();
  } catch (error) {
    throw new Error(`${NO_SERVER}\n\nThe connection failed with: ${(error as Error).message}`);
  }

  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DATABASE,
    ]);

    // Not parameterisable — an identifier, not a value. `TEST_DATABASE` is a
    // constant in this file and never reaches here from outside.
    if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${TEST_DATABASE}"`);
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  await ensureTestDatabase();

  // `migrate deploy` applies the committed migrations, so the schema under
  // test is the schema that will ship — not one `db push` invented.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
});

beforeEach(async () => {
  const { prisma } = await import('../prisma');

  /*
   * One round trip rather than fourteen.
   *
   * The statements and their order are unchanged — the foreign keys are
   * enforced, so the order is load-bearing — but they travel together now.
   * Before every one of 596 tests, fourteen sequential awaits is eight
   * thousand round trips a run spends waiting rather than working.
   *
   * `TRUNCATE ... CASCADE` was tried here and is deliberately not what this
   * does: it needs no ordering and no list, but it is file-level work with a
   * sync behind it, and on tables holding a handful of rows it measured more
   * than twice as slow across the suite as the deletes it replaced.
   */
  await prisma.$transaction([
    // Children first — the foreign keys are enforced.
    prisma.refreshToken.deleteMany(),
    prisma.authIdentity.deleteMany(),
    // Before `user`, which would cascade to them anyway. Explicit because the
    // pointer runs the other way too: `User.activeTripId` references a trip,
    // and clearing trips first lets that go null rather than relying on the
    // order two cascades happen to fire in.
    prisma.chatHistory.deleteMany(),
    prisma.directMessage.deleteMany(),
    // After the messages that point at them, before the trips they point at.
    prisma.tripShare.deleteMany(),
    prisma.friendship.deleteMany(),
    prisma.conversationRead.deleteMany(),
    prisma.recentSearch.deleteMany(),
    prisma.savedActivity.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.userSettings.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  /*
   * The throttles, put back where every suite but one expects them.
   *
   * In `beforeEach` rather than in each file's `afterEach`, and that is the
   * whole point: an `afterEach` does not run when a test times out, so a
   * single slow test in `rate-limit.test.ts` — the one suite that switches
   * throttling *on* for itself — used to leave it on for every file after it.
   * What that looks like is nothing like its cause: three later suites fail
   * asserting 422 and get 429, in modules nobody has touched.
   *
   * Cleaning up before rather than after means a leak costs the test that
   * caused it and nothing else.
   */
  process.env.DISABLE_RATE_LIMIT = '1';

  const [auth, messages, planner, speech, travel] = await Promise.all([
    import('../modules/auth/rate-limit'),
    import('../modules/messages/messages.routes'),
    import('../modules/planner/planner.routes'),
    import('../modules/speech/speech.routes'),
    import('../modules/travel/travel.routes'),
  ]);

  auth.resetRateLimits();
  messages.resetMessagesRateLimit();
  planner.resetPlannerRateLimit();
  speech.resetSpeechRateLimit();
  travel.resetTravelRateLimit();
});

afterAll(async () => {
  const { closeApi } = await import('./harness');
  await closeApi();

  const { prisma } = await import('../prisma');
  await prisma.$disconnect();

  // The database stays. Dropping it would make every run pay for `migrate
  // deploy` against an empty schema again, and the truncation above is what
  // actually isolates one test from the next.
});
