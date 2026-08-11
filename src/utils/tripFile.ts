import { bundledImageId, bundledImageSrc } from '../assets/bundled-images';
import type {
  ItineraryActivity,
  ItineraryDay,
  Trip,
  TripDraft,
  TripNote,
} from '../types/trip.types';
import { createId } from './id';

/**
 * Moving one trip between two accounts, as a file.
 *
 * The exported file is the contract, so everything about it is decided here:
 * what travels, what does not, and what a file has to look like before the app
 * will believe it. Both directions live in one module because a format with its
 * writer and its reader in different files drifts.
 *
 * Nothing here validates a trip. `createTripSchema` on the server is the only
 * thing that decides what a trip may contain, and it runs on an imported trip
 * exactly as it runs on a created one. What this module does is structural —
 * turn bytes into a `TripDraft`, or say in one sentence why it cannot — which
 * is the same relationship `editTrip.ts:validate()` already has to that schema.
 */

export const TRIP_FILE_KIND = 'ai-travel.trip';

/** Bumped only when a change would make an older reader misread the file. */
export const TRIP_FILE_VERSION = 1;

/** Refused before reading, so a huge file is never pulled into memory. */
export const MAX_TRIP_FILE_BYTES = 4 * 1024 * 1024;

/** Matches the server's `express.json` limit — what the request may weigh. */
export const MAX_TRIP_BODY_BYTES = 1024 * 1024;

/**
 * The trip as it travels.
 *
 * `draftId` is an idempotency key belonging to whoever wrote the trip, and
 * `bookings` is the deprecated legacy array — neither means anything in another
 * account. The rest is the plan.
 */
export type ExportedTrip = Omit<TripDraft, 'draftId' | 'bookings' | 'itinerary'> & {
  /**
   * Which bundled picture this trip's cover is, when it is one of ours.
   *
   * `coverImage` is a content-hashed asset path (`/assets/city-9f2a1b.jpg`),
   * and that hash differs between a laptop and a deployment and moves again
   * with the next build — so the URL alone would point the importer at a file
   * their environment has never served. The id is stable. See
   * `assets/bundled-images.ts`.
   */
  coverImageId?: string;
  itinerary: ExportedDay[];
};

/** A day, plus the stable name of its photograph. */
export type ExportedDay = ItineraryDay & { imageId?: string };

/** An activity, plus the stable name of its photograph. */
export type ExportedActivity = ItineraryActivity & { imageId?: string };

export type TripFile = {
  kind: typeof TRIP_FILE_KIND;
  version: number;
  /** ISO timestamp. Informational — nothing branches on it. */
  exportedAt: string;
  trip: ExportedTrip;
};

/** Why a file could not be read, in the order the parser gives up. */
export type TripFileProblem = 'not-json' | 'not-a-trip-file' | 'newer-version' | 'malformed';

/** What the import dialog shows about a file before anything is saved. */
export type TripImportPreview = {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  travellers: number;
  days: number;
  activities: number;
  notes: number;
};

export type ParsedTripFile =
  | { ok: true; trip: ExportedTrip; preview: TripImportPreview }
  | { ok: false; problem: TripFileProblem };

/* ------------------------------------------------------------------ export */

/** A day with its photograph named, so another build can find the same one. */
function exportDay(day: ItineraryDay): ExportedDay {
  const imageId = bundledImageId(day.image);

  return {
    ...day,
    ...(imageId ? { imageId } : {}),
    activities: day.activities.map(exportActivity),
  };
}

function exportActivity(activity: ItineraryActivity): ExportedActivity {
  const imageId = bundledImageId(activity.image);

  return { ...activity, ...(imageId ? { imageId } : {}) };
}

/**
 * A trip, ready to be written to disk.
 *
 * Fields are named one at a time rather than spread, the same way `toApiTrip`
 * names them server-side and for the same reason: a column added later must not
 * leak into a file by default. `exportedAt` is injectable so a test can assert
 * on it.
 *
 * Takes a `TripDraft`, not a `Trip`, so the planner can hand over an itinerary
 * that has not been saved yet — nothing a file carries comes from the row. A
 * saved `Trip` still satisfies it; the id and timestamps are simply ignored.
 */
export function buildTripFile(
  trip: TripDraft,
  exportedAt: string = new Date().toISOString(),
): TripFile {
  const coverImageId = bundledImageId(trip.coverImage);

  return {
    kind: TRIP_FILE_KIND,
    version: TRIP_FILE_VERSION,
    exportedAt,
    trip: {
      title: trip.title,
      destination: trip.destination,
      ...(trip.destinationCountry ? { destinationCountry: trip.destinationCountry } : {}),
      ...(trip.destinationCity ? { destinationCity: trip.destinationCity } : {}),
      startDate: trip.startDate,
      endDate: trip.endDate,
      travellers: trip.travellers,
      coverImage: trip.coverImage,
      ...(coverImageId ? { coverImageId } : {}),
      itinerary: trip.itinerary.map(exportDay),
      ...(trip.notes?.length ? { notes: trip.notes } : {}),
      ...(trip.flightsEstimate === undefined ? {} : { flightsEstimate: trip.flightsEstimate }),
      ...(trip.hotelsEstimate === undefined ? {} : { hotelsEstimate: trip.hotelsEstimate }),
      ...(trip.activitiesEstimate === undefined
        ? {}
        : { activitiesEstimate: trip.activitiesEstimate }),
    },
  };
}

/** Indented on purpose: a file a person can open and read is worth two bytes. */
export function serialiseTripFile(file: TripFile): string {
  return JSON.stringify(file, null, 2);
}

/** `one-week-in-yerevan-2027-09-02.trip.json` — findable in a Downloads folder. */
export function tripFileName(trip: TripDraft): string {
  const slug = trip.title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');

  return `${slug || 'trip'}-${trip.startDate}.trip.json`;
}

/* ------------------------------------------------------------------ import */

/**
 * An image URL this app is willing to point at.
 *
 * Not an XSS guard — `<img src>` is not a script context, and React escapes
 * everything else in the file. It is normalisation: the app itself only ever
 * writes an `https:` URL or a bundled `/assets/…` path, and a file arriving
 * from a stranger can carry a megabyte of inline `data:` or a `blob:` URL from
 * an origin that died with the tab that made it.
 */
/**
 * The picture to use here: a bundled one by name, else the URL in the file.
 *
 * The id wins because it is the only half that survives a change of build. A
 * file written by a laptop names `generic/coast` *and* points at
 * `/src/assets/generic/coast.jpg`, which a deployed copy has never served —
 * so resolving the name first is what keeps the photograph.
 */
function imageOf(record: Record<string, unknown>): string | undefined {
  return bundledImageSrc(record.imageId) ?? safeImageUrl(record.image);
}

export function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // A bundled asset. `//host` is protocol-relative and therefore remote.
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;

  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function coordinatesOf(value: unknown) {
  if (!isRecord(value)) return undefined;

  const lat = optionalNumber(value.lat);
  const lng = optionalNumber(value.lng);

  return lat === undefined || lng === undefined ? undefined : { lat, lng };
}

/**
 * One activity, with a **new** id.
 *
 * Ids are re-minted rather than carried across, because nothing outside the
 * trip's own JSON points at them and `createTripSchema` bounds their length
 * without requiring them to be distinct. A hand-edited file giving two
 * activities the same id is a valid trip as far as the server is concerned, and
 * would then have the editor delete both when asked to delete one. Minting
 * makes that unreachable instead of merely unlikely.
 *
 * `sourceActivityId` is a different field and is preserved: it is the
 * OpenTripMap id the server dedupes on, so losing it would let the same
 * attraction be added to an imported day twice.
 */
function activityOf(value: unknown): ItineraryActivity | null {
  if (!isRecord(value)) return null;

  const priceEstimate = optionalNumber(value.priceEstimate);
  const image = imageOf(value);
  const sourceActivityId = optionalText(value.sourceActivityId, 200);
  const coordinates = coordinatesOf(value.coordinates);

  return {
    id: createId('act'),
    time: str(value.time),
    title: str(value.title),
    description: str(value.description),
    // Not judged here: `createTripSchema`'s enum is the gate, and a second copy
    // of that list is a second thing to update when a category is added.
    category: value.category as ItineraryActivity['category'],
    ...(priceEstimate === undefined ? {} : { priceEstimate }),
    ...(image ? { image } : {}),
    ...(sourceActivityId ? { sourceActivityId } : {}),
    ...(coordinates ? { coordinates } : {}),
  };
}

function dayOf(value: unknown, index: number): ItineraryDay | null {
  if (!isRecord(value) || !Array.isArray(value.activities)) return null;

  const activities: ItineraryActivity[] = [];

  for (const entry of value.activities) {
    const activity = activityOf(entry);
    if (!activity) return null;

    activities.push(activity);
  }

  const coordinates = coordinatesOf(value.coordinates);
  const image = imageOf(value);

  return {
    id: createId('day'),
    dayNumber: optionalNumber(value.dayNumber) ?? index + 1,
    date: str(value.date),
    destination: str(value.destination),
    summary: str(value.summary),
    activities,
    ...(coordinates ? { coordinates } : {}),
    ...(image ? { image } : {}),
  };
}

function noteOf(value: unknown): TripNote | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null;

  const createdAt = optionalText(value.createdAt, 100) ?? new Date().toISOString();

  return {
    id: createId('note'),
    text: value.text,
    createdAt,
    updatedAt: optionalText(value.updatedAt, 100) ?? createdAt,
  };
}

/** The cover to use here. Empty is the schema's own default and renders nothing. */
function coverImageOf(trip: Record<string, unknown>): string {
  return bundledImageSrc(trip.coverImageId) ?? safeImageUrl(trip.coverImage) ?? '';
}

/**
 * Bytes off disk, or the reason they cannot become a trip.
 *
 * Never throws: every caller of this is a click, and a click that can throw is
 * a screen that can go blank.
 */
export function parseTripFile(contents: string): ParsedTripFile {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    return { ok: false, problem: 'not-json' };
  }

  if (!isRecord(parsed) || parsed.kind !== TRIP_FILE_KIND) {
    return { ok: false, problem: 'not-a-trip-file' };
  }

  const version = parsed.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, problem: 'not-a-trip-file' };
  }

  // The only forward-compatibility lever a version 1 reader has. A newer file
  // may carry a whole section this build has never heard of, and silently
  // dropping half a trip is worse than asking someone to update.
  if (version > TRIP_FILE_VERSION) return { ok: false, problem: 'newer-version' };

  const raw = parsed.trip;
  if (!isRecord(raw)) return { ok: false, problem: 'malformed' };

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const travellers = optionalNumber(raw.travellers);

  if (
    !title ||
    typeof raw.startDate !== 'string' ||
    typeof raw.endDate !== 'string' ||
    travellers === undefined ||
    !Array.isArray(raw.itinerary)
  ) {
    return { ok: false, problem: 'malformed' };
  }

  const itinerary: ItineraryDay[] = [];

  for (const [index, entry] of raw.itinerary.entries()) {
    const day = dayOf(entry, index);
    if (!day) return { ok: false, problem: 'malformed' };

    itinerary.push(day);
  }

  let notes: TripNote[] | undefined;

  if (raw.notes !== undefined) {
    if (!Array.isArray(raw.notes)) return { ok: false, problem: 'malformed' };

    notes = [];

    for (const entry of raw.notes) {
      const note = noteOf(entry);
      if (!note) return { ok: false, problem: 'malformed' };

      notes.push(note);
    }
  }

  const destinationCountry = optionalText(raw.destinationCountry, 200);
  const destinationCity = optionalText(raw.destinationCity, 200);
  const flightsEstimate = optionalNumber(raw.flightsEstimate);
  const hotelsEstimate = optionalNumber(raw.hotelsEstimate);
  const activitiesEstimate = optionalNumber(raw.activitiesEstimate);

  const trip: ExportedTrip = {
    title,
    destination: str(raw.destination),
    ...(destinationCountry ? { destinationCountry } : {}),
    ...(destinationCity ? { destinationCity } : {}),
    startDate: raw.startDate,
    endDate: raw.endDate,
    travellers,
    coverImage: coverImageOf(raw),
    itinerary,
    ...(notes ? { notes } : {}),
    ...(flightsEstimate === undefined ? {} : { flightsEstimate }),
    ...(hotelsEstimate === undefined ? {} : { hotelsEstimate }),
    ...(activitiesEstimate === undefined ? {} : { activitiesEstimate }),
  };

  return {
    ok: true,
    trip,
    preview: {
      title: trip.title,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      travellers: trip.travellers,
      days: itinerary.length,
      activities: itinerary.reduce((total, day) => total + day.activities.length, 0),
      notes: notes?.length ?? 0,
    },
  };
}

/**
 * The body to POST.
 *
 * `draftId` comes from the caller rather than from here, because which import
 * attempts share one is a decision about retries — see `useTripImport`.
 */
export function toTripDraft(trip: ExportedTrip, draftId: string): TripDraft {
  const { coverImageId: _coverImageId, ...rest } = trip;

  return { ...rest, draftId };
}

/** Case- and space-insensitive, so "Dubai break " and "Dubai Break" are one title. */
function foldTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The trip this file looks like a second copy of.
 *
 * Title **and** both dates. Title alone would flag every "Summer trip"; dates
 * alone would flag two different trips in the same week; and `destination` is
 * a derived label that two builds of the app can spell differently. The triple
 * is what re-importing the same file actually produces.
 */
export function findDuplicateTrip(trips: Trip[], candidate: TripImportPreview): Trip | null {
  const title = foldTitle(candidate.title);

  return (
    trips.find(
      (trip) =>
        foldTitle(trip.title) === title &&
        trip.startDate === candidate.startDate &&
        trip.endDate === candidate.endDate,
    ) ?? null
  );
}

/* ------------------------------------------------------- reporting a refusal */

/**
 * A zod path from the server's 422, as a person would say it.
 *
 * `details` is keyed by dotted paths — `itinerary.2.activities.0.time` — which
 * names the field precisely and tells a reader nothing. This turns it into
 * "Day 3, activity 1", which is something they can go and look at.
 */
export function tripFieldLabel(path: string): string {
  const day = /^itinerary\.(\d+)/.exec(path);

  if (day) {
    const activity = /^itinerary\.\d+\.activities\.(\d+)/.exec(path);
    const dayLabel = `Day ${Number(day[1]) + 1}`;

    return activity ? `${dayLabel}, activity ${Number(activity[1]) + 1}` : dayLabel;
  }

  const note = /^notes\.(\d+)/.exec(path);
  if (note) return `Note ${Number(note[1]) + 1}`;

  const labels: Record<string, string> = {
    title: 'The trip title',
    destination: 'The destination',
    destinationCountry: 'The country',
    destinationCity: 'The city',
    startDate: 'The start date',
    endDate: 'The end date',
    travellers: 'The number of travellers',
    coverImage: 'The cover image',
  };

  return labels[path] ?? 'This file';
}

/** What to tell the reader when a file cannot be read at all. */
export function tripFileMessage(problem: TripFileProblem): string {
  const messages: Record<TripFileProblem, string> = {
    'not-json': 'That file is not JSON. Pick the .trip.json file this app exported.',
    'not-a-trip-file': 'That is not a trip file exported by this app.',
    'newer-version':
      'That file was made by a newer version of this app. Update, then import it again.',
    malformed: 'That trip file is damaged — part of it is missing or the wrong shape.',
  };

  return messages[problem];
}
