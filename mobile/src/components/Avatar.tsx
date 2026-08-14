import { Image, View } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme/useTheme';

/**
 * A round avatar, falling back to initials.
 *
 * The web's `Avatar`, sizes and colours included, with `initialsOf` copied
 * exactly — two initials, upper case, skipping the empty strings that a double
 * space would otherwise turn into blanks.
 *
 * The web hides the initials from screen readers and puts the full name in a
 * visually-hidden span beside them, because "AB" read aloud is not a name.
 * React Native has no such split, so the same effect comes from labelling the
 * whole view with the name and hiding what is inside it.
 */

type Size = 'sm' | 'md' | 'lg';

const METRICS: Record<Size, { box: number; variant: 'xs' | 'sm' | 'lg' }> = {
  sm: { box: 32, variant: 'xs' },
  md: { box: 40, variant: 'sm' },
  lg: { box: 64, variant: 'lg' },
};

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ name, src, size = 'md' }: { name: string; src?: string; size?: Size }) {
  const theme = useTheme();
  const { box, variant } = METRICS[size];

  return (
    <View
      accessible
      accessibilityLabel={name}
      style={{
        width: box,
        height: box,
        borderRadius: box / 2,
        backgroundColor: theme.color.primarySoft,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {src ? (
        <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : (
        <Text variant={variant} weight="semibold" tone="primary" leading="tight">
          {initialsOf(name)}
        </Text>
      )}
    </View>
  );
}
