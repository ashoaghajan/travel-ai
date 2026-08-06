import { Button } from '../../../components/common/Button';
import { IconButton } from '../../../components/common/IconButton';
import { PlusIcon, TrashIcon } from '../../../components/common/icons';
import { CATEGORY_IMAGES } from '../../../assets/category-images';
import type { ItineraryActivity, ItineraryDay } from '../../../types/trip.types';
import type { Booking } from '../../../types/booking.types';
import type { BookingMoment } from '../../../utils/booking';
import { bookingKindLabel, bookingsAlongsideDay } from '../../../utils/booking';
import { cx } from '../../../utils/cx';
import { formatShortDate } from '../../../utils/date';
import styles from './ItineraryTimeline.module.css';

/** Supplied together, or not at all — see `ItineraryTimelineProps.editing`. */
export type ItineraryEditing = {
  onEditActivity: (
    dayId: string,
    activityId: string,
    patch: Partial<Pick<ItineraryActivity, 'title' | 'description' | 'time'>>,
  ) => void;
  onDeleteActivity: (dayId: string, activityId: string) => void;
  onAddActivity: (dayId: string) => void;
  /**
   * Opens the attraction picker. Falls back to `onAddActivity` where a caller
   * has not wired one, so the blank row is never unreachable.
   */
  onPickActivity?: (dayId: string) => void;
  /** Message for one activity, keyed by its id. */
  errors?: Record<string, string>;
  disabled?: boolean;
};

export type ItineraryTimelineProps = {
  days: ItineraryDay[];
  /**
   * What is actually booked, laid onto the days it falls on.
   *
   * Kept apart from `days[].activities` because they are different claims: an
   * itinerary activity is a plan, a booking is a thing the reader holds. A day
   * with a flight and a hotel on it used to read as empty, because only the
   * plan was ever drawn.
   */
  bookings?: Booking[];
  /**
   * Turns the activity rows into inputs, in place.
   *
   * Editing happens inside this component rather than in a form somewhere
   * else, and that is the whole point: the markers, day headings, dates and
   * photographs are the context that makes an itinerary readable, and
   * rebuilding them in a second component would guarantee the two drift.
   * Only the activity rows change shape.
   */
  editing?: ItineraryEditing;
};

/**
 * Day-by-day timeline (DESIGN_SPEC Screen 3): "Day 1 · May 20", destination,
 * summary, what is booked for that day, and the activities planned for it.
 */
/** "Check in", "Check out", "Flight", "Ticket", "Activity". */
function momentLabel(booking: Booking, moment: BookingMoment): string {
  if (moment === 'checkIn') return 'Check in';
  if (moment === 'checkOut') return 'Check out';

  return bookingKindLabel(booking.kind);
}

export function ItineraryTimeline({ days, bookings = [], editing }: ItineraryTimelineProps) {
  return (
    <ol className={styles.timeline}>
      {days.map((day) => (
        <li key={day.id} className={styles.day}>
          <span className={styles.marker} aria-hidden="true" />

          <div className={styles.content}>
            <p className={styles.dayMeta}>
              Day {day.dayNumber} · {formatShortDate(day.date)}
            </p>

            <div className={styles.heading}>
              <div className={styles.headingText}>
                <h3 className={styles.destination}>{day.destination}</h3>
                {/* Days scaffolded by the create form carry no summary; an
                    empty paragraph would still take its line height. */}
                {day.summary ? <p className={styles.summary}>{day.summary}</p> : null}
              </div>

              {day.image ? (
                <img
                  className={styles.thumbnail}
                  src={day.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
            </div>

            {/* What is booked for this day, above what was planned for it:
                a flight and a room are the fixed points a day is built
                around. Never editable here — a booking is its own record and
                the Bookings tab is where it is changed.

                Only what the rows below do not already say: a planned trip
                files a booking per stop, and chipping those would print the
                whole day twice. See `bookingsAlongsideDay`. */}
            {bookingsAlongsideDay(bookings, day).map(({ booking, moment }) => (
              <p key={`${booking.id}-${moment}`} className={styles.booked}>
                <span className={cx(styles.bookedKind, styles[booking.kind])}>
                  {momentLabel(booking, moment)}
                </span>
                <span className={styles.bookedTitle}>{booking.title || 'Untitled booking'}</span>
              </p>
            ))}

            {/* In edit mode an empty day still needs its "Add activity" row. */}
            {day.activities.length > 0 || editing ? (
              <ul className={styles.activities}>
                {day.activities.map((activity) =>
                  editing ? (
                    <EditableActivity
                      key={activity.id}
                      dayId={day.id}
                      activity={activity}
                      editing={editing}
                    />
                  ) : (
                    <li key={activity.id} className={styles.activity}>
                      <span className={styles.time}>{activity.time}</span>
                      <span className={styles.activityBody}>
                        <span className={styles.activityTitle}>{activity.title}</span>
                        <span className={styles.activityDescription}>{activity.description}</span>
                      </span>
                      {activity.priceEstimate ? (
                        <span className={styles.price}>${activity.priceEstimate}</span>
                      ) : null}
                    </li>
                  ),
                )}

                {editing ? (
                  <li className={styles.addRow}>
                    {day.activities.length === 0 ? (
                      <p className={styles.emptyDay}>Nothing planned for this day yet.</p>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      leadingIcon={<PlusIcon size={16} />}
                      disabled={editing.disabled}
                      onClick={() => (editing.onPickActivity ?? editing.onAddActivity)(day.id)}
                    >
                      Add activity
                    </Button>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** One activity as editable fields, in the row the read view would occupy. */
function EditableActivity({
  dayId,
  activity,
  editing,
}: {
  dayId: string;
  activity: ItineraryActivity;
  editing: ItineraryEditing;
}) {
  const error = editing.errors?.[activity.id];
  const name = activity.title || 'this activity';

  return (
    <li className={styles.editableActivity}>
      <div className={styles.editRow}>
        {/* The edit row shows time, title and description only, so an imported
            stop is otherwise indistinguishable from a typed one — and there is
            no visible reason why retyping it would lose a photo and a map pin. */}
        {activity.sourceActivityId ? (
          <img
            className={styles.pickedThumb}
            src={activity.image ?? CATEGORY_IMAGES[activity.category]}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <input
          className={`${styles.editControl} ${styles.editTime}`}
          type="time"
          value={activity.time}
          onChange={(event) =>
            editing.onEditActivity(dayId, activity.id, { time: event.target.value })
          }
          disabled={editing.disabled}
          aria-label={`Time for ${name}`}
        />
        <input
          className={styles.editControl}
          value={activity.title}
          placeholder="Activity title"
          onChange={(event) =>
            editing.onEditActivity(dayId, activity.id, { title: event.target.value })
          }
          disabled={editing.disabled}
          aria-label={`Title for the activity at ${activity.time}`}
        />
        <IconButton
          label={`Remove ${name}`}
          disabled={editing.disabled}
          onClick={() => editing.onDeleteActivity(dayId, activity.id)}
        >
          <TrashIcon size={18} />
        </IconButton>
      </div>

      <textarea
        className={`${styles.editControl} ${styles.editDescription}`}
        rows={2}
        value={activity.description}
        placeholder="Description"
        onChange={(event) =>
          editing.onEditActivity(dayId, activity.id, { description: event.target.value })
        }
        disabled={editing.disabled}
        aria-label={`Description for ${name}`}
      />

      {activity.sourceActivityId ? (
        <p className={styles.pickedMark}>From the explorer</p>
      ) : null}

      {error ? <p className={styles.editError}>{error}</p> : null}
    </li>
  );
}
