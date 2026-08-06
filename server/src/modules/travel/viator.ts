import type { ApiActivity } from '@ai-travel/shared';
import { env } from '../../env';

/**
 * The Viator client — the provider that prices things to do.
 *
 * Two calls, on the same split as LiteAPI: the catalogue is keyed by Viator's
 * own destination ids, so a city name has to become one of those before any
 * product can be asked for. The taxonomy that maps them is a single static
 * list of every destination Viator sells, so it is fetched once and kept.
 *
 * Optional throughout. Without a key every function here answers "nothing" and
 * the client keeps showing unpriced OpenTripMap attractions, which is what it
 * did before this existed.
 *
 * Nothing here knows what the SPA's activity list looks like beyond the shared
 * `ApiActivity` shape — it speaks Viator's dialect and maps once, at the
 * bottom. The category, the artwork and the coordinates stay the client's.
 *
 * API: https://docs.viator.com/partner-api/
 */

const BASE_URL = 'https://api.viator.com/partner';

/** The version this code was written against; the API keys its shapes on it. */
const ACCEPT = 'application/json;version=2.0';

const REQUEST_TIMEOUT_MS = 12_000;

/** Enough to fill a screen without asking for a catalogue. */
const MAX_PRODUCTS = 20;

export function isViatorConfigured(): boolean {
  return Boolean(env().VIATOR_API_KEY);
}

/* ----------------------------------------------------------------- fetches */

/**
 * A request against the provider.
 *
 * Null for every failure rather than throwing, exactly as `liteapi.ts` does: a
 * provider that is down should cost the reader prices, not the list of things
 * to do — see the fallback in `activities.ts`.
 */
async function request<T>(
  path: string,
  init?: { method: 'POST'; body: unknown },
): Promise<T | null> {
  const key = env().VIATOR_API_KEY;
  if (!key) return null;

  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: init ? init.method : 'GET',
      headers: {
        'exp-api-key': key,
        Accept: ACCEPT,
        'Accept-Language': 'en-US',
        ...(init ? { 'Content-Type': ACCEPT } : {}),
      },
      body: init ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ destinations */

type Destination = { destinationId?: number; destinationName?: string; destinationType?: string };
type DestinationsResponse = { data?: Destination[] };

/**
 * Viator's destination ids, by lower-cased name.
 *
 * Held for the life of the process. The taxonomy is a few thousand rows that
 * change on the timescale of new cities being added, and fetching it per
 * search would put a megabyte on the wire to answer "which number is Yerevan".
 */
let destinations: Map<string, number> | null = null;
let loading: Promise<Map<string, number>> | null = null;

async function loadDestinations(): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  const body = await request<DestinationsResponse>('/v1/taxonomy/destinations');

  for (const row of body?.data ?? []) {
    if (!row.destinationName || typeof row.destinationId !== 'number') continue;

    // First writer wins: the taxonomy lists cities and the regions around
    // them, and a city is the more useful answer for a name that is both.
    const name = row.destinationName.trim().toLowerCase();
    if (!found.has(name)) found.set(name, row.destinationId);
  }

  return found;
}

/** Viator's id for a city, or null when it does not sell there. */
async function destinationId(city: string): Promise<number | null> {
  const wanted = city.trim().toLowerCase();
  if (!wanted) return null;

  if (!destinations) {
    loading ??= loadDestinations().then((loaded) => {
      // Only cached once it holds something: an empty map from a failed fetch
      // would make every later search answer "no such destination".
      if (loaded.size > 0) destinations = loaded;
      loading = null;
      return loaded;
    });

    const loaded = await loading;
    return loaded.get(wanted) ?? null;
  }

  return destinations.get(wanted) ?? null;
}

/** Testing seam — the taxonomy is process-lifetime state. */
export function resetViatorDestinations(): void {
  destinations = null;
  loading = null;
}

/* -------------------------------------------------------------- the search */

type ProductsResponse = {
  products?: {
    productCode?: string;
    title?: string;
    description?: string;
    images?: { isCover?: boolean; variants?: { width?: number; url?: string }[] }[];
    reviews?: { totalReviews?: number; combinedAverageRating?: number };
    pricing?: { summary?: { fromPrice?: number }; currency?: string };
    productUrl?: string;
  }[];
};

/**
 * The largest picture the product carries, preferring its cover.
 *
 * Viator returns each image at a dozen sizes; the cards want one, and the
 * biggest is the one that survives a retina display.
 */
function coverImage(product: NonNullable<ProductsResponse['products']>[number]): string {
  const images = product.images ?? [];
  const cover = images.find((image) => image.isCover) ?? images[0];

  const widest = (cover?.variants ?? [])
    .filter((variant) => variant.url)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];

  return widest?.url ?? '';
}

export type ActivitySearch = {
  destination: string;
  /** Bounds availability, so a product nobody can book is not offered. */
  startDate?: string;
  endDate?: string;
  limit: number;
};

/**
 * Things to do in a city, priced.
 *
 * Empty for every failure and for every city Viator does not sell — which is
 * many of them. Viator lists tours and tickets, not places: it has products in
 * Yerevan and may have none at all in a small town, so this is an overlay on
 * the OpenTripMap listing rather than a replacement for it.
 */
export async function searchActivities(search: ActivitySearch): Promise<ApiActivity[]> {
  const destination = await destinationId(search.destination);
  if (destination === null) return [];

  const body = await request<ProductsResponse>('/products/search', {
    method: 'POST',
    body: {
      filtering: {
        destination: String(destination),
        ...(search.startDate ? { startDate: search.startDate } : {}),
        ...(search.endDate ? { endDate: search.endDate } : {}),
      },
      // Cheapest first: the list is browsed for what a day out costs as much
      // as for what it is.
      sorting: { sort: 'PRICE', order: 'ASCENDING' },
      pagination: { start: 1, count: Math.min(search.limit, MAX_PRODUCTS) },
      currency: 'USD',
    },
  });

  return (body?.products ?? [])
    .filter((product) => product.productCode && (product.title ?? '').trim())
    .slice(0, search.limit)
    .map((product) => ({
      id: product.productCode!,
      title: product.title!.trim(),
      description: (product.description ?? '').trim(),
      /*
       * `fromPrice` is the lowest per-person retail price — a starting price,
       * not what a party of two necessarily pays. The caller stores it with a
       * per-person basis so the trip total multiplies it by the party.
       */
      price: product.pricing?.summary?.fromPrice ?? 0,
      rating: product.reviews?.combinedAverageRating ?? 0,
      reviews: product.reviews?.totalReviews ?? 0,
      image: coverImage(product),
      // Already carries the affiliate attribution — Viator builds it into the
      // URL it hands back, so nothing here has to append a marker.
      sourceUrl: product.productUrl ?? '',
    }));
}
