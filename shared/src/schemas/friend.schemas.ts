import { z } from 'zod';
import { PEOPLE_SEARCH_LIMIT } from '../friend.types';

/**
 * What the server will accept when looking for somebody to befriend.
 *
 * There is nothing else to validate in this feature: every other route names
 * its subject in the path and takes no body at all, because a friendship has
 * no fields — it exists or it does not.
 *
 * Server-only, behind the `@ai-travel/shared/schemas` export path.
 */
export const peopleSearchSchema = z.object({
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(PEOPLE_SEARCH_LIMIT).default(PEOPLE_SEARCH_LIMIT),
});
