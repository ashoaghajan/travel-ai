import { createApp } from './app';
import { env } from './env';
import { prisma } from './prisma';

const { PORT } = env();

const server = createApp().listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

/** Close the pool on the way out so `tsx watch` restarts cleanly. */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0));
    });
  });
}
