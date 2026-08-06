import { defineConfig } from 'prisma/config';

/**
 * Where the CLI finds the schema and the database.
 *
 * Prisma 7 moved the connection URL out of `schema.prisma`; the runtime client
 * gets it through a driver adapter instead (see `src/prisma.ts`).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // The fallback matches `docker-compose.yml`, so a fresh clone that has
    // brought the database up can migrate without writing an env file first.
    // Port 5433 rather than 5432 deliberately — the default is too often
    // already taken by another project's Postgres or a forwarded tunnel.
    url: process.env.DATABASE_URL ?? 'postgresql://aitravel:aitravel@localhost:5433/aitravel',
  },
});
