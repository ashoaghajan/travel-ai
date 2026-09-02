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

/**
 * The row the track is drawn down the middle of.
 *
 * Taller than the handle it carries, because 26dp is a dot to look at and a
 * miss to touch — 44 is the smallest target a finger reliably lands on. It has
 * to be height rather than `hitSlop`: Android does not deliver a touch that
 * falls outside the parent's own bounds, so slop hung off a 26dp row would be
 * ignored on exactly the platform this was measured on.
 */
const ROW_HEIGHT = 44;

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

  /**
   * How far the centre of a handle can move.
   *
   * Half a handle short of the track at each end, which is the difference
   * between a control that looks drawn and one that looks cut. A handle
   * centred on its own extreme hangs half of itself past the track, and this
   * row runs the full width of the page — so on the phone that overhang was
   * not a rough edge but half a circle sliced off by the side of the screen,
   * at both ends, in the resting state every reader sees first.
   *
   * Positions are measured in this rather than in `width`, the drag included:
   * a finger crossing the whole track has to cover the whole range, and
   * dividing its `dx` by the wider figure would leave the far end unreachable.
   */
  const travel = Math.max(0, width - HANDLE_SIZE);

  /*
   * The pan responders are built once — rebuilding them mid-gesture drops the
   * drag — so everything they need to read is held in refs and refreshed on
   * each render rather than captured in their closures.
   */
  const live = useRef({ bounds, min, max, travel, onChange });
  live.current = { bounds, min, max, travel, onChange };

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
        const { bounds: b, travel: t } = live.current;
        if (t <= 0) return;

        const span = b.max - b.min;
        const moved = snap(grabbed.current + (gesture.dx / t) * span);

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

  /** The left edge of the handle standing at `value`, within the row. */
  const offset = (value: number) => ((value - bounds.min) / span) * travel;

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
        style={{
          position: 'absolute',
          left: offset(value),
          top: (ROW_HEIGHT - HANDLE_SIZE) / 2,
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
        style={{ height: ROW_HEIGHT, justifyContent: 'center', marginTop: theme.space.xs }}
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
        {travel > 0 ? (
          <>
            <View
              style={{
                // Drawn between the two handle *centres*, which is half a
                // handle in from where the handles themselves start.
                position: 'absolute',
                left: offset(min) + HANDLE_SIZE / 2,
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
