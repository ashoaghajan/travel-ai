import type { Appearance } from '../core/types/settings.types';

/**
 * The design tokens, as literal values.
 *
 * `src/styles/tokens.css` is the source of truth for the whole product and
 * stays that way — the web app reads it through `var()`, which is why
 * `src/app/theme.ts` holds the *names* rather than the values. React Native
 * has no custom properties, so this file is the one place the values are
 * written a second time.
 *
 * **That duplication is guarded, not tolerated.** `src/styles/tokens.test.ts`
 * reads `tokens.css` off disk and asserts every literal here still matches its
 * custom property, in both themes. Change a colour in the CSS and that test
 * fails until it is changed here too. It runs in the existing web suite, so
 * nobody has to remember to run it.
 *
 * Deliberately free of any `react-native` import: it is plain data, so the
 * drift test can load it under Node without a bundler.
 *
 * What is left out is as considered as what is here. The layout widths
 * (sidebar, messages panel), the z-index scale and the transition durations
 * are all answers to problems a phone does not have — RN stacks by order and
 * animates through `Animated`, and there is no sidebar.
 */

/** Values identical in both themes are stated once, here. */
const shared = {
  /*
   * Everything that paints onto a photograph keeps its light value in both
   * themes, for the reason `tokens.css` gives: a photograph is dark either
   * way, and white text on it is right either way.
   */
  textLight: '#ffffff',
  overlayTop: 'rgba(12, 10, 25, 0.55)',
  overlayMid: 'rgba(12, 10, 25, 0.42)',
  overlayBottom: 'rgba(12, 10, 25, 0.82)',
  glassSurface: 'rgba(255, 255, 255, 0.14)',
  glassSurfaceHover: 'rgba(255, 255, 255, 0.24)',
  glassBorder: 'rgba(255, 255, 255, 0.38)',
  textOnOverlayMuted: 'rgba(255, 255, 255, 0.82)',
  photoPlaceholder: '#1b1730',
  surfaceTranslucent: 'rgba(255, 255, 255, 0.86)',

  /* The map surfaces stay light in both themes, because the tiles do. */
  mapLand: '#e6f0e4',
  mapLandAlt: '#dcead9',
  mapWater: '#dfeaf8',
} as const;

export const lightColors = {
  ...shared,

  primary: '#6d3fef',
  primaryHover: '#5b32d6',
  primarySoft: '#efe9ff',
  /* Split from `primary`: one value could not both fill a button and be read
     as text. See the same comment in `tokens.css`. */
  accent: '#5b32d6',
  onPrimary: '#ffffff',

  background: '#f7f8fc',
  surface: '#ffffff',
  surfaceMuted: '#f3f4f8',

  border: '#e5e7ef',
  /* 3:1, for anything bounding a control rather than decorating a card. */
  borderStrong: '#8f94a6',

  textMain: '#111827',
  textMuted: '#6b7280',

  success: '#15803d',
  warning: '#f59e0b',
  danger: '#dc2626',
  dangerSoft: '#fef2f2',

  kindFlight: '#6d3fef',
  kindFlightSoft: '#efe9ff',
  kindHotel: '#0f766e',
  kindHotelSoft: '#ccfbf1',
  kindActivity: '#b45309',
  kindActivitySoft: '#fef3c7',
  kindTicket: '#be123c',
  kindTicketSoft: '#ffe4e6',

  mapRoute: '#6d3fef',

  /* `rgb(0 0 0 / 45%)` in CSS. RN cannot parse the space-separated form. */
  backdrop: 'rgba(0, 0, 0, 0.45)',
} as const;

/**
 * Dark theme.
 *
 * Two rules, both carried over from `tokens.css`: surfaces get *lighter* than
 * the page rather than darker, so a card still lifts; and saturated colours
 * gain lightness, because `#6d3fef` and `#dc2626` are both too dark to read
 * against a near-black background.
 */
export const darkColors = {
  ...lightColors,

  primary: '#6d28d9',
  primaryHover: '#7c3aed',
  primarySoft: '#2a1e4a',
  accent: '#a78bfa',
  onPrimary: '#ffffff',

  background: '#0f1117',
  surface: '#171a21',
  surfaceMuted: '#1f232c',

  border: '#2a2f3a',
  borderStrong: '#606880',

  textMain: '#e8eaf0',
  textMuted: '#9aa1af',

  success: '#22c55e',
  warning: '#fbbf24',
  danger: '#f87171',
  dangerSoft: '#3a1c1c',

  kindFlight: '#a78bfa',
  kindFlightSoft: '#2a1e4a',
  kindHotel: '#5eead4',
  kindHotelSoft: '#10322f',
  kindActivity: '#fbbf24',
  kindActivitySoft: '#3a2c10',
  kindTicket: '#fda4af',
  kindTicketSoft: '#3d1620',

  /* 45% black over a dark app barely separates the dialog. */
  backdrop: 'rgba(0, 0, 0, 0.68)',
} as const;

/* ===================================================================
 * The other two appearances.
 *
 * Each palette is spread from the Sharpen one of the same ground, so a token
 * nobody re-states keeps a value that was already checked against
 * `tokens.css`. The drift test compares these block by block against the
 * matching `[data-appearance]` selectors.
 * =================================================================== */

/** Photography-led: warm ground, no shadows, serif display, 1.25 type scale. */
export const atlasLightColors = {
  ...lightColors,

  primary: '#2f2b26',
  primaryHover: '#46403a',
  primarySoft: '#efe9df',
  accent: '#5b32d6',
  onPrimary: '#fdfcf9',

  background: '#fdfcf9',
  surface: '#fdfcf9',
  surfaceMuted: '#f3f0e8',

  border: '#e6e0d4',
  borderStrong: '#8d867a',

  textMain: '#1b1a17',
  textMuted: '#77726a',

  success: '#15803d',
  warning: '#b45309',
  danger: '#b3261e',
  dangerSoft: '#fbeae8',
} as const;

export const atlasDarkColors = {
  ...darkColors,

  primary: '#f2efe9',
  primaryHover: '#ffffff',
  primarySoft: '#2b2721',
  accent: '#c3b5f7',
  onPrimary: '#17150f',

  background: '#17150f',
  surface: '#17150f',
  surfaceMuted: '#221f18',

  border: '#322d24',
  borderStrong: '#7b7466',

  textMain: '#f2efe9',
  textMuted: '#a49d92',

  success: '#6ee7a0',
  warning: '#f0b661',
  danger: '#f2938c',
  dangerSoft: '#3a201d',
} as const;

/** Density-led: hairline borders instead of shadows, tighter everything. */
export const consoleLightColors = {
  ...lightColors,

  primary: '#1f2430',
  primaryHover: '#333a4a',
  primarySoft: '#e7eaf1',
  accent: '#5b32d6',
  onPrimary: '#ffffff',

  background: '#f4f5f8',
  surface: '#ffffff',
  surfaceMuted: '#eceef3',

  border: '#d3d7e0',
  borderStrong: '#8f94a6',

  textMain: '#16181d',
  textMuted: '#5f6672',

  success: '#15803d',
  warning: '#b45309',
  danger: '#be123c',
  dangerSoft: '#fdf0f3',
} as const;

export const consoleDarkColors = {
  ...darkColors,

  primary: '#cdd3e0',
  primaryHover: '#e4e9f2',
  primarySoft: '#232936',
  accent: '#a78bfa',
  onPrimary: '#14171d',

  background: '#101318',
  surface: '#14171d',
  surfaceMuted: '#1b1f27',

  border: '#333a46',
  borderStrong: '#6a7288',

  textMain: '#e6e9f0',
  textMuted: '#939bab',

  success: '#4ade80',
  warning: '#d08a2c',
  danger: '#fb7185',
  dangerSoft: '#3a1c24',
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 36,
} as const;

/**
 * Weights as strings, which is what RN's `fontWeight` takes.
 *
 * The CSS states these as numbers; TypeScript would otherwise widen them to
 * `number` and RN rejects that.
 */
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Multipliers, exactly as the CSS states them.
 *
 * RN has no `lineHeight: 1.35` — it wants pixels — so these are multiplied by
 * a font size at the point of use. `lineHeightFor` below does that, rather
 * than every component doing the arithmetic and rounding differently.
 */
export const lineHeight = {
  tight: 1.15,
  snug: 1.35,
  base: 1.6,
} as const;

/** Pixels for a size/leading pair, rounded once and in one place. */
export function lineHeightFor(size: number, leading: keyof typeof lineHeight): number {
  return Math.round(size * lineHeight[leading]);
}

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  xxxxl: 64,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

/**
 * Shadows, rebuilt rather than converted.
 *
 * CSS gives one `box-shadow`; RN wants four iOS properties plus an Android
 * `elevation` that takes no colour and no offset. The two cannot be made
 * identical, so these are matched by eye against the web app rather than by
 * arithmetic — with one rule applied consistently: **`shadowRadius` is the CSS
 * blur halved**, which is the convention that lines iOS up with the browser.
 *
 * The dark values are a rebuild, not a tint. The light set is near-black at
 * 6–12% alpha, which is invisible on a near-black page — every card would
 * flatten into the background.
 */
export const lightShadow = {
  card: {
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  soft: {
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 7,
    elevation: 2,
  },
  primary: {
    shadowColor: '#6d3fef',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.42,
    shadowRadius: 13,
    elevation: 6,
  },
} as const;

export const darkShadow = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 4,
  },
  soft: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 7,
    elevation: 2,
  },
  primary: {
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 13,
    elevation: 6,
  },
} as const;

export type ColorScheme = 'light' | 'dark';

/*
 * Widened on purpose.
 *
 * `as const` is what lets the drift test compare exact strings, but it also
 * makes every value its own literal type — so `darkColors.primary` ('#8b5cf6')
 * is not assignable to `lightColors.primary` ('#6d3fef'), and the two themes
 * become incompatible types describing the same thing. Naming the *keys* and
 * widening the values keeps both properties: exact literals at the leaves for
 * the test, one interchangeable shape for every consumer.
 */
export type Colors = Record<keyof typeof lightColors, string>;

/** One shadow, in the four iOS properties plus the Android one. */
export type ShadowStyle = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

export type Shadows = Record<keyof typeof lightShadow, ShadowStyle>;

export type Theme = {
  appearance: Appearance;
  scheme: ColorScheme;
  color: Colors;
  shadow: Shadows;
  /*
   * Widened from `typeof fontSize` for the same reason `Colors` is widened
   * above: `as const` is what lets the drift test compare exact values, but it
   * also makes 28 the *type* of `fontSize.xl` — so Atlas's 25 would not be
   * assignable. The keys stay pinned; only the values relax to `number`.
   */
  fontSize: Record<keyof typeof fontSize, number>;
  fontWeight: typeof fontWeight;
  space: Record<keyof typeof space, number>;
  radius: Record<keyof typeof radius, number>;
  lineHeightFor: typeof lineHeightFor;
};

/**
 * Geometry per appearance.
 *
 * Ground-independent, exactly as in `tokens.css` — a radius does not change
 * because the sun went down — so there is one entry per look rather than per
 * look and ground. `sharpen` restates nothing, which is the point: it *is* the
 * base scale.
 */
const GEOMETRY = {
  sharpen: { fontSize, space, radius },
  atlas: {
    fontSize: { ...fontSize, xl: 25, xxl: 39 },
    space: { ...space, xl: 28, xxl: 40, xxxl: 56, xxxxl: 76 },
    radius: { ...radius, sm: 2, md: 3, lg: 4, xl: 6 },
  },
  console: {
    fontSize: { ...fontSize, xs: 11, sm: 13, md: 15, lg: 18, xl: 24, xxl: 30 },
    space: { ...space, md: 10, lg: 14, xl: 20, xxl: 28, xxxl: 40, xxxxl: 52 },
    radius: { ...radius, sm: 4, md: 5, lg: 6, xl: 8 },
  },
} as const;

const PALETTES = {
  sharpen: { light: lightColors, dark: darkColors },
  atlas: { light: atlasLightColors, dark: atlasDarkColors },
  console: { light: consoleLightColors, dark: consoleDarkColors },
} as const;

/**
 * The theme for one appearance on one ground.
 *
 * Atlas and Console draw no shadows at all — separation is the image edge for
 * one and a hairline border for the other. `NO_SHADOW` is how that is said in
 * React Native, where there is no `box-shadow: none` to write: every offset,
 * radius and opacity goes to zero, *and* Android's `elevation` with them,
 * because elevation alone will keep painting a shadow that iOS has stopped
 * drawing. That divergence is the whole reason `tokens.test.ts` has never been
 * able to compare shadows across the two platforms.
 */
const NO_SHADOW = {
  shadowColor: 'transparent',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0,
  shadowRadius: 0,
  elevation: 0,
} as const;

function flatShadows(source: Shadows): Shadows {
  return Object.fromEntries(
    Object.keys(source).map((name) => [name, { ...NO_SHADOW }]),
  ) as unknown as Shadows;
}

export function themeFor(appearance: Appearance, scheme: ColorScheme): Theme {
  const geometry = GEOMETRY[appearance];
  const grounded = scheme === 'dark' ? darkShadow : lightShadow;

  return {
    appearance,
    scheme,
    color: PALETTES[appearance][scheme],
    shadow: appearance === 'sharpen' ? grounded : flatShadows(grounded),
    fontSize: geometry.fontSize,
    fontWeight,
    space: geometry.space,
    radius: geometry.radius,
    lineHeightFor,
  };
}
