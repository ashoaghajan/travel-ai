import type { CalendarEvent } from './calendar';

/**
 * A calendar file, as RFC 5545 wants it.
 *
 * Written by hand rather than pulled from a package, because what is needed
 * here is a few hundred bytes of well-formed text and the alternative is a
 * dependency in the one workspace both apps compile — the phone pays for it in
 * bundle size and the browser pays for it on every page load.
 *
 * The output is what Google Calendar, Apple Calendar and Outlook all import.
 * That is the whole point of the format: one file, every calendar, and no
 * account linking — which is what makes this the half of the feature that can
 * ship before anybody has been through Google's verification.
 */

/** CRLF, and not negotiable: RFC 5545 §3.1 says lines end this way. */
const CRLF = '\r\n';

/**
 * Escapes the four characters that mean something to the format.
 *
 * Backslash first, or it would escape the backslashes the others just added.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Folds a line to 75 octets, continuing with a leading space.
 *
 * Measured in octets rather than characters, which matters the moment a trip
 * is called "Tbilisi & the Georgian Mountains" and somebody writes a day named
 * "Мцхета": a fold counted in UTF-16 units can land in the middle of a
 * multi-byte character and produce a file that imports as mojibake. The
 * accumulator therefore tracks encoded length, and never splits a code point.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];

  let current = '';
  let bytes = 0;
  // The continuation lines carry a leading space, so they have one octet less
  // of room than the first.
  let limit = 75;

  for (const character of line) {
    const size = encoder.encode(character).length;

    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74;
    }

    current += character;
    bytes += size;
  }

  parts.push(current);

  return parts.join(`${CRLF} `);
}

/** `2026-09-14T19:30:00` → `20260914T193000`; `2026-09-14` → `20260914`. */
function stamp(value: string): string {
  return value.replace(/[-:]/g, '');
}

/**
 * The `DTSTART`/`DTEND` pair for one event.
 *
 * A zoned event is written as local time with a `TZID`, not converted to UTC.
 * Converting would mean resolving the offset now, and a trip booked in
 * September for March would be resolved against the wrong side of a
 * daylight-saving change — the file would be an hour out, silently, for every
 * event after the clocks moved. A `TZID` naming an IANA zone stays correct
 * however the rules are later amended, and is what Google, Apple and Outlook
 * all read.
 *
 * An event with no zone is written as a *floating* time — no `TZID`, no `Z` —
 * which every calendar reads as "whatever local time is". That is the right
 * answer when a district label could not be resolved: wrong by hours at worst,
 * rather than confidently wrong by a continent.
 */
function dateLines(event: CalendarEvent): string[] {
  if (event.allDay) {
    return [
      `DTSTART;VALUE=DATE:${stamp(event.start)}`,
      `DTEND;VALUE=DATE:${stamp(event.end)}`,
    ];
  }

  const tzid = event.timeZone ? `;TZID=${event.timeZone}` : '';

  return [`DTSTART${tzid}:${stamp(event.start)}`, `DTEND${tzid}:${stamp(event.end)}`];
}

export type IcsOptions = {
  /** Shown as the calendar's name by clients that read `X-WR-CALNAME`. */
  name?: string;
  /**
   * The `DTSTAMP` on every event — when this file was written.
   *
   * Injectable so a test can assert on the whole document, and so two exports
   * of an unchanged trip can be made byte-identical if a caller wants that.
   */
  now?: Date;
};

/** `20260902T130000Z` — UTC, which is the only thing `DTSTAMP` may be. */
function utcStamp(at: Date): string {
  return `${at.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

export function toIcsCalendar(events: CalendarEvent[], { name, now }: IcsOptions = {}): string {
  const stamped = utcStamp(now ?? new Date());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    // The identifier for *this* writer, as §3.7.3 requires.
    'PRODID:-//AI Travel//Trip Itinerary//EN',
    // The traveller is meant to keep these, not be asked about them.
    'METHOD:PUBLISH',
    'CALSCALE:GREGORIAN',
  ];

  if (name) lines.push(`X-WR-CALNAME:${escapeText(name)}`);

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${stamped}`,
      ...dateLines(event),
      `SUMMARY:${escapeText(event.title)}`,
    );

    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // A trailing CRLF: the last line is a line, not a fragment.
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}

/**
 * A "add this one to Google Calendar" URL.
 *
 * The other half of the no-account route, and the one that takes a single tap:
 * Google opens its own compose screen with everything filled in and the
 * traveller presses Save. `ctz` carries the zone, which is why the events this
 * is built from keep wall-clock times — the same pair goes into the link as
 * into the file.
 */
export function toGoogleCalendarUrl(event: CalendarEvent): string {
  const dates = `${stamp(event.start)}/${stamp(event.end)}`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates,
  });

  if (event.description) params.set('details', event.description);
  if (event.location) params.set('location', event.location);
  // Meaningless on an all-day entry, and Google ignores it there.
  if (event.timeZone && !event.allDay) params.set('ctz', event.timeZone);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
