import type {
  ItineraryActivity,
  ItineraryDay,
  Trip,
  TripNote,
  TripPatch,
} from '../../types/trip.types';
import type { Activity } from '../../types/travel.types';
import { minutesOf, toItineraryActivity } from '../../services/trip.service';
import { createId } from '../../utils/id';

/**
 * The editable shape of a trip, and the pure functions that move a trip in and
 * out of it.
 *
 * Kept apart from the modal so the rules — what counts as changed, what counts
 * as valid, what gets sent — can be read and tested without rendering
 * anything. The modal owns only the widgets.
 */

/**
 * Where a newly added activity starts, before the user names it — and what the
 * attraction picker's time field opens on.
 */
export const DEFAULT_ACTIVITY_TIME = '12:00';

export type TripEditDraft = {
  title: string;
  /** Free text; empty means the trip does not name one. */
  destinationCountry: string;
  destinationCity: string;
  /** ISO calendar date, `YYYY-MM-DD` — the format `<input type="date">` uses. */
  startDate: string;
  endDate: string;
  travellers: number;
  itinerary: ItineraryDay[];
  notes: TripNote[];
};

/** Field-keyed messages; an empty object means the draft is valid. */
export type TripEditErrors = {
  title?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  travellers?: string;
  /** Keyed by activity id, so the message can sit against its own row. */
  activities?: Record<string, string>;
  /** Keyed by note id, same reason. */
  notes?: Record<string, string>;
};

/**
 * A trip as the form sees it.
 *
 * The itinerary is deep-copied: the draft is edited in place, and sharing
 * structure with the stored trip would let an abandoned edit leak into the
 * store through a mutated nested object.
 */
export function toEditDraft(trip: Trip): TripEditDraft {
  return {
    title: trip.title,
    destinationCountry: trip.destinationCountry ?? '',
    // Trips saved before the split carry only `destination`; it reads as the
    // city, which is what it has always meant in practice.
    destinationCity: trip.destinationCity ?? trip.destination ?? '',
    startDate: trip.startDate,
    endDate: trip.endDate,
    travellers: trip.travellers,
    itinerary: trip.itinerary.map((day) => ({
      ...day,
      activities: day.activities.map((activity) => ({ ...activity })),
    })),
    // Absent on every trip saved before notes existed — read as empty.
    notes: (trip.notes ?? []).map((note) => ({ ...note })),
  };
}

/**
 * The label the rest of the app shows — city first, country as a fallback.
 *
 * Takes only the two fields it reads, so the create form — whose draft carries
 * no itinerary — can call it too.
 */
export function destinationLabel(
  draft: Pick<TripEditDraft, 'destinationCity' | 'destinationCountry'>,
): string {
  return draft.destinationCity.trim() || draft.destinationCountry.trim();
}

/** True when the draft differs from the trip it was built from. */
export function isDirty(trip: Trip, draft: TripEditDraft): boolean {
  return JSON.stringify(toEditDraft(trip)) !== JSON.stringify(normalise(draft));
}

/**
 * Trims the free-text fields so trailing spaces alone are not a change.
 *
 * Exported because creation trims by the same rules — one definition of what
 * "trimmed" means, rather than two that drift the day a field is added.
 */
export function normalise(draft: TripEditDraft): TripEditDraft {
  return {
    ...draft,
    title: draft.title.trim(),
    destinationCountry: draft.destinationCountry.trim(),
    destinationCity: draft.destinationCity.trim(),
    itinerary: draft.itinerary.map((day) => ({
      ...day,
      activities: day.activities.map((activity) => ({
        ...activity,
        title: activity.title.trim(),
        description: activity.description.trim(),
        time: activity.time.trim(),
      })),
    })),
    notes: draft.notes.map((note) => ({ ...note, text: note.text.trim() })),
  };
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Everything that would make the trip unreadable if it were saved. */
export function validate(draft: TripEditDraft): TripEditErrors {
  const errors: TripEditErrors = {};

  if (!draft.title.trim()) errors.title = 'Give the trip a title.';
  if (!destinationLabel(draft)) errors.destination = 'Name a city or a country.';
  if (!draft.startDate) errors.startDate = 'Pick a start date.';
  if (!draft.endDate) errors.endDate = 'Pick an end date.';

  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.endDate = 'The end date cannot be before the start date.';
  }

  if (!Number.isInteger(draft.travellers) || draft.travellers < 1) {
    errors.travellers = 'At least one traveller.';
  }

  const activities: Record<string, string> = {};
  for (const day of draft.itinerary) {
    for (const activity of day.activities) {
      if (!activity.title.trim()) {
        activities[activity.id] = 'Give this activity a title.';
      } else if (!TIME_PATTERN.test(activity.time.trim())) {
        activities[activity.id] = 'Use a 24-hour time, like 09:30.';
      }
    }
  }

  if (Object.keys(activities).length > 0) errors.activities = activities;

  // A blank note is the one thing that makes the list unreadable — it would
  // save as a row with nothing in it and no way to tell what it was for.
  const notes: Record<string, string> = {};
  for (const note of draft.notes) {
    if (!note.text.trim()) notes[note.id] = 'Write the note, or remove it.';
  }
  if (Object.keys(notes).length > 0) errors.notes = notes;

  return errors;
}

export function hasErrors(errors: TripEditErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * The changed fields only — the body of a `PATCH /api/trips/:id`.
 *
 * Sending just the difference is what keeps the Stage 2 swap honest: the
 * request already carries what a partial update carries, so moving
 * `tripService.updateTrip` onto HTTP changes no caller and no shape.
 */
export function toPatch(trip: Trip, draft: TripEditDraft): TripPatch {
  const clean = normalise(draft);
  const patch: TripPatch = {};

  if (clean.title !== trip.title) patch.title = clean.title;
  if (clean.startDate !== trip.startDate) patch.startDate = clean.startDate;
  if (clean.endDate !== trip.endDate) patch.endDate = clean.endDate;
  if (clean.travellers !== trip.travellers) patch.travellers = clean.travellers;

  /*
   * `null` to clear, not `undefined`.
   *
   * `undefined` does not survive `JSON.stringify` — the key is dropped from
   * the request body entirely, so the server sees no mention of the field and
   * correctly leaves it alone. Clearing a trip's country was therefore
   * impossible: the form emptied, the save succeeded, and the old value came
   * back on reload.
   */
  if (clean.destinationCountry !== (trip.destinationCountry ?? '')) {
    patch.destinationCountry = clean.destinationCountry || null;
  }
  if (clean.destinationCity !== (trip.destinationCity ?? '')) {
    patch.destinationCity = clean.destinationCity || null;
  }

  // `destination` is the label every card and header renders, so it follows
  // the city rather than drifting from it.
  const label = destinationLabel(clean);
  if (label && label !== trip.destination) patch.destination = label;

  if (JSON.stringify(clean.itinerary) !== JSON.stringify(trip.itinerary)) {
    patch.itinerary = clean.itinerary;
  }

  if (JSON.stringify(clean.notes) !== JSON.stringify(trip.notes ?? [])) {
    patch.notes = clean.notes;
  }

  return patch;
}

/* -------------------------------------------------------------------------
 * Itinerary edits — each returns a new draft, never mutates the old one.
 * ---------------------------------------------------------------------- */

function mapDay(
  draft: TripEditDraft,
  dayId: string,
  change: (day: ItineraryDay) => ItineraryDay,
): TripEditDraft {
  return {
    ...draft,
    itinerary: draft.itinerary.map((day) => (day.id === dayId ? change(day) : day)),
  };
}

export function updateActivity(
  draft: TripEditDraft,
  dayId: string,
  activityId: string,
  patch: Partial<Pick<ItineraryActivity, 'title' | 'description' | 'time'>>,
): TripEditDraft {
  return mapDay(draft, dayId, (day) => ({
    ...day,
    activities: day.activities.map((activity) =>
      activity.id === activityId ? { ...activity, ...patch } : activity,
    ),
  }));
}

export function removeActivity(
  draft: TripEditDraft,
  dayId: string,
  activityId: string,
): TripEditDraft {
  return mapDay(draft, dayId, (day) => ({
    ...day,
    activities: day.activities.filter((activity) => activity.id !== activityId),
  }));
}

/** Appends an empty activity for the user to fill in. */
export function addActivity(draft: TripEditDraft, dayId: string): TripEditDraft {
  return mapDay(draft, dayId, (day) => ({
    ...day,
    activities: [
      ...day.activities,
      {
        id: createId('act'),
        time: DEFAULT_ACTIVITY_TIME,
        title: '',
        description: '',
        // The planner's own default; the form does not ask for a category.
        category: 'travel',
      },
    ],
  }));
}

/** True when this day already carries an entry imported from this attraction. */
export function isPickedOnDay(
  draft: TripEditDraft,
  dayId: string,
  sourceActivityId: string,
): boolean {
  const day = draft.itinerary.find((candidate) => candidate.id === dayId);
  return day?.activities.some((entry) => entry.sourceActivityId === sourceActivityId) ?? false;
}

/**
 * Places an entry at the first position later than it, rather than sorting.
 *
 * A day under edit is not necessarily in time order — `addActivity` appends a
 * blank row at the end and nothing re-sorts afterwards — so sorting the whole
 * array here would reshuffle rows the reader had just arranged by hand, as a
 * side effect of picking something unrelated. Inserting gives the same answer
 * on an ordered day and moves nothing on an unordered one.
 */
function insertByTime(
  activities: ItineraryActivity[],
  entry: ItineraryActivity,
): ItineraryActivity[] {
  const at = minutesOf(entry.time);
  const index = activities.findIndex((candidate) => minutesOf(candidate.time) > at);

  return index === -1
    ? [...activities, entry]
    : [...activities.slice(0, index), entry, ...activities.slice(index)];
}

/**
 * Adds an attraction from the explorer to one day of the draft.
 *
 * Draft only. Nothing here writes to the store, because `useEditTrip` rebuilds
 * the whole draft the moment a trip's `updatedAt` moves — a write from the
 * picker would take every other unsaved edit with it. The pick reaches storage
 * the same way a retitled activity does: through `toPatch`, when the reader
 * saves.
 *
 * A second pick of the same place returns the draft untouched, by reference,
 * rather than throwing: this runs inside a `setDraft` updater, where a thrown
 * error is not catchable by the caller that fired it.
 */
export function addPickedActivity(
  draft: TripEditDraft,
  dayId: string,
  activity: Activity,
  time: string,
): TripEditDraft {
  if (isPickedOnDay(draft, dayId, activity.id)) return draft;

  const entry = toItineraryActivity(activity, time.trim() || DEFAULT_ACTIVITY_TIME);

  return mapDay(draft, dayId, (day) => ({
    ...day,
    activities: insertByTime(day.activities, entry),
  }));
}

/* -------------------------------------------------------------------------
 * Notes — same contract as the itinerary edits above: a new draft every time,
 * never a mutation of the old one.
 *
 * Bookings used to live here too. They moved to their own store when it became
 * clear one can be found before its trip is chosen — and because a confirmed
 * reservation has no business sitting inside an edit session's "Cancel
 * Changes". See `src/services/booking.service.ts`.
 * ---------------------------------------------------------------------- */

/** Appends an empty note for the reader to write into. */
export function addNote(draft: TripEditDraft): TripEditDraft {
  const now = new Date().toISOString();

  return {
    ...draft,
    notes: [...draft.notes, { id: createId('note'), text: '', createdAt: now, updatedAt: now }],
  };
}

/**
 * Rewrites a note's text.
 *
 * `updatedAt` only moves when the text actually differs, so re-selecting the
 * same text or a no-op keystroke does not restamp the note. It is compared by
 * `isDirty` like every other field: typing into a note and deleting it again
 * leaves the draft dirty until Cancel, which is the honest answer — the draft
 * does hold a different timestamp than the trip.
 */
export function updateNote(draft: TripEditDraft, noteId: string, text: string): TripEditDraft {
  return {
    ...draft,
    notes: draft.notes.map((note) =>
      note.id === noteId && note.text !== text
        ? { ...note, text, updatedAt: new Date().toISOString() }
        : note,
    ),
  };
}

export function removeNote(draft: TripEditDraft, noteId: string): TripEditDraft {
  return { ...draft, notes: draft.notes.filter((note) => note.id !== noteId) };
}
