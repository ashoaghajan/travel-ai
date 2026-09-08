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

const PACES: { id: TravelPreferences['pace']; label: string; hint: string }[] = [
  { id: 'relaxed', label: 'Relaxed', hint: 'Two things a day' },
  { id: 'balanced', label: 'Balanced', hint: 'Three things a day' },
  { id: 'packed', label: 'Packed', hint: 'Five things a day' },
];

/** `HH:MM` and nothing else — the planner reads this as a clock time. */
function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * An empty field means "no ceiling", which is null on the wire.
 *
 * Zero is a different and valid answer — free things only — so an empty string
 * must not be coerced with `Number`, which would turn "no limit" into "nothing
 * over $0" and empty the itinerary.
 */
function toBudget(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits === '') return null;

  const parsed = Number.parseInt(digits, 10);

  return Number.isFinite(parsed) ? parsed : null;
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
          impossible to edit.
        */}
        <Field
          label="Days start at"
          value={travel.dayStart}
          maxLength={5}
          invalid={!isTime(travel.dayStart)}
          onChangeText={(next) => onChange({ dayStart: next })}
        />
        <Field
          label="Nothing new after"
          value={travel.dayEnd}
          maxLength={5}
          invalid={!isTime(travel.dayEnd)}
          onChangeText={(next) => onChange({ dayEnd: next })}
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
