import { updateMeSchema } from '@ai-travel/shared/schemas';
import { Router } from 'express';
import { notFound } from '../../errors';
import { prisma } from '../../prisma';
import { toApiUser } from './auth.service';
import { requireAuth, userIdOf } from './requireAuth';

/**
 * `/api/me` — the current account.
 *
 * The id always comes from the verified access token, never from the request
 * body, so there is no shape of input that reaches another user's row.
 */
export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', async (request, response) => {
  // Identities come along so the profile screen can list connected providers
  // without a second round trip.
  const user = await prisma.user.findUnique({
    where: { id: userIdOf(request) },
    include: { identities: true },
  });

  // A live token for a deleted account: rare, but it must not 500.
  if (!user) throw notFound('That account no longer exists.');

  response.json(toApiUser(user, user.identities));
});

meRouter.patch('/', async (request, response) => {
  const patch = updateMeSchema.parse(request.body);

  const user = await prisma.user.update({
    where: { id: userIdOf(request) },
    data: patch,
    include: { identities: true },
  });

  response.json(toApiUser(user, user.identities));
});
