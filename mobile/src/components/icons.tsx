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

/** Tab bar: Explore. */
export function CompassIcon(props: IconProps) {
  return (
    <Svg {...useIcon(props)}>
      <Circle cx="12" cy="12" r="8.6" />
      <Path d="m15.6 8.4-2.3 5-5 2.2 2.3-5 5-2.2Z" />
    </Svg>
  );
}

/** Tab bar: Bookings. */
export function TicketIcon(props: IconProps) {
  return (
    <Svg {...useIcon(props)}>
      <Path d="M3.6 9.4V7.6a1.4 1.4 0 0 1 1.4-1.4h14a1.4 1.4 0 0 1 1.4 1.4v1.8a2.6 2.6 0 0 0 0 5.2v1.8a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4v-1.8a2.6 2.6 0 0 0 0-5.2Z" />
      <Path d="M14.4 7v2M14.4 11v2M14.4 15v2" />
    </Svg>
  );
}

/** Tab bar: Friends. */
export function UsersIcon(props: IconProps) {
  return (
    <Svg {...useIcon(props)}>
      <Circle cx="9.6" cy="8.4" r="3.2" />
      <Path d="M3.6 19.6c0-3.1 2.7-4.8 6-4.8s6 1.7 6 4.8" />
      <Path d="M16.2 5.6a3.2 3.2 0 0 1 0 6.2" />
      <Path d="M17.6 15.2c1.8.5 2.8 1.7 2.8 3.4" />
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

/**
 * Google's mark, and the one icon here that takes no colour.
 *
 * It is a trademark rather than part of the icon set: four fixed brand colours,
 * filled not stroked, on Google's own 48×48 grid. Recolouring it to match the
 * theme — which is what every other icon in this file exists to do — is a use
 * their branding guidelines do not permit, so `IconProps.color` is ignored and
 * only `size` is honoured.
 */
export function GoogleIcon({ size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17Z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46Z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7Z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07Z"
      />
    </Svg>
  );
}
