import type { HotelResults, HotelSearchQuery } from '../types/travel.types';
import type { LatLng } from '../types/trip.types';
import { MOCK_HOTELS } from '../mock/hotels';
import { lodgingImage } from '../assets/lodging-images';
import { http } from './http';

/**
 * Hotel search.
 *
 * The same shape as `flight.service.ts`, deliberately — see the note there
 * about why the return type gained an envelope.
 *
 * Stays are on the sample path for now and will stay there longer than
 * flights: Travelpayouts gates its hotel data behind a separate application,
 * where the flight endpoint needs only the profile token. Nothing here
 * anticipates that — `GET /api/hotels/search` either answers or it does not,
 * and the fallback is the same either way. When the approval lands, the route
 * appears and this file starts getting live prices without being touched.
 */

/** Only on the sample path, so the list still exercises its skeletons. */
const SAMPLE_DELAY_MS = 700;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function sampleHotels(query: HotelSearchQuery): Promise<HotelResults> {
  await delay(SAMPLE_DELAY_MS);

  return {
    results: MOCK_HOTELS.map((hotel) => ({ ...hotel, location: query.destination })),
    source: 'sample',
    quotedAt: null,
  };
}

/**
 * Give every stay a picture.
 *
 * The listings directory has no photographs, so the server sends none and the
 * stand-in is chosen here — the images are bundled client assets the server
 * cannot reference. `activity.service.ts` fills its own the same way.
 */
function withImages(results: HotelResults): HotelResults {
  return {
    ...results,
    results: results.results.map((hotel) =>
      hotel.image ? hotel : { ...hotel, image: lodgingImage(hotel.id) },
    ),
  };
}

export const hotelService = {
  async searchHotels(query: HotelSearchQuery): Promise<HotelResults> {
    try {
      return withImages(
        await http.get<HotelResults>('/hotels/search', {
          query: {
            destination: query.destination,
            checkIn: query.checkIn,
            checkOut: query.checkOut,
            guests: query.guests,
          },
        }),
      );
    } catch {
      return sampleHotels(query);
    }
  },
};

/**
 * Where saved stays are, by catalogue id.
 *
 * For the trip map, and only for stays saved before the catalogue's own
 * coordinates were kept: their names cannot be geocoded, so the id is the only
 * thing that can place them. Empty when the API cannot answer, which leaves
 * those rows reading "Not on the map" exactly as they did.
 */
export async function locateHotels(ids: string[]): Promise<Map<string, LatLng>> {
  const wanted = ids.map((id) => id.trim()).filter(Boolean);
  if (wanted.length === 0) return new Map();

  try {
    const found = await http.get<Record<string, { lat: number; lng: number }>>('/hotels/locate', {
      query: { ids: wanted.join(',') },
    });

    return new Map(Object.entries(found));
  } catch {
    return new Map();
  }
}

