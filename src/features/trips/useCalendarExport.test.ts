/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTripCalendar, calendarFileName } from './useCalendarExport';
import { timezoneService } from '../../services/timezone.service';
import { weatherService } from '../../services/weather.service';
import type { Booking } from '../../types/booking.types';
import type { Trip } from '../../types/trip.types';

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    title: 'Porto Trip',
    destination: 'Porto',
    destinationCity: 'Porto',
    destinationCountry: 'Portugal',
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    travellers: 2,
    coverImage: '',
    itinerary: [
      {
        id: 'day_1',
        dayNumber: 1,
        date: '2026-11-01',
        destination: 'Porto',
        summary: 'Arrival',
        activities: [
          {
            id: 'activity_1',
            time: '15:00',
            title: 'Check in and unpack',
            description: 'Drop your bags.',
            category: 'travel',
          },
        ],
      },
    ],
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  } as Trip;
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'bkg_1',
    tripId: 'trip_1',
    kind: 'hotel',
    status: 'saved',
    title: 'Rooms Hotel',
    date: '2026-11-01',
    reference: '',
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  } as Booking;
}

describe('buildTripCalendar', () => {
  beforeEach(() => {
    localStorage.clear();
    timezoneService.clearCache();

    vi.spyOn(weatherService, 'findPlace').mockImplementation(async (place: string) => ({
      name: place,
      latitude: 0,
      longitude: 0,
      timezone: place === 'Porto' ? 'Europe/Lisbon' : undefined,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives each activity its destination zone and an hour', async () => {
    const [event] = await buildTripCalendar(trip());

    expect(event.start).toBe('2026-11-01T15:00:00');
    expect(event.end).toBe('2026-11-01T16:00:00');
    expect(event.timeZone).toBe('Europe/Lisbon');
  });

  it('does not export an itinerary row twice', async () => {
    // Saving a trip files every priced stop as a booking as well, so the
    // summary has something to total. Exporting both put each stop in the
    // calendar twice — once timed, once as an all-day bar over it.
    const events = await buildTripCalendar(trip(), [
      booking({
        id: 'bkg_mirror',
        kind: 'activity',
        title: 'Check in and unpack',
        source: { provider: 'itinerary', resultId: 'activity_1', capturedAt: '2026-09-02T00:00:00.000Z' },
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].uid).toContain('activity_1');
  });

  it('keeps a real booking, including an attraction saved from the explorer', async () => {
    const events = await buildTripCalendar(trip(), [
      booking(),
      booking({
        id: 'bkg_museum',
        kind: 'activity',
        title: 'Serralves',
        source: { provider: 'opentripmap', resultId: 'xid1', capturedAt: '2026-09-02T00:00:00.000Z' },
      }),
    ]);

    expect(events.map((event) => event.title)).toEqual([
      'Rooms Hotel',
      'Serralves',
      'Check in and unpack',
    ]);
  });

  it('spans a stay to the day after check-out', async () => {
    const [stay] = await buildTripCalendar(trip(), [
      booking({ endDate: '2026-11-05' }),
    ]);

    expect(stay.allDay).toBe(true);
    expect(stay.start).toBe('2026-11-01');
    expect(stay.end).toBe('2026-11-06');
  });

  it("falls back to the trip's city for a day whose label is a district", async () => {
    const [event] = await buildTripCalendar(
      trip({
        itinerary: [
          {
            id: 'day_1',
            dayNumber: 1,
            date: '2026-11-01',
            destination: 'Ribeira & Sé',
            summary: 'Old town',
            activities: [
              { id: 'a', time: '09:00', title: 'Walk', description: '', category: 'culture' },
            ],
          },
        ],
      } as Partial<Trip>),
    );

    expect(event.timeZone).toBe('Europe/Lisbon');
  });
});

describe('calendarFileName', () => {
  it.each([
    ['Tbilisi & the Georgian Mountains', 'tbilisi-the-georgian-mountains.ics'],
    ['Porto Trip', 'porto-trip.ics'],
    ['Málaga', 'malaga.ics'],
    ['!!!', 'trip.ics'],
  ])('%s → %s', (title, expected) => {
    expect(calendarFileName(title)).toBe(expected);
  });
});
