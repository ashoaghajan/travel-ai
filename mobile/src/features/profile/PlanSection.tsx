import { useState } from 'react';
import { View } from 'react-native';
import { useCurrentUser } from '../../core/hooks/useCurrentUser';
import { authStore } from '../../core/store/auth.store';
import { formatLongDate } from '../../core/utils/date';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { CrownIcon } from '../../components/icons';
import { useTheme } from '../../theme/useTheme';
import { UpgradeToProDialog } from '../pro/UpgradeToProDialog';

/**
 * Which planner this account gets, and how to change it.
 *
 * The web's `PlanSection`, with its two rules intact. **The directions are
 * asked for differently on purpose**: upgrading opens a dialog and waits for a
 * yes, because it is the direction that will one day take money and the dialog
 * is where a payment provider lands. Going back to free happens on the press —
 * nothing is lost by it, and the button that undoes it is the one that
 * replaces it.
 *
 * And it says there is no payment, because that is true and the screen
 * describing the account is the wrong place to be coy about it.
 */
export function PlanSection() {
  const theme = useTheme();
  const { user, isPro } = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function backToFree() {
    setBusy(true);
    setError(null);

    try {
      await authStore.setPlan('free');
    } catch {
      setError('That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: theme.space.sm }}>
      <Text variant="md" weight="semibold" leading="tight">
        Plan
      </Text>

      <Card padding="lg" elevation="soft">
        <View style={{ gap: theme.space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
                {isPro ? <CrownIcon size={16} color={theme.color.primary} /> : null}
                <Text variant="sm" weight="semibold">
                  {isPro ? 'Pro' : 'Free'}
                </Text>
              </View>

              <Text variant="xs" tone="muted" leading="snug">
                {isPro
                  ? 'The planner writes with Claude, and you can talk to it.'
                  : 'The quick planner builds trips from templates, and answers weather and places.'}
              </Text>

              {/* Only on Pro, and only when the server gave a date — an account
                  upgraded before the column existed has none, and "Pro since
                  Invalid Date" is worse than no line at all. */}
              {isPro && user.proSince ? (
                <Text variant="xs" tone="muted">
                  Since {formatLongDate(user.proSince)}
                </Text>
              ) : null}
            </View>

            <Button
              variant={isPro ? 'secondary' : 'primary'}
              onPress={() => (isPro ? void backToFree() : setAsking(true))}
              loading={busy}
              disabled={busy}
            >
              {isPro ? 'Back to Free' : 'Upgrade'}
            </Button>
          </View>

          {isPro ? null : (
            <Text variant="xs" tone="muted" leading="snug">
              No payment yet — Pro is free while we build it.
            </Text>
          )}

          {error ? (
            <Text variant="xs" tone="danger">
              {error}
            </Text>
          ) : null}
        </View>
      </Card>

      <UpgradeToProDialog visible={asking} onClose={() => setAsking(false)} />
    </View>
  );
}
