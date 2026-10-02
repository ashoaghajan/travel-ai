import type { Booking } from '../types/booking.types';
import type { Trip } from '../types/trip.types';
import { fromIsoDate, toIsoDate, addDays } from '../utils/date';
import { tripReadiness } from '../utils/tripReadiness';
import { STORAGE_KEYS, storageService } from './localStorage.service';

export type TripReminder = {
  id: string;
  tripId: string;
  title: string;
  detail: string;
  href: string;
  date: string;
};

function dayDistance(from: string, to: string): number {
  return Math.round((fromIsoDate(to).getTime() - fromIsoDate(from).getTime()) / 86_400_000);
}

/** Timely, actionable reminders for the next 24 hours and the week before travel. */
export function getTripReminders(trips: Trip[], bookings: Booking[], now = new Date()): TripReminder[] {
  const today = toIsoDate(now);
  const tomorrow = toIsoDate(addDays(now, 1));
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const reminders: TripReminder[] = [];

  for (const trip of trips) {
    const tripBookings = bookings.filter((booking) => booking.tripId === trip.id);
    const tripHref = `/trips/${encodeURIComponent(trip.id)}`;
    const upcoming = dayDistance(today, trip.startDate);

    if (upcoming > 0 && upcoming <= 7) {
      const firstOpenItem = tripReadiness(trip, tripBookings).find((item) => !item.complete);
      if (firstOpenItem) {
        reminders.push({
          id: `ready:${trip.id}:${trip.startDate}:${firstOpenItem.id}`,
          tripId: trip.id,
          title: `${trip.title} is coming up`,
          detail: `Before ${trip.startDate}: ${firstOpenItem.label.toLowerCase()}.`,
          href: firstOpenItem.href,
          date: today,
        });
      }
    }

    for (const day of trip.itinerary) {
      if (day.date !== today && day.date !== tomorrow) continue;
      for (const activity of day.activities) {
        if (day.date === today && activity.time < currentTime) continue;
        reminders.push({
          id: `activity:${trip.id}:${day.id}:${activity.id}`,
          tripId: trip.id,
          title: day.date === today ? 'Coming up today' : 'Coming up tomorrow',
          detail: `${trip.title} · ${activity.time} · ${activity.title}`,
          href: `${tripHref}?tab=itinerary`,
          date: day.date,
        });
      }
    }

    for (const booking of tripBookings) {
      if (booking.kind !== 'hotel' || booking.status !== 'booked') continue;
      if (booking.date !== today && booking.date !== tomorrow) continue;
      reminders.push({
        id: `checkin:${trip.id}:${booking.id}:${booking.date}`,
        tripId: trip.id,
        title: booking.date === today ? 'Hotel check-in today' : 'Hotel check-in tomorrow',
        detail: `${trip.title} · ${booking.title}${booking.reference ? ` · ${booking.reference}` : ''}`,
        href: `${tripHref}?tab=bookings`,
        date: booking.date,
      });
    }
  }

  return reminders.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function deliveredIds(): string[] {
  return storageService.get<string[]>(STORAGE_KEYS.reminderDeliveries, []);
}

/** Deliver only after the reader has granted browser permission. */
export function deliverBrowserReminders(
  reminders: TripReminder[],
  options: {
    permission?: NotificationPermission;
    notify?: (title: string, body: string, tag: string, onClick: () => void) => void;
  } = {},
): string[] {
  const permission = options.permission ?? (typeof Notification === 'undefined' ? 'denied' : Notification.permission);
  if (permission !== 'granted') return [];
  const notify = options.notify ?? ((title, body, tag, onClick) => {
    const notification = new Notification(title, { body, tag });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  });

  const delivered = new Set(deliveredIds());
  const newReminders = reminders.filter((reminder) => !delivered.has(reminder.id));
  const notified: string[] = [];

  for (const reminder of newReminders) {
    try {
      notify(reminder.title, reminder.detail, reminder.id, () => {
        window.location.assign(reminder.href);
      });
      delivered.add(reminder.id);
      notified.push(reminder.id);
    } catch {
      // Browser notification APIs may be unavailable in embedded contexts.
    }
  }

  if (notified.length) {
    try {
      storageService.set(STORAGE_KEYS.reminderDeliveries, [...delivered].slice(-200));
    } catch {
      // In-app reminders still render; lack of storage may mean a repeat later.
    }
  }

  return notified;
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}
