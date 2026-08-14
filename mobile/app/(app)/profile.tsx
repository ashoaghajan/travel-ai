import { useState } from 'react';
import { View } from 'react-native';
import { stream } from '../../src/core/services/http';
import { STORAGE_KEYS, storageService } from '../../src/core/services/localStorage.service';
import { authStore, useAuth } from '../../src/core/store/auth.store';
import { createId } from '../../src/core/utils/id';
import { usdFormatter } from '../../src/core/utils/currency';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { CrownIcon } from '../../src/components/icons';
import { useTheme } from '../../src/theme/useTheme';

/**
 * The account, and — for now — the diagnostics.
 *
 * M9 builds this properly: the plan row, the upgrade dialog, the trip counts.
 * Until then it is the one screen that can hold the probes, and they have to
 * live somewhere: the last unverified risk in the whole port is whether
 * `expo/fetch` streams on a real device, and deleting the only way to check
 * that before M7 proves it would be optimistic.
 *
 * They go when the planner makes them redundant — a Pro reply arriving word by
 * word is the same proof, obtained by using the app.
 */

type Line = { text: string; tone: 'main' | 'muted' | 'success' | 'danger' };

export default function ProfileScreen() {
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
      say(`createId → ${id.slice(0, 24)}…`, id.startsWith('trip_') && id.length > 20 ? 'success' : 'danger');

      let notified = 0;
      const stop = storageService.subscribe(STORAGE_KEYS.settings, () => {
        notified += 1;
      });

      const written = { probe: id };
      storageService.set(STORAGE_KEYS.settings, written);
      const back = storageService.get(STORAGE_KEYS.settings, null as typeof written | null);
      stop();
      storageService.remove(STORAGE_KEYS.settings);

      const round = back?.probe === id;
      say(`MMKV round trip → ${round ? 'ok' : 'MISMATCH'}`, round ? 'success' : 'danger');
      say(`subscribe fired ${notified}×`, notified === 1 ? 'success' : 'danger');
      // Intl underneath — some Hermes builds ship without full ICU, which
      // would break every price in the app rather than just this line.
      say(`usdFormatter → ${usdFormatter.format(1234.5)}`);
    } catch (error) {
      say(`core threw: ${String(error)}`, 'danger');
    }
  }

  /** Does `expo/fetch` stream on a device, through the ported client? */
  async function probeStreaming() {
    setLines([]);
    setBusy(true);

    try {
      if (user?.plan !== 'pro') {
        await authStore.setPlan('pro');
        say('upgraded to Pro', 'success');
      }

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
        <Text variant="xl" weight="bold" leading="tight">
          {user?.name}
        </Text>
        {user?.plan === 'pro' ? <CrownIcon size={20} color={theme.color.warning} /> : null}
      </View>
      <Text variant="sm" tone="muted">
        {user?.email}
      </Text>

      <Card padding="md" elevation="soft">
        <Text variant="xs" tone="muted" leading="snug">
          Kill the app from the task switcher and open it again — staying signed in is what
          M4 was for. The token is in the keychain, not in memory.
        </Text>
      </Card>

      <Button onPress={probeCore} disabled={busy} variant="secondary" fullWidth>
        Check core plumbing
      </Button>
      <Button onPress={() => void probeStreaming()} disabled={busy} loading={busy} fullWidth>
        Check streaming
      </Button>
      <Button
        onPress={() => void authStore.signOut()}
        disabled={busy}
        variant="secondary"
        fullWidth
      >
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
