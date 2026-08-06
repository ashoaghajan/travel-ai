import { useEffect, useId, useRef, useState } from 'react';
import type { Airport, BookingContext } from '../../../types/travel.types';
import { AirportField } from '../../flights/components/AirportField';
import { airportService } from '../../../services/airport.service';
import { countryService } from '../../../services/country.service';
import { geocodeService } from '../../../services/geocode.service';
import { formatShortDate } from '../../../utils/date';
import styles from './FlightLegs.module.css';

/**
 * Which half of the journey the reader is choosing.
 *
 * Two one-way fares rather than one round trip, deliberately. A round-trip
 * quote is a single number covering both flights, and the app used to halve it
 * to fill two booking rows — but the halves are a fiction: the same AUH↔EVN
 * journey that bundles at $363 is $177 out and $220 back. Searching each leg
 * separately is the only way the two rows can carry what either flight
 * actually costs, and it lets the reader take a different airline, or a
 * different day, for the way home.
 *
 * The cost of the honesty is real and worth knowing: booked apart, those two
 * fares come to $397 rather than $363.
 */
export type FlightLeg = 'outbound' | 'return';

export type FlightLegSelection = {
  leg: FlightLeg;
  /** Where this leg leaves from and lands, already swapped for the return. */
  from: string;
  to: string;
  date: string;
};

export type FlightLegsProps = {
  context: BookingContext;
  value: FlightLegSelection;
  onChange: (next: FlightLegSelection) => void;
  className?: string;
};

const LEGS: { id: FlightLeg; label: string }[] = [
  { id: 'outbound', label: 'Outbound' },
  { id: 'return', label: 'Return' },
];

/**
 * Origin, destination and which leg — the three things a fare search needs.
 *
 * The two ends are not symmetrical, and the fields say so. A destination is a
 * closed choice: a trip to Armenia is flown into an Armenian airport, so that
 * field is a short list of exactly those, nearest the destination first. An
 * origin is an open one — the app has no idea where the reader lives, and a
 * trip does not record it — so that field stays a search over every airport.
 */
export function FlightLegs({ context, value, onChange, className }: FlightLegsProps) {
  const legFieldId = useId();
  const [destinations, setDestinations] = useState<Airport[]>([]);

  /*
   * The current selection, reachable from the loading effect without making
   * that effect depend on it — re-running the country lookup every time a
   * field changed would refetch the airport list on each keystroke.
   */
  const onChangeRef = useRef({ destination: '', pick: (_code: string) => {} });

  /*
   * The destination country's airports, nearest the trip's own city first.
   *
   * Two lookups feed it: the country name the trip records has to become an
   * ISO code, and the city has to become a point. Either can fail — an unknown
   * country, a city the geocoder does not hold — and each failure only costs
   * precision: no code means no shortlist and the free search stands in, no
   * point means the country's airports in alphabetical order.
   */
  useEffect(() => {
    const country = context.destinationCountry;
    if (!country) {
      setDestinations([]);
      return;
    }

    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const countries = await countryService.getCountries();
        const match = countries.find(
          (candidate) => candidate.name.toLowerCase() === country.toLowerCase(),
        );
        if (!match || !active) return;

        const point = context.destinationCity
          ? await geocodeService.locate(context.destinationCity, match.code)
          : null;

        const found = await airportService.inCountry(
          match.code,
          point ? { lat: point.lat, lon: point.lng } : null,
          controller.signal,
        );

        if (!active) return;
        setDestinations(found);

        /*
         * Default to the nearest one.
         *
         * `found` is already ordered by distance from the trip's own city, so
         * the first is the closest airport to where the reader is going. This
         * also covers the case where nothing had chosen a destination at all —
         * a trip records a city, not an airport, and without this the fare
         * search sits idle waiting for a code nobody was asked for.
         */
        const current = onChangeRef.current.destination;
        if (found.length > 0 && !found.some((airport) => airport.code === current)) {
          onChangeRef.current.pick(found[0].code);
        }
      } catch {
        // Every failure here is a missing convenience, not a broken screen.
        if (active) setDestinations([]);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [context.destinationCountry, context.destinationCity]);

  /*
   * The reader picks one origin and one destination; the leg decides which way
   * round they go. Storing them as `from`/`to` already swapped would make the
   * return leg's fields read backwards the moment it was selected.
   */
  const origin = value.leg === 'outbound' ? value.from : value.to;
  const destination = value.leg === 'outbound' ? value.to : value.from;

  onChangeRef.current = {
    destination,
    pick: (code: string) => select(value.leg, origin, code),
  };

  function select(leg: FlightLeg, nextOrigin: string, nextDestination: string) {
    const outbound = leg === 'outbound';

    onChange({
      leg,
      from: outbound ? nextOrigin : nextDestination,
      to: outbound ? nextDestination : nextOrigin,
      // Out on the day the trip starts, back on the day it ends.
      date: (outbound ? context.departDate : context.returnDate) ?? '',
    });
  }

  const legDate = value.date ? formatShortDate(value.date) : null;
  const outbound = value.leg === 'outbound';

  /** Wherever the reader is travelling from — open, because nothing records it. */
  const originField = (
    <AirportField
      key="origin"
      label={outbound ? 'From' : 'To'}
      value={origin}
      onChange={(code) => select(value.leg, code, destination)}
      className={styles.field}
    />
  );

  /*
   * The trip's own airport — a closed list when the country resolves, the open
   * search otherwise, which is better than an empty picker.
   */
  const destinationField =
    destinations.length > 0 ? (
      <label key="destination" className={styles.field}>
        <span className={styles.label}>{outbound ? 'To' : 'From'}</span>
        <select
          className={styles.control}
          value={destination}
          onChange={(event) => select(value.leg, origin, event.target.value)}
        >
          {destinations.map((airport) => (
            <option key={airport.code} value={airport.code}>
              {airport.code} · {airport.city}
            </option>
          ))}
        </select>
      </label>
    ) : (
      <AirportField
        key="destination"
        label={outbound ? 'To' : 'From'}
        value={destination}
        onChange={(code) => select(value.leg, origin, code)}
        className={styles.field}
      />
    );

  return (
    <div className={className}>
      <div className={styles.legs} role="group" aria-label="Which flight">
        {LEGS.map((leg) => (
          <button
            key={leg.id}
            type="button"
            id={`${legFieldId}-${leg.id}`}
            className={styles.leg}
            aria-pressed={value.leg === leg.id}
            onClick={() => select(leg.id, origin, destination)}
          >
            {leg.label}
          </button>
        ))}
      </div>

      {/*
        Read in the direction of travel.
        The two fields keep their jobs — one is the open search for wherever
        the reader is coming from, the other the trip's own country — but they
        swap places on the return, because that is the leg where you fly *from*
        the destination. Fixing the order instead would put "From: Abu Dhabi"
        above a flight that leaves Yerevan.
      */}
      <div className={styles.fields}>
        {value.leg === 'return' ? destinationField : originField}
        {value.leg === 'return' ? originField : destinationField}
      </div>

      {legDate ? (
        <p className={styles.date}>
          {value.leg === 'outbound' ? 'Departing' : 'Returning'} {legDate}
          {destinations.length > 0 ? ` · airports in ${context.destinationCountry}` : ''}
        </p>
      ) : null}
    </div>
  );
}
