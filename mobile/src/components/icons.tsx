import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { ColorValue } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * The icon set, ported from `src/components/common/icons.tsx`.
 *
 * **The path data is copied verbatim and must stay that way** — these are the
 * same glyphs, drawn on the same 24×24 grid with the same 1.8 stroke, so the
 * two apps cannot drift into looking like different products. Only the
 * envelope changes: `<svg>` becomes `<Svg>`, and `currentColor` becomes an
 * explicit colour, because RN has no inheritance to lean on.
 *
 * **Ported on demand rather than all at once.** The web set is 37 icons; the
 * core loop needs a handful, and porting the rest before a screen asks for one
 * is inventing work. Add them here as milestones need them, copying the paths
 * across unchanged.
 */

export type IconProps = {
  /** Width and height in pixels. */
  size?: number;
  /**
   * Defaults to the current text colour, which is what `currentColor` did.
   *
   * `ColorValue` rather than `string`: React Native's own callbacks — the tab
   * bar's `tabBarIcon` among them — hand back platform colour objects as well
   * as strings, and narrowing here would make every one of those call sites
   * cast.
   */
  color?: ColorValue;
};

function useIcon({ size = 24, color }: IconProps) {
  const theme = useTheme();

  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color ?? theme.color.textMain,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

/** Brand mark glyph — a paper plane. */
export function PlaneIcon(props: IconProps) {
  return (
    <Svg {...useIcon(props)}>
      <Path d="M21.2 3.3 2.9 10.1c-.8.3-.8 1.4 0 1.7l6.6 2.4 2.4 6.6c.3.8 1.4.8 1.7 0l6.8-18.3c.3-.7-.4-1.5-1.2-1.2Z" />
      <Path d="m21.2 3.3-11.7 11" />
    </Svg>
  );
}

export function CrownIcon(props: IconProps) {
  return (
    <Svg {...useIcon(props)}>
      <Path d="M4.4 17.8h15.2" />
      <Path d="M3.8 7.2 4.9 15h14.2l1.1-7.8-4.6 3L12 4.6l-3.6 5.6-4.6-3Z" />
    </Svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Svg {...useIcon(props)}>
      <Path d="M3.5 10.6 12 3.8l8.5 6.8" />
      <Path d="M5.6 9.4V19a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4V9.4" />
      <Path d="M9.8 20.4v-5.6h4.4v5.6" />
    </Svg>
  );
}

export function SuitcaseIcon(props: IconProps) {
  return (
    <Svg {...useIcon(props)}>
      <Path d="M4.6 8.2h14.8a1 1 0 0 1 1 1v9.6a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6V9.2a1 1 0 0 1 1-1Z" />
      <Path d="M9 8.2V5.8a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 5.8v2.4" />
      <Path d="M3.6 13.4h16.8" />
    </Svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Svg {...useIcon(props)}>
      <Circle cx="12" cy="8.4" r="3.6" />
      <Path d="M4.8 20c0-3.5 3.2-5.4 7.2-5.4s7.2 1.9 7.2 5.4" />
    </Svg>
  );
}

/** The planner's send button. */
export function ArrowUpIcon(props: IconProps) {
  return (
    <Svg {...useIcon(props)}>
      <Path d="M12 19.4V5" />
      <Path d="m5.8 11.2 6.2-6.2 6.2 6.2" />
    </Svg>
  );
}

export function BookmarkIcon(props: IconProps) {
  return (
    <Svg {...useIcon(props)}>
      <Path d="M6.6 4.6a1 1 0 0 1 1-1h8.8a1 1 0 0 1 1 1v15.8l-5.4-3.9-5.4 3.9Z" />
    </Svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <Svg {...useIcon(props)}>
      <Rect x="9" y="3" width="6" height="11" rx="3" />
      <Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <Path d="M12 18v3" />
    </Svg>
  );
}

/** Stop is filled rather than stroked, as on the web. */
export function StopIcon({ size = 24, color }: IconProps) {
  const base = useIcon({ size, color });

  return (
    <Svg {...base}>
      <Rect x="7" y="7" width="10" height="10" rx="2" fill={base.stroke} stroke="none" />
    </Svg>
  );
}
