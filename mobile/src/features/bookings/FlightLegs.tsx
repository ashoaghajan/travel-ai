import { Pressable, View } from 'react-native';
import type { BookingContext } from '../../core/types/travel.types';
import { formatShortDate } from '../../core/utils/date';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import { hasReturnLeg, legRoute } from './flight.legs';
import type { FlightLeg, FlightLegRoute } from './flight.legs';

const LEGS: { id: FlightLeg; label: string }[] = [
  { id: 'outbound', label: 'Outbound' },
  { id: 'return', label: 'Return' },
];

/** "AUH → EVN · Sep 14", or as much of it as the search knows. */
function describeRoute(route: FlightLegRoute): string {
  const ends = route.from && route.to ? `${route.from} → ${route.to}` : '';
  const date = route.date ? formatShortDate(route.date) : '';

  return [ends, date].filter(Boolean).join(' · ');
}

/**
 * The two steps a round trip is booked in: the way out, then the way home.
 *
 * The web's `FlightLegs.tsx`, in React Native. Same two steps, same numbering,
 * same rule that both stay tappable — a reader who wants to price the way home
 * before committing to the way out is doing something reasonable.
 *
 * **Side by side rather than stacked**, which is the one deliberate departure.
 * The web draws an ordered list down the page; two steps across a 360dp phone
 * fit on one row, and stacking them would push the fares themselves below the
 * fold on a screen that already carries a search form and a tab bar.
 *
 * **No completion ticks.** The web marks a leg done when its fare is filed
 * against the trip, and there is no such moment here: this app's flight cards
 * open the partner's site and nothing comes back to say what happened. A tick
 * driven by "tapped Book" would claim a booking nobody made, so the steps
 * stay numbered and unticked until mobile has a booking flow of its own.
 */
export function FlightLegs({
  context,
  value,
  onChange,
}: {
  context: BookingContext;
  /** The step on screen. */
  value: FlightLeg;
  onChange: (next: FlightLeg) => void;
}) {
  const theme = useTheme();

  /*
   * One way: no steps, just the line saying what is being priced. The stepper
   * would be a list of one with a number in front of it.
   */
  if (!hasReturnLeg(context)) {
    const described = describeRoute(legRoute(context, 'outbound'));

    return described ? (
      <Text variant="xs" tone="muted" leading="snug">
        {described}
      </Text>
    ) : null;
  }

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Book this trip in two steps"
      style={{ flexDirection: 'row', gap: theme.space.sm }}
    >
      {LEGS.map((leg, index) => {
        const route = legRoute(context, leg.id);
        const isCurrent = value === leg.id;
        const described = describeRoute(route);

        return (
          <Pressable
            key={leg.id}
            onPress={() => onChange(leg.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isCurrent }}
            /*
             * Spelled out rather than left to the contents: the label and the
             * route are separate elements for the two-line layout, and the
             * computed name runs them together — "ReturnEVN → AUH".
             */
            accessibilityLabel={`Step ${index + 1}, ${leg.label}${described ? `: ${described}` : ''}`}
            style={({ pressed }) => ({
              flex: 1,
              gap: 2,
              paddingVertical: theme.space.md,
              paddingHorizontal: theme.space.md,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: isCurrent ? theme.color.primary : theme.color.border,
              backgroundColor: pressed
                ? theme.color.surfaceMuted
                : isCurrent
                  ? theme.color.primarySoft
                  : 'transparent',
            })}
          >
            <Text
              variant="sm"
              weight={isCurrent ? 'semibold' : 'medium'}
              tone={isCurrent ? 'primary' : 'main'}
              leading="tight"
            >
              {index + 1}. {leg.label}
            </Text>
            {described ? (
              <Text variant="xs" tone="muted" leading="snug" numberOfLines={1}>
                {described}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
