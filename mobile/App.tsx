import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { http, stream } from './src/core/services/http';
import { authStore, useAuth } from './src/core/store/auth.store';
import { STORAGE_KEYS, storageService } from './src/core/services/localStorage.service';
import { createId } from './src/core/utils/id';
import { usdFormatter } from './src/core/utils/currency';

import { SignInScreen } from './src/features/auth/SignInScreen';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { useTheme } from './src/theme/useTheme';
import { Screen } from './src/components/Screen';
import { Text } from './src/components/Text';
import { Button } from './src/components/Button';
import { Card } from './src/components/Card';
import { CrownIcon, PlaneIcon } from './src/components/icons';

/**
 * The root, until expo-router replaces it at M5.
 *
 * Three states, and the middle one is the reason there are three: on a cold
 * start the app holds a refresh token in the keychain and does not yet know
 * whether it is still good. Treating that as "signed out" would flash the
 * sign-in form at somebody who is signed in, every launch.
 */

type Line = { text: string; tone: 'main' | 'muted' | 'success' | 'danger' };

function SignedIn() {
  const theme = useTheme();
  const { user } = useAuth();
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const say = (text: string, tone: Line['tone'] = 'muted') =>
    setLines((current) => [...current, { text, tone }]);

  /** The copied services, running on Hermes. */
  function probeCore() {
    setLines([]);

    try {
      const id = createId('trip');
      say(`createId → ${id}`, id.startsWith('trip_') && id.length > 20 ? 'success' : 'danger');

      let notified = 0;
      const stop = storageService.subscribe(STORAGE_KEYS.settings, () => {
        notified += 1;
      });
      const written = { probe: id };
      storageService.set(STORAGE_KEYS.settings, written);
      const back = storageService.get(STORAGE_KEYS.settings, null as typeof written | null);
      stop();
      storageService.remove(STORAGE_KEYS.settings);

      say(`MMKV round trip → ${back?.probe === id ? 'ok' : 'MISMATCH'}`,
        back?.probe === id ? 'success' : 'danger');
      say(`subscribe fired ${notified}×`, notified === 1 ? 'success' : 'danger');
      // Intl under the hood — some Hermes builds ship without full ICU.
      say(`usdFormatter → ${usdFormatter.format(1234.5)}`);
    } catch (error) {
      say(`core threw: ${String(error)}`, 'danger');
    }
  }

  /**
   * The last unverified risk in the port: does `expo/fetch` actually stream on
   * a device, through the ported client rather than a hand-written fetch?
   *
   * Needs Pro, which is self-serve, so this upgrades the account first.
   */
  async function probeStreaming() {
    setLines([]);
    setBusy(true);

    try {
      await http.post('/me/plan', { plan: 'pro' });
      say('upgraded to Pro', 'success');

      const started = Date.now();
      let frames = 0;
      let firstAt = 0;
      let text = '';

      for await (const event of stream<{ type: string; text?: string }>('/planner/chat', {
        body: { messages: [{ author: 'user', content: 'Three days in Kyoto for two, April.' }] },
      })) {
        frames += 1;
        if (frames === 1) firstAt = Date.now() - started;
        if (event.type === 'delta' && event.text) text += event.text;
      }

      const total = Date.now() - started;
      const streamed = frames > 2 && firstAt < total * 0.8;

      say(`${frames} frames · first at ${firstAt}ms · total ${total}ms`);
      say(text.slice(0, 140) || '(no text)', 'main');
      say(streamed ? 'STREAMING CONFIRMED' : 'CHECK: looks buffered', streamed ? 'success' : 'danger');
    } catch (error) {
      say(`threw: ${String(error)}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
        <PlaneIcon size={22} color={theme.color.primary} />
        <Text variant="lg" weight="semibold" leading="tight">
          {user?.name}
        </Text>
        {user?.plan === 'pro' ? <CrownIcon size={18} color={theme.color.warning} /> : null}
      </View>

      <Text variant="xs" tone="muted">
        {user?.email} · {user?.plan} · {theme.scheme}
      </Text>

      <Card padding="md" elevation="soft">
        <Text variant="xs" tone="muted" leading="snug">
          Kill the app from the task switcher and open it again. Staying signed in is the
          whole of this milestone — the token is in the keychain, not in memory.
        </Text>
      </Card>

      <Button onPress={probeCore} disabled={busy} variant="secondary" fullWidth>
        Core plumbing
      </Button>
      <Button onPress={() => void probeStreaming()} disabled={busy} loading={busy} fullWidth>
        Stream the planner
      </Button>
      <Button onPress={() => void authStore.signOut()} disabled={busy} variant="secondary" fullWidth>
        Sign out
      </Button>

      {lines.length > 0 ? (
        <Card padding="md" elevation="soft">
          {lines.map((line, index) => (
            <Text key={index} variant="xs" tone={line.tone} leading="snug">
              {line.text}
            </Text>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function Splash() {
  const theme = useTheme();

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.color.primary} />
      </View>
    </Screen>
  );
}

function Root() {
  const { status } = useAuth();

  // Once, at launch. The store owns the outcome; this only starts it.
  useEffect(() => {
    void authStore.bootstrap();
  }, []);

  if (status === 'unknown') return <Splash />;

  return status === 'authenticated' ? <SignedIn /> : <SignInScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
