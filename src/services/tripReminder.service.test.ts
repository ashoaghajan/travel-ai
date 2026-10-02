/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Booking } from '../types/booking.types';
import type { Trip } from '../types/trip.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import { deliverBrowserReminders, getTripReminders, requestBrowserNotificationPermission } from './tripReminder.service';

const trip: Trip = {
  id: 'trip_1', title: 'Lisbon weekend', destination: 'Lisbon', startDate: '2027-06-02',
  endDate: '2027-06-04', travellers: 2, coverImage: '', createdAt: 'x', updatedAt: 'x',
  itinerary: [{
    id: 'day_2', dayNumber: 1, date: '2027-06-02', destination: 'Lisbon', summary: '',
    activities: [
      { id: 'act_early', time: '09:00', title: 'Breakfast', description: '', category: 'food' },
      { id: 'act_later', time: '18:30', title: 'Sunset walk', description: '', category: 'nature' },
    ],
  }],
};

const hotel: Booking = {
  id: 'stay_1', tripId: 'trip_1', kind: 'hotel', status: 'booked', title: 'Riverside Hotel',
  date: '2027-06-02', endDate: '2027-06-04', reference: 'HTL123', createdAt: 'x', updatedAt: 'x',
};

afterEach(() => {
  storageService.remove(STORAGE_KEYS.reminderDeliveries);
  vi.restoreAllMocks();
});

describe('getTripReminders', () => {
  it('includes tomorrow activities and hotel check-in, with links to the trip', () => {
    const reminders = getTripReminders([trip], [hotel], new Date(2027, 5, 1, 11, 0));
    expect(reminders.some((item) => item.title === 'Coming up tomorrow' && item.detail.includes('Breakfast'))).toBe(true);
    expect(reminders.some((item) => item.title === 'Hotel check-in tomorrow' && item.detail.includes('HTL123'))).toBe(true);
    expect(reminders.every((item) => item.href.startsWith('/trips/trip_1') || item.href.startsWith('/bookings?tripId=trip_1'))).toBe(true);
  });

  it('skips activities already past and adds a readiness reminder within seven days', () => {
    const upcomingTrip = { ...trip, startDate: '2027-06-05', itinerary: trip.itinerary.map((day) => ({ ...day, date: '2027-06-05' })) };
    const reminders = getTripReminders([upcomingTrip], [], new Date(2027, 5, 1, 10, 0));
    expect(reminders.some((item) => item.detail.includes('Breakfast'))).toBe(false);
    expect(reminders.some((item) => item.id.startsWith('ready:'))).toBe(true);
  });
});

describe('deliverBrowserReminders', () => {
  it('does not deliver without permission and deduplicates granted notifications', () => {
    const reminders = getTripReminders([trip], [], new Date(2027, 5, 1, 11, 0));
    const notify = vi.fn();
    expect(deliverBrowserReminders(reminders, { permission: 'default', notify })).toEqual([]);

    const first = deliverBrowserReminders(reminders, { permission: 'granted', notify });
    const second = deliverBrowserReminders(reminders, { permission: 'granted', notify });
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(first.length);
  });

  it('requests permission only when called by the explicit opt-in action', async () => {
    const original = globalThis.Notification;
    class NotificationStub {
      static permission: NotificationPermission = 'default';
      static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    }
    Object.defineProperty(globalThis, 'Notification', { configurable: true, value: NotificationStub });
    await expect(requestBrowserNotificationPermission()).resolves.toBe('granted');
    expect(NotificationStub.requestPermission).toHaveBeenCalledTimes(1);
    Object.defineProperty(globalThis, 'Notification', { configurable: true, value: original });
  });
});
