import type { Booking } from '../types/booking.types';
import type { Trip } from '../types/trip.types';
import { stayGaps } from './booking';

export type ReadinessItem = {
  id: 'dates' | 'itinerary' | 'flight' | 'stay' | 'confirmation';
  label: string;
  detail: string;
  complete: boolean;
  href: string;
};

/** Turn stored trip facts into a short, actionable departure checklist. */
export function tripReadiness(trip: Trip, bookings: Booking[]): ReadinessItem[] {
  const tripBookings = bookings.filter((booking) => booking.tripId === trip.id);
  const flight = tripBookings.some((booking) => booking.kind === 'flight' && booking.status === 'booked');
  const bookedStay = tripBookings.some((booking) => booking.kind === 'hotel' && booking.status === 'booked');
  const stayGapsRemaining = trip.startDate && trip.endDate
    ? stayGaps(trip.startDate, trip.endDate, tripBookings)
    : [];
  const hasStayCoverage = trip.startDate < trip.endDate && stayGapsRemaining.length === 0;
  const missingConfirmation = tripBookings.some(
    (booking) => booking.status === 'booked' && !booking.reference.trim(),
  );

  return [
    {
      id: 'dates',
      label: 'Trip dates set',
      detail: trip.startDate && trip.endDate ? `${trip.startDate} to ${trip.endDate}` : 'Add your travel dates',
      complete: Boolean(trip.startDate && trip.endDate && trip.endDate >= trip.startDate),
      href: `/trips/${encodeURIComponent(trip.id)}`,
    },
    {
      id: 'itinerary',
      label: 'Plan at least one activity',
      detail: trip.itinerary.some((day) => day.activities.length > 0)
        ? `${trip.itinerary.reduce((total, day) => total + day.activities.length, 0)} activities in your schedule`
        : 'Add places to your schedule',
      complete: trip.itinerary.some((day) => day.activities.length > 0),
      href: `/trips/${encodeURIComponent(trip.id)}?tab=itinerary`,
    },
    {
      id: 'flight',
      label: 'Flight added',
      detail: flight ? 'A booked flight is on this trip' : 'Add your flight or record it manually',
      complete: flight,
      href: `/bookings?tripId=${encodeURIComponent(trip.id)}&tab=flights`,
    },
    {
      id: 'stay',
      label: 'Accommodation covered',
      detail: hasStayCoverage
        ? 'Every trip night has a booked stay'
        : bookedStay
          ? `${stayGapsRemaining.length} stay gap${stayGapsRemaining.length === 1 ? '' : 's'} still open`
          : 'Add a stay for your trip nights',
      complete: hasStayCoverage,
      href: `/bookings?tripId=${encodeURIComponent(trip.id)}&tab=hotels`,
    },
    {
      id: 'confirmation',
      label: 'Confirmation references saved',
      detail: missingConfirmation
        ? 'At least one booked item needs a reference number'
        : tripBookings.some((booking) => booking.status === 'booked')
          ? 'References are saved for all booked items'
          : 'Add a booked item to store its confirmation reference',
      complete: !missingConfirmation && tripBookings.some(
        (booking) => booking.status === 'booked' && Boolean(booking.reference.trim()),
      ),
      href: `/trips/${encodeURIComponent(trip.id)}?tab=bookings`,
    },
  ];
}
