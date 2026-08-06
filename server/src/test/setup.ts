import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach } from 'vitest';

/**
 * A real database per test run, thrown away afterwards.
 *
 * Not a mocked Prisma client: the things most worth testing here — the unique
 * constraint on `emailKey`, cascade deletes, the family-wide revoke — are
 * behaviours of the database, and a mock would assert only that we called it.
 *
 * The environment has to be set before anything imports `env.ts` or
 * `prisma.ts`, which is why this runs as a setup file rather than in a hook.
 */

const directory = mkdtempSync(join(tmpdir(), 'ai-travel-test-'));
const databaseUrl = `file:${join(directory, 'test.db')}`;

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-to-pass-validation';
// Most suites fail login on purpose and would throttle themselves; the
// rate-limit suite switches this back on for itself.
process.env.DISABLE_RATE_LIMIT = '1';

beforeAll(() => {
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

  // Children first — SQLite enforces the foreign keys.
  await prisma.refreshToken.deleteMany();
  await prisma.authIdentity.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  const { prisma } = await import('../prisma');
  await prisma.$disconnect();

  rmSync(directory, { recursive: true, force: true });
});
