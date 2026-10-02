import { STORAGE_KEYS, storageService } from './localStorage.service';

export type ProductEventName = 'trip_created' | 'place_added' | 'booking_saved' | 'return_visit';

type ProductEvent = { name: ProductEventName; at: string; dedupeKey: string };
type ProductMetrics = { events: ProductEvent[] };
export type ProductMetricsSummary = Record<ProductEventName, number> & {
  returnDays: number;
  since: string | null;
};

const EMPTY: ProductMetrics = { events: [] };
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const listeners = new Set<() => void>();

function isConsented(): boolean {
  return storageService.get<boolean>(STORAGE_KEYS.productAnalyticsConsent, false);
}

function read(): ProductMetrics {
  const value = storageService.get<ProductMetrics>(STORAGE_KEYS.productAnalytics, EMPTY);
  if (!value || !Array.isArray(value.events)) return EMPTY;
  const cutoff = Date.now() - RETENTION_MS;
  return { events: value.events.filter((event) => Date.parse(event.at) >= cutoff) };
}

function emit(): void { listeners.forEach((listener) => listener()); }

function record(name: ProductEventName, dedupeKey: string): void {
  if (!isConsented()) return;
  const metrics = read();
  if (metrics.events.some((event) => event.name === name && event.dedupeKey === dedupeKey)) return;
  const events = [...metrics.events, { name, at: new Date().toISOString(), dedupeKey }].slice(-500);
  try {
    storageService.set(STORAGE_KEYS.productAnalytics, { events });
    emit();
  } catch {
    // Measurement is optional and must never interrupt the product action.
  }
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function digest(value: string): string {
  // Dedupe only; raw trip/place/booking ids are never retained as event data.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export const productAnalyticsService = {
  isConsented,

  getConsentSnapshot(): boolean {
    return isConsented();
  },

  setConsent(consent: boolean): void {
    try {
      storageService.set(STORAGE_KEYS.productAnalyticsConsent, consent);
      if (!consent) storageService.remove(STORAGE_KEYS.productAnalytics);
    } catch {
      // Consent UI should remain usable if local storage is unavailable.
    } finally {
      emit();
    }
  },

  recordTripCreated(tripId: string): void { record('trip_created', digest(tripId)); },
  recordPlaceAdded(tripId: string, placeId: string): void { record('place_added', digest(`${tripId}:${placeId}`)); },
  recordBookingSaved(bookingId: string): void { record('booking_saved', digest(bookingId)); },
  recordReturnVisit(now = new Date()): void { record('return_visit', localDateKey(now)); },

  getSummary(): ProductMetricsSummary {
    const events = read().events;
    const count = (name: ProductEventName) => events.filter((event) => event.name === name).length;
    const returnDays = new Set(events.filter((event) => event.name === 'return_visit').map((event) => event.dedupeKey)).size;
    return {
      trip_created: count('trip_created'),
      place_added: count('place_added'),
      booking_saved: count('booking_saved'),
      return_visit: count('return_visit'),
      returnDays,
      since: events[0]?.at ?? null,
    };
  },

  exportJson(): string {
    if (!isConsented()) return JSON.stringify({ consented: false, summary: null }, null, 2);
    const events = read().events.map(({ name, at }) => ({ name, at }));
    return JSON.stringify({ consented: true, retentionDays: 90, summary: this.getSummary(), events }, null, 2);
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Test seam and an explicit local reset. */
  clear(): void {
    storageService.remove(STORAGE_KEYS.productAnalytics);
    emit();
  },
};
