import type { ItineraryDay, TripDraft } from '../../types/trip.types';
import { COVER_IMAGES } from '../../assets/cover-images';
import { addDays, fromIsoDate, nightsBetween, toIsoDate } from '../../utils/date';
import { createId } from '../../utils/id';
import { destinationLabel, normalise, validate } from './editTrip';
import type { TripEditDraft, TripEditErrors } from './editTrip';

/**
 * Creating a trip by hand: the shape the form holds, and the rules that turn
 * it into a `TripDraft`.
 *
 * Sits next to `editTrip.ts` and leans on it — the same validation, the same
 * trimming, the same destination label — so a trip created here and a trip
 * edited there cannot disagree about what a valid trip is.
 *
 * The itinerary is deliberately *not* part of the draft. It is one empty day
 * per date, so the dates are its only input; deriving it removes any chance of
 * a day list that has drifted from the range it was built from.
 */

/**
 * The form's state.
 *
 * `coverImage` is the one field the edit draft has no equivalent for: an
 * existing trip already has a cover, a new one has to choose.
 *
 * `notes` is dropped for the same reason as `itinerary`: a trip that does not
 * exist yet has nothing noted, so asking for it on the create form would be
 * asking about a trip the reader has not made yet. Notes are added from the
 * trip page afterwards, and bookings from their own store.
 */
export type TripCreateDraft = Omit<TripEditDraft, 'itinerary' | 'notes'> & {
  coverImage: string;
};

/**
 * The create draft as the shared rules expect it.
 *
 * `validate` and `normalise` are the edit form's, and they read two lists a
 * trip being created has none of. Supplying them empty here keeps one
 * definition of what a valid trip is rather than a second, nearly identical
 * validator for creation.
 */
function asEditDraft(draft: TripCreateDraft): TripEditDraft {
  return { ...draft, itinerary: [], notes: [] };
}

/** Matches the planner's own defaults, so both doors open on the same trip. */
const DEFAULT_LEAD_DAYS = 30;
const DEFAULT_DAYS = 5;
const DEFAULT_TRAVELLERS = 2;

/**
 * The most days a manually created trip may cover.
 *
 * A guard rail, not a policy: `<input type="date">` will happily hand back the
 * year 2207 after one mistyped digit, and every day in the range becomes an
 * object in storage and a row on screen. Ninety days is past any realistic
 * trip and far short of anything that hurts.
 */
export const MAX_TRIP_DAYS = 90;

/** Days covered by an inclusive date range; 0 when the range is unusable. */
export function dayCount(startIso: string, endIso: string): number {
  if (!startIso || !endIso || endIso < startIso) return 0;
  return nightsBetween(startIso, endIso) + 1;
}

/** The form as it opens: dates a month out, nothing else assumed. */
export function emptyCreateDraft(today = new Date()): TripCreateDraft {
  const start = addDays(today, DEFAULT_LEAD_DAYS);

  return {
    title: '',
    destinationCountry: '',
    destinationCity: '',
    startDate: toIsoDate(start),
    endDate: toIsoDate(addDays(start, DEFAULT_DAYS - 1)),
    travellers: DEFAULT_TRAVELLERS,
    coverImage: COVER_IMAGES[0].src,
  };
}

/**
 * One empty day per date in the range.
 *
 * Capped at `MAX_TRIP_DAYS` here as well as in validation, because this runs on
 * every keystroke in the date fields to feed the preview. Typing a year passes
 * through values like `0202-01-01`, and an uncapped version would allocate
 * hundreds of thousands of objects synchronously — long before anything had
 * been submitted for validation to reject.
 *
 * `summary` is left empty on purpose. A placeholder sentence is not something
 * the trip page gives anyone a way to delete.
 */
export function scaffoldDays(
  startIso: string,
  endIso: string,
  destination: string,
): ItineraryDay[] {
  const total = Math.min(dayCount(startIso, endIso), MAX_TRIP_DAYS);
  if (total === 0) return [];

  const start = fromIsoDate(startIso);

  return Array.from({ length: total }, (_, index) => ({
    id: createId('day'),
    dayNumber: index + 1,
    date: toIsoDate(addDays(start, index)),
    destination,
    summary: '',
    activities: [],
  }));
}

/** Today as `YYYY-MM-DD`, in the reader's own timezone. */
export function todayIso(today = new Date()): string {
  return toIsoDate(today);
}

/**
 * The edit rules, plus the two only creation has.
 *
 * Deliberately a wrapper rather than extra rules inside `validate()`. Both are
 * about *starting* a trip, and neither survives contact with editing one: the
 * length cap exists because this form scaffolds a day per date, and a trip that
 * began last week is a perfectly good trip to still be editing. Putting either
 * in the shared validator would make an existing trip impossible to save from
 * the very form needed to fix it.
 *
 * The messages ride on `startDate`/`endDate` rather than new error keys: they
 * are complaints about those fields, they render where the reader can act on
 * them, and no caller has to learn a new one.
 */
export function validateCreate(draft: TripCreateDraft, today = new Date()): TripEditErrors {
  const errors = validate(asEditDraft(draft));

  // A trip cannot begin before today. Checked as well as constrained on the
  // input, because `min` is a hint the browser can be talked out of and a typed
  // date bypasses the picker entirely.
  if (!errors.startDate && draft.startDate < todayIso(today)) {
    errors.startDate = 'A trip cannot start in the past.';
  }

  if (
    !errors.startDate &&
    !errors.endDate &&
    dayCount(draft.startDate, draft.endDate) > MAX_TRIP_DAYS
  ) {
    errors.endDate = `A trip can cover at most ${MAX_TRIP_DAYS} days.`;
  }

  return errors;
}

/**
 * The trip to persist — in Stage 2, the body of a `POST /api/trips`.
 *
 * No cost estimates: a hand-made trip has nothing to base them on, and
 * `calculateTripCosts` already treats a missing estimate as zero and recomputes
 * the activities line from the itinerary. An explicit `0` would suppress that
 * recomputation and pin the total at nothing as the trip filled up.
 */
export function toTripDraft(draft: TripCreateDraft, draftId: string): TripDraft {
  const clean = normalise(asEditDraft(draft));
  const destination = destinationLabel(clean);

  return {
    draftId,
    title: clean.title,
    destination,
    destinationCountry: clean.destinationCountry || undefined,
    destinationCity: clean.destinationCity || undefined,
    startDate: clean.startDate,
    endDate: clean.endDate,
    travellers: clean.travellers,
    coverImage: draft.coverImage,
    itinerary: scaffoldDays(clean.startDate, clean.endDate, destination),
  };
}
