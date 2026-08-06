import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * One client for the process.
 *
 * Prisma 7 connects through a driver adapter rather than a URL in the schema,
 * so the database choice lives here and in `prisma.config.ts` — which is what
 * makes the eventual move to Postgres a two-file change.
 *
 * Held on `globalThis` so `tsx watch` reloading a module does not leak a new
 * connection pool on every save.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: env().DATABASE_URL }),
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (env().NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
