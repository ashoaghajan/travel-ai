import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
/*
 * `expo-calendar/legacy`, not `expo-calendar`.
 *
 * SDK 57 repointed the package root at a new object-oriented API and left
 * deprecated shims in its place. The shims warn on import and — found on an
 * Honor ALT-LX2, not by any test —`requestCalendarPermissionsAsync` throws
 * through one of them: no permission dialog appears, the permission stays
 * denied, and the failure surfaces as the generic write error rather than the
 * permission one. The package's own deprecation notice names this path.
 */
import * as Calendar from 'expo-calendar/legacy';
import {
  bookingsToCalendarEvents,
  calendarDestinations,
  toCalendarEvents,
  zonedTimeToInstant,
  type CalendarEvent,
  type CalendarSourceBooking,
} from '@ai-travel/shared';
import type { Trip } from '../../core/types/trip.types';
import type { Booking } from '../../core/types/booking.types';
import { timezoneService } from '../../core/services/timezone.service';

/**
 * A trip, written into the calendar already on the phone.
 *
 * **This is why the phone needs no OAuth.** On Android the device calendar
 * provider *is* the signed-in Google account's calendar: an event written here
 * is picked up by Google's own sync adapter and appears on
 * calendar.google.com, on the laptop, everywhere — which is the outcome the
 * Calendar API would have bought, without a client secret, a refresh token, or
 * the consent-screen verification that its sensitive scope requires.
 *
 * On iOS the same call writes to whatever the default calendar is. That is
 * Google's only if the reader has added the account under Settings → Calendar,
 * so the honest description there is "your phone's calendar" — which is what
 * {@link describeCalendarTarget} says.
 *
 * The web's counterpart writes an `.ics` file instead: a browser cannot reach
 * a calendar, only offer a file to import. Both build their events from the
 * same `@ai-travel/shared` mapping, so the two cannot disagree about when
 * anything happens.
 */

const PERMISSION_ERROR =
  'AI Travel needs permission to use your calendar. You can grant it in Settings.';
const WRITE_ERROR = 'We could not add this trip to your calendar. Please try again.';
const NO_CALENDAR_ERROR = 'No calendar on this phone can be written to.';

/** What the button can honestly promise, which differs by platform. */
export function describeCalendarTarget(): string {
  return Platform.OS === 'android' ? 'Google Calendar' : 'your calendar';
}

function fallbackPlace(trip: Trip): string | undefined {
  return trip.destinationCity || trip.destination || trip.destinationCountry || undefined;
}

/*
 * Inferred rather than imported: the record type lives in the package's
 * `legacy` entry point and is not re-exported at the top level, and naming it
 * would collide with the `Calendar` namespace this file imports anyway.
 */
type DeviceCalendar = Awaited<ReturnType<typeof Calendar.getCalendarsAsync>>[number];

/**
 * The calendar to write into.
 *
 * Android first: `getDefaultCalendarAsync` is iOS-only, and the Android
 * provider hands back a long list that includes read-only ones — birthdays,
 * holidays, subscribed feeds — so the choice is made explicitly. A calendar
 * owned by a Google account is preferred over any other writable one, because
 * that is the one that syncs off the device; a local-only calendar would leave
 * the trip on this handset and nowhere else, which looks identical until the
 * reader opens their laptop.
 */
async function targetCalendar(): Promise<DeviceCalendar | null> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);

  const writable = calendars.filter(
    (calendar) =>
      calendar.allowsModifications &&
      calendar.accessLevel !== Calendar.CalendarAccessLevel.READ &&
      calendar.accessLevel !== Calendar.CalendarAccessLevel.FREEBUSY,
  );

  if (writable.length === 0) return null;

  const google = writable.find(
    (calendar) =>
      calendar.source?.type === Calendar.SourceType.CALDAV ||
      /google|gmail/i.test(calendar.source?.name ?? ''),
  );

  // The primary Google calendar is the one whose name is the account itself.
  const primary = writable.find((calendar) => /@/.test(calendar.title ?? ''));

  return google ?? primary ?? writable[0];
}

/** One event, as `expo-calendar` wants it: instants, plus the zone they read in. */
function toDeviceEvent(event: CalendarEvent, calendarId: string) {
  const startDate = zonedTimeToInstant(event.start, event.timeZone);
  const endDate = zonedTimeToInstant(event.end, event.timeZone);

  if (!startDate || !endDate) return null;

  return {
    calendarId,
    title: event.title,
    notes: event.description || undefined,
    location: event.location || undefined,
    startDate,
    endDate,
    allDay: event.allDay ?? false,
    timeZone: event.timeZone,
  };
}

export type CalendarExportResult = {
  added: number;
  /** Where they went, for the sentence afterwards. */
  calendarTitle: string;
};

export type CalendarExportState = {
  addToCalendar: (trip: Trip, bookings?: Booking[]) => Promise<void>;
  isAdding: boolean;
  result: CalendarExportResult | null;
  error: string | null;
  reset: () => void;
};

export function useCalendarExport(): CalendarExportState {
  const [isAdding, setIsAdding] = useState(false);
  const [result, setResult] = useState<CalendarExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const addToCalendar = useCallback(async (trip: Trip, bookings: Booking[] = []) => {
    setIsAdding(true);
    setError(null);
    setResult(null);

    try {
      const { granted } = await Calendar.requestCalendarPermissionsAsync();

      if (!granted) {
        setError(PERMISSION_ERROR);
        return;
      }

      const calendar = await targetCalendar();

      if (!calendar) {
        setError(NO_CALENDAR_ERROR);
        return;
      }

      const days = trip.itinerary ?? [];

      const timeZoneFor = await timezoneService.resolveForTrip(
        calendarDestinations(days),
        fallbackPlace(trip),
      );

      // The itinerary's own rows are filed as bookings too, so the summary has
      // something to total — see the web hook for the whole story. Exporting
      // both would put every stop in the calendar twice.
      const reservations = bookings.filter((booking) => booking.source?.provider !== 'itinerary');

      const events = [
        ...bookingsToCalendarEvents(
          reservations as CalendarSourceBooking[],
          { timeZoneFor },
          fallbackPlace(trip) ?? '',
        ),
        ...toCalendarEvents(days, { timeZoneFor }),
      ];

      let added = 0;

      for (const event of events) {
        const details = toDeviceEvent(event, calendar.id);
        if (!details) continue;

        await Calendar.createEventAsync(calendar.id, details);
        added += 1;
      }

      setResult({ added, calendarTitle: calendar.title ?? describeCalendarTarget() });
    } catch {
      setError(WRITE_ERROR);
    } finally {
      setIsAdding(false);
    }
  }, []);

  return { addToCalendar, isAdding, result, error, reset };
}
