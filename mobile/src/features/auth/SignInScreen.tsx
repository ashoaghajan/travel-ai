import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { ApiError } from '../../core/services/http';
import { authStore } from '../../core/store/auth.store';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { PlaneIcon } from '../../components/icons';
import { useTheme } from '../../theme/useTheme';

/**
 * Sign in, or create an account.
 *
 * One screen with a mode toggle rather than two routes: the fields differ by a
 * single input, and on a phone the cost of a wrong guess is a whole navigation
 * rather than a glance at a link.
 *
 * **The server's message is shown, not replaced.** It already distinguishes a
 * wrong password from a taken email from a password that is too short, and it
 * deliberately says the same thing for a wrong password and an unknown address
 * — rewriting any of that here would either leak what the server took care not
 * to, or lose the one message that tells somebody what to fix.
 */
export function SignInScreen() {
  const theme = useTheme();
  const [mode, setMode] = useState<'signIn' | 'register'>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registering = mode === 'register';
  const ready = email.trim().length > 0 && password.length > 0 && (!registering || name.trim());

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      if (registering) {
        await authStore.signUp({ name: name.trim(), email: email.trim(), password });
      } else {
        await authStore.signIn({ email: email.trim(), password });
      }
      // No navigation: the store flips to `authenticated` and the root swaps
      // this screen out. One source of truth for where the app is.
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Something went wrong. Please try again.',
      );
      setBusy(false);
    }
  }

  const field = {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    color: theme.color.textMain,
    fontSize: theme.fontSize.sm,
  };

  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: theme.space.sm, marginBottom: theme.space.lg }}>
        <PlaneIcon size={32} color={theme.color.primary} />
        <Text variant="xl" weight="bold" leading="tight">
          AI Travel
        </Text>
        <Text variant="sm" tone="muted">
          {registering ? 'Create an account to save your trips.' : 'Welcome back.'}
        </Text>
      </View>

      {registering ? (
        <TextInput
          style={field}
          placeholder="Your name"
          placeholderTextColor={theme.color.textMuted}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoComplete="name"
          editable={!busy}
        />
      ) : null}

      <TextInput
        style={field}
        placeholder="Email"
        placeholderTextColor={theme.color.textMuted}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        editable={!busy}
      />

      <TextInput
        style={field}
        placeholder="Password"
        placeholderTextColor={theme.color.textMuted}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        // `new-password` tells a password manager to offer to generate one;
        // `current-password` tells it to fill the saved one. The wrong hint
        // makes managers unhelpful in a way people blame on the app.
        autoComplete={registering ? 'new-password' : 'current-password'}
        editable={!busy}
        onSubmitEditing={() => ready && !busy && void submit()}
        returnKeyType="go"
      />

      {error ? (
        <Text variant="xs" tone="danger" leading="snug">
          {error}
        </Text>
      ) : null}

      <Button onPress={() => void submit()} disabled={!ready} loading={busy} fullWidth size="lg">
        {registering ? 'Create account' : 'Sign in'}
      </Button>

      <Button
        variant="secondary"
        fullWidth
        disabled={busy}
        onPress={() => {
          setMode(registering ? 'signIn' : 'register');
          setError(null);
        }}
      >
        {registering ? 'I already have an account' : 'Create an account'}
      </Button>
    </Screen>
  );
}
