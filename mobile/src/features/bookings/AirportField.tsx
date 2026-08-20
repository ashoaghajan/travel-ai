import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import type { Airport } from '../../core/types/travel.types';
import { airportService } from '../../core/services/airport.service';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/** Long enough that typing a city is one query rather than five. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * One end of the route, type-to-search.
 *
 * The web's `AirportField` as a phone can have it. This replaces `OriginPicker`,
 * which asked only where the reader was flying *from* — fine while the trip
 * supplied the other half, and wrong once this screen grew the same editable
 * search the web has. Both ends are the same question, so both ends are the
 * same field.
 *
 * DIFFERS FROM WEB: no combobox roles, no arrow keys, and no outside-click
 * dismissal — there is no pointer to click outside with, and a phone has no
 * keyboard to walk a listbox. What replaces them is a list that stays up until
 * something is chosen, which is also why choosing does not have to race a blur
 * the way the web's `pointerdown` handler does.
 */
export function AirportField({
  label,
  value,
  onChange,
}: {
  label: string;
  /** The selected IATA code. */
  value: string;
  onChange: (code: string) => void;
}) {
  const theme = useTheme();

  /*
   * What has been typed, or null when the field is showing its selection.
   *
   * The web splits this into `isOpen` plus `query`; one nullable string says
   * the same thing here, because on this side the two always change together.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [results, setResults] = useState<Airport[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const selected = airportService.resolve(value);

  useEffect(() => {
    const wanted = draft?.trim();
    if (!wanted) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setIsSearching(true);

    const timer = setTimeout(() => {
      void airportService.search(wanted, controller.signal).then(
        (found) => {
          if (!active) return;
          setResults(found);
          setIsSearching(false);
        },
        () => {
          // An abort is this search being replaced; leaving the spinner up is
          // correct, because the newer search has already turned it on.
          if (active) setIsSearching(false);
        },
      );
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [draft]);

  return (
    <View style={{ gap: theme.space.xs }}>
      <Text variant="xs" weight="semibold" tone="muted" leading="tight">
        {label.toUpperCase()}
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
        // Idle, the field reads as the airport that is chosen; being edited, it
        // reads as what is being typed. The web's line for the same rule.
        value={draft ?? (selected ? airportService.format(selected) : value)}
        onChangeText={setDraft}
        // Clearing on focus rather than selecting-all: the reader who taps this
        // field is replacing the airport, not appending to its name.
        onFocus={() => setDraft('')}
        placeholder="City or airport"
        placeholderTextColor={theme.color.textMuted}
        accessibilityLabel={label}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      {isSearching && results.length === 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
          <ActivityIndicator size="small" color={theme.color.textMuted} />
          <Text variant="xs" tone="muted">
            Searching airports…
          </Text>
        </View>
      ) : null}

      {results.length > 0 ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: theme.color.border,
            borderRadius: theme.radius.lg,
            overflow: 'hidden',
          }}
        >
          {results.map((airport) => (
            <Pressable
              key={airport.code}
              onPress={() => {
                // Remembered so the screen can name this airport's city later
                // without a round trip. See `airport.service.ts`.
                airportService.remember(airport);
                onChange(airport.code);
                setDraft(null);
                setResults([]);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                { paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md },
                pressed && { backgroundColor: theme.color.primarySoft },
              ]}
            >
              <Text variant="sm" weight="semibold" leading="tight">
                {airport.code} · {airport.city}
              </Text>
              <Text variant="xs" tone="muted" leading="tight" numberOfLines={1}>
                {airport.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {draft?.trim() && !isSearching && results.length === 0 ? (
        <Text variant="xs" tone="muted" leading="snug">
          No airports match “{draft.trim()}”.
        </Text>
      ) : null}
    </View>
  );
}
