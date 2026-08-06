import type {
  BookingContext,
  FlightSearchQuery,
  Partner,
  PartnerCategory,
  PartnerLinkBuilderId,
} from '../../types/travel.types';
import { airportService } from '../../services/airport.service';
import { formatDateRange, formatShortDate } from '../../utils/date';

/**
 * Outbound partner links — DESIGN_SPEC Screen 7.
 *
 * Stage 1 cannot query a partner: none of them send `Access-Control-Allow-Origin`,
 * and their booking APIs want a signed contract and a server holding the key.
 * What it can do is hand the reader over with the search already filled in, so
 * they arrive at results rather than at an empty form.
 *
 * Every builder returns `null` when the trip is not described well enough for
 * the search it would produce, and `buildPartnerUrl` falls back to the
 * partner's home page. A half-filled search URL is worse than no search at
 * all: partners reject or silently reinterpret them.
 *
 * Pure — no React, no services, no network.
 */

/** Which query parameter each partner tracks affiliates with. */
const AFFILIATE_PARAM: Record<PartnerLinkBuilderId, string> = {
  expedia: 'affcid',
  booking: 'aid',
  trip: 'Allianceid',
  getyourguide: 'partner_id',
};

/**
 * Read at call time rather than hoisted into a constant, so a test can stub
 * the environment and so a build without ids still tree-shakes to empty.
 */
function affiliateId(builder: PartnerLinkBuilderId): string {
  switch (builder) {
    case 'expedia':
      return import.meta.env.VITE_EXPEDIA_AFFILIATE_ID ?? '';
    case 'booking':
      return import.meta.env.VITE_BOOKING_AFFILIATE_ID ?? '';
    case 'trip':
      return import.meta.env.VITE_TRIP_AFFILIATE_ID ?? '';
    case 'getyourguide':
      return import.meta.env.VITE_GETYOURGUIDE_AFFILIATE_ID ?? '';
  }
}

const EMPTY_CONTEXT: BookingContext = {
  tripType: 'round-trip',
  originCode: null,
  destinationCode: null,
  destinationCity: null,
  destinationCountry: null,
  departDate: null,
  returnDate: null,
  travellers: 1,
};

/**
 * The last flight search, as the booking screen needs it.
 *
 * That search is the only place the app records an *origin* — a trip knows
 * where you are going but not where you are leaving from — which is why it is
 * the source rather than the active trip.
 */
export function toBookingContext(query: FlightSearchQuery | null): BookingContext {
  if (!query) return EMPTY_CONTEXT;

  return {
    tripType: query.tripType,
    originCode: query.from || null,
    destinationCode: query.to || null,
    /*
     * Resolved locally, and it has to be: this function is pure and
     * synchronous. `airportService.resolve` looks in the airports the reader
     * has picked before — which always includes this one, because picking it
     * is how it got into the search — then the built-in eight.
     */
    destinationCity: airportService.resolve(query.to)?.city ?? null,
    // A flight search records no country; only a trip supplies one.
    destinationCountry: null,
    departDate: query.departDate || null,
    returnDate: query.returnDate || null,
    travellers: query.travellers > 0 ? query.travellers : 1,
  };
}

/** "JFK → DPS · May 20 - May 28 · 2 travellers", or null when nothing is known. */
export function describeBookingContext(context: BookingContext): string | null {
  const parts: string[] = [];

  if (context.originCode && context.destinationCode) {
    parts.push(`${context.originCode} → ${context.destinationCode}`);
  } else if (context.destinationCity) {
    parts.push(context.destinationCity);
  }

  if (context.departDate) {
    parts.push(
      context.returnDate
        ? formatDateRange(context.departDate, context.returnDate)
        : formatShortDate(context.departDate),
    );
  }

  if (parts.length === 0) return null;

  parts.push(`${context.travellers} ${context.travellers === 1 ? 'traveller' : 'travellers'}`);

  return parts.join(' · ');
}

/**
 * Where "View Deals" should go for this partner under this tab.
 *
 * Always returns a usable URL — the partner's home page when the trip is too
 * vague to search for.
 */
export function buildPartnerUrl(
  partner: Partner,
  category: PartnerCategory,
  context: BookingContext,
): string {
  const search = searchUrl(partner.linkBuilder, category, context);
  return withAffiliate(search ?? partner.homeUrl, partner.linkBuilder);
}

function searchUrl(
  builder: PartnerLinkBuilderId,
  category: PartnerCategory,
  context: BookingContext,
): string | null {
  switch (builder) {
    case 'expedia':
      if (category === 'flights') return expediaFlights(context);
      if (category === 'hotels') return expediaHotels(context);
      return null;
    case 'trip':
      // Trip.com's hotel list keys off an internal numeric city id we have no
      // way to resolve, so hotels fall through to their home page.
      return category === 'flights' ? tripFlights(context) : null;
    case 'booking':
      return category === 'hotels' ? bookingHotels(context) : null;
    case 'getyourguide':
      return category === 'activities' ? getYourGuideActivities(context) : null;
  }
}

/* ------------------------------------------------------------------ builders */

function expediaFlights(context: BookingContext): string | null {
  const { originCode, destinationCode, departDate } = context;
  if (!originCode || !destinationCode || !departDate) return null;

  const returnDate = roundTripReturn(context);

  // `TANYT` is Expedia's "any time of day" marker on a leg.
  const leg = (from: string, to: string, date: string) =>
    `from:${from},to:${to},departure:${usDate(date)}TANYT`;

  const params: [string, string][] = [['leg1', leg(originCode, destinationCode, departDate)]];

  if (returnDate) {
    params.push(['leg2', leg(destinationCode, originCode, returnDate)]);
  }

  params.push(
    ['trip', returnDate ? 'roundtrip' : 'oneway'],
    ['passengers', `adults:${context.travellers}`],
    ['mode', 'search'],
  );

  return `https://www.expedia.com/Flights-Search?${new URLSearchParams(params)}`;
}

function expediaHotels(context: BookingContext): string | null {
  const { destinationCity, departDate, returnDate } = context;
  if (!destinationCity || !departDate || !returnDate) return null;

  const params = new URLSearchParams({
    destination: destinationCity,
    startDate: departDate,
    endDate: returnDate,
    adults: String(context.travellers),
  });

  return `https://www.expedia.com/Hotel-Search?${params}`;
}

function tripFlights(context: BookingContext): string | null {
  const { originCode, destinationCode, departDate } = context;
  if (!originCode || !destinationCode || !departDate) return null;

  const returnDate = roundTripReturn(context);

  const params: [string, string][] = [
    ['dcity', originCode.toLowerCase()],
    ['acity', destinationCode.toLowerCase()],
    ['ddate', departDate],
  ];

  if (returnDate) params.push(['rdate', returnDate]);

  params.push(
    ['triptype', returnDate ? 'rt' : 'ow'],
    ['class', 'y'],
    ['quantity', String(context.travellers)],
    ['locale', 'en-US'],
    ['curr', 'USD'],
  );

  return `https://us.trip.com/flights/showfarefirst?${new URLSearchParams(params)}`;
}

function bookingHotels(context: BookingContext): string | null {
  const { destinationCity, departDate, returnDate } = context;
  if (!destinationCity || !departDate || !returnDate) return null;

  const params = new URLSearchParams({
    ss: destinationCity,
    checkin: departDate,
    checkout: returnDate,
    group_adults: String(context.travellers),
    group_children: '0',
    no_rooms: '1',
  });

  return `https://www.booking.com/searchresults.html?${params}`;
}

function getYourGuideActivities(context: BookingContext): string | null {
  if (!context.destinationCity) return null;

  return `https://www.getyourguide.com/s/?${new URLSearchParams({ q: context.destinationCity })}`;
}

/**
 * Where to book one named attraction, rather than the whole city.
 *
 * The activity listings come from OpenTripMap, which knows where places are
 * but sells nothing — there is no per-place booking URL to carry, the way a
 * fare or a stay has one. So the link is a search for that place by name at
 * the partner who does sell tours, which is as specific as this can honestly
 * get. The city goes in the query too: "Cascade" alone finds the wrong ones.
 *
 * Exported for the Activities tab; `buildPartnerUrl` still answers for the
 * partner cards underneath it.
 */
export function buildActivityUrl(title: string, city: string | null): string {
  const query = [title.trim(), city?.trim()].filter(Boolean).join(' ');
  const url = `https://www.getyourguide.com/s/?${new URLSearchParams({ q: query })}`;

  return withAffiliate(url, 'getyourguide');
}

/* ------------------------------------------------------------------- helpers */

/**
 * The return date, but only for a search that really is a return.
 *
 * A multi-city query carries one leg — the form says as much — so it books as
 * a one-way rather than inventing a return the reader never asked for.
 */
function roundTripReturn(context: BookingContext): string | null {
  return context.tripType === 'round-trip' ? context.returnDate : null;
}

/** Expedia dates are `M/D/YYYY`; everything else here takes ISO unchanged. */
function usDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;

  return `${Number(month)}/${Number(day)}/${year}`;
}

function withAffiliate(url: string, builder: PartnerLinkBuilderId): string {
  const id = affiliateId(builder).trim();
  if (!id) return url;

  const target = new URL(url);
  target.searchParams.set(AFFILIATE_PARAM[builder], id);

  return target.toString();
}
