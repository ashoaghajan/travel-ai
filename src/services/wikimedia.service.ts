/**
 * Wikimedia HTTP client — photographs for places we already have an identity
 * for.
 *
 * Knows Wikidata and Commons and nothing about our domain: it maps Wikidata
 * entity ids to pictures, and `activity.service.ts` decides what to do with
 * them. No React component may import this file.
 *
 * Two stages, because the two facts live in different places: Wikidata says
 * *which* photo represents an entity (property P18, "image of the subject"),
 * and Commons holds the file itself along with its author and licence. Both
 * endpoints take up to 50 ids per request, so a screen of places costs a
 * bounded handful of calls rather than one per card.
 *
 * Neither endpoint needs a key, and both send `Access-Control-Allow-Origin: *`.
 *
 * APIs: https://www.wikidata.org/w/api.php, https://commons.wikimedia.org/w/api.php
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/** Both endpoints cap a batch at 50 ids for anonymous callers. */
const BATCH_SIZE = 50;

/** Wide enough for a card at 2× on the widest grid column. */
const THUMBNAIL_WIDTH = 800;

/** Photos are decorative — a slow response must not hold up the grid. */
const REQUEST_TIMEOUT_MS = 8_000;

/** "image of the subject". */
const IMAGE_PROPERTY = 'P18';

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

type EntitiesResponse = {
  entities?: Record<
    string,
    {
      claims?: Record<
        string,
        { mainsnak?: { datavalue?: { value?: unknown } } }[]
      >;
    }
  >;
};

type ImageInfoResponse = {
  query?: {
    pages?: {
      title?: string;
      imageinfo?: {
        thumburl?: string;
        url?: string;
        descriptionurl?: string;
        extmetadata?: Record<string, { value?: unknown }>;
      }[];
    }[];
  };
};

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function request<T>(base: string, params: Record<string, string>): Promise<T | null> {
  const url = new URL(base);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  // Wikimedia treats an explicit origin as the signal to send CORS headers.
  url.searchParams.set('origin', '*');
  url.searchParams.set('format', 'json');

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // Offline, timeout, CORS or malformed JSON. A missing photo is not worth
    // an error state, so every failure here degrades to "no image".
    return null;
  }
}

/**
 * The metadata fields arrive as small HTML fragments — an author is usually a
 * link to a user page. React would render the markup as literal text, so it is
 * reduced to the words here.
 */
export function toPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function metadataString(
  extmetadata: Record<string, { value?: unknown }> | undefined,
  field: string,
): string | undefined {
  const raw = extmetadata?.[field]?.value;
  if (typeof raw !== 'string') return undefined;

  const text = toPlainText(raw);
  return text.length > 0 ? text : undefined;
}

export const wikimediaService = {
  /**
   * Wikidata entity id → Commons file name, for the entities that have a
   * representative image. Ids with no `P18` are simply absent from the result.
   */
  async getImageFileNames(entityIds: string[]): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    if (entityIds.length === 0) return files;

    const batches = await Promise.all(
      chunk(entityIds, BATCH_SIZE).map((batch) =>
        request<EntitiesResponse>(WIKIDATA_API, {
          action: 'wbgetentities',
          ids: batch.join('|'),
          props: 'claims',
          formatversion: '2',
        }),
      ),
    );

    for (const batch of batches) {
      for (const [entityId, entity] of Object.entries(batch?.entities ?? {})) {
        const value = entity.claims?.[IMAGE_PROPERTY]?.[0]?.mainsnak?.datavalue?.value;
        if (typeof value === 'string' && value.length > 0) files.set(entityId, value);
      }
    }

    return files;
  },

  /** Commons file name → thumbnail URL with the attribution it requires. */
  async getImageInfo(fileNames: string[]): Promise<Map<string, WikimediaImage>> {
    const images = new Map<string, WikimediaImage>();
    if (fileNames.length === 0) return images;

    const batches = await Promise.all(
      chunk(fileNames, BATCH_SIZE).map((batch) =>
        request<ImageInfoResponse>(COMMONS_API, {
          action: 'query',
          titles: batch.map((name) => `File:${name}`).join('|'),
          prop: 'imageinfo',
          iiprop: 'url|extmetadata',
          iiurlwidth: String(THUMBNAIL_WIDTH),
          formatversion: '2',
        }),
      ),
    );

    for (const batch of batches) {
      for (const page of batch?.query?.pages ?? []) {
        const info = page.imageinfo?.[0];
        // `thumburl` is absent for formats Commons cannot scale, e.g. SVG.
        const url = info?.thumburl ?? info?.url;
        if (!page.title || !url) continue;

        images.set(page.title.replace(/^File:/, ''), {
          url,
          descriptionUrl: info?.descriptionurl ?? '',
          author: metadataString(info?.extmetadata, 'Artist'),
          license: metadataString(info?.extmetadata, 'LicenseShortName'),
        });
      }
    }

    return images;
  },

  /**
   * Wikidata entity id → picture, resolving both stages.
   *
   * Entities with no image, and files Commons will not serve, are left out
   * rather than reported — the caller falls back to its own artwork.
   */
  async getImages(entityIds: string[]): Promise<Map<string, WikimediaImage>> {
    const files = await wikimediaService.getImageFileNames(entityIds);
    const images = await wikimediaService.getImageInfo([...new Set(files.values())]);

    const byEntity = new Map<string, WikimediaImage>();
    for (const [entityId, fileName] of files) {
      const image = images.get(fileName);
      if (image) byEntity.set(entityId, image);
    }

    return byEntity;
  },
};
