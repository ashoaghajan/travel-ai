import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';

/**
 * Home — the planner, once M6 builds it.
 *
 * A placeholder rather than a stub of the real thing: the tab has to exist for
 * the shell to be navigable, and pretending to be a composer that cannot send
 * anything would be worse than saying what it is.
 */
export default function PlannerScreen() {
  return (
    <Screen>
      <Text variant="xl" weight="bold" leading="tight">
        Plan a trip
      </Text>
      <Card>
        <Text variant="sm" tone="muted" leading="base">
          The planner lands next. Free accounts will build trips from templates; Pro writes
          them with Claude.
        </Text>
      </Card>
    </Screen>
  );
}
