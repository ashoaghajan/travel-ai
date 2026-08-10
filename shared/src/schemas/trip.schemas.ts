import { z } from 'zod';

/**
 * What the server will accept as a trip.
 *
 * These mirror `src/features/trips/editTrip.ts:validate()`, which is the real
 * statement of the rules — but the client's copy is UX and this one is
 * enforcement. Anything reachable by hand-writing a request has to be refused
 * here, because nothing else will refuse it.
 *
 * Server-only: this file lives behind the `@ai-travel/shared/schemas` export
 * path so zod never reaches the browser bundle.
 */

/** `09:30`, and not `24:00` or `9:5`. */
const TIME = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time, like 09:30.');

/** ISO calendar date. A trip's dates are days, not instants — see the schema. */
const ISO_DATE = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

const ISO_TIMESTAMP = z.string().trim().min(1);

const CATEGORY = z.enum(['food', 'nature', 'culture', 'adventure', 'relaxation', 'travel']);

const LAT_LNG = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * Ids are client-minted and pass through unchanged.
 *
 * Bounded rather than free-form: they end up as object keys and in URLs, and
 * an unbounded string here is a way to make a row arbitrarily large.
 */
const ID = z.string().trim().min(1).max(200);

const itineraryActivitySchema = z.object({
  id: ID,
  time: TIME,
  title: z.string().trim().min(1, 'Give this activity a title.').max(300),
  description: z.string().max(2000).default(''),
  category: CATEGORY,
  priceEstimate: z.number().min(0).max(1_000_000).optional(),
  image: z.string().max(2000).optional(),
  sourceActivityId: z.string().max(200).optional(),
  coordinates: LAT_LNG.optional(),
});

const itineraryDaySchema = z.object({
  id: ID,
  dayNumber: z.number().int().min(1).max(1000),
  date: ISO_DATE,
  destination: z.string().trim().max(300).default(''),
  summary: z.string().max(2000).default(''),
  activities: z.array(itineraryActivitySchema).max(100),
  coordinates: LAT_LNG.optional(),
  image: z.string().max(2000).optional(),
});

/** Bounded so one trip cannot be made unboundedly large. */
export const itinerarySchema = z.array(itineraryDaySchema).max(365);

const tripNoteSchema = z.object({
  id: ID,
  text: z.string().trim().min(1, 'Write the note, or remove it.').max(5000),
  createdAt: ISO_TIMESTAMP,
  updatedAt: ISO_TIMESTAMP,
});

const notesSchema = z.array(tripNoteSchema).max(500);

/**
 * A trip needs a city or a country, not merely a `destination` label.
 *
 * The label is what cards render, and it is derived from the other two on the
 * client — so a trip with a label and neither part behind it is one the
 * explorer cannot filter and the map cannot place.
 */
function hasSomewhereToGo(value: {
  destination: string;
  destinationCity?: string | null;
  destinationCountry?: string | null;
}): boolean {
  return Boolean(
    value.destination.trim() || value.destinationCity?.trim() || value.destinationCountry?.trim(),
  );
}

const baseTrip = {
  draftId: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1, 'Give the trip a title.').max(300),
  destination: z.string().trim().max(300).default(''),
  destinationCountry: z.string().trim().max(200).nullish(),
  destinationCity: z.string().trim().max(200).nullish(),
  startDate: ISO_DATE,
  endDate: ISO_DATE,
  travellers: z.number().int().min(1, 'At least one traveller.').max(50),
  coverImage: z.string().max(2000).default(''),
  itinerary: itinerarySchema,
  notes: notesSchema.optional(),
  flightsEstimate: z.number().min(0).max(10_000_000).nullish(),
  hotelsEstimate: z.number().min(0).max(10_000_000).nullish(),
  activitiesEstimate: z.number().min(0).max(10_000_000).nullish(),
};

export const createTripSchema = z
  .object(baseTrip)
  .refine((trip) => trip.endDate >= trip.startDate, {
    message: 'The end date cannot be before the start date.',
    path: ['endDate'],
  })
  .refine(hasSomewhereToGo, { message: 'Name a city or a country.', path: ['destination'] });

/**
 * A patch, where an absent key means "leave it" and `null` means "clear it".
 *
 * The distinction is the whole reason this is not `createTripSchema.partial()`.
 * `undefined` does not survive `JSON.stringify`, so a client trying to clear a
 * trip's country by sending `undefined` sends nothing at all and the field
 * silently keeps its old value.
 */
export const updateTripSchema = z
  .object({
    title: baseTrip.title.optional(),
    destination: z.string().trim().max(300).optional(),
    destinationCountry: baseTrip.destinationCountry,
    destinationCity: baseTrip.destinationCity,
    startDate: ISO_DATE.optional(),
    endDate: ISO_DATE.optional(),
    travellers: baseTrip.travellers.optional(),
    coverImage: z.string().max(2000).optional(),
    itinerary: itinerarySchema.optional(),
    notes: notesSchema.nullish(),
    flightsEstimate: baseTrip.flightsEstimate,
    hotelsEstimate: baseTrip.hotelsEstimate,
    activitiesEstimate: baseTrip.activitiesEstimate,
    /**
     * The version the client believes it is editing.
     *
     * Optional so an empty touch still works — `useTripSave` sends `{}`
     * deliberately to bump `updatedAt`. When present it is checked, and a
     * mismatch is a `409` rather than a silent overwrite.
     */
    version: z.number().int().min(0).optional(),
  })
  .refine(
    (patch) =>
      patch.startDate === undefined || patch.endDate === undefined || patch.endDate >= patch.startDate,
    { message: 'The end date cannot be before the start date.', path: ['endDate'] },
  );

/** The body of `POST /api/trips/:id/days/:dayId/activities`. */
export const addActivitySchema = z.object({
  activity: z.object({
    id: ID,
    title: z.string().trim().min(1).max(300),
    description: z.string().max(2000).default(''),
    category: CATEGORY,
    price: z.number().min(0).max(1_000_000).default(0),
    image: z.string().max(2000).default(''),
    coordinates: LAT_LNG.optional(),
  }),
  time: TIME.optional(),
});

export const activeTripSchema = z.object({
  tripId: z.string().trim().min(1).max(200).nullable(),
});

export type CreateTripBody = z.infer<typeof createTripSchema>;
export type UpdateTripBody = z.infer<typeof updateTripSchema>;
export type AddActivityBody = z.infer<typeof addActivitySchema>;
