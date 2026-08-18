import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import type { Airport } from '../../core/types/travel.types';
import { airportService } from '../../core/services/airport.service';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/** Long enough that typing a city is one query rather than five. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Where the reader is flying *from*.
 *
 * The one thing a trip cannot tell us. It records where somebody is going and
 * when, and `useDestinationAirport` turns that into an arrival airport without
 * being asked — but nothing in a trip says which airport they leave from, and
 * a fare search is meaningless without it. The web gets it from the flight
 * search form on `/flights`, which this app has no equivalent of.
 *
 * So it is one field rather than the web's whole form: the other half of the
 * route, the dates and the party size all come from the trip already, and
 * asking for them again here would be asking the reader to retype what they
 * have on screen.
 *
 * The choice is remembered by `airportService.remember`, so the next trip
 * opens on the airport this one used.
 */
export function OriginPicker({
  value,
  onSelect,
}: {
  value: string | null;
  onSelect: (airport: Airport) => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Airport[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const wanted = query.trim();
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
  }, [query]);

  return (
    <View style={{ gap: theme.space.xs }}>
      <Text variant="xs" weight="semibold" tone="muted" leading="tight">
        FLYING FROM
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
        value={query}
        onChangeText={setQuery}
        placeholder={value ? `${value} — change it` : 'Airport or city'}
        placeholderTextColor={theme.color.textMuted}
        accessibilityLabel="Departure airport"
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
                airportService.remember(airport);
                onSelect(airport);
                setQuery('');
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
    </View>
  );
}
