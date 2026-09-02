/**
 * An itinerary, as calendar events.
 *
 * Shared because both apps need the same answer and there is nothing
 * platform-specific about it: the web will hand these to an `.ics` writer or to
 * the Calendar API, the phone to `expo-calendar`, and a dinner that starts at
 * 19:30 in Tbilisi has to start at 19:30 in Tbilisi whichever of those wrote it.
 * Pure functions, so the rules can be read and tested away from any transport.
 *
 * **Times here are wall-clock, not instants.** Every event carries a local
 * `start`/`end` and the `timeZone` those are to be read in, rather than a UTC
 * timestamp. That is deliberate: the itinerary says "19:30" and means 19:30
 * where the traveller will be standing, and resolving that to an instant here
 * would bake in whatever offset was in force on the day this ran — including
 * the wrong side of a daylight-saving change for a trip booked months out.
 * Both `.ics` (`DTSTART;TZID=`) and the Calendar API (`{dateTime, timeZone}`)
 * take exactly this pair, so nothing is lost by deferring it.
 */

/** One hour, unless the activity says otherwise. */
export const DEFAULT_ACTIVITY_MINUTES = 60;

/**
 * The shape this needs from an itinerary activity.
 *
 * Structural rather than an imported `ItineraryActivity`, because that type is
 * declared once in the web app and again on the phone — this package is what
 * the two have in common, so it cannot import either.
 */
export type CalendarSourceActivity = {
  id: string;
  /** 24-hour display time, e.g. "09:30". */
  time: string;
  title: string;
  description?: string;
  /** Minutes. Absent means {@link DEFAULT_ACTIVITY_MINUTES}. */
  durationMinutes?: number;
};

export type CalendarSourceDay = {
  /** ISO calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Where the day is spent — often a district label, not a resolvable town. */
  destination: string;
  activities: CalendarSourceActivity[];
};

export type CalendarEvent = {
  /**
   * Stable for the life of the activity.
   *
   * Derived from the activity's own id so that exporting a trip twice updates
   * the same event rather than adding a second copy of it — which is what both
   * `.ics` `UID` and the Calendar API's `id` are for.
   */
  uid: string;
  title: string;
  description: string;
  /**
   * Local wall-clock, `YYYY-MM-DDTHH:mm:ss`, to be read in `timeZone` — or a
   * bare `YYYY-MM-DD` when {@link CalendarEvent.allDay} is set.
   */
  start: string;
  /**
   * The end, and for an all-day event it is **exclusive**: a stay running the
   * 14th to the 18th ends on the 19th, because that is the convention both
   * `.ics` and the Calendar API use for a whole-day range, and the alternative
   * draws the bar a day short of the morning the traveller checks out.
   */
  end: string;
  /** IANA zone, e.g. `Asia/Tbilisi`. Absent when nothing could resolve one. */
  timeZone?: string;
  /** The day's destination, for the calendar's own "where". */
  location: string;
  /**
   * True for something that occupies days rather than hours.
   *
   * A booking has a date and no clock time — a flight is "the 14th", a stay is
   * "the 14th to the 18th" — and inventing 09:00 for it would put a fake
   * departure time in somebody's calendar. All-day is the honest shape, and it
   * is also the one that sits in the header row rather than burying the day's
   * actual plans under a twelve-hour block.
   */
  allDay?: boolean;
};

/** `"9:5"`, `"09:05"` and `" 09:05 "` all mean the same thing; `"soon"` does not. */
export function parseTimeOfDay(time: string): { hours: number; minutes: number } | null {
  const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(time);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return null;

  return { hours, minutes };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * `date` + `time` + `minutes`, as another wall-clock stamp.
 *
 * The arithmetic runs in UTC, which sounds wrong and is not: no zone is being
 * applied, UTC is simply the one calendar whose days are all 24 hours long, so
 * it can carry "23:30 plus ninety minutes" over midnight without a library. The
 * result is read back out in the same wall-clock terms it went in as.
 */
export function shiftWallClock(date: string, time: string, minutes: number): string | null {
  const parsed = parseTimeOfDay(time);
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parsed || !day) return null;

  const at = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), parsed.hours, parsed.minutes);
  const moved = new Date(at + minutes * 60_000);

  return (
    `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}` +
    `T${pad(moved.getUTCHours())}:${pad(moved.getUTCMinutes())}:00`
  );
}

export type CalendarEventOptions = {
  /**
   * The zone a day's events happen in.
   *
   * Injected rather than looked up here, because resolving a place name to a
   * zone is a network call and this file is pure. The caller is expected to
   * have resolved every distinct destination once — see the timezone service on
   * either platform — and to fall back to the trip's own city when a day's
   * label does not resolve, which is often: `PlannerDayPlan.destination` is
   * documented as "a district or a nearby town", and the gazetteer behind our
   * geocoder answers NOT_FOUND for most districts and, worse, fuzzy-matches
   * some of them to a real town in the wrong country. Returning `undefined` is
   * a valid answer and leaves the event floating, which every calendar reads as
   * "local time" — wrong by hours at worst, rather than wrong by a continent.
   */
  timeZoneFor?: (destination: string) => string | undefined;
};

/**
 * Every activity in an itinerary, as an event.
 *
 * Days are taken in the order given and activities in the order they appear —
 * an itinerary is already sorted by the screen that shows it, and re-sorting
 * here would disagree with it. An activity whose `time` cannot be parsed is
 * dropped rather than guessed at: a calendar entry at the wrong hour is worse
 * than one the traveller notices is missing.
 */
export function toCalendarEvents(
  days: CalendarSourceDay[],
  { timeZoneFor }: CalendarEventOptions = {},
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const day of days) {
    const timeZone = timeZoneFor?.(day.destination);

    for (const activity of day.activities) {
      const start = shiftWallClock(day.date, activity.time, 0);
      if (!start) continue;

      const minutes =
        activity.durationMinutes && activity.durationMinutes > 0
          ? activity.durationMinutes
          : DEFAULT_ACTIVITY_MINUTES;

      const end = shiftWallClock(day.date, activity.time, minutes);
      if (!end) continue;

      events.push({
        uid: `${activity.id}@ai-travel`,
        title: activity.title,
        description: activity.description ?? '',
        start,
        end,
        timeZone,
        location: day.destination,
      });
    }
  }

  return events;
}

/**
 * The shape this needs from a saved booking. Structural, for the same reason
 * as {@link CalendarSourceActivity}.
 */
export type CalendarSourceBooking = {
  id: string;
  kind: 'flight' | 'hotel' | 'ticket' | 'activity';
  title: string;
  /** ISO calendar date, `YYYY-MM-DD`. Empty when unknown. */
  date: string;
  /** Check-out, on a stay only. */
  endDate?: string;
  /** Confirmation number, when there is one. */
  reference?: string;
};

/** The day after `date`, which is where an exclusive all-day end belongs. */
function nextDay(date: string): string | null {
  const shifted = shiftWallClock(date, '00:00', 24 * 60);
  return shifted ? shifted.slice(0, 10) : null;
}

/**
 * Saved bookings, as all-day entries.
 *
 * Separate from {@link toCalendarEvents} rather than folded into it, because
 * the two answer different questions — "what am I doing on Tuesday" against
 * "what have I actually paid for" — and a caller may reasonably want one
 * without the other.
 *
 * A booking with no date is skipped. The bookings tab already groups those
 * under their own heading rather than guessing at the trip's start date, and a
 * calendar has nowhere to put an entry that does not know when it is.
 */
export function bookingsToCalendarEvents(
  bookings: CalendarSourceBooking[],
  { timeZoneFor }: CalendarEventOptions = {},
  location = '',
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const booking of bookings) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date)) continue;

    // A stay runs to its check-out; everything else occupies the one day. Both
    // ends are made exclusive by the same step, so the two cases differ only in
    // which date they start from.
    const lastDay = booking.kind === 'hotel' && booking.endDate ? booking.endDate : booking.date;
    const end = nextDay(lastDay);
    if (!end || end <= booking.date) continue;

    events.push({
      uid: `${booking.id}@ai-travel`,
      title: booking.title,
      description: booking.reference ? `Reference: ${booking.reference}` : '',
      start: booking.date,
      end,
      timeZone: timeZoneFor?.(location),
      location,
      allDay: true,
    });
  }

  return events;
}

/**
 * What a zone's offset was at a given instant, in milliseconds.
 *
 * There is no API that answers this directly, so the standard trick: format the
 * instant *as* the target zone, read the wall-clock digits back, and subtract.
 * `Intl` carries the whole history of a zone's rules, so this is right across a
 * daylight-saving change rather than assuming a fixed offset.
 */
function offsetMsAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));

  const read: Record<string, string> = {};
  for (const part of parts) read[part.type] = part.value;

  const asUtc = Date.UTC(
    Number(read.year),
    Number(read.month) - 1,
    Number(read.day),
    // `hour12: false` renders midnight as 24 in some ICU versions.
    Number(read.hour) % 24,
    Number(read.minute),
    Number(read.second),
  );

  return asUtc - instant;
}

/**
 * A wall-clock stamp and its zone, as the instant it names.
 *
 * The file format does not need this — `.ics` carries the pair as-is — but a
 * device calendar does: `expo-calendar` takes a `Date`, which is a point on the
 * timeline, so 19:30 in Tbilisi has to be resolved before it can be written.
 * This is the one place in the feature where that resolution happens, and it
 * happens at the moment of writing rather than at the moment of planning.
 *
 * The offset is applied twice on purpose. The first pass asks what the offset
 * was at roughly the right instant; the second asks again at the answer, which
 * is what gets the hour right for a time that falls near a clock change, where
 * the two differ.
 *
 * Returns local time when no zone is given, and falls back to local if `Intl`
 * cannot do zones — Hermes has historically shipped without the data, and an
 * event at the reader's own 19:30 is a better failure than no event at all.
 */
export function zonedTimeToInstant(wallClock: string, timeZone?: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(wallClock);
  if (!match) return null;

  const [, year, month, day, hour = '0', minute = '0'] = match;
  const parts = [Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)] as const;

  if (!timeZone) return new Date(parts[0], parts[1], parts[2], parts[3], parts[4]);

  try {
    const guess = Date.UTC(...parts);
    const once = guess - offsetMsAt(guess, timeZone);

    return new Date(guess - offsetMsAt(once, timeZone));
  } catch {
    return new Date(parts[0], parts[1], parts[2], parts[3], parts[4]);
  }
}

/** The distinct destinations an itinerary visits, for resolving zones once each. */
export function calendarDestinations(days: CalendarSourceDay[]): string[] {
  const seen = new Set<string>();

  for (const day of days) {
    const name = day.destination.trim();
    if (name.length > 0) seen.add(name);
  }

  return [...seen];
}
