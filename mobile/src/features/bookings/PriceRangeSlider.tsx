import { useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import type { PriceBounds } from '@ai-travel/shared';
import { useMoney } from '../../core/store/currency.store';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/**
 * A two-handle price range, the way the booking sites do it.
 *
 * Built on `PanResponder`, which React Native ships, rather than on a slider
 * package. Every one of those is a native module, and a native module means a
 * new dev client and a new store build before anybody can drag anything — a
 * heavy price for a control this size. This is pure JavaScript and runs in the
 * binary that is already on the phone.
 *
 * **Dragged by delta, not by touch position.** The gesture gives `dx` — how far
 * the finger has moved since it went down — and the handle moves the same
 * fraction of the track. Reading the absolute touch position instead would mean
 * knowing where the track sits on the screen, which is a measurement that has
 * to be retaken every time the layout moves; a delta needs only the width.
 *
 * The handles cannot cross: each is clamped a step short of the other.
 */

const TRACK_HEIGHT = 4;
const HANDLE_SIZE = 26;

export function PriceRangeSlider({
  bounds,
  min,
  max,
  onChange,
}: {
  bounds: PriceBounds;
  min: number;
  max: number;
  onChange: (next: { min: number; max: number }) => void;
}) {
  const theme = useTheme();
  const money = useMoney();

  const [width, setWidth] = useState(0);

  /*
   * The pan responders are built once — rebuilding them mid-gesture drops the
   * drag — so everything they need to read is held in refs and refreshed on
   * each render rather than captured in their closures.
   */
  const live = useRef({ bounds, min, max, width, onChange });
  live.current = { bounds, min, max, width, onChange };

  /** Where the dragged handle was when the finger went down. */
  const grabbed = useRef(0);

  /** To the nearest step, and inside the range. */
  function snap(value: number): number {
    const { bounds: b } = live.current;
    const stepped = Math.round(value / b.step) * b.step;

    return Math.min(b.max, Math.max(b.min, stepped));
  }

  function makeResponder(end: 'min' | 'max') {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        grabbed.current = end === 'min' ? live.current.min : live.current.max;
      },
      onPanResponderMove: (_event, gesture) => {
        const { bounds: b, width: w } = live.current;
        if (w <= 0) return;

        const span = b.max - b.min;
        const moved = snap(grabbed.current + (gesture.dx / w) * span);

        if (end === 'min') {
          const next = Math.min(moved, live.current.max - b.step);
          live.current.onChange({ min: next, max: live.current.max });
        } else {
          const next = Math.max(moved, live.current.min + b.step);
          live.current.onChange({ min: live.current.min, max: next });
        }
      },
    });
  }

  // Created once each, for the reason the refs above exist.
  const minPan = useRef(makeResponder('min')).current;
  const maxPan = useRef(makeResponder('max')).current;

  const span = bounds.max - bounds.min;
  const offset = (value: number) => ((value - bounds.min) / span) * width;

  /** Keyboard and switch control: one step either way. */
  function nudge(end: 'min' | 'max', direction: 1 | -1) {
    const moved = snap((end === 'min' ? min : max) + direction * bounds.step);

    if (end === 'min') onChange({ min: Math.min(moved, max - bounds.step), max });
    else onChange({ min, max: Math.max(moved, min + bounds.step) });
  }

  function handleFor(end: 'min' | 'max') {
    const value = end === 'min' ? min : max;
    const responder = end === 'min' ? minPan : maxPan;

    return (
      <View
        {...responder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={`${end === 'min' ? 'Minimum' : 'Maximum'} price per night`}
        accessibilityValue={{ min: bounds.min, max: bounds.max, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          nudge(end, event.nativeEvent.actionName === 'increment' ? 1 : -1)
        }
        // Positioned by its centre, so the handle sits *on* its value rather
        // than starting at it.
        style={{
          position: 'absolute',
          left: offset(value) - HANDLE_SIZE / 2,
          top: 0,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          borderRadius: theme.radius.pill,
          borderWidth: 2,
          borderColor: theme.color.primary,
          backgroundColor: theme.color.surface,
        }}
      />
    );
  }

  return (
    <View style={{ gap: theme.space.xs }}>
      <Text variant="xs" tone="muted" leading="tight">
        Price per night
      </Text>

      {/* The chosen span in figures: a thumb on a track is not a price, and
          this is what a reader reads back to check. */}
      <Text variant="sm" weight="semibold" leading="tight">
        {money.format(min)} – {money.format(max)}
      </Text>

      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{ height: HANDLE_SIZE, justifyContent: 'center', marginTop: theme.space.xs }}
      >
        <View
          style={{
            height: TRACK_HEIGHT,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.border,
          }}
        />

        {/* Everything below needs the measured width; one frame without it
            would put both handles on top of each other at zero. */}
        {width > 0 ? (
          <>
            <View
              style={{
                position: 'absolute',
                left: offset(min),
                width: Math.max(0, offset(max) - offset(min)),
                height: TRACK_HEIGHT,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.primary,
              }}
            />
            {handleFor('min')}
            {handleFor('max')}
          </>
        ) : null}
      </View>
    </View>
  );
}
