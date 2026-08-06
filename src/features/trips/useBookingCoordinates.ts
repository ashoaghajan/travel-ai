import { useEffect, useMemo, useState } from 'react';
import type { Booking } from '../../types/booking.types';
import type { LatLng } from '../../types/trip.types';
import { geocodeService } from '../../services/geocode.service';
import { countryService } from '../../services/country.service';
import { airportService } from '../../services/airport.service';
import { locateHotels } from '../../services/hotel.service';

/**
 * Places a pin for each hotel and activity booked on a trip.
 *
 * Two sources, in order. An attraction attached from the explorer already
 * carries a point — OpenTripMap knew exactly where it was, and
 * `activityToBookingDraft` copies it. A hotel never does: the listings come
 * from a places directory that gives no coordinates at all, so its name is
 * geocoded the way a day's destination already is.
 *
 * **Nothing here writes to the booking.** A write would move `updatedAt` on a
 * record the reader may be editing in the tab next door, to cache something
 * `geocodeService` already caches on its own.
 */

/** Kinds that are one place. A flight is handled separately — see below. */
const MAPPABLE = new Set<Booking['kind']>(['hotel', 'activity', 'ticket']);

export type LocatedBooking = {
  id: string;
  label: string;
  kind: Booking['kind'];
  coordinates: LatLng;
};

/**
 * The airports a trip's flights touch.
 *
 * Their own list rather than more `LocatedBooking`s: a flight is not one place,
 * and two legs of a return trip name the same pair of airports, so they are
 * deduped by code before anything is drawn. Without them a trip's map showed
 * the hotel and the museums but not the way in or out.
 */
export type LocatedAirport = {
  code: string;
  label: string;
  coordinates: LatLng;
};

export type BookingCoordinatesState = {
  located: LocatedBooking[];
  airports: LocatedAirport[];
  /** Booked places with no point to be had — named, so the map can say so. */
  unlocated: Booking[];
  isLoading: boolean;
};

export function useBookingCoordinates(
  bookings: Booking[],
  countryName: string | null,
  /** Narrows a geocode: "Hotel Indigo" alone matches a chain, not a building. */
  city: string | null,
): BookingCoordinatesState {
  const [geocoded, setGeocoded] = useState<Map<string, LatLng | null>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [countryCode, setCountryCode] = useState<string | undefined>(undefined);
  /** Bumped when an airport lookup lands, so the synchronous read re-runs. */
  const [resolvedAt, setResolvedAt] = useState(0);
  /** Points fetched by catalogue id, for stays that carry none of their own. */
  const [stayPoints, setStayPoints] = useState<Map<string, LatLng>>(new Map());

  // The ISO code disambiguates, exactly as it does for the itinerary stops.
  useEffect(() => {
    if (!countryName) {
      setCountryCode(undefined);
      return;
    }

    let active = true;

    countryService
      .getCountries()
      .then((countries) => {
        if (active) setCountryCode(countryService.findByName(countries, countryName)?.code);
      })
      .catch(() => {
        // Precision, not the lookup — a miss still geocodes by name.
      });

    return () => {
      active = false;
    };
  }, [countryName]);

  const mappable = useMemo(
    () => bookings.filter((booking) => MAPPABLE.has(booking.kind) && booking.title.trim()),
    [bookings],
  );

  /** Only the ones with no point of their own have to be looked up. */
  const needed = useMemo(
    () =>
      mappable
        .filter((booking) => !booking.source?.coordinates)
        .map((booking) => searchName(booking, city)),
    [mappable, city],
  );

  // Keyed on the names themselves: the array is rebuilt every render.
  const key = needed.join('|');

  useEffect(() => {
    if (needed.length === 0) return;

    let active = true;
    setIsLoading(true);

    geocodeService
      .locateAll(needed, countryCode)
      .then((found) => {
        if (!active) return;

        setGeocoded((current) => {
          const next = new Map(current);
          for (const [name, point] of found) {
            next.set(name, point ? { lat: point.lat, lng: point.lng } : null);
          }
          return next;
        });
      })
      .catch(() => {
        // A missing key is already reported by the itinerary stops' own hook;
        // saying it twice on one screen helps nobody.
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, countryCode]);

  /*
   * The airports the trip's flights touch, resolved from the codes stored on
   * each flight booking.
   *
   * `airportService.resolve` is synchronous and answers from the airports the
   * reader has already picked, which always includes the ones they searched —
   * picking them is how they got there. Anything it does not know is fetched
   * once, by code.
   */
  const routeCodes = useMemo(() => {
    const codes = new Set<string>();

    for (const booking of bookings) {
      if (booking.kind !== 'flight') continue;

      const route = booking.source?.route ?? routeFromTitle(booking.title);
      if (route?.from) codes.add(route.from.toUpperCase());
      if (route?.to) codes.add(route.to.toUpperCase());
    }

    return [...codes].sort();
  }, [bookings]);

  const codeKey = routeCodes.join(',');

  useEffect(() => {
    const missing = routeCodes.filter((code) => !airportService.resolve(code)?.coordinates);
    if (missing.length === 0) return;

    let active = true;

    airportService
      .byCode(missing)
      .then((found) => {
        // Remembering them is what makes the next render synchronous, and it
        // is the same store the picker fills.
        if (active) for (const airport of found) airportService.remember(airport);
        if (active) setResolvedAt(Date.now());
      })
      .catch(() => {
        // A map without airport pins, not a broken map.
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeKey]);

  /*
   * Stays saved before the catalogue's coordinates were kept.
   *
   * Their names cannot be geocoded — the geocoder is a gazetteer of towns, not
   * of buildings — so they are placed by catalogue id or not at all.
   */
  const staleStayIds = useMemo(
    () =>
      mappable
        .filter(
          (booking) =>
            booking.kind === 'hotel' &&
            !booking.source?.coordinates &&
            booking.source?.provider === 'hotels' &&
            booking.source?.resultId,
        )
        .map((booking) => booking.source!.resultId)
        .sort(),
    [mappable],
  );

  const stayIdKey = staleStayIds.join(',');

  useEffect(() => {
    if (staleStayIds.length === 0) return;

    let active = true;

    locateHotels(staleStayIds)
      .then((found) => {
        if (!active || found.size === 0) return;

        setStayPoints((current) => {
          const next = new Map(current);
          for (const [id, point] of found) next.set(id, point);
          return next;
        });
      })
      .catch(() => {
        // "Not on the map", which is what these rows said already.
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayIdKey]);

  const airports = useMemo(() => {
    void resolvedAt;

    return routeCodes.flatMap((code) => {
      const airport = airportService.resolve(code);
      if (!airport?.coordinates) return [];

      return [
        {
          code,
          label: `${code} · ${airport.city}`,
          coordinates: { lat: airport.coordinates.lat, lng: airport.coordinates.lon },
        },
      ];
    });
  }, [routeCodes, resolvedAt]);

  return useMemo(() => {
    const located: LocatedBooking[] = [];
    const unlocated: Booking[] = [];

    for (const booking of mappable) {
      const own =
        booking.source?.coordinates ??
        (booking.source?.resultId ? stayPoints.get(booking.source.resultId) : undefined);
      const point = own ?? geocoded.get(searchName(booking, city));

      if (point) {
        located.push({
          id: booking.id,
          label: booking.title,
          kind: booking.kind,
          coordinates: point,
        });
      } else {
        unlocated.push(booking);
      }
    }

    return { located, airports, unlocated, isLoading };
  }, [mappable, geocoded, city, airports, stayPoints, isLoading]);
}

/**
 * The route read back out of a flight's title, for rows saved before it was
 * recorded.
 *
 * A fallback only. The title is editable, so this is deliberately strict — two
 * three-letter codes either side of the arrow the mapper writes, or nothing.
 * A reader who renamed the row simply loses its pins, which is what they had
 * before this existed.
 */
function routeFromTitle(title: string): { from: string; to: string } | null {
  const match = /\b([A-Z]{3})\s*→\s*([A-Z]{3})\b/.exec(title);

  return match ? { from: match[1], to: match[2] } : null;
}

/** What to geocode: the booking's name, narrowed by the trip's city. */
function searchName(booking: Booking, city: string | null): string {
  const title = booking.title.trim();
  const place = city?.trim();

  return place && !title.toLowerCase().includes(place.toLowerCase())
    ? `${title} ${place}`
    : title;
}
