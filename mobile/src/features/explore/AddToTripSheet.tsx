import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Activity } from '../../core/types/travel.types';
import type { ItineraryDay, Trip } from '../../core/types/trip.types';
import {
  ActivityAlreadyOnDayError,
  ItineraryDayNotFoundError,
  TripNotFoundError,
} from '../../core/services/trip.service';
import { tripStore, useTrips } from '../../core/store/trip.store';
import { formatShortDate } from '../../core/utils/date';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import { addableTrips, canAddToTrip, tripCountry } from './trip.filters';

const SAVE_ERROR = 'We could not add this to your trip. Please try again.';

function describeError(error: unknown): string {
  if (error instanceof ActivityAlreadyOnDayError) return error.message;
  if (error instanceof TripNotFoundError) return 'That trip no longer exists.';
  if (error instanceof ItineraryDayNotFoundError) return 'That day is no longer on the trip.';
  return SAVE_ERROR;
}

/** One selectable row — a trip, or a day within one. */
function Row({
  label,
  detail,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space.md,
        paddingVertical: theme.space.md,
        paddingHorizontal: theme.space.lg,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: selected ? theme.color.primary : theme.color.border,
        backgroundColor: pressed && !disabled ? theme.color.surfaceMuted : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="sm" weight={selected ? 'semibold' : 'regular'} leading="tight">
          {label}
        </Text>
        {detail ? (
          <Text variant="xs" tone="muted" leading="snug">
            {detail}
          </Text>
        ) : null}
      </View>

      {selected ? (
        <Text variant="sm" tone="primary" weight="bold">
          ✓
        </Text>
      ) : null}
    </Pressable>
  );
}

/** What the Day row shows when the sheet is closed on itself. */
function dayLabel(days: ItineraryDay[], dayId: string): string {
  if (days.length === 0) return 'This trip has no days yet';

  const day = days.find((candidate) => candidate.id === dayId);
  if (!day) return 'Choose a day';

  const date = day.date ? ` · ${formatShortDate(day.date)}` : '';

  return `Day ${day.dayNumber}${day.destination ? ` · ${day.destination}` : ''}${date}`;
}

/**
 * One collapsed choice: a label, what is chosen, and a chevron.
 *
 * This is the `<select>` the web gets for nothing — one line, always visible,
 * opening a list only when asked.
 */
function Field({
  label,
  value,
  muted,
  disabled,
  onPress,
}: {
  label: string;
  value: string;
  muted?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.space.xs }}>
      <Text variant="xs" weight="semibold" tone="muted" leading="tight">
        {label.toUpperCase()}
      </Text>

      <Pressable
        onPress={disabled ? undefined : onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.md,
          minHeight: 44,
          paddingHorizontal: theme.space.lg,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: pressed && !disabled ? theme.color.surfaceMuted : theme.color.background,
          opacity: disabled ? 0.5 : 1,
        })}
      >
        <Text
          variant="sm"
          tone={muted ? 'muted' : 'main'}
          leading="tight"
          numberOfLines={1}
          style={{ flex: 1 }}
        >
          {value}
        </Text>
        {disabled ? null : (
          <Text variant="sm" tone="muted">
            ›
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/**
 * Trip, then day, then add — the phone's answer to `AddToTripDialog`.
 *
 * The web opens an attraction page and puts this behind a button on it. There
 * is no attraction page here, so tapping the card opens this directly: the
 * capability the reader was after is adding the place to a trip, and a page
 * they would only pass through to reach it is a tap they do not need.
 *
 * **Trip and day are two rows, not two lists.** They were two stacked lists
 * first, and the day list lost: it sat below every trip inside a scroll view,
 * so opening the sheet showed a trip list and an Add button with no sign a day
 * choice existed at all. Somebody with nine trips had to scroll past all nine
 * to discover the second half of the form. The web does not have this problem
 * because its two `<select>`s collapse to one line each and are both on screen
 * — so these are two rows that open a list when tapped, which is what a
 * `<select>` is.
 *
 * **A trip in another country cannot be chosen, and stays visible anyway.**
 * `trip.filters.ts` explains why the test is the country and not the city;
 * the reason for leaving the blocked trips on screen is the web's, unchanged —
 * removing them leaves somebody staring at a picker missing the trip they were
 * looking for, with nothing to explain where it went. So they are listed,
 * disabled, labelled with where they go.
 */
export function AddToTripSheet({
  activity,
  placeCountry,
  onClose,
  onAdded,
}: {
  activity: Activity;
  /**
   * The country the explorer was browsing when this place was found. Null when
   * it is not known, which allows every trip, since a mismatch cannot be shown.
   */
  placeCountry?: string | null;
  onClose: () => void;
  onAdded?: (tripTitle: string) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const trips = useTrips();

  const addable = useMemo(() => addableTrips(trips, placeCountry ?? null), [trips, placeCountry]);
  const noneAddable = trips.length > 0 && addable.length === 0;

  const [tripId, setTripId] = useState(() => addable[0]?.id ?? '');
  const [dayId, setDayId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Which half of the form is open, if either. */
  const [step, setStep] = useState<'summary' | 'trip' | 'day'>('summary');

  const trip = trips.find((candidate: Trip) => candidate.id === tripId);
  const days = trip?.itinerary ?? [];

  // Choosing a trip picks its first day, so the common case is one tap. Keyed
  // on the day's id rather than the array, which is rebuilt every render.
  const firstDayId = days[0]?.id ?? '';
  useEffect(() => {
    setDayId(firstDayId);
  }, [tripId, firstDayId]);

  async function add() {
    if (!trip || !dayId) return;

    /*
     * The disabled rows already prevent this. Checked again because the guard
     * above is a rendering decision and adding the stop is the irreversible
     * half — a stale `tripId` from a trip that changed country in another
     * session would otherwise walk straight past it.
     */
    const eligibility = canAddToTrip(trip, placeCountry ?? null);
    if (!eligibility.addable) {
      setError(`${trip.title} ${eligibility.reason}, so this cannot go on it.`);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await tripStore.addActivityToDay(trip.id, dayId, activity);
      onAdded?.(trip.title);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View
        style={{
          flex: 1,
          backgroundColor: theme.color.background,
          paddingTop: insets.top + theme.space.lg,
          paddingBottom: insets.bottom + theme.space.lg,
          paddingHorizontal: theme.space.lg,
          gap: theme.space.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
          <Text variant="lg" weight="bold" leading="tight" style={{ flex: 1 }}>
            Add to a trip
          </Text>
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
        </View>

        <Text variant="sm" tone="muted" leading="snug">
          {activity.title}
        </Text>

        {trips.length === 0 ? (
          <Text variant="sm" tone="muted" leading="snug">
            You have no trips yet. Plan one first, and this place can go on it.
          </Text>
        ) : noneAddable ? (
          <Text variant="sm" tone="muted" leading="snug">
            {placeCountry
              ? `None of your trips go to ${placeCountry}.`
              : 'None of your trips can take this place.'}
          </Text>
        ) : step === 'trip' ? (
          <ScrollView contentContainerStyle={{ gap: theme.space.sm }}>
            {trips.map((candidate: Trip) => {
              const eligibility = canAddToTrip(candidate, placeCountry ?? null);

              return (
                <Row
                  key={candidate.id}
                  label={candidate.title}
                  detail={
                    eligibility.addable
                      ? (tripCountry(candidate) ?? undefined)
                      : `Goes to ${tripCountry(candidate)}`
                  }
                  selected={candidate.id === tripId}
                  disabled={!eligibility.addable}
                  onPress={() => {
                    setTripId(candidate.id);
                    setStep('summary');
                  }}
                />
              );
            })}
          </ScrollView>
        ) : step === 'day' ? (
          <ScrollView contentContainerStyle={{ gap: theme.space.sm }}>
            {days.map((day) => (
              <Row
                key={day.id}
                label={`Day ${day.dayNumber}${day.destination ? ` · ${day.destination}` : ''}`}
                detail={day.date ? formatShortDate(day.date) : undefined}
                selected={day.id === dayId}
                onPress={() => {
                  setDayId(day.id);
                  setStep('summary');
                }}
              />
            ))}
          </ScrollView>
        ) : (
          <View style={{ gap: theme.space.md }}>
            <Field
              label="Trip"
              value={trip?.title ?? 'Choose a trip'}
              muted={!trip}
              onPress={() => setStep('trip')}
            />
            {/*
              Shown even when the trip has no days, rather than hidden: a form
              that grows a second field only sometimes is how somebody learns
              the field exists after they have already pressed Add.
            */}
            <Field
              label="Day"
              value={dayLabel(days, dayId)}
              muted={!dayId}
              onPress={() => setStep('day')}
              disabled={days.length === 0}
            />
          </View>
        )}

        {error ? (
          <Text variant="sm" tone="danger" accessibilityRole="alert" leading="snug">
            {error}
          </Text>
        ) : null}

        {trips.length > 0 && !noneAddable && step === 'summary' ? (
          <Button onPress={() => void add()} loading={isSaving} disabled={!trip || !dayId} fullWidth>
            Add to trip
          </Button>
        ) : null}
      </View>
    </Modal>
  );
}
