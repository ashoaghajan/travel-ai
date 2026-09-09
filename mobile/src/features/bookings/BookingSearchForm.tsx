import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import type { FlightSearchQuery, TripType } from '../../core/types/travel.types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { ArrowRightIcon } from '../../components/icons';
import { useTheme } from '../../theme/useTheme';
import { AirportField } from './AirportField';
import { useFlightOrigin } from '../../core/hooks/useFlightOrigin';

/** DESIGN_SPEC Screen 4 trip type tabs — the web's list, in its order. */
const TRIP_TYPES = [
  { id: 'round-trip', label: 'Round Trip' },
  { id: 'one-way', label: 'One Way' },
  { id: 'multi-city', label: 'Multi-city' },
] as const satisfies readonly { id: TripType; label: string }[];

const MAX_TRAVELLERS = 6;

/**
 * A real calendar date, not merely a plausible-looking one.
 *
 * `editTrip.isCalendarDate`, and for the same reason: the dates are typed here,
 * so the field can hold "next tuesday" or half a date. The pattern alone
 * accepts 2026-02-31 — round-tripping through `Date` catches it, because
 * JavaScript normalises an overflowing date rather than rejecting it.
 */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export type BookingSearchFormProps = {
  initialQuery: FlightSearchQuery;
  onOriginDefaulted?: (code: string) => void;
  onSearch: (query: FlightSearchQuery) => void;
  isSearching?: boolean;
  submitLabel?: string;
  submitBusyLabel?: string;
};

/**
 * The search this screen prices — the web's `FlightSearchForm` on a phone.
 *
 * This screen used to ask one question, where the reader was flying *from*,
 * and take the rest from the trip. That was true to what a trip records and
 * false to what the reader could actually change: the web's booking screen
 * carries the whole search, so route, dates and party size were editable in a
 * browser and fixed in the app, and the same trip priced two different things
 * depending on which one you opened. The fields are the web's now, in the
 * web's order, holding the same draft state and handing back the same
 * `FlightSearchQuery`.
 *
 * Three things a phone changes, none of them a field:
 *
 * - **The dates are typed, not picked.** React Native has no date input and
 *   the community picker is a native module — a new build of the app before
 *   anybody could change a date. `TripEditFields` made this trade first; this
 *   follows it, down to the format in the label and `isCalendarDate` checking
 *   what was typed is real. The web needs no such check, its input cannot
 *   produce anything else.
 * - **Travellers is a stepper, not a `<select>`.** The web's other selects
 *   became sheets, because 200 countries want a search box. Six do not: a
 *   sheet for "how many adults" is two taps and a full-screen takeover to move
 *   a number by one.
 * - **The submit button matters more.** A `<select>` and a date input commit
 *   on change, so the web's form is nearly live and its button is a
 *   formality; every field here is a keyboard, so nothing is committed until
 *   Update search is pressed.
 */
export function BookingSearchForm({
  initialQuery,
  onOriginDefaulted,
  onSearch,
  isSearching = false,
  submitLabel = 'Update search',
  submitBusyLabel = 'Updating…',
}: BookingSearchFormProps) {
  const theme = useTheme();

  const [tripType, setTripType] = useState<TripType>(initialQuery.tripType);
  const { from, changeFrom: setFrom, keepOrigin } = useFlightOrigin(
    initialQuery.from, true, onOriginDefaulted,
  );
  const [to, setTo] = useState(initialQuery.to);
  const [departDate, setDepartDate] = useState(initialQuery.departDate);
  const [returnDate, setReturnDate] = useState(initialQuery.returnDate ?? initialQuery.departDate);
  const [travellers, setTravellers] = useState(initialQuery.travellers);
  const [error, setError] = useState<string | null>(null);

  const wantsReturn = tripType === 'round-trip';

  /*
   * Editing anything takes the message down.
   *
   * DIFFERS FROM WEB: there the error survives until the next submit, and it
   * can afford to — its fields commit on change, so the reader fixes the
   * field and presses the button in one motion and the stale line is gone
   * before it is read. Here a correction is a keyboard, a result list and a
   * scroll, and "Choose where you are flying from and to" stayed on screen
   * under a filled-in From and To for as long as that took. A message that
   * describes the form as it was is worse than no message.
   */
  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setError(null);
    };
  }

  function swapAirports() {
    setFrom(to);
    setTo(from);
    setError(null);
  }

  function handleSubmit() {
    keepOrigin();
    if (!from || !to) {
      setError('Choose where you are flying from and to.');
      return;
    }
    if (from === to) {
      setError('Choose two different airports.');
      return;
    }
    // Typed, so it has to be checked. The web's date input cannot hand back
    // anything but a real date, and has no equivalent of this message.
    if (!isCalendarDate(departDate)) {
      setError('Use a departure date like 2026-09-08.');
      return;
    }
    if (wantsReturn && !isCalendarDate(returnDate)) {
      setError('Use a return date like 2026-09-13.');
      return;
    }
    if (wantsReturn && returnDate < departDate) {
      setError('The return date cannot be before the departure date.');
      return;
    }

    setError(null);
    onSearch({
      tripType,
      from,
      to,
      departDate,
      returnDate: wantsReturn ? returnDate : undefined,
      travellers,
    });
  }

  return (
    <Card padding="lg" elevation="card">
      <View style={{ gap: theme.space.md }}>
        <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
          {TRIP_TYPES.map((type) => {
            const isActive = type.id === tripType;

            return (
              <Pressable
                key={type.id}
                onPress={() => edited(setTripType)(type.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: theme.space.sm,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: isActive ? theme.color.primary : theme.color.border,
                    backgroundColor: isActive ? theme.color.primary : theme.color.surface,
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text
                  variant="xs"
                  weight="semibold"
                  tone={isActive ? 'light' : 'muted'}
                  leading="tight"
                >
                  {type.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/*
          Stacked, where the web puts the two airports side by side with the
          swap between them. Each is a search field with a result list under it,
          and two of those in a 180pt column would be unusable.
        */}
        <AirportField label="From" value={from} onChange={edited(setFrom)} onFocus={keepOrigin} />

        <Pressable
          onPress={swapAirports}
          accessibilityRole="button"
          accessibilityLabel="Swap origin and destination"
          style={({ pressed }) => [
            {
              alignSelf: 'flex-end',
              minHeight: 44,
              minWidth: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.pill,
              borderWidth: 1,
              borderColor: theme.color.border,
              backgroundColor: theme.color.surface,
              // The web can rotate its arrow to point across the two fields.
              // Stacked, the swap is vertical, so the icon is turned to match.
              transform: [{ rotate: '90deg' }],
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <ArrowRightIcon size={18} color={theme.color.textMuted} />
        </Pressable>

        <AirportField label="To" value={to} onChange={edited(setTo)} />

        <View style={{ flexDirection: 'row', gap: theme.space.md }}>
          <View style={{ flex: 1 }}>
            <DateField
              label="DEPART (YYYY-MM-DD)"
              value={departDate}
              onChangeText={edited(setDepartDate)}
              placeholder="2026-09-08"
            />
          </View>

          {wantsReturn ? (
            <View style={{ flex: 1 }}>
              <DateField
                label="RETURN (YYYY-MM-DD)"
                value={returnDate}
                onChangeText={edited(setReturnDate)}
                placeholder="2026-09-13"
              />
            </View>
          ) : null}
        </View>

        <View style={{ gap: theme.space.xs }}>
          <Text variant="xs" weight="semibold" tone="muted" leading="tight">
            TRAVELLERS
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
            <Stepper
              label="One fewer traveller"
              symbol="−"
              disabled={travellers <= 1}
              onPress={() => edited(setTravellers)((count) => Math.max(1, count - 1))}
            />

            <Text variant="sm" weight="semibold" leading="tight" style={{ flex: 1, textAlign: 'center' }}>
              {travellers} {travellers === 1 ? 'Adult' : 'Adults'}
            </Text>

            <Stepper
              label="One more traveller"
              symbol="+"
              disabled={travellers >= MAX_TRAVELLERS}
              onPress={() => edited(setTravellers)((count) => Math.min(MAX_TRAVELLERS, count + 1))}
            />
          </View>
        </View>

        {tripType === 'multi-city' ? (
          <Text variant="xs" tone="muted" leading="snug">
            Extra legs arrive in a later stage — this searches the first leg only.
          </Text>
        ) : null}

        {error ? (
          <Text variant="xs" tone="danger" leading="snug" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Button variant="primary" size="lg" fullWidth disabled={isSearching} onPress={handleSubmit}>
          {isSearching ? submitBusyLabel : submitLabel}
        </Button>
      </View>
    </Card>
  );
}

/** A typed date. See the docblock for why it is typed and not picked. */
function DateField({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
}) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.space.xs }}>
      <Text variant="xs" weight="semibold" tone="muted" leading="tight">
        {label}
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
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textMuted}
        accessibilityLabel={label}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

/** One end of the travellers control. */
function Stepper({
  label,
  symbol,
  disabled,
  onPress,
}: {
  label: string;
  symbol: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        {
          minHeight: 44,
          minWidth: 44,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radius.pill,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.background,
          opacity: disabled ? 0.4 : 1,
        },
        pressed && !disabled && { backgroundColor: theme.color.primarySoft },
      ]}
    >
      <Text variant="md" weight="semibold" tone={disabled ? 'muted' : 'main'} leading="tight">
        {symbol}
      </Text>
    </Pressable>
  );
}
