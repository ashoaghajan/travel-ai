import { Pressable, View } from 'react-native';
import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * The white rounded surface the whole product is built from.
 *
 * `elevation` names which shadow, matching the web `Card`'s prop of the same
 * name — `card` for something that sits above the page, `soft` for something
 * that barely lifts, `none` for a bordered panel.
 *
 * **Android needs the border even when it has elevation.** In dark mode the
 * surface is `#171a21` on a `#0f1117` page: a shadow is nearly invisible at
 * that contrast, and the border is the only thing making the card an object.
 * The web gets away without one because its shadow reads on white.
 */

export type CardProps = {
  children: ReactNode;
  padding?: 'none' | 'md' | 'lg';
  elevation?: 'none' | 'soft' | 'card';
  onPress?: () => void;
  style?: ViewStyle;
};

export function Card({
  children,
  padding = 'lg',
  elevation = 'card',
  onPress,
  style,
}: CardProps) {
  const theme = useTheme();

  const surface: ViewStyle = {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: padding === 'none' ? 0 : theme.space[padding],
    ...(elevation === 'none' ? {} : theme.shadow[elevation]),
  };

  if (!onPress) return <View style={[surface, style]}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [surface, pressed && { opacity: 0.9 }, style]}
    >
      {children}
    </Pressable>
  );
}
