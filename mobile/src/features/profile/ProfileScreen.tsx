import { useState } from 'react';
import { View } from 'react-native';
import { useCurrentUser } from '../../core/hooks/useCurrentUser';
import { authStore } from '../../core/store/auth.store';
import { useTrips } from '../../core/store/trip.store';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import { PlanSection } from './PlanSection';

/**
 * The account: who is signed in, which planner they get, and what they have
 * planned so far.
 *
 * **This screen used to hold the port's diagnostics** — a core-plumbing probe
 * and a streaming probe — because until the planner shipped there was no other
 * way to find out whether MMKV, `expo-crypto`, Intl and `expo/fetch` survived
 * Hermes. M7 made them redundant exactly as promised: a Pro reply arriving word
 * by word is the same proof about streaming, and planning a trip exercises the
 * other three on the way past. So they are gone rather than left behind a flag.
 *
 * The web's profile also lists connected accounts and friend counts. Google
 * sign-in and friends are both Phase 2, so those are absent rather than shown
 * empty — a "Connected accounts" card with nothing in it invites somebody to
 * press something that does not exist yet.
 */

/** Trip counts, from the trips already in the store — no endpoint for this. */
function Stats() {
  const theme = useTheme();
  const trips = useTrips();

  const days = trips.reduce((total, trip) => total + trip.itinerary.length, 0);
  const destinations = new Set(trips.map((trip) => trip.destination)).size;

  const stats = [
    { id: 'trips', value: trips.length, label: trips.length === 1 ? 'Saved trip' : 'Saved trips' },
    { id: 'days', value: days, label: days === 1 ? 'Day planned' : 'Days planned' },
    {
      id: 'destinations',
      value: destinations,
      label: destinations === 1 ? 'Destination' : 'Destinations',
    },
  ];

  return (
    <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
      {stats.map((stat) => (
        <Card key={stat.id} padding="md" elevation="soft" style={{ flex: 1 }}>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text variant="lg" weight="bold" leading="tight">
              {stat.value}
            </Text>
            <Text variant="xs" tone="muted" leading="tight" style={{ textAlign: 'center' }}>
              {stat.label}
            </Text>
          </View>
        </Card>
      ))}
    </View>
  );
}

export function ProfileScreen() {
  const theme = useTheme();
  const { user } = useCurrentUser();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);

    try {
      await authStore.signOut();
    } finally {
      /*
       * No `setSigningOut(false)` on success, and that is deliberate: signing
       * out swaps the whole navigator for the sign-in screen, so this component
       * is gone. Setting state on the way out would be a no-op at best.
       */
      setSigningOut(false);
    }
  }

  if (!user) return null;

  return (
    <Screen>
      <Card padding="lg" elevation="card">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
          <Avatar name={user.name} size="lg" />

          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="lg" weight="bold" leading="tight">
              {user.name}
            </Text>
            <Text variant="xs" tone="muted">
              {user.email}
            </Text>
          </View>
        </View>
      </Card>

      <PlanSection />

      <Stats />

      <Button variant="secondary" onPress={() => void signOut()} loading={signingOut} fullWidth>
        Sign out
      </Button>
    </Screen>
  );
}
