import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/**
 * One titled card of related preferences, for consistent spacing.
 *
 * The web's version of this component (`SettingsSection.module.css`) is the
 * same three parts — heading, optional description, body — and the same card
 * around them; only the styling mechanism differs.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const theme = useTheme();

  return (
    <Card padding="lg" elevation="soft">
      <View style={{ gap: theme.space.md }}>
        <View style={{ gap: 4 }}>
          <Text variant="md" weight="semibold" leading="tight">
            {title}
          </Text>
          {description ? (
            <Text variant="xs" tone="muted" leading="snug">
              {description}
            </Text>
          ) : null}
        </View>

        <View style={{ gap: theme.space.md }}>{children}</View>
      </View>
    </Card>
  );
}
