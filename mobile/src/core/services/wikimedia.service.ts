import { http } from './http';

/**
 * Photographs for attractions.
 *
 * Fetched through our own `/api/images/wikidata`, which resolves both stages
 * of the Wikidata → Commons lookup and caches the result. That two-round,
 * batched conversation used to happen in every browser independently; one
 * server-side copy now serves everyone, and Wikimedia sees a fraction of the
 * traffic.
 *
 * No React component may import this file.
 */

/**
 * The APIs behind the endpoint accept 50 ids per call, and it batches for us —
 * but a single request should still not be unbounded, and the server caps it
 * at 100. Chunking here keeps a large grid inside that cap.
 */
const BATCH_SIZE = 100;

export type WikimediaImage = {
  /** Thumbnail URL, already sized for a card. */
  url: string;
  /** The file's page on Commons, carrying the full licence terms. */
  descriptionUrl: string;
  /** Plain-text author, as far as the file's metadata gives one. */
  author?: string;
  /** Short licence name, e.g. "CC BY-SA 4.0". */
  license?: string;
};

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export const wikimediaService = {
  /**
   * Wikidata entity id → picture.
   *
   * Entities with no image, and files Commons will not serve, are left out
   * rather than reported — the caller falls back to its own artwork. A failed
   * request is the same: an empty result, never an error. A card without a
   * photograph is a far better outcome than a grid that refuses to render.
   */
  async getImages(entityIds: string[]): Promise<Map<string, WikimediaImage>> {
    const byEntity = new Map<string, WikimediaImage>();

    const unique = [...new Set(entityIds.filter(Boolean))];
    if (unique.length === 0) return byEntity;

    const batches = await Promise.all(
      chunk(unique, BATCH_SIZE).map(async (batch) => {
        try {
          return await http.get<Record<string, WikimediaImage>>('/images/wikidata', {
            query: { ids: batch.join(',') },
          });
        } catch {
          return {};
        }
      }),
    );

    for (const batch of batches) {
      for (const [entityId, image] of Object.entries(batch)) {
        if (image?.url) byEntity.set(entityId, image);
      }
    }

    return byEntity;
  },
};
