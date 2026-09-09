import { useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import type { TravelPreferences } from '../../core/types/planner.types';
import type { ActivityCategory } from '../../core/types/trip.types';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import { SettingsSection } from './SettingsSection';

/**
 * The preferences the itinerary scheduler plans against.
 *
 * A port of `src/features/settings/components/PlanningSection.tsx`, with the
 * two controls the web gets from the platform rebuilt:
 *
 * - **The hours are typed, not picked.** There is no `<input type="time">`
 *   here, and the same call was already made for trip editing — dates are
 *   typed rather than opening a native picker. A four-character field somebody
 *   can correct beats a wheel that costs a modal.
 * - **The weights are five buttons, not a slider.** A `Slider` for a five-stop
 *   scale is a drag gesture to say a word, on a control that has to sit inside
 *   a scroll view that also wants vertical drags. Five taps are unambiguous
 *   and reachable.
 */

const CHOOSABLE: { id: ActivityCategory; label: string; hint: string }[] = [
  { id: 'culture', label: 'Culture & history', hint: 'Museums, old towns, architecture' },
  { id: 'nature', label: 'Nature', hint: 'Parks, beaches, viewpoints' },
  { id: 'food', label: 'Food & drink', hint: 'Markets, restaurants, tastings' },
  { id: 'adventure', label: 'Adventure', hint: 'Diving, climbing, volcanoes' },
  { id: 'relaxation', label: 'Relaxation', hint: 'Spas, quiet corners, slow mornings' },
];

/** The five stops, and the words for them. Zero excludes rather than lowers. */
const WEIGHTS = [
  { value: 0, label: 'Never' },
  { value: 0.25, label: 'Rarely' },
  { value: 0.5, label: 'Sometimes' },
  { value: 0.75, label: 'Often' },
  { value: 1, label: 'Lots' },
];

/**
 * The radii offered, in whole kilometres, with "no limit" as the first stop.
 *
 * Chips rather than a typed number, for the reason `TimeField` exists: the
 * server accepts 1–100, and anything a box can hold that the server will not
 * take is a preference that appears to revert. A row of chips cannot be wrong.
 */
const DISTANCES: { value: number | null; label: string }[] = [
  { value: null, label: 'No limit' },
  { value: 1, label: '1 km' },
  { value: 2, label: '2 km' },
  { value: 3, label: '3 km' },
  { value: 5, label: '5 km' },
  { value: 10, label: '10 km' },
];

const PACES: { id: TravelPreferences['pace']; label: string; hint: string }[] = [
  { id: 'relaxed', label: 'Relaxed', hint: 'Two things a day' },
  { id: 'balanced', label: 'Balanced', hint: 'Three things a day' },
  { id: 'packed', label: 'Packed', hint: 'Five things a day' },
];

/** `HH:MM` and nothing else — the planner reads this as a clock time. */
function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** The largest budget the API will store — a typo, past here, is not a budget. */
const MAX_BUDGET = 100_000;

/**
 * An empty field means "no ceiling", which is null on the wire.
 *
 * Zero is a different and valid answer — free things only — so an empty string
 * must not be coerced with `Number`, which would turn "no limit" into "nothing
 * over $0" and empty the itinerary.
 *
 * Held to the ceiling the schema enforces, for the reason `TimeField` holds
 * the times to theirs: six digits fit in this box and the server refuses
 * anything over a hundred thousand, so an unclamped one is a 422 that takes
 * the pace and the weights down with it.
 */
function toBudget(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits === '') return null;

  const parsed = Number.parseInt(digits, 10);

  return Number.isFinite(parsed) ? Math.min(parsed, MAX_BUDGET) : null;
}

function Field({
  label,
  value,
  placeholder,
  onChangeText,
  keyboardType,
  maxLength,
  invalid,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChangeText: (next: string) => void;
  keyboardType?: 'numeric' | 'default';
  maxLength?: number;
  invalid?: boolean;
}) {
  const theme = useTheme();

  return (
    <View style={{ flex: 1, gap: theme.space.xs }}>
      <Text variant="xs" tone="muted" weight="medium">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textMuted}
        keyboardType={keyboardType ?? 'default'}
        maxLength={maxLength}
        accessibilityLabel={label}
        style={{
          borderWidth: 1,
          borderColor: invalid ? theme.color.danger : theme.color.border,
          borderRadius: theme.radius.md,
          paddingVertical: theme.space.sm,
          paddingHorizontal: theme.space.md,
          color: theme.color.textMain,
          backgroundColor: theme.color.surface,
          fontSize: 15,
        }}
      />
    </View>
  );
}

/**
 * A time somebody is part-way through typing.
 *
 * The draft is what the box shows; only a complete `HH:MM` is handed up. The
 * comment below the header has always promised this, and the code did the
 * opposite — it wrote every keystroke back — which made both time fields
 * impossible to edit and took the rest of this section down with them.
 *
 * The server validates `dayStart` and `dayEnd` against the same regex `isTime`
 * uses, so every prefix of a time is a 422: "0", "09", "09:" and "09:3" are
 * all refused. `useSettings` treats a refusal as "this preference was never
 * stored" and puts the old value back, so the first keystroke bounced. With
 * `maxLength` at 5 the field cannot be typed into at all — a change has to
 * start with a deletion, and the deletion is what got rejected.
 *
 * And it did not stop at the two boxes. `setTravel` sends the *whole* travel
 * object, read from a cache that `settingsService.save` writes to before the
 * request rather than after, so a half-typed hour sat in the cache while its
 * request was in flight and rode along with whatever was touched next. That is
 * why choosing a pace came back as refused too: nothing was wrong with the
 * pace, it was travelling with an invalid time.
 *
 * A new `value` from above is adopted — a save landing, or the account's
 * settings arriving — but it cannot interrupt typing, because while the draft
 * is not a time nothing has been sent and so nothing can come back.
 */
function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [adopted, setAdopted] = useState(value);

  // Adjusted during render rather than in an effect: an effect would paint the
  // stale value for a frame first, which on a field somebody is typing into
  // reads as the keystroke being undone and then redone.
  if (value !== adopted) {
    setAdopted(value);
    setDraft(value);
  }

  return (
    <Field
      label={label}
      value={draft}
      maxLength={5}
      invalid={!isTime(draft)}
      onChangeText={(next) => {
        setDraft(next);
        if (isTime(next)) onCommit(next);
      }}
    />
  );
}

export function PlanningSection({
  travel,
  onChange,
}: {
  travel: TravelPreferences;
  onChange: (patch: Partial<TravelPreferences>) => void;
}) {
  const theme = useTheme();

  return (
    <SettingsSection
      title="Planning"
      description="How a generated trip should be put together. These apply to every trip the planner builds for you."
    >
      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
        {/*
          Written back only when it is a real time, so a half-typed "1" does
          not become the start of somebody's day. The field itself shows what
          was typed either way — rejecting the keystroke would make the box
          impossible to edit. See `TimeField`, which is where that happens.
        */}
        <TimeField
          label="Days start at"
          value={travel.dayStart}
          onCommit={(next) => onChange({ dayStart: next })}
        />
        <TimeField
          label="Nothing new after"
          value={travel.dayEnd}
          onCommit={(next) => onChange({ dayEnd: next })}
        />
      </View>

      <Text variant="xs" tone="muted" leading="snug">
        Times as 24-hour, like 09:30. Dinner is still planned for the evening — the second time is
        about when the day stops starting new things.
      </Text>

      <View style={{ gap: theme.space.sm }}>
        <Text variant="sm" weight="medium">
          Pace
        </Text>
        {PACES.map((option) => {
          const isSelected = travel.pace === option.id;

          return (
            <Pressable
              key={option.id}
              onPress={() => onChange({ pace: option.id })}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={option.label}
              accessibilityHint={option.hint}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.md,
                paddingVertical: theme.space.md,
                paddingHorizontal: theme.space.lg,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: isSelected ? theme.color.accent : theme.color.border,
                backgroundColor: isSelected ? theme.color.primarySoft : 'transparent',
              }}
            >
              <Text variant="sm" weight={isSelected ? 'semibold' : 'medium'} style={{ flex: 1 }}>
                {option.label}
              </Text>
              <Text variant="xs" tone="muted">
                {option.hint}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: theme.space.md }}>
        <Text variant="sm" weight="medium">
          What you like
        </Text>

        {CHOOSABLE.map((category) => {
          const weight = travel.categoryWeights[category.id] ?? 0.5;

          return (
            <View key={category.id} style={{ gap: theme.space.xs }}>
              <Text variant="sm" weight="medium">
                {category.label}
              </Text>
              <Text variant="xs" tone="muted" leading="snug">
                {category.hint}
              </Text>

              <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
                {WEIGHTS.map((step) => {
                  const isSelected = weight === step.value;

                  return (
                    <Pressable
                      key={step.value}
                      onPress={() =>
                        onChange({
                          categoryWeights: {
                            ...travel.categoryWeights,
                            [category.id]: step.value,
                          },
                        })
                      }
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`${category.label}: ${step.label}`}
                      style={{
                        flex: 1,
                        paddingVertical: theme.space.sm,
                        borderRadius: theme.radius.sm,
                        borderWidth: 1,
                        borderColor: isSelected ? theme.color.accent : theme.color.border,
                        backgroundColor: isSelected ? theme.color.primarySoft : 'transparent',
                        alignItems: 'center',
                      }}
                    >
                      <Text
                        variant="xs"
                        weight={isSelected ? 'semibold' : 'regular'}
                        tone={isSelected ? 'primary' : 'muted'}
                        numberOfLines={1}
                      >
                        {step.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
        <Field
          label="Most per activity"
          value={travel.maxActivityPrice === null ? '' : String(travel.maxActivityPrice)}
          placeholder="No limit"
          keyboardType="numeric"
          maxLength={6}
          onChangeText={(next) => onChange({ maxActivityPrice: toBudget(next) })}
        />
        <Field
          label="Most per day"
          value={travel.dailyActivityBudget === null ? '' : String(travel.dailyActivityBudget)}
          placeholder="No limit"
          keyboardType="numeric"
          maxLength={6}
          onChangeText={(next) => onChange({ dailyActivityBudget: toBudget(next) })}
        />
      </View>

      {/* Only a bookable product carries a real price; an attraction has none,
          and a budget that excluded them would empty the trip. */}
      <Text variant="xs" tone="muted" leading="snug">
        In US dollars, per person. Places with no published price are never excluded by a budget —
        most attractions do not publish one.
      </Text>

      <View style={{ gap: theme.space.sm }}>
        <Text variant="sm" weight="medium">
          Distance from your hotel
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
          {DISTANCES.map((option) => {
            const isSelected = travel.maxDistanceFromHotelKm === option.value;

            return (
              <Pressable
                key={option.label}
                onPress={() => onChange({ maxDistanceFromHotelKm: option.value })}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={option.label}
                style={{
                  paddingVertical: theme.space.sm,
                  paddingHorizontal: theme.space.lg,
                  borderRadius: theme.radius.pill,
                  borderWidth: 1,
                  borderColor: isSelected ? theme.color.accent : theme.color.border,
                  backgroundColor: isSelected ? theme.color.primarySoft : 'transparent',
                }}
              >
                <Text
                  variant="xs"
                  weight={isSelected ? 'semibold' : 'regular'}
                  tone={isSelected ? 'primary' : 'muted'}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/*
          Which point the radius runs from, said out loud. The planner runs
          before anything is booked, so this is usually the middle of the city
          rather than a hotel — and those are different promises.
        */}
        <Text variant="xs" tone="muted" leading="snug">
          Measured from your hotel when you have one booked and not yet attached to a trip, and from
          the middle of the destination when you do not. Straight-line distance.
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="sm" weight="medium" leading="tight">
            Only near a metro station
          </Text>
          <Text variant="xs" tone="muted" leading="snug">
            Nothing more than a ten-minute walk from the metro. Ignored where there is no metro,
            rather than emptying the trip.
          </Text>
        </View>
        <Switch
          value={travel.nearMetroOnly}
          onValueChange={(checked) => onChange({ nearMetroOnly: checked })}
          accessibilityLabel="Only near a metro station"
          trackColor={{ false: theme.color.surfaceMuted, true: theme.color.primary }}
        />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="sm" weight="medium" leading="tight">
            Plan a lunch
          </Text>
          <Text variant="xs" tone="muted" leading="snug">
            Hold the middle of the day open and find somewhere near it.
          </Text>
        </View>
        <Switch
          value={travel.meals.lunch}
          onValueChange={(checked) => onChange({ meals: { ...travel.meals, lunch: checked } })}
          accessibilityLabel="Plan a lunch"
          trackColor={{ false: theme.color.surfaceMuted, true: theme.color.primary }}
        />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="sm" weight="medium" leading="tight">
            Plan a dinner
          </Text>
          <Text variant="xs" tone="muted" leading="snug">
            Finish the day somewhere to eat.
          </Text>
        </View>
        <Switch
          value={travel.meals.dinner}
          onValueChange={(checked) => onChange({ meals: { ...travel.meals, dinner: checked } })}
          accessibilityLabel="Plan a dinner"
          trackColor={{ false: theme.color.surfaceMuted, true: theme.color.primary }}
        />
      </View>
    </SettingsSection>
  );
}
