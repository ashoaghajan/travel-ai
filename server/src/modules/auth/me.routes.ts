import { setPlanSchema, updateMeSchema } from '@ai-travel/shared/schemas';
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
    include: { identities: true, settings: true },
  });

  // A live token for a deleted account: rare, but it must not 500.
  if (!user) throw notFound('That account no longer exists.');

  response.json(toApiUser(user, user.identities, user.settings));
});

meRouter.patch('/', async (request, response) => {
  const patch = updateMeSchema.parse(request.body);

  const user = await prisma.user.update({
    where: { id: userIdOf(request) },
    data: patch,
    include: { identities: true, settings: true },
  });

  response.json(toApiUser(user, user.identities, user.settings));
});

/**
 * `POST /api/me/plan` — become Pro, or go back to free.
 *
 * **This route is a stand-in for a payment provider's webhook and must be
 * deleted the day one exists.** Nothing here takes money, so the only honest
 * way to have a tier at all is to let somebody ask for it: anyone who reads
 * the network tab can be Pro for nothing. That is a deliberate property, not
 * an oversight — until billing lands, the tier shapes the default experience
 * rather than withholding anything.
 *
 * `proSince` is cleared on the way down rather than kept, so it always
 * describes the spell the account is in now and not the first one it ever had.
 */
meRouter.post('/plan', async (request, response) => {
  const { plan } = setPlanSchema.parse(request.body);

  const user = await prisma.user.update({
    where: { id: userIdOf(request) },
    data: { plan, proSince: plan === 'pro' ? new Date() : null },
    include: { identities: true, settings: true },
  });

  response.json(toApiUser(user, user.identities, user.settings));
});
