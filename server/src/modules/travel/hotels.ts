import type { Hotel } from '@ai-travel/shared';
import { isLiteApiConfigured, searchStays } from './liteapi';
import { placesGet } from '../places/opentripmap';

/**
 * Hotel listings, priced where a provider will quote them.
 *
 * Two sources, in preference order rather than in combination.
 *
 * LiteAPI is the good answer: one catalogue that carries the property, its
 * guest rating, a photograph and a live rate, all joined on its own id. When
 * it has anything for a destination, that is what the reader gets.
 *
 * OpenTripMap is the fallback, and the reason this file still has two halves.
 * It is a places directory — it knows a hotel exists and nothing about what it
 * costs — but it covers everywhere, which a rate catalogue does not. A city
 * LiteAPI has never heard of therefore degrades to real stays with
 * `pricePerNight: null`, priced by the partner on the far side of the booking
 * link, rather than to an empty screen.
 *
 * Deliberately *not* a merge of the two. Pricing OpenTripMap listings from
 * LiteAPI would mean matching two catalogues on hotel name, and a "Grand
 * Hotel" that quietly acquires the rate of "Grand Hotel Suites" down the road
 * is a worse failure than a missing price: the reader can click through to
 * discover a missing price, but has no way to discover a wrong one.
 */

/** How far from the city centre to look. Wide enough for resort areas. */
const RADIUS_METRES = 15_000;

/** Asked for generously, because filtering throws a lot away. */
const FETCH_LIMIT = 60;

/**
 * Tags that mean "somewhere to sleep".
 *
 * `accomodations` alone is too broad: OpenTripMap hangs it on the Burj Khalifa
 * because there is a hotel inside, and a skyscraper is not a stay. Requiring
 * one of these narrower tags keeps landmarks out of the list.
 *
 * The provider's spelling of "accomodations" is its own.
 */
const LODGING_KINDS = [
  'other_hotels',
  'hostels',
  'guest_houses',
  'motels',
  'apartments',
  'resorts',
] as const;

type Place = {
  xid?: string;
  name?: string;
  kinds?: string;
  rate?: number;
  point?: { lat?: number; lon?: number };
};

type GeoName = { lat?: number; lon?: number; name?: string; status?: string };

/** Where a destination is, so the radius search has a centre. */
async function locate(destination: string): Promise<{ lat: number; lon: number } | null> {
  const found = await placesGet<GeoName>('/geoname', { name: destination });

  if (typeof found.lat !== 'number' || typeof found.lon !== 'number') return null;

  return { lat: found.lat, lon: found.lon };
}

function isLodging(place: Place): boolean {
  const kinds = (place.kinds ?? '').split(',');
  return LODGING_KINDS.some((kind) => kinds.includes(kind));
}

/** The most specific lodging tag, made presentable: "Guest house", "Hostel". */
function describeKind(place: Place): string {
  const kinds = (place.kinds ?? '').split(',');

  if (kinds.includes('resorts')) return 'Resort';
  if (kinds.includes('hostels')) return 'Hostel';
  if (kinds.includes('guest_houses')) return 'Guest house';
  if (kinds.includes('apartments')) return 'Apartment';
  if (kinds.includes('motels')) return 'Motel';

  return 'Hotel';
}

/**
 * Where to book this stay.
 *
 * Searched by name on Hotellook — Travelpayouts' hotel brand, so the marker
 * that attributes flight commission attributes this too. It lands on a search
 * for that property with the reader's dates rather than on its booking page:
 * we have no property id to link deeper with, and a named search is honest
 * about that where a fabricated deep link would not be.
 */
export function hotelBookingUrl(
  name: string,
  destination: string,
  checkIn: string,
  checkOut: string,
  guests: number,
  marker: string | null,
): string {
  const url = new URL('https://search.hotellook.com/');

  url.searchParams.set('query', `${name} ${destination}`.trim());
  url.searchParams.set('checkIn', checkIn);
  url.searchParams.set('checkOut', checkOut);
  url.searchParams.set('adults', String(guests));
  url.searchParams.set('currency', 'usd');
  if (marker) url.searchParams.set('marker', marker);

  return url.toString();
}

export type HotelSearch = {
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  limit: number;
  marker: string | null;
};

/** The unpriced fallback: real stays from the places directory. */
async function listingsFrom(
  centre: { lat: number; lon: number },
  search: HotelSearch,
): Promise<Hotel[]> {
  const places = await placesGet<Place[] | { error?: string }>('/radius', {
    lat: centre.lat,
    lon: centre.lon,
    radius: RADIUS_METRES,
    kinds: 'accomodations',
    format: 'json',
    limit: FETCH_LIMIT,
  });

  if (!Array.isArray(places)) return [];

  return places
    .filter((place) => place.xid && (place.name ?? '').trim() && isLodging(place))
    // Most notable first, which is the order the explorer already trusts.
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
    .slice(0, search.limit)
    .map((place) => ({
      id: place.xid!,
      name: place.name!.trim(),
      location: search.destination,
      category: describeKind(place),
      // The directory carries no guest ratings. Zero reads as "unrated" to the
      // card, which is true, rather than as a bad score.
      rating: 0,
      reviews: 0,
      pricePerNight: null,
      image: '',
      // The directory does give a point, even though it gives no price.
      coordinates:
        typeof place.point?.lat === 'number' && typeof place.point?.lon === 'number'
          ? { lat: place.point.lat, lng: place.point.lon }
          : undefined,
      bookingUrl: hotelBookingUrl(
        place.name!.trim(),
        search.destination,
        search.checkIn,
        search.checkOut,
        search.guests,
        search.marker,
      ),
    }));
}

export async function searchHotels(search: HotelSearch): Promise<Hotel[]> {
  // OpenTripMap places the destination in both paths. LiteAPI searches by
  // coordinate rather than by city name, which avoids having to agree with it
  // on how a city is spelled.
  const centre = await locate(search.destination);
  if (!centre) return [];

  if (isLiteApiConfigured()) {
    const stays = await searchStays({
      lat: centre.lat,
      lon: centre.lon,
      checkIn: search.checkIn,
      checkOut: search.checkOut,
      guests: search.guests,
      limit: search.limit,
    });

    // Empty means the provider had nothing here, or was unreachable. Either
    // way the fallback below still has stays to show, so neither is fatal.
    if (stays.length > 0) {
      return stays.map((stay) => ({
        id: stay.id,
        name: stay.name,
        location: stay.address || search.destination,
        // The catalogue does not classify the property the way OpenTripMap's
        // tags do, and "Hotel" is true of nearly all of it.
        category: 'Hotel',
        rating: stay.rating,
        reviews: stay.reviews,
        pricePerNight: stay.pricePerNight,
        image: stay.image,
        coordinates: stay.coordinates,
        bookingUrl: hotelBookingUrl(
          stay.name,
          search.destination,
          search.checkIn,
          search.checkOut,
          search.guests,
          search.marker,
        ),
      }));
    }
  }

  return listingsFrom(centre, search);
}
