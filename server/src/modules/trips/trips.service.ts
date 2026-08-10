import { ERROR_CODES } from '@ai-travel/shared';
import type { AddActivityBody, CreateTripBody, UpdateTripBody } from '@ai-travel/shared/schemas';
import { itinerarySchema } from '@ai-travel/shared/schemas';
import { Prisma } from '@prisma/client';
import type { Trip as TripRow } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { HttpError, conflict } from '../../errors';
import { prisma } from '../../prisma';

/**
 * Trips, as the database holds them.
 *
 * The itinerary is a JSON column, so every read casts it back and every write
 * validates it — see the schema header for why a document beats child tables
 * here. Nothing else in this file knows about Express.
 */

/** The wire shape: what the SPA's `Trip` type expects, and nothing more. */
export type ApiTrip = {
  id: string;
  draftId?: string;
  title: string;
  destination: string;
  destinationCountry?: string;
  destinationCity?: string;
  startDate: string;
  endDate: string;
  travellers: number;
  coverImage: string;
  itinerary: unknown;
  notes?: unknown;
  flightsEstimate?: number;
  hotelsEstimate?: number;
  activitiesEstimate?: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Row to wire shape.
 *
 * Names each field rather than spreading, so a column added later — an
 * internal flag, a soft-delete marker — cannot leak to the client by default.
 * `null` becomes absent because the SPA's type uses optional properties, and
 * an explicit `null` would fail the `?? undefined` checks all over it.
 */
export function toApiTrip(row: TripRow): ApiTrip {
  return {
    id: row.id,
    draftId: row.draftId ?? undefined,
    title: row.title,
    destination: row.destination,
    destinationCountry: row.destinationCountry ?? undefined,
    destinationCity: row.destinationCity ?? undefined,
    startDate: row.startDate,
    endDate: row.endDate,
    travellers: row.travellers,
    coverImage: row.coverImage,
    itinerary: row.itinerary ?? [],
    notes: row.notes ?? undefined,
    flightsEstimate: row.flightsEstimate ?? undefined,
    hotelsEstimate: row.hotelsEstimate ?? undefined,
    activitiesEstimate: row.activitiesEstimate ?? undefined,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function tripNotFound(id: string): HttpError {
  return new HttpError(404, ERROR_CODES.TRIP_NOT_FOUND, `No trip with id "${id}".`);
}

/** Ids are client-minted; the server only mints one when the client sent none. */
function newTripId(): string {
  return `trip_${randomUUID()}`;
}

export async function listTrips(userId: string): Promise<ApiTrip[]> {
  const rows = await prisma.trip.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map(toApiTrip);
}

export async function getTrip(userId: string, id: string): Promise<ApiTrip> {
  // Scoped by owner in the same query rather than fetched and then checked:
  // another account's trip must be indistinguishable from one that is not
  // there, or the 404 becomes an existence oracle.
  const row = await prisma.trip.findFirst({ where: { id, userId } });
  if (!row) throw tripNotFound(id);

  return toApiTrip(row);
}

export type CreateResult = { trip: ApiTrip; created: boolean };

/**
 * Saves a draft.
 *
 * Idempotent by `draftId`: a double click, a second tab, or the same
 * conversation reopened after a reload all carry the same draft, and the
 * existing trip comes back rather than a twin. The unique constraint is what
 * makes that safe under a race — two simultaneous saves cannot both insert,
 * and the loser reads the winner's row instead of failing.
 *
 * `created` tells the route whether to answer `201` or `200`.
 */
export async function createTrip(userId: string, body: CreateTripBody): Promise<CreateResult> {
  if (body.draftId) {
    const existing = await prisma.trip.findFirst({ where: { userId, draftId: body.draftId } });
    if (existing) return { trip: toApiTrip(existing), created: false };
  }

  try {
    const row = await prisma.trip.create({
      data: {
        id: newTripId(),
        userId,
        draftId: body.draftId,
        title: body.title,
        destination: body.destination,
        destinationCountry: body.destinationCountry,
        destinationCity: body.destinationCity,
        startDate: body.startDate,
        endDate: body.endDate,
        travellers: body.travellers,
        coverImage: body.coverImage,
        itinerary: body.itinerary as Prisma.InputJsonValue,
        notes: (body.notes ?? Prisma.DbNull) as Prisma.InputJsonValue,
        flightsEstimate: body.flightsEstimate,
        hotelsEstimate: body.hotelsEstimate,
        activitiesEstimate: body.activitiesEstimate,
      },
    });

    return { trip: toApiTrip(row), created: true };
  } catch (error) {
    // The other tab won the race between the lookup above and this insert.
    if (isUniqueViolation(error) && body.draftId) {
      const existing = await prisma.trip.findFirst({ where: { userId, draftId: body.draftId } });
      if (existing) return { trip: toApiTrip(existing), created: false };
    }

    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * Applies a patch.
 *
 * An absent key leaves the field alone; an explicit `null` clears it. That is
 * the whole reason the patch schema is hand-written rather than
 * `createTripSchema.partial()` — `undefined` does not survive JSON, so
 * "clear this" and "do not touch this" would be the same request.
 *
 * An empty patch is a success that bumps `updatedAt`: the summary screen's
 * Save sends `{}` deliberately.
 */
export async function updateTrip(
  userId: string,
  id: string,
  patch: UpdateTripBody,
): Promise<ApiTrip> {
  const existing = await prisma.trip.findFirst({ where: { id, userId } });
  if (!existing) throw tripNotFound(id);

  if (patch.version !== undefined && patch.version !== existing.version) {
    throw conflict(
      ERROR_CODES.STALE_TRIP,
      'This trip changed somewhere else while you were editing it.',
    );
  }

  const data: Prisma.TripUpdateInput = { version: { increment: 1 } };

  // Named one at a time so only keys the client actually sent are written —
  // spreading the parsed body would turn every absent optional into an
  // explicit undefined and, for the nullable columns, erase them.
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.destination !== undefined) data.destination = patch.destination;
  if (patch.destinationCountry !== undefined) data.destinationCountry = patch.destinationCountry;
  if (patch.destinationCity !== undefined) data.destinationCity = patch.destinationCity;
  if (patch.startDate !== undefined) data.startDate = patch.startDate;
  if (patch.endDate !== undefined) data.endDate = patch.endDate;
  if (patch.travellers !== undefined) data.travellers = patch.travellers;
  if (patch.coverImage !== undefined) data.coverImage = patch.coverImage;
  if (patch.itinerary !== undefined) data.itinerary = patch.itinerary as Prisma.InputJsonValue;
  if (patch.notes !== undefined) {
    data.notes = patch.notes === null ? Prisma.DbNull : (patch.notes as Prisma.InputJsonValue);
  }
  if (patch.flightsEstimate !== undefined) data.flightsEstimate = patch.flightsEstimate;
  if (patch.hotelsEstimate !== undefined) data.hotelsEstimate = patch.hotelsEstimate;
  if (patch.activitiesEstimate !== undefined) data.activitiesEstimate = patch.activitiesEstimate;

  // The pair has to hold together even when only one half is being changed.
  const startDate = patch.startDate ?? existing.startDate;
  const endDate = patch.endDate ?? existing.endDate;
  if (endDate < startDate) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      'The end date cannot be before the start date.',
      { endDate: 'The end date cannot be before the start date.' },
    );
  }

  const row = await prisma.trip.update({ where: { id }, data });

  return toApiTrip(row);
}

export async function deleteTrip(userId: string, id: string): Promise<void> {
  // Idempotent, matching what the client's service always did: deleting a trip
  // that is already gone is the outcome the caller wanted.
  await prisma.trip.deleteMany({ where: { id, userId } });
}

/* ------------------------------------------------- adding one activity */

/** Where an imported attraction lands when the day already has a schedule. */
const DEFAULT_IMPORT_TIME = '12:00';

/** Sorts "09:30" before "14:00"; anything unparseable sinks to the end. */
export function minutesOf(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return Number.MAX_SAFE_INTEGER;

  return Number(match[1]) * 60 + Number(match[2]);
}

type ItineraryActivity = {
  id: string;
  time: string;
  title: string;
  description: string;
  category: string;
  priceEstimate?: number;
  image?: string;
  sourceActivityId?: string;
  coordinates?: { lat: number; lng: number };
};

type ItineraryDay = {
  id: string;
  activities: ItineraryActivity[];
  [key: string]: unknown;
};

/**
 * Adds an attraction from the explorer to one day.
 *
 * The ordering and duplicate rules are lifted verbatim from the client service
 * this replaces: the day stays in time order so an import lands where it
 * belongs, and re-adding the same place is refused rather than silently
 * duplicated — two identical rows are worse than a message.
 *
 * Runs inside a transaction with the row locked. Without the lock, two
 * attractions added at once both read the same itinerary, and the second write
 * drops the first: the whole day is one JSON value, so a lost update loses an
 * entire activity rather than a field.
 */
export async function addActivityToDay(
  userId: string,
  tripId: string,
  dayId: string,
  body: AddActivityBody,
): Promise<ApiTrip> {
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Trip" WHERE "id" = ${tripId} AND "userId" = ${userId} FOR UPDATE
    `;
    if (!locked) throw tripNotFound(tripId);

    const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
    const itinerary = itinerarySchema.parse(trip.itinerary) as unknown as ItineraryDay[];

    const dayIndex = itinerary.findIndex((day) => day.id === dayId);
    if (dayIndex === -1) {
      throw new HttpError(404, ERROR_CODES.DAY_NOT_FOUND, `No day with id "${dayId}" on this trip.`);
    }

    const day = itinerary[dayIndex];
    if (day.activities.some((entry) => entry.sourceActivityId === body.activity.id)) {
      throw conflict(
        ERROR_CODES.ACTIVITY_ALREADY_ON_DAY,
        `"${body.activity.title}" is already planned for this day.`,
      );
    }

    const entry: ItineraryActivity = {
      id: `act_${randomUUID()}`,
      time: body.time?.trim() || DEFAULT_IMPORT_TIME,
      title: body.activity.title,
      description: body.activity.description,
      category: body.activity.category,
      // Zero means nobody quoted one, which is not the same as free.
      priceEstimate: body.activity.price > 0 ? body.activity.price : undefined,
      image: body.activity.image || undefined,
      /// What makes the import traceable, and what recognises a second one.
      sourceActivityId: body.activity.id,
      coordinates: body.activity.coordinates,
    };

    const activities = [...day.activities, entry].sort(
      (a, b) => minutesOf(a.time) - minutesOf(b.time),
    );

    const updated = itinerary.map((candidate, index) =>
      index === dayIndex ? { ...candidate, activities } : candidate,
    );

    const row = await tx.trip.update({
      where: { id: tripId },
      data: { itinerary: updated as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    });

    return toApiTrip(row);
  });
}

/* ------------------------------------------------------- the active trip */

export async function setActiveTrip(userId: string, tripId: string | null): Promise<void> {
  if (tripId !== null) {
    // Refuse a pointer at someone else's trip, or at nothing.
    const owned = await prisma.trip.findFirst({ where: { id: tripId, userId } });
    if (!owned) throw tripNotFound(tripId);
  }

  await prisma.user.update({ where: { id: userId }, data: { activeTripId: tripId } });
}

export async function getActiveTripId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeTripId: true },
  });

  return user?.activeTripId ?? null;
}
