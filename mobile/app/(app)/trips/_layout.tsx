import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme/useTheme';

/**
 * A stack inside the Trips tab, so a trip pushes over the list and the back
 * gesture returns to it — rather than replacing the tab, which would strand
 * somebody on a detail screen with no way back but the tab bar.
 */
export default function TripsLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.background },
        headerTintColor: theme.color.textMain,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.color.background },
      }}
    >
      {/* The list draws its own heading, so a native header would say "Trips"
          twice. The detail keeps one, because that is where Back lives. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[tripId]" options={{ title: 'Trip' }} />
    </Stack>
  );
}
