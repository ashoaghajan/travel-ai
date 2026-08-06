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
    url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
  },
});
