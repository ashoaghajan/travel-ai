import { Text as RNText } from 'react-native';
import type { TextProps as RNTextProps } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { lineHeightFor } from '../theme/tokens';

/**
 * Text that knows the type scale and the theme.
 *
 * Two things RN gets wrong by default, fixed once here rather than in every
 * screen. **Text does not inherit** — a `<Text>` inside a styled parent picks
 * up nothing, so an unstyled label is black on a dark background. And
 * `lineHeight` takes pixels, not the multipliers the design system is written
 * in, so leading gets eyeballed per component and drifts.
 *
 * `tone` rather than `color`: the choices are the roles the design system
 * names, so a screen cannot reach for an arbitrary colour without saying why.
 */

type Variant = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
type Tone = 'main' | 'muted' | 'light' | 'primary' | 'danger' | 'success';
type Weight = 'regular' | 'medium' | 'semibold' | 'bold';

export type TextProps = RNTextProps & {
  variant?: Variant;
  tone?: Tone;
  weight?: Weight;
  /** Leading. Headings want `tight`, body wants `base`. */
  leading?: 'tight' | 'snug' | 'base';
};

export function Text({
  variant = 'sm',
  tone = 'main',
  weight = 'regular',
  leading = 'base',
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();

  const color = {
    main: theme.color.textMain,
    muted: theme.color.textMuted,
    light: theme.color.textLight,
    primary: theme.color.primary,
    danger: theme.color.danger,
    success: theme.color.success,
  }[tone];

  const size = theme.fontSize[variant];

  return (
    <RNText
      style={[
        {
          color,
          fontSize: size,
          fontWeight: theme.fontWeight[weight],
          lineHeight: lineHeightFor(size, leading),
        },
        style,
      ]}
      {...rest}
    />
  );
}
