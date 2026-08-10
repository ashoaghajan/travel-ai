/**
 * Photographs for attractions, from Wikidata and Wikimedia Commons.
 *
 * Keyless and CORS-open, so this did not move for secrecy either. It moved
 * because it is chatty: a grid of thirty attractions is two rounds of batched
 * lookups, and every browser was doing them again from scratch. One cache here
 * serves every reader, and Wikimedia gets a fraction of the traffic.
 *
 * Both stages are needed because Wikidata names the file and Commons serves
 * it: `P18` on an entity gives a file name, and only Commons can turn that
 * into a sized thumbnail with the attribution its licence requires.
 *
 * A missing photo is never an error. Every failure here degrades to "no
 * image", because the caller has its own artwork to fall back on and a card
 * without a photograph is a far better outcome than an error state.
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/** The APIs accept 50 ids per call; asking for more is silently truncated. */
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
    { claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> }
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

/**
 * MediaWiki reports failure in the body, with a 200 status.
 *
 * `wbgetentities` answers `{"error":{"code":"no-such-entity",…}}` — and does so
 * for the *whole batch* when a single id in it does not exist. Read as a
 * success that simply contained no entities, that becomes "none of these
 * attractions has a photograph", which the caller would then cache.
 */
function isProviderError(body: unknown): boolean {
  return Boolean(body && typeof body === 'object' && 'error' in body);
}

async function request<T>(base: string, params: Record<string, string>): Promise<T | null> {
  const url = new URL(base);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('format', 'json');

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as T;

    return isProviderError(body) ? null : body;
  } catch {
    // Offline, timeout or malformed JSON. Null rather than a throw: see the
    // module docblock — a missing photo is not worth failing a grid over.
    return null;
  }
}

/**
 * The metadata fields arrive as small HTML fragments — an author is usually a
 * link to a user page. A client would render the markup as literal text, so it
 * is reduced to the words here.
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

/**
 * Whether every provider call behind a result succeeded.
 *
 * The distinction is load-bearing for the caller's cache. "This entity has no
 * photograph" is a durable fact worth remembering; "the lookup failed" is not,
 * and caching the second as the first blanks an attraction for as long as the
 * TTL lasts. Both look identical in the returned map, so completeness has to
 * be reported alongside it.
 */
export type ImageLookup<T> = { value: T; complete: boolean };

/**
 * Wikidata entity id → Commons file name, for entities that have one.
 *
 * Ids with no `P18` are simply absent from the result.
 */
export async function getImageFileNames(
  entityIds: string[],
): Promise<ImageLookup<Map<string, string>>> {
  const files = new Map<string, string>();
  if (entityIds.length === 0) return { value: files, complete: true };

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

  /*
   * `wbgetentities` fails the *whole batch* when a single id does not exist,
   * so one stale Wikidata reference in an itinerary can empty a grid. Nothing
   * here can rescue that, but reporting it stops the caller remembering the
   * blank as fact.
   */
  return { value: files, complete: batches.every((batch) => batch !== null) };
}

/** Commons file name → thumbnail URL with the attribution it requires. */
export async function getImageInfo(
  fileNames: string[],
): Promise<ImageLookup<Map<string, WikimediaImage>>> {
  const images = new Map<string, WikimediaImage>();
  if (fileNames.length === 0) return { value: images, complete: true };

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

  return { value: images, complete: batches.every((batch) => batch !== null) };
}

/**
 * Wikidata entity id → picture, resolving both stages.
 *
 * Returns a plain object rather than a `Map` because this crosses the wire.
 * Entities with no image, and files Commons will not serve, are left out
 * rather than reported.
 */
export async function getImages(
  entityIds: string[],
): Promise<ImageLookup<Record<string, WikimediaImage>>> {
  const files = await getImageFileNames(entityIds);
  const images = await getImageInfo([...new Set(files.value.values())]);

  const byEntity: Record<string, WikimediaImage> = {};
  for (const [entityId, fileName] of files.value) {
    const image = images.value.get(fileName);
    if (image) byEntity[entityId] = image;
  }

  return { value: byEntity, complete: files.complete && images.complete };
}
