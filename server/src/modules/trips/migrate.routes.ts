import { createTripSchema, importBookingSchema } from '@ai-travel/shared/schemas';
import { Prisma } from '@prisma/client';
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { requireAuth, userIdOf } from '../auth/requireAuth';

/**
 * `POST /api/migrate/local` — claiming the trips a browser saved before there
 * was anywhere else to put them.
 *
 * Everyone who used this app before the trips API existed has their trips in
 * `localStorage` and nowhere else. Without this they would sign in after the
 * deploy and find the list empty — the data still on their disk, and the app
 * no longer looking at it.
 *
 * Idempotent by construction: the client sends the ids it already has, and
 * those become the primary keys. Running it twice writes the same rows.
 */

export const migrateRouter = Router();

/**
 * Ids come from the browser, so they are the one thing here not minted by us.
 *
 * Bounded and pattern-checked rather than trusted: they become primary keys,
 * and an id shaped like someone else's would let a caller claim a row. The
 * `userId` scoping below is what actually prevents that — this is the second
 * fence.
 */
const CLIENT_ID = z
  .string()
  .trim()
  .regex(/^trip_[A-Za-z0-9_-]{1,100}$/, 'That is not a trip id this app minted.');

const payloadSchema = z.object({
  /** Bounded: an unbounded array is an unbounded transaction. */
  trips: z
    .array(createTripSchema.and(z.object({ id: CLIENT_ID })))
    .max(200)
    .default([]),
  activeTripId: CLIENT_ID.nullish(),
  /**
   * Bookings come across in the same payload as the trips they belong to.
   *
   * One endpoint rather than two, because they have to arrive together: a
   * booking's `tripId` points at a trip in this same payload, and importing
   * them separately would leave every booking unassigned if the second call
   * failed.
   */
  bookings: z.array(importBookingSchema).max(500).default([]),
});

export type MigrateResponse = {
  /**
   * True when this account had already claimed a browser's data.
   *
   * A success rather than a `409`, because there is nothing for the client to
   * do about it and a no-op success is far easier to handle than an error it
   * must special-case.
   */
  alreadyMigrated: boolean;
  imported: number;
  importedBookings: number;
};

migrateRouter.post(
  '/migrate/local',
  requireAuth,
  /*
   * `express.json()` defaults to 100kb, and twenty trips with full itineraries
   * comfortably exceed it. Raised for this route alone rather than globally —
   * every other endpoint takes a small body, and a global raise would remove a
   * limit that is doing useful work everywhere else.
   */
  express.json({ limit: '2mb' }),
  async (request: Request, response: Response) => {
    const userId = userIdOf(request);
    const payload = payloadSchema.parse(request.body ?? {});

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { localImportCompletedAt: true },
    });

    /*
     * The server's marker is authoritative, and it stops a *second device*
     * re-importing a copy of data already claimed. The client keeps its own
     * marker too, so a second browser holding genuinely different trips can
     * still contribute — server-only would silently drop that browser,
     * client-only would re-import after someone clears their storage.
     */
    if (user.localImportCompletedAt) {
      return void response.json({
        alreadyMigrated: true,
        imported: 0,
        importedBookings: 0,
      } satisfies MigrateResponse);
    }

    const imported = await prisma.$transaction(async (tx) => {
      for (const trip of payload.trips) {
        /*
         * `update: {}` — an id already present is left exactly as it is.
         *
         * The row in the database has been edited since it was exported;
         * whatever this browser holds is the older copy. Overwriting would
         * quietly undo edits made on another device.
         */
        await tx.trip.upsert({
          where: { id: trip.id },
          update: {},
          create: {
            id: trip.id,
            userId,
            draftId: trip.draftId,
            title: trip.title,
            destination: trip.destination,
            destinationCountry: trip.destinationCountry,
            destinationCity: trip.destinationCity,
            startDate: trip.startDate,
            endDate: trip.endDate,
            travellers: trip.travellers,
            coverImage: trip.coverImage,
            itinerary: trip.itinerary as Prisma.InputJsonValue,
            notes: (trip.notes ?? Prisma.DbNull) as Prisma.InputJsonValue,
            flightsEstimate: trip.flightsEstimate,
            hotelsEstimate: trip.hotelsEstimate,
            activitiesEstimate: trip.activitiesEstimate,
          },
        });
      }

      /*
       * Bookings after the trips, so their `tripId` has something to point at.
       *
       * A booking naming a trip that is not in this payload is imported
       * unassigned rather than rejected — that is exactly what the app shows
       * for a booking whose trip was deleted, and losing a confirmation
       * number over a dangling pointer would be the worse outcome.
       */
      const tripIds = new Set(payload.trips.map((trip) => trip.id));

      for (const booking of payload.bookings) {
        await tx.booking.upsert({
          where: { id: booking.id },
          update: {},
          create: {
            id: booking.id,
            userId,
            tripId: booking.tripId && tripIds.has(booking.tripId) ? booking.tripId : null,
            kind: booking.kind,
            status: booking.status,
            title: booking.title,
            date: booking.date,
            endDate: booking.endDate,
            reference: booking.reference,
            price: booking.price,
            priceBasis: (booking.priceBasis ?? Prisma.DbNull) as Prisma.InputJsonValue,
            url: booking.url,
            source: (booking.source ?? Prisma.DbNull) as Prisma.InputJsonValue,
          },
        });
      }

      // Only point at a trip this import actually established.
      const activeTripId =
        payload.activeTripId && payload.trips.some((trip) => trip.id === payload.activeTripId)
          ? payload.activeTripId
          : null;

      await tx.user.update({
        where: { id: userId },
        data: { localImportCompletedAt: new Date(), activeTripId },
      });

      return { trips: payload.trips.length, bookings: payload.bookings.length };
    });

    response.json({
      alreadyMigrated: false,
      imported: imported.trips,
      importedBookings: imported.bookings,
    } satisfies MigrateResponse);
  },
);
