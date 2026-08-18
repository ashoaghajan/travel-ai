import { Linking, View } from 'react-native';
import type { Partner } from '../../core/types/travel.types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/**
 * Partner booking card (DESIGN_SPEC Screen 7): brand-coloured placeholder
 * logo, name, one line of description and a View Deals action.
 *
 * Deliberately simpler than a checkout card — booking happens off-app, which
 * on a phone means `Linking.openURL` and the system browser rather than an
 * anchor. The colours come from the partner record rather than the theme, so
 * they are the two places in this app that do not go through `useTheme`;
 * `brandTextColor` ships alongside `brandColor` for exactly that reason, since
 * a light-on-light tile would be unreadable.
 */
export function PartnerCard({ partner, href }: { partner: Partner; href: string }) {
  const theme = useTheme();
  const { name, description, brandColor, brandTextColor, initials } = partner;

  return (
    <Card padding="lg" elevation="soft">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: theme.radius.md,
            backgroundColor: brandColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="sm" weight="bold" leading="tight" style={{ color: brandTextColor }}>
            {initials}
          </Text>
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="md" weight="semibold" leading="tight">
            {name}
          </Text>
          <Text variant="xs" tone="muted" leading="snug">
            {description}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: theme.space.md }}>
        <Button
          variant="secondary"
          fullWidth
          onPress={() => void Linking.openURL(href)}
        >
          View Deals
        </Button>
      </View>
    </Card>
  );
}
