import { TouchableOpacity, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { SettingsIcon } from './icons';
import { Text } from './Text';
import { useTheme } from '../theme/useTheme';

/**
 * The top row of a tab screen: the way into settings, and the screen's title.
 *
 * **This exists because a phone has no sidebar.** On the web, Settings sits in
 * the sidebar's account group (`navigation.config.ts`, `ACCOUNT_NAV`) beside
 * Profile and Friends. The bottom bar is built from `BOTTOM_NAV`, which is the
 * main four plus Friends and Profile — Settings is deliberately not in it, and
 * six tabs is already the most that bar can hold. So the page the sidebar
 * reaches needed a door of its own on this side, and this is it.
 *
 * Left rather than right, which is the less conventional corner on Android for
 * a header action. Two reasons: the right is where a screen's own actions
 * belong, and settings is not one of them; and the right is also where the OS
 * parks floating overlays — an accessibility button, an assistant bubble — so
 * an app gear there ends up stacked under a system one.
 *
 * `title` is optional because two of the six tabs do not have one. The planner
 * opens straight into the conversation and the profile opens on the account
 * card, and giving either a heading to sit under would be inventing chrome to
 * keep this component company.
 */
export function ScreenHeader({
  title,
  style,
}: {
  title?: string;
  /*
   * Spacing is the caller's, not this component's. The six screens compose
   * their headers differently — one is a `FlatList` header, two sit directly
   * above a subtitle in a gapped stack — so a margin baked in here would be
   * right for one of them and wrong for the rest.
   */
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.md,
        },
        style,
      ]}
    >
      <TouchableOpacity
        onPress={() => router.push('/settings')}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        /*
         * The glyph is 22px on a 24px grid, well under the 44px a finger
         * wants. `hitSlop` grows the touch target without growing the icon,
         * which is the whole reason it is not simply drawn bigger.
         */
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <SettingsIcon size={22} color={theme.color.textMuted} />
      </TouchableOpacity>

      {title ? (
        // `flex: 1` so a long heading wraps in the space left beside the gear
        // rather than pushing it off the row — "Book with our partners" and
        // "Top Activities in Reykjavík" both already wrap without one.
        <Text variant="xl" weight="bold" leading="tight" style={{ flex: 1 }}>
          {title}
        </Text>
      ) : null}
    </View>
  );
}
