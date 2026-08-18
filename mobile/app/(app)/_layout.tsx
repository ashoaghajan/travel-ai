import { Tabs } from 'expo-router';
import {
  CompassIcon,
  HomeIcon,
  SuitcaseIcon,
  TicketIcon,
  UserIcon,
  UsersIcon,
} from '../../src/components/icons';
import { useTheme } from '../../src/theme/useTheme';

/**
 * The tab bar — the phone's answer to the sidebar.
 *
 * The web builds its bottom bar from the same array as its sidebar
 * (`navigation.config.ts`) precisely so the two cannot drift. Here the file
 * tree *is* the route table, so the equivalent discipline is that the screens
 * below keep the web's labels, icons and order. Home is the planner, as it is
 * on the web where "Home" is the planner dashboard.
 *
 * **All six, matching `BOTTOM_NAV`.** Explore, Bookings and Friends were held
 * back while they had no screens, on the rule that a tab which opens an empty
 * screen is worse than a tab that is not there yet — it advertises a feature
 * and then apologises. They now have screens, so they are here, in the web's
 * order and under the web's labels and icons.
 *
 * Six fits, for the reason `navigation.config.ts` worked out for the web's own
 * bottom bar: the bar divides evenly and the cells stay wide enough to tap at
 * the narrowest common width.
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
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color, size }) => <CompassIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: 'Bookings',
          tabBarIcon: ({ color, size }) => <TicketIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ color, size }) => <UsersIcon size={size} color={color} />,
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
