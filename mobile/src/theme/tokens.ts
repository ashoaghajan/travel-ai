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

  background: '#f7f8fc',
  surface: '#ffffff',
  surfaceMuted: '#f3f4f8',

  border: '#e5e7ef',

  textMain: '#111827',
  textMuted: '#6b7280',

  success: '#16a34a',
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

  primary: '#8b5cf6',
  primaryHover: '#a78bfa',
  primarySoft: '#2a1e4a',

  background: '#0f1117',
  surface: '#171a21',
  surfaceMuted: '#1f232c',

  border: '#2a2f3a',

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
  scheme: ColorScheme;
  color: Colors;
  shadow: Shadows;
  fontSize: typeof fontSize;
  fontWeight: typeof fontWeight;
  space: typeof space;
  radius: typeof radius;
  lineHeightFor: typeof lineHeightFor;
};

export function themeFor(scheme: ColorScheme): Theme {
  return {
    scheme,
    color: scheme === 'dark' ? darkColors : lightColors,
    shadow: scheme === 'dark' ? darkShadow : lightShadow,
    fontSize,
    fontWeight,
    space,
    radius,
    lineHeightFor,
  };
}
