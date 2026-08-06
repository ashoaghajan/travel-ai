/**
 * Typed access to the design tokens defined in `src/styles/tokens.css`.
 *
 * Every entry resolves to a CSS custom property rather than a literal value,
 * so there is exactly one place where a token's value can change (the CSS
 * file) and no risk of TS and CSS drifting apart.
 *
 * Use this only where a token is needed from TypeScript (inline styles,
 * canvas/SVG drawing). Prefer plain `var(--token)` inside CSS Modules.
 */

export const theme = {
  color: {
    primary: 'var(--color-primary)',
    primaryHover: 'var(--color-primary-hover)',
    primarySoft: 'var(--color-primary-soft)',
    background: 'var(--color-background)',
    surface: 'var(--color-surface)',
    surfaceMuted: 'var(--color-surface-muted)',
    border: 'var(--color-border)',
    textMain: 'var(--color-text-main)',
    textMuted: 'var(--color-text-muted)',
    textLight: 'var(--color-text-light)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    danger: 'var(--color-danger)',
    mapRoute: 'var(--color-map-route)',
  },
  font: {
    family: 'var(--font-family-base)',
    xs: 'var(--font-xs)',
    sm: 'var(--font-sm)',
    md: 'var(--font-md)',
    lg: 'var(--font-lg)',
    xl: 'var(--font-xl)',
    xxl: 'var(--font-2xl)',
  },
  space: {
    xs: 'var(--space-xs)',
    sm: 'var(--space-sm)',
    md: 'var(--space-md)',
    lg: 'var(--space-lg)',
    xl: 'var(--space-xl)',
    xxl: 'var(--space-2xl)',
  },
  radius: {
    sm: 'var(--radius-sm)',
    md: 'var(--radius-md)',
    lg: 'var(--radius-lg)',
    xl: 'var(--radius-xl)',
    pill: 'var(--radius-pill)',
  },
  shadow: {
    card: 'var(--shadow-card)',
    soft: 'var(--shadow-soft)',
  },
} as const;

/** Breakpoints from DESIGN_SPEC §7, in pixels. */
export const breakpoints = {
  tablet: 768,
  desktop: 1024,
} as const;

export type Theme = typeof theme;
