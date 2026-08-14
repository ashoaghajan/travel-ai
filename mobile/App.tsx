import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { fetch as expoFetch } from 'expo/fetch';

/*
 * A runtime import, deliberately.
 *
 * `ERROR_CODES` is a const object rather than a type, so it survives to the
 * bundle and actually exercises Metro's resolution of a source-only workspace
 * package. Importing a type here would compile, erase, and prove nothing.
 */
import { ERROR_CODES } from '@ai-travel/shared';

/**
 * M1 — the throwaway spike.
 *
 * This screen exists to retire the three infrastructure risks in the port
 * before a single feature is written, and it is deleted at M5:
 *
 *   1. Can Metro resolve `@ai-travel/shared` — TypeScript source, outside this
 *      app's directory, reached through a workspace symlink?
 *   2. Can the phone reach the deployed API at all?
 *   3. Does `expo/fetch` stream a response body on a real device? The whole
 *      Pro planner depends on it, and there is no point porting nine
 *      milestones of UI before finding out.
 *
 * Nothing runs on mount. Every probe is behind a press, because the streaming
 * one registers an account against the deployed database and that should never
 * be a side effect of opening an app.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://travel-ai-io1t.onrender.com/api';

type Line = { text: string; tone: 'ok' | 'bad' | 'plain' };

export default function App() {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const say = (text: string, tone: Line['tone'] = 'plain') =>
    setLines((current) => [...current, { text, tone }]);

  /** Risk 1: does the monorepo resolve? Answered without touching the network. */
  function probeShared() {
    setLines([]);
    try {
      const code = ERROR_CODES.PRO_REQUIRED;
      say(`shared/ resolved — ERROR_CODES.PRO_REQUIRED = ${code}`, 'ok');
    } catch (error) {
      say(`shared/ failed: ${String(error)}`, 'bad');
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
      say(`${response.status} — ${body}`, response.ok ? 'ok' : 'bad');
    } catch (error) {
      say(`unreachable: ${String(error)}`, 'bad');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Risk 3, the one that could change the design.
   *
   * The streaming endpoint needs an account and a Pro plan, so this registers a
   * throwaway, upgrades it (self-serve, as the Pro work shipped), and then
   * reads the reply frame by frame. If the frames arrive one at a time the
   * port is safe; if they arrive in a single lump at the end, `expo/fetch` is
   * buffering and the fallbacks come into play.
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
        say(`register failed: ${registered.status} ${await registered.text()}`, 'bad');
        return;
      }

      const { accessToken } = (await registered.json()) as { accessToken: string };
      say('registered, bearer token in hand', 'ok');

      const upgraded = await fetch(`${API_URL}/me/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ plan: 'pro' }),
      });
      say(`upgrade to Pro: ${upgraded.status}`, upgraded.ok ? 'ok' : 'bad');
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
        say(`stream refused: ${response.status} ${await response.text()}`, 'bad');
        return;
      }

      if (!response.body) {
        say('response.body is undefined — expo/fetch did NOT stream', 'bad');
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
      say(`done — ${chunks} chunks, first at ${firstChunkAt}ms, total ${total}ms`, 'ok');
      say(
        chunks > 1
          ? 'STREAMING CONFIRMED — many chunks over time'
          : 'BUFFERED — one chunk only, fallbacks needed',
        chunks > 1 ? 'ok' : 'bad',
      );
    } catch (error) {
      say(`threw: ${String(error)}`, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>M1 · infrastructure spike</Text>
        <Text style={styles.api}>{API_URL}</Text>

        <Probe label="1 · resolve @ai-travel/shared" onPress={probeShared} disabled={busy} />
        <Probe label="2 · reach the API" onPress={() => void probeApi()} disabled={busy} />
        <Probe label="3 · stream with expo/fetch" onPress={() => void probeStreaming()} disabled={busy} />

        <View style={styles.log}>
          {lines.map((line, index) => (
            <Text key={index} style={[styles.line, styles[line.tone]]}>
              {line.text}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Probe({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#faf9fc' },
  content: { padding: 20, paddingTop: 64, gap: 10 },
  title: { fontSize: 20, fontWeight: '600', color: '#1a1a2e' },
  api: { fontSize: 11, color: '#6b7280', marginBottom: 8 },
  button: { backgroundColor: '#6d3fef', borderRadius: 999, paddingVertical: 13 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '600', fontSize: 14 },
  log: { marginTop: 18, gap: 5 },
  line: { fontSize: 12, fontFamily: 'Courier' },
  ok: { color: '#15803d' },
  bad: { color: '#b91c1c' },
  plain: { color: '#374151' },
});
