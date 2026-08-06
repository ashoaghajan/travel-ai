import { useState } from 'react';
import { Button } from '../../../components/common/Button';
import { Card } from '../../../components/common/Card';
import { EmptyState } from '../../../components/common/EmptyState';
import { IconButton } from '../../../components/common/IconButton';
import {
  ExternalLinkIcon,
  PlusIcon,
  TicketIcon,
  TrashIcon,
} from '../../../components/common/icons';
import type { Booking, BookingKind, BookingPatch } from '../../../types/booking.types';
import type { Trip } from '../../../types/trip.types';
import { BookingBrowser } from '../../bookings/components/BookingBrowser';
import { resolveBookingContext } from '../../bookings/booking.context';
import { searchService } from '../../../services/search.service';
import type { PartnerCategory } from '../../../types/travel.types';
import { bookingStore, useTripBookings } from '../../../store/booking.store';
import {
  bookingAmount,
  bookingKindLabel,
  describeBookingAmount,
  groupBookingsByDate,
  stayPriceBasis,
} from '../../../utils/booking';
import type { TripPricing } from '../../../utils/booking';
import { tripPricing, tripTotal } from '../../../utils/trip';
import { formatCurrency } from '../../../utils/currency';
import { cx } from '../../../utils/cx';
import { BOOKING_AVATARS } from '../../../assets/booking-avatars';
import styles from './TripBookings.module.css';

/** The manual row, for something booked outside this app. */
const MANUAL_KINDS: BookingKind[] = ['hotel', 'ticket', 'activity'];

const REMOVE_ERROR = 'We could not remove that. Your browser storage may be full or blocked.';

export type TripBookingsProps = {
  trip: Trip;
};

/**
 * What is booked for this trip.
 *
 * Deliberately outside the page's edit session. A booking is a fact about the
 * world — a flight that is paid for does not become unpaid because someone
 * pressed "Cancel Changes" — so every action here writes immediately, the way
 * `AddToTripDialog` does from the explorer.
 *
 * Rows arrive from two directions: attached from a search on `/bookings`,
 * which is where the photograph and the partner link come from, or typed in
 * by hand for the plenty that gets booked outside this app.
 */
export function TripBookings({ trip }: TripBookingsProps) {
  const tripId = trip.id;
  const bookings = useTripBookings(tripId);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which catalogue the browser below is showing.
  const [browseTab, setBrowseTab] = useState<PartnerCategory>('hotels');
  // Which kind to add by hand, revealed only when asked for.
  const [isAddingManually, setIsAddingManually] = useState(false);

  const groups = groupBookingsByDate(bookings);
  // What the stay and the party actually come to, not a sum of the quoted
  // figures — a hotel's price is one night's, a fare's is one seat's.
  const { amount, priced, counted, hasSample } = tripTotal(trip, bookings);
  /*
   * How many of the priced rows carry a guess rather than a quote.
   *
   * The page header already says "estimated" for exactly this reason — the
   * total here was the same number with no qualifier at all, which read as the
   * firmer of the two claims while being the looser one. `hasSample` says
   * whether any are; this says how many, which is what a reader can act on.
   */
  const estimates = bookings.filter(
    (booking) => booking.price !== undefined && booking.source?.priceSource === 'sample',
  ).length;
  // Shared with every row, so each line and the total are built the same way.
  const pricing = tripPricing(trip);

  /**
   * A write that takes the row out of action while it lands — remove, or
   * moving between booked and shortlisted.
   */
  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);

    try {
      await action();
    } catch {
      setError(REMOVE_ERROR);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * A write from a field the reader is typing in.
   *
   * Deliberately does *not* set `busyId`. These save on every keystroke, and
   * disabling the input until each write resolves would take the focus away
   * mid-word — the field would fight whoever is using it.
   */
  async function edit(action: () => Promise<unknown>) {
    setError(null);

    try {
      await action();
    } catch {
      setError(REMOVE_ERROR);
    }
  }

  async function addManual(kind: BookingKind) {
    setError(null);

    try {
      await bookingStore.create({
        tripId,
        kind,
        status: 'booked',
        title: '',
        date: '',
        reference: '',
      });
    } catch {
      setError(REMOVE_ERROR);
    }
  }

  /*
   * What the browser searches. The trip supplies the destination, the dates
   * and the party; only the origin has to come from the last flight search,
   * because a trip knows where you are going but not where you leave from.
   */
  const resolved = resolveBookingContext(
    [trip],
    trip.id,
    searchService.getLastFlightSearch(),
    trip.id,
  );

  const browser = (
    <section className={styles.browse} aria-labelledby="trip-browse-heading">
      <h3 id="trip-browse-heading" className={styles.browseTitle}>
        Add to this trip
      </h3>
      {/* The same list `/bookings` shows, inline rather than behind a modal —
          a catalogue is for scrolling and comparing. */}
      <BookingBrowser
        context={resolved.context}
        tripId={trip.id}
        activeTab={browseTab}
        onTabChange={setBrowseTab}
        idPrefix="trip-browse"
      />

      {/*
        One button rather than three.
        Adding by hand is the uncommon path — most rows arrive from the
        catalogue above — and three buttons of it under every list took more
        room than the case deserves. The kinds are still one click away.
      */}
      <div className={styles.addRow}>
        <span className={styles.manualLabel}>Booked somewhere else?</span>
        <Button
          type="button"
          variant="secondary"
          size="md"
          leadingIcon={<PlusIcon size={16} />}
          onClick={() => setIsAddingManually((open) => !open)}
          aria-expanded={isAddingManually}
        >
          Add by hand
        </Button>

        {isAddingManually ? (
          <div className={styles.manualKinds} role="group" aria-label="What did you book?">
            {MANUAL_KINDS.map((kind) => (
              <Button
                key={kind}
                type="button"
                variant="secondary"
                size="md"
                onClick={() => {
                  setIsAddingManually(false);
                  void addManual(kind);
                }}
              >
                {bookingKindLabel(kind)}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );

  if (bookings.length === 0) {
    return (
      <>
      <EmptyState
        icon={<TicketIcon size={26} />}
        title="Nothing booked yet"
        description="Find a flight, a place to stay or something to do, and it will be listed here with its confirmation."
        action={
          <>
            <Button to={`/bookings?tripId=${tripId}`} variant="secondary" size="md">
              Open the booking screen
            </Button>
          </>
        }
      />
      {browser}
      </>
    );
  }

  return (
    <div className={styles.bookings}>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.summary}>
        <p className={styles.count}>
          {counted} {counted === 1 ? 'booking' : 'bookings'}
          {priced > 0 ? (
            <>
              {/* Labelled, because a bold figure sitting beside a booking
                  count otherwise reads as the price of one of them. */}
              {' · Trip total '}
              <strong className={styles.total}>{formatCurrency(amount)}</strong>
              {/* What the figure is made of, before what is missing from it —
                  a total built on the planner's guesses must not read as money
                  committed, which is the same claim the header makes. */}
              {hasSample
                ? ` · ${estimates} ${estimates === 1 ? 'is an estimate' : 'are estimates'}`
                : null}
              {/* Says what is *missing* from it. A booking with no price
                  recorded is not free and must not read as included. */}
              {priced < counted
                ? ` · ${counted - priced} ${counted - priced === 1 ? 'has' : 'have'} no price yet`
                : null}
            </>
          ) : (
            ' · no prices recorded yet'
          )}
        </p>
        <Button to={`/bookings?tripId=${tripId}`} variant="secondary" size="md">
          Find more
        </Button>
      </div>

      {groups.map((group) => (
        <section key={group.date || 'undated'} className={styles.group}>
          <h3 className={styles.groupLabel}>{group.label}</h3>

          <ul className={styles.list}>
            {group.bookings.map((booking) => (
              <li key={booking.id}>
                <BookingRow
                  booking={booking}
                  busy={busyId === booking.id}
                  pricing={pricing}
                  earliest={trip.startDate || undefined}
                  latest={trip.endDate || undefined}
                  onEdit={(patch) => void edit(() => bookingStore.update(booking.id, patch))}
                  onToggleBooked={() =>
                    void run(booking.id, () =>
                      bookingStore.setStatus(
                        booking.id,
                        booking.status === 'booked' ? 'saved' : 'booked',
                      ),
                    )
                  }
                  onRemove={() => void run(booking.id, () => bookingStore.remove(booking.id))}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {browser}
    </div>
  );
}

function BookingRow({
  booking,
  busy,
  pricing,
  earliest,
  latest,
  onEdit,
  onToggleBooked,
  onRemove,
}: {
  booking: Booking;
  busy: boolean;
  /** Nights and party, for turning a unit price into what the line costs. */
  pricing: TripPricing;
  /** The trip's own days — a booking on it cannot be dated outside them. */
  earliest?: string;
  latest?: string;
  onEdit: (patch: BookingPatch) => void;
  onToggleBooked: () => void;
  onRemove: () => void;
}) {
  const name = booking.title || `this ${bookingKindLabel(booking.kind).toLowerCase()}`;
  const link = booking.url || booking.source?.bookingUrl;
  // An invented price must never be presented as what something costs.
  const isSamplePrice = booking.source?.priceSource === 'sample';

  const amount = bookingAmount(booking, pricing);
  const workings = describeBookingAmount(booking, pricing);

  const isStay = booking.kind === 'hotel';

  /**
   * A date edit that keeps the price in step with it.
   *
   * Moving a stay's check-out is the reader saying how long they are there,
   * and the cost has to follow — three nights of a $116 room is $348 whatever
   * it was when the rate was captured. Any other kind is just a date.
   */
  function editStayDate(patch: { date?: string; endDate?: string }) {
    if (!isStay || booking.price === undefined) {
      onEdit(patch);
      return;
    }

    const checkIn = patch.date ?? booking.date;
    const checkOut = patch.endDate ?? booking.endDate;

    onEdit({ ...patch, priceBasis: stayPriceBasis(checkIn, checkOut) });
  }

  return (
    <Card padding="md" elevation="soft" className={styles.card}>
      {/* Always a picture, never a bare glyph: a 40px icon beside a 72px photo
          left the flights indented differently from everything else, and the
          icon read as chrome rather than as the row's avatar. */}
      <img
        className={styles.thumb}
        src={booking.source?.image || BOOKING_AVATARS[booking.kind]}
        alt=""
        loading="lazy"
        decoding="async"
        onError={(event) => {
          // A provider photo whose URL has rotted falls back to the drawn one
          // rather than leaving a broken-image glyph mid-list.
          event.currentTarget.src = BOOKING_AVATARS[booking.kind];
        }}
      />

      <div className={styles.body}>
        <p className={styles.kind}>
          {/* Colour-coded so the list is scannable before it is read — see
              `--color-kind-*` in `tokens.css`. */}
          <span className={cx(styles.kindChip, styles[booking.kind])}>
            {bookingKindLabel(booking.kind)}
          </span>
          <span className={booking.status === 'booked' ? styles.chipBooked : styles.chipSaved}>
            {booking.status === 'booked' ? 'Booked' : 'Shortlisted'}
          </span>
        </p>

        {/* Typed in place rather than behind an edit mode — there is no draft
            to save, so a modal would be a round trip for one field. */}
        <input
          className={styles.title}
          value={booking.title}
          placeholder={`Name this ${bookingKindLabel(booking.kind).toLowerCase()}`}
          onChange={(event) => onEdit({ title: event.target.value })}
          disabled={busy}
          aria-label={`Title for ${name}`}
        />

        {booking.source?.subtitle ? (
          <p className={styles.subtitle}>{booking.source.subtitle}</p>
        ) : null}

        <div className={styles.fields}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{isStay ? 'Check-in' : 'Date'}</span>
            <input
              className={styles.control}
              type="date"
              value={booking.date}
              onChange={(event) => editStayDate({ date: event.target.value })}
              min={earliest}
              max={latest}
              disabled={busy}
              aria-label={`${isStay ? 'Check-in' : 'Date'} for ${name}`}
            />
          </label>

          {/* A stay occupies a range, and its nights are what the nightly rate
              is multiplied by — so shortening it here changes what it costs. */}
          {isStay ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Check-out</span>
              <input
                className={styles.control}
                type="date"
                value={booking.endDate ?? ''}
                onChange={(event) => editStayDate({ endDate: event.target.value })}
                min={booking.date || earliest}
                max={latest}
                disabled={busy}
                aria-label={`Check-out for ${name}`}
              />
            </label>
          ) : null}

          {/*
            Only once there is something to put in it.
            A shortlisted row has no confirmation number by definition — the
            reader has not booked it — so the field was an empty box on every
            card, and a planned trip now files ten of them at once. It appears
            with the reference the moment the row is marked as booked, and a
            row that somehow carries one keeps showing it either way.
          */}
          {booking.status === 'booked' || booking.reference ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Reference</span>
              <input
                className={styles.control}
                value={booking.reference}
                placeholder="Confirmation number"
                onChange={(event) => onEdit({ reference: event.target.value })}
                disabled={busy}
                aria-label={`Reference for ${name}`}
              />
            </label>
          ) : null}
        </div>
      </div>

      <div className={styles.side}>
        {/* What the booking costs, not what one night or one seat of it costs.
            The working goes underneath, so the column adds up to the trip
            total on the reader's own arithmetic. */}
        {amount !== undefined ? (
          <p className={styles.price}>
            {formatCurrency(amount)}
            {workings ? <span className={styles.workings}>{workings}</span> : null}
            {isSamplePrice ? <span className={styles.sample}>sample price</span> : null}
          </p>
        ) : null}

        {link ? (
          <a className={styles.link} href={link} target="_blank" rel="noopener noreferrer">
            View booking
            <ExternalLinkIcon size={14} />
          </a>
        ) : null}

        <button type="button" className={styles.statusToggle} onClick={onToggleBooked} disabled={busy}>
          {booking.status === 'booked' ? 'Move to shortlist' : 'Mark as booked'}
        </button>

        <IconButton label={`Remove ${name}`} disabled={busy} onClick={onRemove}>
          <TrashIcon size={18} />
        </IconButton>
      </div>
    </Card>
  );
}
