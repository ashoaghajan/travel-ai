import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fetch as expoFetch } from 'expo/fetch';

/*
 * A runtime import, deliberately.
 *
 * `ERROR_CODES` is a const object rather than a type, so it survives to the
 * bundle and actually exercises Metro's resolution of a source-only workspace
 * package. Importing a type here would compile, erase, and prove nothing.
 */
import { ERROR_CODES } from '@ai-travel/shared';

import { ThemeProvider } from './src/theme/ThemeProvider';
import { useTheme } from './src/theme/useTheme';
import { Screen } from './src/components/Screen';
import { Text } from './src/components/Text';
import { Button } from './src/components/Button';
import { Card } from './src/components/Card';
import { CrownIcon, PlaneIcon } from './src/components/icons';

/**
 * M1's spike, now wearing M2's theme.
 *
 * This screen is a throwaway and is deleted at M5, when expo-router brings
 * real routes. It carries two jobs at once because they share a build: the
 * three probes retire the infrastructure risks of the port, and the frame
 * around them is the first real use of the token system, so the theme is seen
 * on a device rather than trusted.
 *
 * Nothing runs on mount. Every probe is behind a press, because the streaming
 * one registers an account against the deployed database, and that should
 * never be a side effect of opening an app.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://travel-ai-io1t.onrender.com/api';

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
    try {
      say(`shared/ resolved — PRO_REQUIRED = ${ERROR_CODES.PRO_REQUIRED}`, 'success');
    } catch (error) {
      say(`shared/ failed: ${String(error)}`, 'danger');
    }
  }

  /** Risk 2: can this device reach the API? */
  async function probeApi() {
    setLines([]);
    setBusy(true);
    say(`GET ${API_URL}/health`);

    try {
      const response = await fetch(`${API_URL}/health`);
      const body = await response.text();
      say(`${response.status} — ${body}`, response.ok ? 'success' : 'danger');
    } catch (error) {
      say(`unreachable: ${String(error)}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Risk 3, the one that could change the design.
   *
   * The streaming endpoint needs an account and a Pro plan, so this registers a
   * throwaway, upgrades it (self-serve, as the Pro work shipped), and reads the
   * reply frame by frame. Many chunks arriving over time means the port is
   * safe. One chunk at the end means `expo/fetch` is buffering, and the
   * fallbacks come into play before any UI is built on it.
   */
  async function probeStreaming() {
    setLines([]);
    setBusy(true);

    const email = `spike-${Date.now()}@example.com`;

    try {
      say('registering a throwaway account…');
      const registered = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'M1 Spike', email, password: 'spike-password-123' }),
      });

      if (!registered.ok) {
        say(`register failed: ${registered.status} ${await registered.text()}`, 'danger');
        return;
      }

      const { accessToken } = (await registered.json()) as { accessToken: string };
      say('registered, bearer token in hand', 'success');

      const upgraded = await fetch(`${API_URL}/me/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ plan: 'pro' }),
      });
      say(`upgrade to Pro: ${upgraded.status}`, upgraded.ok ? 'success' : 'danger');
      if (!upgraded.ok) return;

      say('opening the stream with expo/fetch…');
      const started = Date.now();

      const response = await expoFetch(`${API_URL}/planner/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          messages: [{ author: 'user', content: 'Three days in Kyoto, two people, April.' }],
        }),
      });

      if (!response.ok) {
        say(`stream refused: ${response.status} ${await response.text()}`, 'danger');
        return;
      }

      if (!response.body) {
        say('response.body is undefined — expo/fetch did NOT stream', 'danger');
        return;
      }

      /*
       * Decoded incrementally rather than through `pipeThrough(new
       * TextDecoderStream())` as the web client does: Hermes has `TextDecoder`
       * but not the stream variant. This is the shape `http.ts` will have to
       * adopt, so the spike proves the real thing rather than a near miss.
       */
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let chunks = 0;
      let firstChunkAt = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks += 1;
        if (chunks === 1) firstChunkAt = Date.now() - started;

        const text = decoder.decode(value, { stream: true });
        const frames = text.split('\n\n').filter((frame) => frame.startsWith('data:')).length;
        if (chunks <= 6) say(`chunk ${chunks}: ${value.length}B, ${frames} frame(s)`);
      }

      const total = Date.now() - started;
      say(`done — ${chunks} chunks, first at ${firstChunkAt}ms, total ${total}ms`);
      say(
        chunks > 1 ? 'STREAMING CONFIRMED' : 'BUFFERED — fallback needed',
        chunks > 1 ? 'success' : 'danger',
      );
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
          AI Travel
        </Text>
        <CrownIcon size={18} color={theme.color.warning} />
      </View>

      <Text variant="xs" tone="muted">
        M1 spike · M2 theme · {theme.scheme}
      </Text>

      <Button onPress={probeShared} disabled={busy} fullWidth>
        1 · resolve @ai-travel/shared
      </Button>
      <Button onPress={() => void probeApi()} disabled={busy} loading={busy} fullWidth>
        2 · reach the API
      </Button>
      <Button onPress={() => void probeStreaming()} disabled={busy} variant="secondary" fullWidth>
        3 · stream with expo/fetch
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
