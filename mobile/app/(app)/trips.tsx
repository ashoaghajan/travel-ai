import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';

/** Saved trips. Built at M8, with the route map. */
export default function TripsScreen() {
  return (
    <Screen>
      <Text variant="xl" weight="bold" leading="tight">
        Trips
      </Text>
      <Card>
        <Text variant="sm" tone="muted" leading="base">
          Saved trips appear here once the planner can make them.
        </Text>
      </Card>
    </Screen>
  );
}
