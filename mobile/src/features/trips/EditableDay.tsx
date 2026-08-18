import { TextInput, View } from 'react-native';
import type { ItineraryActivity, ItineraryDay } from '../../core/types/trip.types';
import { formatWeekdayDate } from '../../core/utils/date';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import type { TripEditErrors } from './editTrip';

/**
 * One day, with its activities open for editing.
 *
 * The read-only `Day` stays exactly as it was rather than growing a mode flag:
 * the two have almost no layout in common — three text inputs and a Remove
 * button per row against a single line of text — and threading `isEditing`
 * through every element of the quiet version would make the common case harder
 * to read for the sake of the rare one.
 *
 * The day itself is not editable. Its date, number, photograph and summary come
 * from the planner, and `TripPatch` carries the itinerary whole, so a reader
 * retyping a day's destination here would silently disagree with the map pin
 * and the route line drawn from the same field.
 */
export function EditableDay({
  day,
  errors,
  showErrors,
  onEditActivity,
  onRemoveActivity,
  onAddActivity,
}: {
  day: ItineraryDay;
  errors: TripEditErrors;
  showErrors: boolean;
  onEditActivity: (
    activityId: string,
    patch: Partial<Pick<ItineraryActivity, 'title' | 'description' | 'time'>>,
  ) => void;
  onRemoveActivity: (activityId: string) => void;
  onAddActivity: () => void;
}) {
  const theme = useTheme();

  return (
    <Card padding="lg" elevation="soft">
      <View style={{ gap: theme.space.md }}>
        <View style={{ gap: 2 }}>
          <Text variant="xs" tone="primary" weight="semibold">
            DAY {day.dayNumber} · {formatWeekdayDate(day.date)}
          </Text>
          <Text variant="md" weight="semibold" leading="tight">
            {day.destination}
          </Text>
        </View>

        {day.activities.map((activity) => (
          <ActivityRow
            key={activity.id}
            activity={activity}
            error={showErrors ? errors.activities?.[activity.id] : undefined}
            onEdit={(patch) => onEditActivity(activity.id, patch)}
            onRemove={() => onRemoveActivity(activity.id)}
          />
        ))}

        {day.activities.length === 0 ? (
          <Text variant="xs" tone="muted" leading="snug">
            Nothing planned for this day yet.
          </Text>
        ) : null}

        <Button variant="secondary" fullWidth onPress={onAddActivity}>
          Add activity
        </Button>
      </View>
    </Card>
  );
}

function ActivityRow({
  activity,
  error,
  onEdit,
  onRemove,
}: {
  activity: ItineraryActivity;
  error?: string;
  onEdit: (patch: Partial<Pick<ItineraryActivity, 'title' | 'description' | 'time'>>) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();

  const input = {
    minHeight: 44,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: error ? theme.color.danger : theme.color.border,
    backgroundColor: theme.color.background,
    color: theme.color.textMain,
    fontSize: theme.fontSize.sm,
  };

  return (
    <View
      style={{
        gap: theme.space.sm,
        paddingTop: theme.space.md,
        borderTopWidth: 1,
        borderTopColor: theme.color.border,
      }}
    >
      <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
        {/* Wide enough for "09:30" and no wider — the title is what needs room. */}
        <TextInput
          style={[input, { width: 76, textAlign: 'center' }]}
          value={activity.time}
          onChangeText={(time) => onEdit({ time })}
          placeholder="09:30"
          placeholderTextColor={theme.color.textMuted}
          accessibilityLabel="Time"
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
        />

        <TextInput
          style={[input, { flex: 1 }]}
          value={activity.title}
          onChangeText={(title) => onEdit({ title })}
          placeholder="What are you doing?"
          placeholderTextColor={theme.color.textMuted}
          accessibilityLabel="Activity title"
          autoCapitalize="sentences"
        />
      </View>

      <TextInput
        style={[input, { minHeight: 44 }]}
        value={activity.description}
        onChangeText={(description) => onEdit({ description })}
        placeholder="Notes (optional)"
        placeholderTextColor={theme.color.textMuted}
        accessibilityLabel="Activity description"
        autoCapitalize="sentences"
      />

      {error ? (
        <Text variant="xs" tone="danger" leading="snug" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <View style={{ alignItems: 'flex-start' }}>
        <Button variant="secondary" onPress={onRemove}>
          Remove
        </Button>
      </View>
    </View>
  );
}
