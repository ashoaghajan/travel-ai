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

  // Children first — the foreign keys are enforced.
  await prisma.refreshToken.deleteMany();
  await prisma.authIdentity.deleteMany();
  // Before `user`, which would cascade to them anyway. Explicit because the
  // pointer runs the other way too: `User.activeTripId` references a trip, and
  // clearing trips first lets that go null rather than relying on the order
  // two cascades happen to fire in.
  await prisma.chatHistory.deleteMany();
  await prisma.directMessage.deleteMany();
  await prisma.conversationRead.deleteMany();
  await prisma.recentSearch.deleteMany();
  await prisma.savedActivity.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.userSettings.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  const { prisma } = await import('../prisma');
  await prisma.$disconnect();

  // The database stays. Dropping it would make every run pay for `migrate
  // deploy` against an empty schema again, and the truncation above is what
  // actually isolates one test from the next.
});
