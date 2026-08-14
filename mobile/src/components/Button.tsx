import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';

/**
 * The one button primitive, mirroring the web app's variants and sizes so the
 * two clients cannot drift into different button vocabularies.
 *
 * Differences from the web version, all forced by the platform:
 *
 * - **`Pressable`, not `<button>`.** There is no `:hover` on a phone, so the
 *   hover variants in `Button.module.css` have no counterpart. What replaces
 *   them is a pressed state, which the web does not have.
 * - **`loading` is new.** The web can leave a button enabled while a request
 *   is in flight because a second click is cheap to ignore; a tap that appears
 *   to do nothing reads as a broken app, so the state is shown.
 * - **`glass` is not ported.** It exists for the landing page's photographic
 *   backgrounds and depends on `backdrop-filter`, which RN has no equivalent
 *   for. It comes back with `expo-blur` when a screen needs it.
 */

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'md' | 'lg';

export type ButtonProps = {
  children: ReactNode;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
};

/** Height and padding per size — the web's `.md` / `.lg` rules. */
const SIZES = {
  md: { minHeight: 44, paddingHorizontal: 24, variant: 'sm' },
  lg: { minHeight: 52, paddingHorizontal: 32, variant: 'md' },
} as const;

export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  loading = false,
  leadingIcon,
}: ButtonProps) {
  const theme = useTheme();
  const metrics = SIZES[size];

  // A button doing something is not a button you may press again.
  const inert = disabled || loading;

  const palette = {
    primary: {
      backgroundColor: theme.color.primary,
      borderColor: 'transparent',
      tone: 'light' as const,
      shadow: theme.shadow.primary,
    },
    secondary: {
      backgroundColor: theme.color.surface,
      borderColor: theme.color.border,
      tone: 'main' as const,
      shadow: theme.shadow.soft,
    },
    danger: {
      backgroundColor: theme.color.danger,
      borderColor: 'transparent',
      tone: 'light' as const,
      shadow: theme.shadow.soft,
    },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: metrics.minHeight,
          paddingHorizontal: metrics.paddingHorizontal,
          borderRadius: theme.radius.lg,
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
        },
        palette.shadow,
        fullWidth && styles.fullWidth,
        // The web lifts on hover and settles on press; a phone only has the
        // press, so that is where the feedback goes.
        pressed && styles.pressed,
        inert && styles.inert,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={palette.tone === 'light' ? theme.color.textLight : theme.color.textMain}
        />
      ) : (
        <>
          {leadingIcon ? <View style={styles.icon}>{leadingIcon}</View> : null}
          <Text variant={metrics.variant} weight="semibold" tone={palette.tone} leading="tight">
            {children}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
  },
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  /* The web uses 0.55; matched rather than re-chosen. */
  inert: { opacity: 0.55 },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
