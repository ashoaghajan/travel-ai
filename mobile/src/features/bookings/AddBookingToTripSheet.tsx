import { useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BookingDraft } from '../../core/types/booking.types';
import type { Trip } from '../../core/types/trip.types';
import { bookingStore } from '../../core/store/booking.store';
import { useTrips } from '../../core/store/trip.store';
import { bookingKindLabel, rebasePriceBasis, stayPriceBasis } from '../../core/utils/booking';
import { tripPricing } from '../../core/utils/trip';
import { formatShortDate } from '../../core/utils/date';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

const SAVE_ERROR = 'We could not record that. Please try again.';

/**
 * A date pulled inside the trip it is being filed against.
 *
 * The web clamps with a date picker's `min`/`max`; there is no picker here —
 * mobile types its dates — so the clamp is the only guard, and it runs on the
 * way in as well as on save. ISO dates compare correctly as strings, which is
 * the whole reason the app stores them that way.
 */
function clampToTrip(date: string, trip: Trip | null): string {
  if (!date || !trip?.startDate || !trip?.endDate) return date;

  if (date < trip.startDate) return trip.startDate;
  if (date > trip.endDate) return trip.endDate;

  return date;
}

/** One collapsed choice, matching the explorer's sheet. */
function Field({
  label,
  value,
  muted,
  onPress,
}: {
  label: string;
  value: string;
  muted?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.space.xs }}>
      <Text variant="xs" weight="semibold" tone="muted" leading="tight">
        {label.toUpperCase()}
      </Text>
      <Pressable
        onPress={onPress}
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
          backgroundColor: pressed ? theme.color.surfaceMuted : theme.color.background,
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
        <Text variant="sm" tone="muted">
          ›
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Trip, date, whether it is booked yet — then record it.
 *
 * The phone's `AddBookingToTripDialog`. Recording a fare is not booking it:
 * nothing here opens a partner, and the row it writes is `saved` unless the
 * reader says otherwise. That is the whole distinction the app is built on —
 * an itinerary activity is a guess, a booking is a fact — and this is the
 * screen where a fare crosses from one to the other.
 *
 * **"No trip" is a legitimate answer.** You can find a fare before deciding
 * which trip it is for, and demanding a trip at that moment is what would send
 * somebody back to the partner with nothing recorded. So the picker offers
 * "Decide later", and having no trips at all is a normal path rather than a
 * dead end.
 *
 * **A stay gets a check-out field; everything else happens on a day.** Which
 * one is decided by the draft's `kind`, not by where the sheet was opened
 * from, so a hotel filed from anywhere carries its range.
 */
export function AddBookingToTripSheet({
  drafts,
  onClose,
  onAdded,
}: {
  drafts: BookingDraft[];
  onClose: () => void;
  onAdded?: (label: string) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const trips = useTrips();

  const first = drafts[0];

  /** A stay occupies a range; everything else happens on a day. */
  const isStay = first?.kind === 'hotel';

  const [tripId, setTripId] = useState(first?.tripId ?? '');
  // Clamped on the way in too: the preselected trip may not be the one this
  // draft's date was quoted against.
  const [date, setDate] = useState(() =>
    clampToTrip(first?.date ?? '', trips.find((trip: Trip) => trip.id === first?.tripId) ?? null),
  );
  /**
   * Check-out, for a stay.
   *
   * Falls back to the trip's own last day, which is what somebody filing a
   * hotel against a five-day trip means by "the whole trip" — they should not
   * have to retype what the trip already knows.
   */
  const [endDate, setEndDate] = useState(() => {
    const trip = trips.find((candidate: Trip) => candidate.id === first?.tripId) ?? null;
    return clampToTrip(first?.endDate ?? trip?.endDate ?? '', trip);
  });
  const [isBooked, setIsBooked] = useState(false);
  const [reference, setReference] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickingTrip, setPickingTrip] = useState(false);

  const chosen = trips.find((trip: Trip) => trip.id === tripId) ?? null;

  if (!first) return null;

  async function save() {
    setIsSaving(true);
    setError(null);

    try {
      // Sequentially, not in parallel: each write reads the stored list and
      // writes it back, so two at once would lose one of them.
      for (const [index, draft] of drafts.entries()) {
        await bookingStore.create({
          ...draft,
          tripId: tripId || null,
          /*
           * A stay is counted by its own nights; everything else keeps the
           * basis it was captured with, recounted against the chosen trip.
           */
          priceBasis:
            isStay && draft.price !== undefined
              ? stayPriceBasis(clampToTrip(date, chosen), clampToTrip(endDate, chosen))
              : rebasePriceBasis(draft.priceBasis, chosen ? tripPricing(chosen) : null),
          // Only the first leg's date is editable here — the rest keep the days
          // the provider quoted, which is what makes them separate rows.
          date: index === 0 ? clampToTrip(date, chosen) : draft.date,
          endDate: isStay ? clampToTrip(endDate, chosen) || undefined : draft.endDate,
          status: isBooked ? 'booked' : 'saved',
          // The same confirmation covers every leg of one fare.
          reference: isBooked ? reference.trim() : '',
        });
      }

      onAdded?.(chosen ? chosen.title : 'your bookings');
      onClose();
    } catch {
      setError(SAVE_ERROR);
    } finally {
      setIsSaving(false);
    }
  }

  const kind = bookingKindLabel(first.kind).toLowerCase();

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
            {pickingTrip ? 'Which trip?' : `Add this ${kind}`}
          </Text>
          <Button variant="secondary" onPress={pickingTrip ? () => setPickingTrip(false) : onClose}>
            {pickingTrip ? 'Back' : 'Close'}
          </Button>
        </View>

        {pickingTrip ? (
          <ScrollView contentContainerStyle={{ gap: theme.space.sm }}>
            {[{ id: '', title: 'Decide later' }, ...trips].map((option) => {
              const selected = option.id === tripId;

              return (
                <Pressable
                  key={option.id || 'none'}
                  onPress={() => {
                    setTripId(option.id);
                    // Both dates belong to whichever trip is now chosen.
                    const next = trips.find((t: Trip) => t.id === option.id) ?? null;
                    setDate((current) => clampToTrip(current, next));
                    setEndDate((current) => clampToTrip(current || next?.endDate || '', next));
                    setPickingTrip(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.space.md,
                    paddingVertical: theme.space.md,
                    paddingHorizontal: theme.space.lg,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: selected ? theme.color.primary : theme.color.border,
                    backgroundColor: pressed ? theme.color.surfaceMuted : 'transparent',
                  })}
                >
                  <Text
                    variant="sm"
                    weight={selected ? 'semibold' : 'regular'}
                    style={{ flex: 1 }}
                    leading="tight"
                  >
                    {option.title}
                  </Text>
                  {selected ? (
                    <Text variant="sm" tone="primary" weight="bold">
                      ✓
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ gap: theme.space.md }}>
            <View style={{ gap: 2 }}>
              <Text variant="sm" weight="semibold" leading="tight">
                {first.title}
              </Text>
              {drafts.length > 1 ? (
                <Text variant="xs" tone="muted" leading="snug">
                  {drafts.length} rows — one for each leg of this fare.
                </Text>
              ) : null}
            </View>

            <Field
              label="Trip"
              value={chosen ? chosen.title : 'Decide later'}
              muted={!chosen}
              onPress={() => setPickingTrip(true)}
            />

            <View style={{ gap: theme.space.xs }}>
              <Text variant="xs" weight="semibold" tone="muted" leading="tight">
                {isStay ? 'CHECK-IN (YYYY-MM-DD)' : 'DATE (YYYY-MM-DD)'}
              </Text>
              <TextInput
                style={{
                  minHeight: 44,
                  paddingHorizontal: theme.space.lg,
                  borderRadius: theme.radius.lg,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  backgroundColor: theme.color.background,
                  color: theme.color.textMain,
                  fontSize: theme.fontSize.sm,
                }}
                value={date}
                onChangeText={setDate}
                /*
                 * Clamped when the field is left rather than on every
                 * keystroke: correcting "2026-09-1" to the trip's first day
                 * mid-typing would fight somebody reaching for "2026-09-15".
                 */
                onBlur={() => setDate((current) => clampToTrip(current, chosen))}
                placeholder="2026-09-14"
                placeholderTextColor={theme.color.textMuted}
                accessibilityLabel="Date"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
              />
              {chosen?.startDate && chosen?.endDate ? (
                <Text variant="xs" tone="muted" leading="snug">
                  {chosen.title} runs {formatShortDate(chosen.startDate)} –{' '}
                  {formatShortDate(chosen.endDate)}.
                </Text>
              ) : null}
            </View>

            {isStay ? (
              <View style={{ gap: theme.space.xs }}>
                <Text variant="xs" weight="semibold" tone="muted" leading="tight">
                  CHECK-OUT (YYYY-MM-DD)
                </Text>
                <TextInput
                  style={{
                    minHeight: 44,
                    paddingHorizontal: theme.space.lg,
                    borderRadius: theme.radius.lg,
                    borderWidth: 1,
                    borderColor: theme.color.border,
                    backgroundColor: theme.color.background,
                    color: theme.color.textMain,
                    fontSize: theme.fontSize.sm,
                  }}
                  value={endDate}
                  onChangeText={setEndDate}
                  onBlur={() => setEndDate((current) => clampToTrip(current, chosen))}
                  placeholder="2026-09-18"
                  placeholderTextColor={theme.color.textMuted}
                  accessibilityLabel="Check-out date"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                />
                {/*
                  The nights are what the price is counted over — `stayPriceBasis`
                  reads exactly this pair — so a wrong check-out is a wrong total
                  rather than only a wrong date.
                */}
                <Text variant="xs" tone="muted" leading="snug">
                  The stay is priced over these nights.
                </Text>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="sm" weight="medium" leading="tight">
                  Already booked
                </Text>
                <Text variant="xs" tone="muted" leading="snug">
                  Leave this off to keep it as a fare you are considering.
                </Text>
              </View>
              <Switch
                value={isBooked}
                onValueChange={setIsBooked}
                accessibilityLabel="Already booked"
                trackColor={{ false: theme.color.surfaceMuted, true: theme.color.primary }}
              />
            </View>

            {isBooked ? (
              <View style={{ gap: theme.space.xs }}>
                <Text variant="xs" weight="semibold" tone="muted" leading="tight">
                  CONFIRMATION (OPTIONAL)
                </Text>
                <TextInput
                  style={{
                    minHeight: 44,
                    paddingHorizontal: theme.space.lg,
                    borderRadius: theme.radius.lg,
                    borderWidth: 1,
                    borderColor: theme.color.border,
                    backgroundColor: theme.color.background,
                    color: theme.color.textMain,
                    fontSize: theme.fontSize.sm,
                  }}
                  value={reference}
                  onChangeText={setReference}
                  placeholder="e.g. XJ7K2P"
                  placeholderTextColor={theme.color.textMuted}
                  accessibilityLabel="Confirmation number"
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>
            ) : null}
          </ScrollView>
        )}

        {error ? (
          <Text variant="sm" tone="danger" accessibilityRole="alert" leading="snug">
            {error}
          </Text>
        ) : null}

        {pickingTrip ? null : (
          <Button onPress={() => void save()} loading={isSaving} fullWidth>
            {isBooked ? 'Record as booked' : 'Add to trip'}
          </Button>
        )}
      </View>
    </Modal>
  );
}
