import type { Partner } from '../types/travel.types';

/**
 * Booking partners — DESIGN_SPEC Screen 7.
 *
 * This is app configuration rather than search inventory: it ships with the
 * build and never goes through a search service. Logos are brand-coloured
 * placeholder tiles, not partner artwork.
 *
 * `homeUrl` is the floor: it is where "View Deals" goes when there is not
 * enough known about the trip to build a prefilled search. `partner.links.ts`
 * turns `linkBuilder` into the search URL when there is.
 */
export const MOCK_PARTNERS: Partner[] = [
  {
    id: 'partner-expedia',
    name: 'Expedia',
    description: 'Great prices on flights & hotels',
    categories: ['flights', 'hotels'],
    brandColor: '#ffc72c',
    brandTextColor: '#1f2937',
    initials: 'EX',
    linkBuilder: 'expedia',
    homeUrl: 'https://www.expedia.com/',
  },
  {
    id: 'partner-booking',
    name: 'Booking.com',
    description: 'Wide selection of hotels',
    categories: ['hotels'],
    brandColor: '#003580',
    brandTextColor: '#ffffff',
    initials: 'B.',
    linkBuilder: 'booking',
    homeUrl: 'https://www.booking.com/',
  },
  {
    id: 'partner-trip',
    name: 'Trip.com',
    description: 'Competitive prices worldwide',
    categories: ['flights', 'hotels'],
    brandColor: '#287dfa',
    brandTextColor: '#ffffff',
    initials: 'TR',
    linkBuilder: 'trip',
    homeUrl: 'https://us.trip.com/',
  },
  {
    id: 'partner-getyourguide',
    name: 'GetYourGuide',
    description: 'Top activities & experiences',
    categories: ['activities'],
    brandColor: '#ff5533',
    brandTextColor: '#ffffff',
    initials: 'GY',
    linkBuilder: 'getyourguide',
    homeUrl: 'https://www.getyourguide.com/',
  },
];
