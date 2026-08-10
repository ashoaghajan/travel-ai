import { z } from 'zod';

/**
 * What the server will accept as a booking.
 *
 * Server-only, behind the `@ai-travel/shared/schemas` export path so zod never
 * reaches the browser bundle.
 *
 * Looser than the trip schemas in one specific way: a booking is often saved
 * before anything about it is known. A fare found while browsing has no date,
 * no reference and sometimes no price, and refusing it at that moment is what
 * would push someone back to the partner with nothing recorded. So the empty
 * string is a valid date here, and most fields are optional.
 */

const ID = z.string().trim().min(1).max(200);

/** ISO calendar date, or empty — see the header. */
const ISO_DATE_OR_BLANK = z
  .string()
  .trim()
  .refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Use a YYYY-MM-DD date.');

const KIND = z.enum(['flight', 'hotel', 'ticket', 'activity']);
const STATUS = z.enum(['saved', 'booked']);

const priceBasisSchema = z.object({
  unit: z.enum(['nightly', 'perPerson']),
  units: z.number().int().min(1).max(1000),
});

/**
 * A copy of the search result this came from.
 *
 * Passed through rather than modelled field by field: it is a snapshot of a
 * provider's shape, those shapes differ per provider and change without
 * notice, and nothing on the server reads inside it. Bounded so one booking
 * cannot be made unboundedly large.
 */
const sourceSchema = z
  .object({
    provider: z.string().max(100),
    resultId: z.string().max(300).optional(),
    subtitle: z.string().max(1000).optional(),
    image: z.string().max(2000).optional(),
    bookingUrl: z.string().max(2000).optional(),
    price: z.number().min(0).max(10_000_000).optional(),
    priceSource: z.string().max(50).optional(),
    route: z.object({ from: z.string().max(100), to: z.string().max(100) }).optional(),
    coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
    capturedAt: z.string().max(100).optional(),
  })
  .passthrough();

const bookingFields = {
  /**
   * The trip this belongs to, or null for one attached to nothing yet.
   *
   * Nullable on purpose: you can find a fare before deciding which trip it is
   * for. The route checks that a named trip actually belongs to the caller.
   */
  tripId: ID.nullish(),
  kind: KIND,
  status: STATUS.default('saved'),
  title: z.string().trim().min(1, 'Give the booking a title.').max(300),
  date: ISO_DATE_OR_BLANK,
  endDate: ISO_DATE_OR_BLANK.optional(),
  reference: z.string().trim().max(200).default(''),
  price: z.number().min(0).max(10_000_000).nullish(),
  priceBasis: priceBasisSchema.nullish(),
  url: z.string().max(2000).nullish(),
  source: sourceSchema.nullish(),
};

export const createBookingSchema = z.object(bookingFields);

/**
 * A patch, where an absent key means "leave it" and `null` means "clear it".
 *
 * Same reasoning as `TripPatch`: `undefined` does not survive
 * `JSON.stringify`, so detaching a booking from its trip needs a value of its
 * own. `source` is deliberately absent — it is a snapshot of where the
 * booking came from and is never edited.
 */
export const updateBookingSchema = z.object({
  tripId: bookingFields.tripId,
  kind: KIND.optional(),
  status: STATUS.optional(),
  title: bookingFields.title.optional(),
  date: ISO_DATE_OR_BLANK.optional(),
  endDate: ISO_DATE_OR_BLANK.nullish(),
  reference: z.string().trim().max(200).optional(),
  price: bookingFields.price,
  priceBasis: bookingFields.priceBasis,
  url: bookingFields.url,
});

/** Ids are client-minted; the import preserves them so it can be idempotent. */
export const importBookingSchema = createBookingSchema.and(
  z.object({
    id: z
      .string()
      .trim()
      // `bkg_`, which is what `createId('bkg')` produces on the client.
      .regex(/^bkg_[A-Za-z0-9_-]{1,100}$/, 'That is not a booking id this app minted.'),
  }),
);

export type CreateBookingBody = z.infer<typeof createBookingSchema>;
export type UpdateBookingBody = z.infer<typeof updateBookingSchema>;
