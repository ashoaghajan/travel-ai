import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { authStore } from '../../core/store/auth.store';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { CrownIcon } from '../../components/icons';
import { useTheme } from '../../theme/useTheme';

/**
 * Confirms the upgrade before taking it.
 *
 * The same sentence the web asks, in the same shape and for the same reason:
 * this is the seam a payment provider lands on, so both ways in go through one
 * component and the day there is something to pay, this becomes the screen
 * that says what it costs.
 *
 * **`Modal` gives less than `<dialog>` did.** The web got the backdrop, the
 * focus trap and Escape from the browser. Here the backdrop is a `Pressable`,
 * dismissal is `onRequestClose` — which is the Android back button, the
 * nearest thing to Escape a phone has — and the focus trap is the platform's
 * own, because a native modal is genuinely modal.
 */
export function UpgradeToProDialog({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);

    try {
      await authStore.setPlan('pro');
      onClose();
    } catch {
      setError('That did not go through. Try again.');
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android's back button. Refused mid-request, so a dismissal cannot
      // leave the call running with nothing on screen to report back to.
      onRequestClose={() => !busy && onClose()}
    >
      <Pressable
        onPress={() => !busy && onClose()}
        style={{
          flex: 1,
          backgroundColor: theme.color.backdrop,
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.space.xl,
        }}
      >
        {/* Swallows the press so a tap inside the card does not dismiss it —
            what `<dialog>` got for free by the backdrop being a pseudo-element. */}
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%',
            maxWidth: 420,
            backgroundColor: theme.color.surface,
            borderRadius: theme.radius.lg,
            padding: theme.space.xl,
            gap: theme.space.md,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.primarySoft,
            }}
          >
            <CrownIcon size={20} color={theme.color.primary} />
          </View>

          <Text variant="lg" weight="semibold" leading="tight">
            Upgrade to Pro?
          </Text>

          <Text variant="sm" leading="snug">
            The planner starts writing trips with Claude instead of building them from
            templates, and you can talk to it — ask for changes, and it rewrites the days.
          </Text>

          <Text variant="xs" tone="muted" leading="snug">
            Everything else stays as it is. Weather, places and saved trips are the same on
            both plans.
          </Text>

          <View
            style={{
              padding: theme.space.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.primarySoft,
            }}
          >
            <Text variant="xs" tone="muted" leading="snug">
              <Text variant="xs" weight="semibold">
                There is nothing to pay.
              </Text>{' '}
              Pro is free while we build it, and you can go back whenever you like.
            </Text>
          </View>

          {error ? (
            <Text variant="xs" tone="danger">
              {error}
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
            <View style={{ flex: 1 }}>
              <Button variant="secondary" onPress={onClose} disabled={busy} fullWidth>
                Not now
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button onPress={() => void confirm()} loading={busy} disabled={busy} fullWidth>
                Upgrade
              </Button>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
