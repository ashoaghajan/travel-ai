import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createCache } from '../../cache';
import { getImages } from './wikimedia';
import type { WikimediaImage } from './wikimedia';

/**
 * `/api/images` — attraction photographs, from Wikidata and Commons.
 *
 * Unauthenticated reference data, like the rest of this module.
 *
 * Cached per entity rather than per request, because the requests overlap
 * heavily: two readers browsing the same city ask for almost the same thirty
 * ids, and a whole-request key would miss on every reordering.
 */

export const imagesRouter = Router();

/** A photograph of a cathedral does not change. */
const TTL_MS = 24 * 60 * 60 * 1000;

const MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * One entry per entity, holding either the image or the fact that there is
 * none. Caching the absence matters as much as caching the hit: most entities
 * have no `P18`, and without it every grid re-asks Wikidata for all of them.
 *
 * `'none'` rather than `null` for that absence, because the cache already uses
 * `null` to mean "not held" — storing `null` would make a known-imageless
 * entity look like a miss and defeat the point of caching it.
 */
const NO_IMAGE = 'none';

const images = createCache<WikimediaImage | typeof NO_IMAGE>(TTL_MS);

/** Ids are `Q` followed by digits; anything else is not worth a round trip. */
const query = z.object({
  ids: z
    .string()
    .trim()
    .min(1, 'Name at least one Wikidata id.')
    .transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string().regex(/^Q\d+$/, 'Wikidata ids look like Q42.')).min(1).max(100)),
});

imagesRouter.get('/images/wikidata', async (request: Request, response: Response) => {
  const { ids } = query.parse(request.query);

  const found: Record<string, WikimediaImage> = {};
  const missing: string[] = [];

  for (const id of ids) {
    const cached = images.get(id);

    if (cached === null) {
      missing.push(id);
    } else if (cached !== NO_IMAGE) {
      found[id] = cached;
    }
  }

  if (missing.length > 0) {
    const fetched = await getImages(missing);

    for (const id of missing) {
      const image = fetched.value[id];

      if (image) {
        images.set(id, image);
        found[id] = image;
        continue;
      }

      /*
       * Only remember an absence the lookup actually established.
       *
       * Wikidata fails a whole batch for one unknown id, so a single stale
       * reference makes every other entity in the request look imageless.
       * Caching that would blank a grid of attractions for a day over one bad
       * id — the failure is retried instead.
       */
      if (fetched.complete) images.set(id, NO_IMAGE);
    }
  }

  response.set('Cache-Control', `public, max-age=${MAX_AGE_SECONDS}`);
  response.json(found);
});

/** Test seam: drops every cached photograph. */
export function resetImagesCache(): void {
  images.clear();
}
