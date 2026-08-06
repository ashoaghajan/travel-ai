import type { BookingKind } from '../types/booking.types';
import flightAvatar from './generic/avatar-flight.svg';
import hotelAvatar from './generic/avatar-hotel.svg';
import activityAvatar from './generic/avatar-activity.svg';
import ticketAvatar from './generic/avatar-ticket.svg';

/**
 * The picture a booking wears when it has none of its own.
 *
 * A flight never has one — there is nothing to photograph but the aircraft,
 * and a stock aeroplane would be the same image on every fare. Hotels and
 * attractions usually do, but the providers answer without one often enough
 * that the fallback has to look deliberate rather than empty.
 *
 * Drawn rather than photographed, and carrying each kind's own colour, so the
 * avatar and the kind chip beside it read as one mark. SVG so they stay sharp
 * and cost a few hundred bytes each.
 */
export const BOOKING_AVATARS: Record<BookingKind, string> = {
  flight: flightAvatar,
  hotel: hotelAvatar,
  activity: activityAvatar,
  ticket: ticketAvatar,
};
