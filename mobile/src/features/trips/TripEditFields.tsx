import { TextInput, View } from 'react-native';
import type { KeyboardTypeOptions } from 'react-native';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import type { TripEditDraft, TripEditErrors } from './editTrip';

/**
 * The trip's metadata: name, where, when, how many.
 *
 * The web puts these in a modal over the trip page, because it has the width
 * to keep the itinerary visible behind one. A phone does not, so on this side
 * they are a card at the top of the same screen and the whole screen goes into
 * edit mode together — one draft, one Save, one Cancel, rather than a dialog
 * for the title and a separate mode for the days.
 *
 * **The dates are typed, not picked.** React Native has no date input, and the
 * community picker is a native module: adding one means the app has to be
 * rebuilt and reinstalled before anybody can change a date, which is a heavy
 * price for a field that is edited rarely. So the format is stated in the
 * label, the keyboard opens on numbers, and `editTrip.validate` checks that
 * what was typed is a real calendar date — a check the web does not need,
 * because its input cannot produce anything else.
 */
export function TripEditFields({
  draft,
  errors,
  showErrors,
  onChange,
}: {
  draft: TripEditDraft;
  errors: TripEditErrors;
  /** Messages stay quiet until the reader has tried to save. */
  showErrors: boolean;
  onChange: <Field extends keyof TripEditDraft>(
    field: Field,
    value: TripEditDraft[Field],
  ) => void;
}) {
  const theme = useTheme();

  return (
    <Card padding="lg" elevation="soft">
      <View style={{ gap: theme.space.md }}>
        <Field
          label="TITLE"
          value={draft.title}
          onChangeText={(next) => onChange('title', next)}
          error={showErrors ? errors.title : undefined}
          placeholder="Name this trip"
          autoCapitalize="sentences"
        />

        <Field
          label="CITY"
          value={draft.destinationCity}
          onChangeText={(next) => onChange('destinationCity', next)}
          // The destination error belongs to the pair — either field can
          // satisfy it — so it is shown against the one most trips fill in.
          error={showErrors ? errors.destination : undefined}
          placeholder="Where are you going?"
          autoCapitalize="words"
        />

        <Field
          label="COUNTRY"
          value={draft.destinationCountry}
          onChangeText={(next) => onChange('destinationCountry', next)}
          placeholder="Optional"
          autoCapitalize="words"
        />

        <View style={{ flexDirection: 'row', gap: theme.space.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label="START (YYYY-MM-DD)"
              value={draft.startDate}
              onChangeText={(next) => onChange('startDate', next)}
              error={showErrors ? errors.startDate : undefined}
              placeholder="2026-09-08"
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="END (YYYY-MM-DD)"
              value={draft.endDate}
              onChangeText={(next) => onChange('endDate', next)}
              error={showErrors ? errors.endDate : undefined}
              placeholder="2026-09-13"
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        <Field
          label="TRAVELLERS"
          /*
           * Empty rather than "0" while the field is being cleared. `Number('')`
           * is 0, and showing that back would make the reader delete a digit
           * they did not type before they could enter their own.
           */
          value={draft.travellers > 0 ? String(draft.travellers) : ''}
          onChangeText={(next) => onChange('travellers', Number(next.replace(/\D/g, '')) || 0)}
          error={showErrors ? errors.travellers : undefined}
          placeholder="2"
          keyboardType="number-pad"
        />
      </View>
    </Card>
  );
}

function Field({
  label,
  value,
  onChangeText,
  error,
  placeholder,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  error?: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words';
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
          // The border is the error message's louder half — a sentence under a
          // field is easy to miss on a screen this narrow.
          borderColor: error ? theme.color.danger : theme.color.border,
          backgroundColor: theme.color.background,
          color: theme.color.textMain,
          fontSize: theme.fontSize.sm,
        }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textMuted}
        accessibilityLabel={label}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
      />

      {error ? (
        <Text variant="xs" tone="danger" leading="snug" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
