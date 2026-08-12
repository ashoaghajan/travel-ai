import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/common/Button';
import { Card } from '../../../components/common/Card';
import { EmptyState } from '../../../components/common/EmptyState';
import { Skeleton } from '../../../components/common/Skeleton';
import { Tabs } from '../../../components/common/Tabs';
import { CurrencySelect } from '../../../components/common/CurrencySelect';
import { tabId, tabPanelId } from '../../../components/common/tabs.helpers';
import { TripRouteMap } from '../components/TripRouteMap';
import { IconButton } from '../../../components/common/IconButton';
import { ShareTripDialog } from '../components/ShareTripDialog';
import { DownloadIcon, ShareIcon, SuitcaseIcon, TrashIcon } from '../../../components/common/icons';
import type { Trip } from '../../../types/trip.types';
import { formatDateRange } from '../../../utils/date';
import {
  formatTravellers,
  formatTripTotal,
  groupItineraryStops,
  tripTotal,
} from '../../../utils/trip';
import { BackLink } from '../components/BackLink';
import { EditTripModal } from '../components/EditTripModal';
import { AttractionPickerDialog } from '../components/AttractionPickerDialog';
import { ItineraryTimeline } from '../components/ItineraryTimeline';
import { TripBookings } from '../components/TripBookings';
import { TripNotes } from '../components/TripNotes';
import { useDeleteTrip, useTripDetails } from '../useTrips';
import { useEditTrip } from '../useEditTrip';
import { useTripExport } from '../useTripExport';
import { useStopCoordinates } from '../useStopCoordinates';
import { useBookingCoordinates } from '../useBookingCoordinates';
import { useTripBookings } from '../../../store/booking.store';
import { useMoney } from '../../../store/currency.store';
import { bookingKindLabel } from '../../../utils/booking';
import { cx } from '../../../utils/cx';
import { destinationLabel, hasErrors } from '../editTrip';
import styles from './TripDetailsPage.module.css';

/** DESIGN_SPEC Screen 3 tabs. */
const TRIP_TABS = [
  // The id stays `itinerary` — it is the URL's `?tab=` value and the type
  // names throughout. Only the word the reader sees changes.
  { id: 'itinerary', label: 'Schedule' },
  { id: 'map', label: 'Map' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'notes', label: 'Notes' },
] as const;

type TripTabId = (typeof TRIP_TABS)[number]['id'];

const DEFAULT_TAB: TripTabId = 'itinerary';
const TAB_ID_PREFIX = 'trip';

function isTripTab(value: string | null): value is TripTabId {
  return TRIP_TABS.some((tab) => tab.id === value);
}

/**
 * Trip details with the itinerary timeline and route map (DESIGN_SPEC Screen 3).
 *
 * Only the guards live here. Everything else takes a trip that is known to
 * exist, which is what lets the edit session be a page-level hook rather than
 * something mounted inside a tab panel — an edit has to survive switching to
 * the map and back.
 */
export function TripDetailsPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const { trip, isLoading, notFound } = useTripDetails(tripId);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <PageHeader title="Loading trip…" leading={<BackLink to={ROUTES.trips} label="Back to your trips" />} />
        <div className={styles.content} aria-busy="true">
          <span className="visually-hidden">Loading this trip…</span>
          <Skeleton height="44px" radius="pill" />
          <Skeleton height="120px" radius="lg" />
          <Skeleton height="120px" radius="lg" />
        </div>
      </div>
    );
  }

  if (notFound || !trip) {
    return (
      <div className={styles.page}>
        <PageHeader title="Trip not found" leading={<BackLink to={ROUTES.trips} label="Back to your trips" />} />
        <div className={styles.content}>
          <EmptyState
            icon={<SuitcaseIcon size={26} />}
            title="This trip is no longer saved"
            description="It may have been deleted. Your other saved trips are still here."
            action={
              <Button to={ROUTES.trips} variant="primary" size="md">
                Back to trips
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return <TripDetailsView trip={trip} />;
}

function TripDetailsView({ trip }: { trip: Trip }) {
  const { deleteTrip, isDeleting, error: deleteError } = useDeleteTrip();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [pickerDayId, setPickerDayId] = useState<string | null>(null);
  const navigate = useNavigate();

  const edit = useEditTrip(trip);

  async function handleDelete() {
    const deleted = await deleteTrip(trip.id);
    if (deleted) navigate(ROUTES.trips, { replace: true });
  }

  // The tab lives in the URL so a view can be linked to and survives reload.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab: TripTabId = isTripTab(requestedTab) ? requestedTab : DEFAULT_TAB;

  function selectTab(next: TripTabId) {
    const params = new URLSearchParams(searchParams);
    if (next === DEFAULT_TAB) {
      params.delete('tab');
    } else {
      params.set('tab', next);
    }
    setSearchParams(params, { replace: true });
  }

  function leaveEditMode() {
    edit.cancel();
    // A picker outliving edit mode would be editing a draft that has gone.
    setPickerDayId(null);
    setIsEditing(false);
  }

  async function saveEdits() {
    if (await edit.save()) {
      setPickerDayId(null);
      setIsEditing(false);
    }
  }

  // In edit mode the itinerary and notes read from the draft, so a deleted stop
  // disappears from the timeline and the map at once. Bookings are not in the
  // draft — they are their own records and save immediately, see `TripBookings`.
  const days = isEditing ? edit.draft.itinerary : trip.itinerary;
  const notes = isEditing ? edit.draft.notes : (trip.notes ?? []);
  const stops = groupItineraryStops(days);

  // Resolved once for the page: the map and the stop list must agree on which
  // stops could be placed.
  const placed = useStopCoordinates(stops, trip.destinationCountry ?? null);
  const unlocatedIds = new Set(placed.unlocated.map((stop) => stop.id));

  // Booked hotels and attractions, as their own pins. An attraction brings its
  // point from the explorer; a hotel is geocoded from its name.
  const tripBookings = useTripBookings(trip.id);
  const money = useMoney();
  const { exportTrip, error: exportError } = useTripExport();

  /*
   * Dates, party, and what it comes to. The cost joins the other two because
   * it answers a question the reader has on every tab, not only on Bookings —
   * and it drops out rather than reading $0 on a trip with nothing priced.
   */
  const headerSubtitle = [
    formatDateRange(trip.startDate, trip.endDate),
    formatTravellers(trip.travellers),
    formatTripTotal(tripTotal(trip, tripBookings), money),
  ]
    .filter(Boolean)
    .join(' · ');

  const bookedPlaces = useBookingCoordinates(
    tripBookings,
    trip.destinationCountry ?? null,
    trip.destinationCity ?? trip.destination ?? null,
  );
  const placeMarkers = [
    ...bookedPlaces.located.map((booking) => ({
      id: booking.id,
      label: booking.label,
      coordinates: booking.coordinates,
      // A ticket has no glyph of its own; it borrows the activity's.
      kind: booking.kind === 'hotel' ? ('hotel' as const) : ('activity' as const),
    })),
    // The airports the trip's flights run between, deduped by code — a return
    // trip names the same pair twice.
    ...bookedPlaces.airports.map((airport) => ({
      id: `airport-${airport.code}`,
      label: airport.label,
      coordinates: airport.coordinates,
      kind: 'airport' as const,
    })),
  ];

  // From the draft, not the trip: an attraction added a minute ago is unsaved,
  // and the picker has to know about it to refuse a duplicate.
  const pickerDay = pickerDayId
    ? (edit.draft.itinerary.find((day) => day.id === pickerDayId) ?? null)
    : null;
  const showEditErrors = edit.hasAttemptedSave && hasErrors(edit.errors);

  return (
    <div className={styles.page}>
      <PageHeader
        title={trip.title}
        subtitle={headerSubtitle}
        leading={<BackLink to={ROUTES.trips} label="Back to your trips" />}
        actions={
          <>
            {isEditing ? (
              <Button variant="secondary" size="md" onClick={() => setIsEditingDetails(true)}>
                Trip details
              </Button>
            ) : (
              <>
                <Button variant="secondary" size="md" onClick={() => setIsEditing(true)}>
                  Edit Trip
                </Button>
                <Button to={`/trips/${trip.id}/summary`} variant="secondary" size="md">
                  Summary
                </Button>
                {/*
                  Icon-only, and next to Delete rather than beside the labelled
                  buttons: two labels plus two icons is the ceiling this row
                  holds on a phone, and `.actions` now wraps rather than
                  overflowing if a fifth control ever arrives.
                */}
                {/*
                  Beside Export, because the two are the same act with
                  different destinations: one writes the trip to a file, the
                  other hands it to somebody in the app.
                */}
                <IconButton
                  label={`Share ${trip.title} with somebody`}
                  onClick={() => setIsSharing(true)}
                >
                  <ShareIcon size={20} />
                </IconButton>
                <IconButton
                  label={`Export ${trip.title} as a file`}
                  onClick={() => exportTrip(trip)}
                >
                  <DownloadIcon size={20} />
                </IconButton>
                <IconButton
                  label={`Delete ${trip.title}`}
                  disabled={isDeleting}
                  onClick={() => setIsConfirmingDelete(true)}
                >
                  <TrashIcon size={20} />
                </IconButton>
              </>
            )}
          </>
        }
      />

      <div className={styles.content}>
        {exportError ? (
          <p className={styles.error} role="alert">
            {exportError}
          </p>
        ) : null}

        {deleteError ? (
          <p className={styles.error} role="alert">
            {deleteError}
          </p>
        ) : null}

        {isSharing ? <ShareTripDialog trip={trip} onClose={() => setIsSharing(false)} /> : null}

      {isConfirmingDelete ? (
          <Card padding="lg" elevation="soft" className={styles.confirm}>
            <p className={styles.confirmText}>Delete this trip? This cannot be undone.</p>
            <div className={styles.confirmActions}>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setIsConfirmingDelete(false)}
              >
                Cancel
              </Button>
              <Button variant="danger" size="md" disabled={isDeleting} onClick={handleDelete}>
                {isDeleting ? 'Deleting…' : 'Delete trip'}
              </Button>
            </div>
          </Card>
        ) : null}

        {isEditing ? (
          <div className={styles.editBanner}>
            <p className={styles.editBannerText}>
              Editing the itinerary — change a time, retitle a stop, or add one.
            </p>
            {edit.isDirty ? (
              <span className={styles.dirtyBadge} role="status">
                Unsaved Changes
              </span>
            ) : null}
          </div>
        ) : null}

        {/*
          The currency picker sits on the tab row rather than in the header.
          It belongs beside the prices it governs — the schedule's costs are
          directly below it — and the header is already full: two labelled
          buttons and two icon buttons is as much as fits a phone.
        */}
        <div className={styles.tabRow}>
          <Tabs
            items={TRIP_TABS}
            activeId={activeTab}
            onChange={selectTab}
            idPrefix={TAB_ID_PREFIX}
            label="Trip sections"
          />

          <CurrencySelect label="Show prices in" />
        </div>

        <div
          role="tabpanel"
          id={tabPanelId(TAB_ID_PREFIX, activeTab)}
          aria-labelledby={tabId(TAB_ID_PREFIX, activeTab)}
          tabIndex={0}
          className={styles.panel}
        >
          {activeTab === 'itinerary' ? (
            <div className={styles.itineraryLayout}>
              <Card padding="lg" elevation="soft" className={styles.timelineCard}>
                <h2 className={styles.sectionTitle}>Day by day</h2>
                <ItineraryTimeline
                  days={days}
                  bookings={tripBookings}
                  editing={
                    isEditing
                      ? {
                          onEditActivity: edit.editActivity,
                          onDeleteActivity: edit.deleteActivity,
                          onAddActivity: edit.appendActivity,
                          onPickActivity: setPickerDayId,
                          errors: showEditErrors ? edit.errors.activities : undefined,
                          disabled: edit.isSaving,
                        }
                      : undefined
                  }
                />
              </Card>

              {/* The map rides alongside the timeline on desktop; on smaller
                  screens it lives in its own tab. */}
              <aside className={styles.mapColumn}>
                {/* `scrollWheelZoom` stays off here: this column is sticky, so
                    a wheel gesture over it belongs to the page. */}
                <TripRouteMap stops={stops} {...placed} places={placeMarkers} />
              </aside>
            </div>
          ) : null}

          {activeTab === 'map' ? (
            <div className={styles.mapPanel}>
              <TripRouteMap stops={stops} {...placed} places={placeMarkers} size="lg" scrollWheelZoom />

              <Card padding="lg" elevation="soft">
                <h2 className={styles.sectionTitle}>Route stops</h2>
                <ol className={styles.stopList}>
                  {stops.map((stop) => (
                    <li key={stop.id} className={styles.stop}>
                      <span className={styles.stopMarker} aria-hidden="true" />
                      {stop.label}
                      {/* This list is the map's accessible equivalent, so it
                          lists every stop and says which are missing from it. */}
                      {unlocatedIds.has(stop.id) ? (
                        <span className={styles.stopUnmapped}>Not on the map</span>
                      ) : null}
                    </li>
                  ))}
                </ol>

                {/* The map's accessible equivalent covers what is booked too,
                    or a reader who cannot see the pins never learns of them. */}
                {bookedPlaces.located.length > 0 ||
                bookedPlaces.airports.length > 0 ||
                bookedPlaces.unlocated.length > 0 ? (
                  <>
                    {/* "Places" was too narrow once airports joined: a flight
                        is a booking too, and the heading has to cover it. */}
                    <h2 className={cx(styles.sectionTitle, styles.secondSection)}>
                      On this trip
                    </h2>
                    <ul className={styles.stopList}>
                      {/* The badge carries the kind's own colour, matching its
                          pin on the map above and its chip on the Bookings tab
                          — one hue per kind, everywhere it appears. */}
                      {bookedPlaces.airports.map((airport) => (
                        <li key={airport.code} className={styles.stop}>
                          <span
                            className={cx(styles.stopMarker, styles.markerFlight)}
                            aria-hidden="true"
                          />
                          {airport.label}
                          <span className={cx(styles.kindBadge, styles.badgeFlight)}>Airport</span>
                        </li>
                      ))}
                      {bookedPlaces.located.map((place) => (
                        <li key={place.id} className={styles.stop}>
                          <span
                            className={cx(styles.stopMarker, styles[`marker_${place.kind}`])}
                            aria-hidden="true"
                          />
                          {place.label}
                          <span className={cx(styles.kindBadge, styles[`badge_${place.kind}`])}>
                            {bookingKindLabel(place.kind)}
                          </span>
                        </li>
                      ))}
                      {bookedPlaces.unlocated.map((booking) => (
                        <li key={booking.id} className={styles.stop}>
                          <span
                            className={cx(styles.stopMarker, styles[`marker_${booking.kind}`])}
                            aria-hidden="true"
                          />
                          {booking.title}
                          <span className={cx(styles.kindBadge, styles[`badge_${booking.kind}`])}>
                            {bookingKindLabel(booking.kind)}
                          </span>
                          <span className={styles.stopUnmapped}>Not on the map</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </Card>
            </div>
          ) : null}

          {activeTab === 'bookings' ? <TripBookings trip={trip} /> : null}

          {activeTab === 'notes' ? (
            <TripNotes
              notes={notes}
              editing={
                isEditing
                  ? {
                      onAdd: edit.appendNote,
                      onEdit: edit.editNote,
                      onDelete: edit.deleteNote,
                      errors: showEditErrors ? edit.errors.notes : undefined,
                      disabled: edit.isSaving,
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
      </div>

      {isEditing ? (
        <div className={styles.editBar}>
          <div className={styles.editBarInner}>
            <p className={styles.editBarStatus} role="status">
              {edit.saveError ??
                (showEditErrors
                  ? 'Fix the highlighted activities before saving.'
                  : edit.isDirty
                    ? 'Unsaved Changes'
                    : 'No changes yet')}
            </p>

            <div className={styles.editBarActions}>
              <Button
                variant="secondary"
                size="md"
                onClick={leaveEditMode}
                disabled={edit.isSaving}
              >
                Cancel Changes
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={saveEdits}
                disabled={edit.isSaving || !edit.isDirty}
              >
                {edit.isSaving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isEditingDetails ? (
        <EditTripModal trip={trip} onClose={() => setIsEditingDetails(false)} />
      ) : null}

      {pickerDay ? (
        <AttractionPickerDialog
          day={pickerDay}
          countryName={edit.draft.destinationCountry || null}
          fallbackDestination={destinationLabel(edit.draft)}
          onPick={(activity, time) => edit.pickActivity(pickerDay.id, activity, time)}
          onAddBlank={() => edit.appendActivity(pickerDay.id)}
          onClose={() => setPickerDayId(null)}
        />
      ) : null}
    </div>
  );
}
