import { useCallback, useState } from 'react';
import {
  bookingsToCalendarEvents,
  calendarDestinations,
  toCalendarEvents,
  toIcsCalendar,
  type CalendarEvent,
  type CalendarSourceBooking,
} from '@ai-travel/shared';
import type { Trip } from '../../types/trip.types';
import type { Booking } from '../../types/booking.types';
import { downloadTextFile } from '../../services/fileTransfer.service';
import { timezoneService } from '../../services/timezone.service';

const EXPORT_ERROR = 'We could not save that file. Your browser may have blocked the download.';

/** `Tbilisi & the Georgian Mountains` → `tbilisi-the-georgian-mountains.ics`. */
export function calendarFileName(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${slug || 'trip'}.ics`;
}

/**
 * The place to fall back to when a day's own label does not resolve.
 *
 * The city first, then the bare `destination` an older trip carries, then the
 * country — each broader than the last, and a country is enough to be right
 * about the hour in every case that matters here.
 */
function fallbackPlace(trip: Trip): string | undefined {
  return trip.destinationCity || trip.destination || trip.destinationCountry || undefined;
}

/**
 * Builds a trip's events, with a zone resolved for every day.
 *
 * Exported separately from the download so the same list can feed the
 * per-event "Add to Google Calendar" links, and so the phone can reuse the
 * assembly without the file.
 */
export async function buildTripCalendar(
  trip: Trip,
  bookings: Booking[] = [],
): Promise<CalendarEvent[]> {
  const days = trip.itinerary ?? [];

  const timeZoneFor = await timezoneService.resolveForTrip(
    calendarDestinations(days),
    fallbackPlace(trip),
  );

  const activities = toCalendarEvents(days, { timeZoneFor });

  /*
   * The itinerary's own rows, which are already above as timed events.
   *
   * Saving a trip files every priced stop as a booking too, so the total on the
   * summary has something to add up — `itineraryActivityToBookingDraft` stamps
   * those with the `itinerary` provider. Exporting both put each stop in the
   * calendar twice: once at 15:00 with its description, and again as a
   * featureless all-day bar above it.
   *
   * Filtered on the provider rather than on `kind === 'activity'`, because that
   * kind is also what an attraction saved from the explorer gets, and a museum
   * the reader shortlisted but never put on a day is not a duplicate of
   * anything — dropping it would lose a real booking to fix a cosmetic one.
   */
  const reservations = bookings.filter((booking) => booking.source?.provider !== 'itinerary');

  // All-day, and belonging to the trip rather than to one of its districts, so
  // they are located by the trip's own city.
  const events = bookingsToCalendarEvents(
    reservations as CalendarSourceBooking[],
    { timeZoneFor },
    fallbackPlace(trip) ?? '',
  );

  return [...events, ...activities];
}

export type CalendarExportState = {
  /** Throws nothing — a failure lands in `error` instead. */
  exportCalendar: (trip: Trip, bookings?: Booking[]) => void;
  isExporting: boolean;
  error: string | null;
};

/**
 * A trip as a calendar file.
 *
 * Asynchronous where `useTripExport` is synchronous, and the difference is the
 * time zones: an itinerary knows it is in "Sololaki & Vera" at 19:30 and not
 * what that is an offset from, so the zone for each day has to be looked up
 * before a single line can be written. Cached after the first export, so the
 * second is effectively instant.
 *
 * One file rather than a per-event link, because a week's trip is thirty-odd
 * entries and nobody is pressing Save thirty times. `.ics` imports into Google
 * Calendar, Apple Calendar and Outlook alike — which also means it works for
 * the readers who signed up with an email address and have no Google account
 * to connect.
 */
export function useCalendarExport(): CalendarExportState {
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const exportCalendar = useCallback((trip: Trip, bookings: Booking[] = []) => {
    setIsExporting(true);
    setError(null);

    void (async () => {
      try {
        const events = await buildTripCalendar(trip, bookings);

        downloadTextFile(
          calendarFileName(trip.title),
          toIcsCalendar(events, { name: trip.title }),
          'text/calendar;charset=utf-8',
        );
      } catch {
        setError(EXPORT_ERROR);
      } finally {
        setIsExporting(false);
      }
    })();
  }, []);

  return { exportCalendar, isExporting, error };
}
