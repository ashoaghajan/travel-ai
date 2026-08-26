import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
 * The bar's own height, before the safe area is added underneath it.
 *
 * This is the value the navigator would have used on its own
 * (`TABBAR_HEIGHT_UIKIT`); it is restated here because setting `height` in
 * `tabBarStyle` replaces the navigator's calculation outright rather than
 * adding to it, so the base has to be part of the sum.
 */
const BAR_HEIGHT = 49;

/**
 * How far the labels are lifted off the bottom edge when the OS reports no
 * inset of its own.
 *
 * A phone's screen is a rounded rectangle, so the bottom corners curve away
 * from the content: on the Honor this was found on, the radius is 26dp and the
 * corner arcs are centred 26dp above the bottom edge. Anything painted below
 * that centre line is inside the curve, which is why the outermost tabs — Home
 * and Profile — looked pinched into the corners while the middle four sat
 * straight.
 *
 * Clearing the *vertical* space therefore clears the horizontal crowding too:
 * above the arc's centre line the display is full width again, so the six cells
 * get the whole 360dp and no tab has to dodge a corner. `space.xl` is 24dp,
 * near enough to a typical 26dp radius that the residual intrusion is a
 * fraction of a pixel, and it is a token rather than a measurement of one
 * particular handset.
 */
const CORNER_CLEARANCE = 24;

/**
 * The label size, one point below `fontSize.xs`.
 *
 * Six tabs across a 360dp phone give each cell 60dp, and the navigator spends
 * 5dp a side of that on padding applied to a pressable the `tabBarItemStyle`
 * prop does not reach — so 100px is all a label ever gets. "Bookings" needs
 * about 103px at `fontSize.xs` and was rendering as "Bookin…"; at 11 it takes
 * roughly 92px and the word survives.
 *
 * This deliberately sits below the token scale rather than being added to it.
 * The scale describes the type used *in* screens, where 12 is already the
 * smallest step that stays readable in a paragraph; a tab label is a fixed
 * six-across grid with a width the design cannot negotiate, which is why the
 * navigator's own default here is 10. Widening the shared scale to serve one
 * component would invite 11 into places that have room for 12.
 */
const LABEL_SIZE = 11;

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
  const insets = useSafeAreaInsets();

  // Gesture-navigation phones vary in what they admit to. Some report the
  // gesture bar as a real bottom inset; this Honor reports a navigation bar of
  // zero height, so `insets.bottom` is 0 and the navigator's own
  // `paddingBottom: insets.bottom` amounted to nothing — the labels were laid
  // straight onto the curved bottom edge. Taking the larger of the two means a
  // phone that declares its inset keeps it, and one that declares nothing
  // still clears its own corners.
  const bottomInset = Math.max(insets.bottom, CORNER_CLEARANCE);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.primary,
        tabBarInactiveTintColor: theme.color.textMuted,
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.border,
          // The surface still runs the full width and into the corners — the
          // OS clips it there, which is what makes the bar look built into the
          // phone. Only the content is held back off the curve.
          height: BAR_HEIGHT + bottomInset,
          paddingBottom: bottomInset,
        },
        tabBarLabelStyle: {
          fontSize: LABEL_SIZE,
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
      {/*
        Settings is in this group but not in the bar. `href: null` is how
        expo-router says "routable, not a tab" — it hides the item and refuses
        the press, leaving the route reachable only from the gear in
        `ScreenHeader`.

        It belongs here rather than beside `(app)` because the tab bar should
        stay on screen while it is open, which is how the web behaves: the
        sidebar does not disappear when you open Settings. The seventh cell
        would also break the six-across arithmetic the bar depends on.
      */}
      <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
    </Tabs>
  );
}
