import { FlatList, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CURRENCIES } from '@ai-travel/shared';
import type { CurrencyCode } from '@ai-travel/shared';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/**
 * The currency chooser — what replaces the web's `<select>`.
 *
 * A sheet, like `CountryPicker`, but without its search box: that list is
 * about 200 countries and this one is nine currencies, so a filter would be a
 * text field nobody ever types in. Everything fits on screen at once.
 */
export function CurrencyPicker({
  selected,
  onSelect,
  onClose,
}: {
  selected: CurrencyCode;
  onSelect: (code: CurrencyCode) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

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
            Show prices in
          </Text>
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
        </View>

        <FlatList
          data={CURRENCIES}
          keyExtractor={(currency) => currency.code}
          contentContainerStyle={{ paddingBottom: theme.space.xl }}
          renderItem={({ item }) => {
            const isSelected = item.code === selected;

            return (
              <Pressable
                onPress={() => onSelect(item.code)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space.md,
                  paddingVertical: theme.space.md,
                  paddingHorizontal: theme.space.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: pressed ? theme.color.surfaceMuted : 'transparent',
                })}
              >
                <Text
                  variant="sm"
                  weight="semibold"
                  /*
                   * Fixed width so the names line up in a column: the codes are
                   * all three letters, but they are not all the same width.
                   */
                  style={{ width: 44 }}
                  tone={isSelected ? 'primary' : 'main'}
                >
                  {item.code}
                </Text>
                <Text variant="sm" tone={isSelected ? 'primary' : 'muted'} style={{ flex: 1 }}>
                  {item.name}
                </Text>
                {isSelected ? (
                  <Text variant="sm" tone="primary" weight="bold">
                    ✓
                  </Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}
