import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Country } from '../../core/services/country.service';
import { flagOf } from '../../core/utils/flag';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/**
 * The country chooser — what replaces the web's `<select>`.
 *
 * A phone has a native picker, and it was tempting to reach for one. But the
 * list is about 200 entries and the reader usually knows the name they want:
 * a wheel makes them scroll to it, where a search box makes them type three
 * letters. So this is a full-screen sheet with a filter at the top, which is
 * what a `<select>` over 200 options would be on a phone anyway once the OS
 * had finished with it.
 *
 * The filter is a plain `includes` rather than `cityService.filter`. That one
 * ranks prefix matches above mid-string ones because it is cutting 16,000
 * cities down to 50; 200 countries all fit on one scrollable list, so ranking
 * them would only move rows around under the reader's thumb.
 */
export function CountryPicker({
  countries,
  selectedCode,
  onSelect,
  onClose,
}: {
  countries: Country[];
  selectedCode: string | null;
  onSelect: (country: Country) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return countries;

    return countries.filter((country) => country.name.toLowerCase().includes(wanted));
  }, [countries, query]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View
        style={{
          flex: 1,
          backgroundColor: theme.color.background,
          paddingTop: insets.top + theme.space.lg,
          paddingBottom: insets.bottom,
          paddingHorizontal: theme.space.lg,
          gap: theme.space.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
          <Text variant="lg" weight="bold" leading="tight" style={{ flex: 1 }}>
            Choose a country
          </Text>
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
        </View>

        <TextInput
          style={{
            backgroundColor: theme.color.surface,
            borderColor: theme.color.border,
            borderWidth: 1,
            borderRadius: theme.radius.lg,
            paddingHorizontal: theme.space.lg,
            paddingVertical: theme.space.md,
            color: theme.color.textMain,
            fontSize: theme.fontSize.sm,
          }}
          value={query}
          onChangeText={setQuery}
          placeholder="Search countries…"
          placeholderTextColor={theme.color.textMuted}
          accessibilityLabel="Search countries"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />

        <FlatList
          data={visible}
          keyExtractor={(country) => country.code}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: theme.space.xl }}
          ListEmptyComponent={
            <Text variant="sm" tone="muted" style={{ paddingVertical: theme.space.lg }}>
              No country here is called “{query}”.
            </Text>
          }
          renderItem={({ item }) => {
            const isSelected = item.code === selectedCode;

            return (
              <Pressable
                onPress={() => onSelect(item)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.space.md,
                    paddingVertical: theme.space.md,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.color.border,
                  },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text variant="md" leading="tight">
                  {flagOf(item.code)}
                </Text>
                <Text
                  variant="sm"
                  weight={isSelected ? 'semibold' : 'regular'}
                  tone={isSelected ? 'primary' : 'main'}
                  leading="tight"
                  style={{ flex: 1 }}
                >
                  {item.name}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}
