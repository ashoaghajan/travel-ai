import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/*
 * A runtime import, deliberately.
 *
 * `ERROR_CODES` is a const object rather than a type, so it survives to the
 * bundle and actually exercises Metro's resolution of a source-only workspace
 * package. Importing a type here would compile, erase, and prove nothing.
 */
import { ERROR_CODES } from '@ai-travel/shared';

import { http, setAccessToken, stream } from './src/core/services/http';
import { STORAGE_KEYS, storageService } from './src/core/services/localStorage.service';
import { createId } from './src/core/utils/id';
import { formatDateRange } from './src/core/utils/date';
import { usdFormatter } from './src/core/utils/currency';

import { ThemeProvider } from './src/theme/ThemeProvider';
import { useTheme } from './src/theme/useTheme';
import { Screen } from './src/components/Screen';
import { Text } from './src/components/Text';
import { Button } from './src/components/Button';
import { Card } from './src/components/Card';
import { CrownIcon, PlaneIcon } from './src/components/icons';

/**
 * The spike, now exercising the ported plumbing rather than standing in for it.
 *
 * Deleted at M5, when expo-router brings real routes. Until then it is the
 * only way to run any of this on a device, and it carries three jobs: the
 * infrastructure risks from M1, the theme from M2, and — the point of M3 —
 * proof that the copied services actually execute on Hermes.
 *
 * **The streaming probe deliberately goes through `stream()` from the ported
 * client**, not through a hand-written fetch. A spike that proves `expo/fetch`
 * works while the real code path stays untested would be answering an easier
 * question than the one that matters.
 *
 * Nothing runs on mount. Every probe is behind a press, because two of them
 * write to the deployed database, and that should never be a side effect of
 * opening an app.
 */

type Line = { text: string; tone: 'main' | 'muted' | 'success' | 'danger' };

function Spike() {
  const theme = useTheme();
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const say = (text: string, tone: Line['tone'] = 'muted') =>
    setLines((current) => [...current, { text, tone }]);

  /** Risk 1: does the monorepo resolve? Answered without touching the network. */
  function probeShared() {
    setLines([]);
    say(`shared/ resolved — PRO_REQUIRED = ${ERROR_CODES.PRO_REQUIRED}`, 'success');
  }

  /**
   * M3: do the copied services run on Hermes?
   *
   * Three of the four platform seams at once — MMKV behind the synchronous
   * storage facade, `expo-crypto` behind `createId`, and two pure utils that
   * were copied verbatim and should behave exactly as they do on the web.
   */
  function probeCore() {
    setLines([]);

    try {
      const id = createId('trip');
      say(`createId → ${id}`, id.startsWith('trip_') && id.length > 20 ? 'success' : 'danger');

      let notified = 0;
      const unsubscribe = storageService.subscribe(STORAGE_KEYS.settings, () => {
        notified += 1;
      });

      const written = { theme: 'dark' as const, currency: 'USD', probe: id };
      storageService.set(STORAGE_KEYS.settings, written);
      const readBack = storageService.get(STORAGE_KEYS.settings, null as typeof written | null);
      unsubscribe();

      const round = readBack?.probe === id;
      say(`MMKV round trip → ${round ? 'value survived' : 'MISMATCH'}`, round ? 'success' : 'danger');
      say(`subscribe fired ${notified}×`, notified === 1 ? 'success' : 'danger');

      // Copied verbatim, so these must read exactly as they do in the browser.
      say(`formatDateRange → ${formatDateRange('2027-04-02', '2027-04-08')}`);
      /*
       * `Intl.NumberFormat` under the hood. Worth a probe of its own: Hermes
       * ships without full ICU on some builds, and a missing Intl would break
       * every price in the app rather than just this line.
       */
      say(`usdFormatter → ${usdFormatter.format(1234.5)}`);

      storageService.remove(STORAGE_KEYS.settings);
      say('core plumbing OK', 'success');
    } catch (error) {
      say(`core threw: ${String(error)}`, 'danger');
    }
  }

  /** Risk 2: can this device reach the API, through the ported client? */
  async function probeApi() {
    setLines([]);
    setBusy(true);

    try {
      const body = await http.get<{ status: string }>('/health', { skipAuth: true });
      say(`GET /health → ${JSON.stringify(body)}`, 'success');
    } catch (error) {
      say(`unreachable: ${String(error)}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Risk 3, the one that could still change the design.
   *
   * Registers a throwaway, upgrades it (self-serve, as the Pro work shipped),
   * and reads the planner reply through the ported `stream()`. Frames arriving
   * one at a time means the port is safe. Everything at once means
   * `expo/fetch` is buffering, and the fallbacks come into play before any UI
   * is built on it.
   */
  async function probeStreaming() {
    setLines([]);
    setBusy(true);

    const email = `spike-${Date.now()}@example.com`;

    try {
      say('registering a throwaway account…');
      const session = await http.post<{ accessToken: string }>('/auth/register', {
        name: 'M3 Spike',
        email,
        password: 'spike-password-123',
      });

      // What the auth store will do for real at M4.
      setAccessToken(session.accessToken);
      say('registered — bearer token held by the ported client', 'success');

      await http.post('/me/plan', { plan: 'pro' });
      say('upgraded to Pro', 'success');

      say('streaming through core/services/http…');
      const started = Date.now();
      let frames = 0;
      let firstAt = 0;
      let text = '';

      for await (const event of stream<{ type: string; text?: string }>('/planner/chat', {
        body: {
          messages: [{ author: 'user', content: 'Three days in Kyoto, two people, April.' }],
        },
      })) {
        frames += 1;
        if (frames === 1) firstAt = Date.now() - started;
        if (event.type === 'delta' && event.text) text += event.text;
        if (frames <= 3) say(`frame ${frames}: ${event.type}`);
      }

      const total = Date.now() - started;
      say(`${frames} frames, first at ${firstAt}ms, total ${total}ms`);
      say(text.slice(0, 120) || '(no text)', 'main');
      say(
        frames > 2 && firstAt < total * 0.8 ? 'STREAMING CONFIRMED' : 'CHECK: looks buffered',
        frames > 2 && firstAt < total * 0.8 ? 'success' : 'danger',
      );
    } catch (error) {
      say(`threw: ${String(error)}`, 'danger');
    } finally {
      setAccessToken(null);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
        <PlaneIcon size={22} color={theme.color.primary} />
        <Text variant="lg" weight="semibold" leading="tight">
          AI Travel
        </Text>
        <CrownIcon size={18} color={theme.color.warning} />
      </View>

      <Text variant="xs" tone="muted">
        spike · {theme.scheme} theme
      </Text>

      <Button onPress={probeShared} disabled={busy} variant="secondary" fullWidth>
        1 · resolve @ai-travel/shared
      </Button>
      <Button onPress={probeCore} disabled={busy} variant="secondary" fullWidth>
        2 · core plumbing (MMKV, crypto, utils)
      </Button>
      <Button onPress={() => void probeApi()} disabled={busy} fullWidth>
        3 · reach the API
      </Button>
      <Button onPress={() => void probeStreaming()} disabled={busy} loading={busy} fullWidth>
        4 · stream the planner
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

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Spike />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
