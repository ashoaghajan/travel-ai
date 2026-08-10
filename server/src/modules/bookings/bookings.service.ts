import { ERROR_CODES } from '@ai-travel/shared';
import type { CreateBookingBody, UpdateBookingBody } from '@ai-travel/shared/schemas';
import { Prisma } from '@prisma/client';
import type { Booking as BookingRow } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../../errors';
import { prisma } from '../../prisma';
import { tripNotFound } from '../trips/trips.service';

/**
 * Bookings — the flights, stays, tickets and activities someone has saved or
 * actually booked.
 *
 * One user-scoped collection rather than a child of `Trip`: a booking outlives
 * the search that produced it and can exist before anyone has decided which
 * trip it is for. Most of what the app does with bookings — turning a fare
 * into drafts, working out what a nightly rate comes to, building partner
 * links — stays on the client. Only the persistence is here.
 */

export type ApiBooking = {
  id: string;
  tripId: string | null;
  kind: string;
  status: string;
  title: string;
  date: string;
  endDate?: string;
  reference: string;
  price?: number;
  priceBasis?: unknown;
  url?: string;
  source?: unknown;
  createdAt: string;
  updatedAt: string;
};

/**
 * Row to wire shape.
 *
 * Named field by field so a column added later cannot leak by default, and
 * `null` becomes absent because the SPA's `Booking` uses optional properties —
 * an explicit `null` would fail the `?? undefined` checks throughout it.
 */
export function toApiBooking(row: BookingRow): ApiBooking {
  return {
    id: row.id,
    tripId: row.tripId,
    kind: row.kind,
    status: row.status,
    title: row.title,
    date: row.date,
    endDate: row.endDate ?? undefined,
    reference: row.reference,
    price: row.price ?? undefined,
    priceBasis: row.priceBasis ?? undefined,
    url: row.url ?? undefined,
    source: row.source ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function bookingNotFound(id: string): HttpError {
  return new HttpError(404, ERROR_CODES.BOOKING_NOT_FOUND, `No booking with id "${id}".`);
}

function newBookingId(): string {
  // `bkg_`, matching what the client minted before the API existed.
  return `bkg_${randomUUID()}`;
}

/**
 * Refuses a pointer at a trip the caller does not own.
 *
 * Without this, anyone could attach a booking to any trip id and learn which
 * ones exist by which attempts succeeded.
 */
async function assertOwnsTrip(userId: string, tripId: string | null | undefined): Promise<void> {
  if (!tripId) return;

  const owned = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
  if (!owned) throw tripNotFound(tripId);
}

export async function listBookings(userId: string): Promise<ApiBooking[]> {
  const rows = await prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map(toApiBooking);
}

export function bookingAlreadyOnTrip(title: string): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.BOOKING_ALREADY_ON_TRIP,
    `"${title}" is already on this trip.`,
  );
}

/** The `source.resultId` of a booking, when it came from a search result. */
function resultIdOf(body: { source?: unknown }): string | null {
  const source = body.source as { resultId?: unknown } | null | undefined;

  return typeof source?.resultId === 'string' ? source.resultId : null;
}

/**
 * Refuses filing the same search result against the same trip twice.
 *
 * The client checked this against its own list, which cannot see what another
 * tab just saved. The same fare on two *different* trips is legitimate, so the
 * check is scoped to the trip — and a hand-typed booking has no `source` and
 * is never a duplicate of anything.
 */
async function assertNotAlreadyFiled(
  userId: string,
  body: CreateBookingBody,
): Promise<void> {
  const resultId = resultIdOf(body);
  if (!resultId || !body.tripId) return;

  const clash = await prisma.booking.findFirst({
    where: {
      userId,
      tripId: body.tripId,
      source: { path: ['resultId'], equals: resultId },
    },
    select: { id: true },
  });

  if (clash) throw bookingAlreadyOnTrip(body.title);
}

export async function createBooking(
  userId: string,
  body: CreateBookingBody,
): Promise<ApiBooking> {
  await assertOwnsTrip(userId, body.tripId);
  await assertNotAlreadyFiled(userId, body);

  const row = await prisma.booking.create({
    data: {
      id: newBookingId(),
      userId,
      tripId: body.tripId ?? null,
      kind: body.kind,
      status: body.status,
      title: body.title,
      date: body.date,
      endDate: body.endDate,
      reference: body.reference,
      price: body.price,
      priceBasis: (body.priceBasis ?? Prisma.DbNull) as Prisma.InputJsonValue,
      url: body.url,
      source: (body.source ?? Prisma.DbNull) as Prisma.InputJsonValue,
    },
  });

  return toApiBooking(row);
}

/**
 * Applies a patch.
 *
 * An absent key leaves the field alone; an explicit `null` clears it. Same
 * reasoning as `updateTrip` — `undefined` does not survive JSON, so detaching
 * a booking from its trip needs a value of its own.
 */
export async function updateBooking(
  userId: string,
  id: string,
  patch: UpdateBookingBody,
): Promise<ApiBooking> {
  const existing = await prisma.booking.findFirst({ where: { id, userId } });
  if (!existing) throw bookingNotFound(id);

  if (patch.tripId !== undefined) await assertOwnsTrip(userId, patch.tripId);

  const data: Prisma.BookingUpdateInput = {};

  if (patch.tripId !== undefined) {
    data.trip = patch.tripId ? { connect: { id: patch.tripId } } : { disconnect: true };
  }
  if (patch.kind !== undefined) data.kind = patch.kind;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.date !== undefined) data.date = patch.date;
  if (patch.endDate !== undefined) data.endDate = patch.endDate;
  if (patch.reference !== undefined) data.reference = patch.reference;
  if (patch.price !== undefined) data.price = patch.price;
  if (patch.priceBasis !== undefined) {
    data.priceBasis =
      patch.priceBasis === null ? Prisma.DbNull : (patch.priceBasis as Prisma.InputJsonValue);
  }
  if (patch.url !== undefined) data.url = patch.url;

  const row = await prisma.booking.update({ where: { id }, data });

  return toApiBooking(row);
}

export async function deleteBooking(userId: string, id: string): Promise<void> {
  // Idempotent, matching what the client's service always did.
  await prisma.booking.deleteMany({ where: { id, userId } });
}

/**
 * Saves several at once.
 *
 * A flight is two bookings — an outbound and a return — and filing a trip's
 * whole schedule is a dozen. Sending them one at a time would leave a reader
 * with half a trip recorded if the third request failed, so they go in one
 * transaction: all of them, or none.
 */
export async function createBookings(
  userId: string,
  bodies: CreateBookingBody[],
): Promise<ApiBooking[]> {
  for (const body of bodies) {
    await assertOwnsTrip(userId, body.tripId);
    await assertNotAlreadyFiled(userId, body);
  }

  /*
   * Written in the order given, not reversed.
   *
   * The list is newest-first and a date group keeps array order, so filing a
   * trip's schedule as it runs is what makes day one's morning read before its
   * afternoon. Creating them one at a time would stack each day backwards.
   */

  const rows = await prisma.$transaction(
    bodies.map((body) =>
      prisma.booking.create({
        data: {
          id: newBookingId(),
          userId,
          tripId: body.tripId ?? null,
          kind: body.kind,
          status: body.status,
          title: body.title,
          date: body.date,
          endDate: body.endDate,
          reference: body.reference,
          price: body.price,
          priceBasis: (body.priceBasis ?? Prisma.DbNull) as Prisma.InputJsonValue,
          url: body.url,
          source: (body.source ?? Prisma.DbNull) as Prisma.InputJsonValue,
        },
      }),
    ),
  );

  return rows.map(toApiBooking);
}
