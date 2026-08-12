import { z } from 'zod';
import { baseTrip, itineraryActivitySchema, itineraryDaySchema } from './trip.schemas';

/**
 * What the server will accept as a shared trip.
 *
 * A snapshot is an `ExportedTrip` — the document `Export` already writes to a
 * file — so this is `createTripSchema` plus the one thing a file carries that a
 * row does not: the stable name of each photograph.
 *
 * **That name is why the snapshot is built in the browser rather than here.**
 * A bundled picture's URL is a content hash (`/assets/city-9f2a1b.jpg`) that
 * differs between one build and the next, so the URL alone would point the
 * recipient at a file their copy of the app has never served. `bundledImageId`
 * turns it back into `city`, and that map lives in the client bundle. The
 * server's job is to refuse anything that is not shaped like a trip — which is
 * this file — not to author the document.
 *
 * Server-only, behind the `@ai-travel/shared/schemas` export path.
 */

/** A bundled picture's stable name. Bounded, like every other id here. */
const IMAGE_ID = z.string().trim().min(1).max(200);

const sharedActivitySchema = itineraryActivitySchema.extend({
  imageId: IMAGE_ID.optional(),
});

const sharedDaySchema = itineraryDaySchema.extend({
  imageId: IMAGE_ID.optional(),
  activities: z.array(sharedActivitySchema).max(100),
});

/**
 * The trip inside an offer.
 *
 * `draftId` is deliberately absent: it is an idempotency key belonging to
 * whoever wrote the trip and it means nothing in another account. Acceptance
 * mints its own — see `shares.service.ts`.
 */
export const sharedTripSchema = z
  .object({
    title: baseTrip.title,
    destination: baseTrip.destination,
    destinationCountry: baseTrip.destinationCountry,
    destinationCity: baseTrip.destinationCity,
    startDate: baseTrip.startDate,
    endDate: baseTrip.endDate,
    travellers: baseTrip.travellers,
    coverImage: baseTrip.coverImage,
    coverImageId: IMAGE_ID.optional(),
    itinerary: z.array(sharedDaySchema).max(365),
    notes: baseTrip.notes,
    flightsEstimate: baseTrip.flightsEstimate,
    hotelsEstimate: baseTrip.hotelsEstimate,
    activitiesEstimate: baseTrip.activitiesEstimate,
  })
  .refine((trip) => trip.endDate >= trip.startDate, {
    message: 'The end date cannot be before the start date.',
    path: ['endDate'],
  });

export type SharedTripBody = z.infer<typeof sharedTripSchema>;

/** `POST /api/trips/:id/share` — who it goes to, and what they are being sent. */
export const shareTripSchema = z.object({
  toUserId: z.string().trim().min(1).max(200),
  trip: sharedTripSchema,
});
