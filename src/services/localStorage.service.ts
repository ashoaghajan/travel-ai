/**
 * The only module in the app that touches `window.localStorage`.
 *
 * Everything else goes through a domain service (`trip.service.ts`, …), so
 * Stage 2 can swap persistence for HTTP calls without changing components.
 */

/** Keys from README "Stage 1 LocalStorage Keys", plus the activities cache. */
export const STORAGE_KEYS = {
  trips: 'ai-travel-planner:trips',
  activeTripId: 'ai-travel-planner:activeTripId',
  chatHistory: 'ai-travel-planner:chatHistory',
  settings: 'ai-travel-planner:settings',
  recentSearches: 'ai-travel-planner:recentSearches',
  /** The explorer's country, when the user has chosen one explicitly. */
  selectedCountry: 'ai-travel-planner:selectedCountry',
  /** The explorer's city, when the user has chosen one explicitly. */
  selectedCity: 'ai-travel-planner:selectedCity',
  /** Attractions the user bookmarked from the explorer. */
  savedActivities: 'ai-travel-planner:savedActivities',
  /** Flights, stays, tickets and activities attached to a trip — or to none yet. */
  bookings: 'ai-travel-planner:bookings',
  /**
   * Airports the user has picked, by IATA code. Reference data, not user data:
   * it exists so `partner.links.ts` can name a destination city synchronously.
   */
  airports: 'ai-travel-planner:airports',
  /** Cached country list — reference data, not user data. */
  countries: 'ai-travel-planner:countries',
  /** Cached OpenTripMap results — not user data, expires after 5 minutes. */
  activities: 'ai-travel-planner:activities',
  /** Place name → coordinates for the trip map. Reference data, not user data. */
  geocodes: 'ai-travel-planner:geocodes',
  /**
   * Cached exchange rates — reference data, not user data.
   *
   * Held so a reload repaints converted prices immediately instead of showing
   * dollars until the network answers, which would look like the currency
   * preference had been forgotten.
   */
  exchangeRates: 'ai-travel-planner:exchangeRates',
  /**
   * The account this browser has already handed its local trips to.
   *
   * Per browser, deliberately. The server has its own marker, which stops a
   * second *device* re-importing data an account already claimed; this one
   * stops *this* browser asking again while still letting a different browser
   * with genuinely different trips contribute its own.
   */
  migratedFor: 'ai-travel-planner:migratedFor',
  /**
   * Which account the user data above currently belongs to.
   *
   * Trips are still device-local while accounts are real, so something has to
   * remember whose they are — see `localData.service.ts`.
   */
  ownerUserId: 'ai-travel-planner:ownerUserId',
} as const;

/**
 * City lists are cached one key per country, so the key cannot be a member of
 * the fixed table above. The prefix keeps them recognisable — `cityListKeys`
 * finds them all again for eviction and for the settings screen.
 */
export const CITY_LIST_KEY_PREFIX = 'ai-travel-planner:cities:';

export type CityListKey = `${typeof CITY_LIST_KEY_PREFIX}${string}`;

/** The cache key for one country's cities. */
export function cityListKey(country: string): CityListKey {
  return `${CITY_LIST_KEY_PREFIX}${country}`;
}

/**
 * Where a signed-out account's data is parked.
 *
 * Archived rather than deleted: it is the only copy until Phase 4 uploads it,
 * and switching accounts must not be a data-loss event.
 */
export const ARCHIVE_KEY_PREFIX = 'ai-travel-planner:archive:';

export type ArchiveKey = `${typeof ARCHIVE_KEY_PREFIX}${string}`;

/** Where one key's contents live while `userId` is signed out. */
export function archiveKey(userId: string, key: StorageKey): ArchiveKey {
  return `${ARCHIVE_KEY_PREFIX}${userId}:${key}`;
}

export type StorageKey =
  | (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]
  | CityListKey
  | ArchiveKey;

/** Thrown when a write fails — full storage or a blocked/private context. */
export class StorageWriteError extends Error {
  constructor(key: string, cause?: unknown) {
    super(`Could not write "${key}" to local storage.`);
    this.name = 'StorageWriteError';
    this.cause = cause;
  }
}

/** Space used by one of the app's keys. */
export type StorageEntryUsage = {
  key: StorageKey;
  present: boolean;
  bytes: number;
};

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

function notify(key: string): void {
  listeners.get(key)?.forEach((listener) => listener());
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Accessing localStorage throws when cookies are blocked.
    return null;
  }
}

// Writes from another tab arrive as `storage` events; same-tab writes notify
// directly from `set`/`remove`.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key) notify(event.key);
  });
}

export const storageService = {
  /** Reads and parses a value, falling back when missing or corrupt. */
  get<T>(key: StorageKey, fallback: T): T {
    const storage = getStorage();
    if (!storage) return fallback;

    try {
      const raw = storage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      // Unparseable value — treat it as absent rather than crashing the app.
      return fallback;
    }
  },

  /** Serialises and stores a value. Throws `StorageWriteError` on failure. */
  set<T>(key: StorageKey, value: T): void {
    const storage = getStorage();
    if (!storage) throw new StorageWriteError(key);

    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      throw new StorageWriteError(key, error);
    }
    notify(key);
  },

  remove(key: StorageKey): void {
    getStorage()?.removeItem(key);
    notify(key);
  },

  /**
   * How much space each of the app's keys is using, for the settings screen.
   * Sizes are the encoded length of the stored string — close enough to what
   * the quota counts, without a second copy of the data.
   */
  usage(): StorageEntryUsage[] {
    const storage = getStorage();

    return Object.values(STORAGE_KEYS).map((key) => {
      const raw = storage?.getItem(key) ?? null;
      return {
        key,
        present: raw !== null,
        bytes: raw === null ? 0 : new TextEncoder().encode(raw).length,
      };
    });
  },

  /**
   * Every cached city list currently held, oldest write first is not knowable
   * from here — the caller decides what to evict.
   */
  cityListKeys(): CityListKey[] {
    const storage = getStorage();
    if (!storage) return [];

    const keys: CityListKey[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(CITY_LIST_KEY_PREFIX)) keys.push(key as CityListKey);
    }

    return keys;
  },

  /** Subscribes to changes for one key, in this tab and in other tabs. */
  subscribe(key: StorageKey, listener: Listener): () => void {
    const forKey = listeners.get(key) ?? new Set<Listener>();
    forKey.add(listener);
    listeners.set(key, forKey);

    return () => {
      forKey.delete(listener);
      if (forKey.size === 0) listeners.delete(key);
    };
  },
};
