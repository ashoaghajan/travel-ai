import { Tabs } from 'expo-router';
import { HomeIcon, SuitcaseIcon, UserIcon } from '../../src/components/icons';
import { useTheme } from '../../src/theme/useTheme';

/**
 * The tab bar — the phone's answer to the sidebar.
 *
 * The web builds its bottom bar from the same array as its sidebar
 * (`navigation.config.ts`) precisely so the two cannot drift. Here the file
 * tree *is* the route table, so the equivalent discipline is that these three
 * keep the web's labels, icons and order: Home is the planner, then Trips,
 * then Profile.
 *
 * **Three of the web's six.** Explore, Bookings and Friends are Phase 2, and a
 * tab that opens an empty screen is worse than a tab that is not there yet —
 * it advertises a feature and then apologises. They slot in beside these when
 * their screens exist, in the web's order.
 */
export default function AppLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.primary,
        tabBarInactiveTintColor: theme.color.textMuted,
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.border,
        },
        tabBarLabelStyle: {
          fontSize: theme.fontSize.xs,
          fontWeight: theme.fontWeight.medium,
        },
        // The bar sits on the safe area itself rather than floating above it,
        // as it does on the web — see `AppShell.module.css`, where it occupies
        // a real grid row.
        sceneStyle: { backgroundColor: theme.color.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <HomeIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          tabBarIcon: ({ color, size }) => <SuitcaseIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <UserIcon size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
