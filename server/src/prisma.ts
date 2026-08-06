import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * One client for the process.
 *
 * Prisma 7 connects through a driver adapter rather than a URL in the schema,
 * so the database choice lives here and in `prisma.config.ts` — which is what
 * kept the move from SQLite to Postgres to those two files.
 *
 * Held on `globalThis` so `tsx watch` reloading a module does not leak a new
 * connection pool on every save. That mattered less against a file; against a
 * server with a finite connection limit it is what stops a morning's editing
 * exhausting it.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: env().DATABASE_URL }),
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (env().NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
