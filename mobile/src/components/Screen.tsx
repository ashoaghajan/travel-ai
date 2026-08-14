import { ScrollView, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';

/**
 * The page frame: background, safe areas, and the status bar.
 *
 * Every screen sits in one of these, so the three things that are easy to get
 * subtly wrong on a phone are got right in one place — the notch, the home
 * indicator, and a status bar whose text has to invert with the theme.
 *
 * **The insets are applied as padding, not as a `SafeAreaView` wrapper.** A
 * scrolling screen must paint its background *under* the home indicator while
 * keeping its content clear of it; a wrapper that insets the view itself
 * leaves a stripe of page colour at the bottom of every scroll.
 *
 * `scroll` defaults to true because most screens are lists. The exception is a
 * screen that owns its own scrolling — a chat transcript, a map — where a
 * second scroll container would fight the first.
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const padding = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };

  const inner = padded ? { padding: theme.space.lg, gap: theme.space.md } : undefined;

  return (
    <View style={[styles.root, { backgroundColor: theme.color.background }]}>
      {/* Inverted against the theme, not the OS: somebody on a dark phone who
          chose the light theme needs dark status text, and vice versa. */}
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />

      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[padding, inner]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, padding, inner]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
});
