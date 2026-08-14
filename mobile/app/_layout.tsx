import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { authStore, useAuth } from '../src/core/store/auth.store';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { useTheme } from '../src/theme/useTheme';

/**
 * The root layout: providers, and the one decision about where the app is.
 *
 * Mirrors `src/app/routeTable.tsx` — `RootLayout` wrapping a `RequireAuth`
 * guard wrapping the shell — with the difference that expo-router has no
 * element tree to nest guards in. The route tree *is* the file tree, so the
 * guard becomes an effect that redirects, and the two groups it redirects
 * between are `(auth)` and `(app)`.
 *
 * **Groups, not paths.** The parentheses keep `(auth)` and `(app)` out of the
 * URL, so the tab bar lives at `/`, `/trips`, `/profile` rather than under a
 * segment nobody would want in a deep link.
 */

function Splash() {
  const theme = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.background,
      }}
    >
      <ActivityIndicator color={theme.color.primary} />
    </View>
  );
}

function Guard() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Once, at launch. The store owns the outcome; this only starts it.
  useEffect(() => {
    void authStore.bootstrap();
  }, []);

  useEffect(() => {
    /*
     * `unknown` is not `anonymous`, and the difference is the whole reason
     * this waits. On a cold start there is a refresh token in the keychain and
     * no answer yet about whether it still works; redirecting now would show
     * the sign-in form to somebody who is signed in, every single launch.
     */
    if (status === 'unknown') return;

    const inAuth = segments[0] === '(auth)';

    if (status === 'anonymous' && !inAuth) router.replace('/sign-in');
    if (status === 'authenticated' && inAuth) router.replace('/');
  }, [status, segments, router]);

  if (status === 'unknown') return <Splash />;

  return <Slot />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Guard />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
