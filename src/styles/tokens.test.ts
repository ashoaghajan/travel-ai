/*
 * Node types for this file alone, rather than adding "node" to the project's
 * `types`. This is the only file under `src/` that touches the filesystem, and
 * granting the whole browser project node globals to serve it would make
 * `import fs from 'node:fs'` typecheck cleanly inside a React component.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { darkColors, lightColors } from '../../mobile/src/theme/tokens';

/**
 * The one thing standing between this product and two colour systems.
 *
 * `tokens.css` is the source of truth: the web app reads it through `var()`,
 * so a value can only be wrong in one place. React Native has no custom
 * properties, so `mobile/src/theme/tokens.ts` writes the same values a second
 * time — and a second copy of a design system drifts silently, one hex at a
 * time, until the two apps are visibly different products.
 *
 * This reads the CSS off disk and compares. It lives in the web suite rather
 * than mobile's because this suite already runs on every change, and a guard
 * nobody runs is not a guard.
 *
 * Shadows are deliberately absent: CSS gives one `box-shadow` string and RN
 * wants four properties plus an Android `elevation` that takes neither colour
 * nor offset. There is no equality to assert, so `tokens.ts` matches those by
 * eye and says so.
 */

/*
 * Read from disk rather than imported.
 *
 * `import CSS from './tokens.css?raw'` is the tidier-looking version and it
 * silently returns an empty string: Vitest runs with `css: false`, so a
 * stylesheet import is stubbed and every assertion below would pass against
 * nothing. Reading the bytes is the only way this file can actually fail.

 */
const CSS = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

/** The declarations inside one `:root` block, by custom-property name. */
function block(selector: string): Map<string, string> {
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`No ${selector} block in tokens.css`);

  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('\n}', open);
  const body = CSS.slice(open, close);

  const declarations = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    declarations.set(name, value.trim());
  }

  return declarations;
}

const light = block(':root {');
const dark = block(":root[data-theme='dark']");

/**
 * Both notations reduced to comparable numbers.
 *
 * The CSS and the RN file are allowed to *spell* a colour differently — CSS
 * uses `rgb(0 0 0 / 45%)`, which RN cannot parse at all — so comparing the
 * strings would fail on a difference that is not a difference. Comparing the
 * channels tests what actually matters.
 */
function rgba(value: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }

  const parts = value
    .replace(/^rgba?\(|\)$/g, '')
    .split(/[\s,/]+/)
    .filter(Boolean);

  if (parts.length < 3) throw new Error(`Cannot read colour: ${value}`);

  const alpha = parts[3] ?? '1';
  return [
    Number(parts[0]),
    Number(parts[1]),
    Number(parts[2]),
    alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha),
  ];
}

/** mobile token name → the custom property it must equal. */
const MAP: Record<keyof typeof lightColors, string> = {
  primary: 'color-primary',
  primaryHover: 'color-primary-hover',
  primarySoft: 'color-primary-soft',
  background: 'color-background',
  surface: 'color-surface',
  surfaceMuted: 'color-surface-muted',
  border: 'color-border',
  textMain: 'color-text-main',
  textMuted: 'color-text-muted',
  textLight: 'color-text-light',
  success: 'color-success',
  warning: 'color-warning',
  danger: 'color-danger',
  dangerSoft: 'color-danger-soft',
  kindFlight: 'color-kind-flight',
  kindFlightSoft: 'color-kind-flight-soft',
  kindHotel: 'color-kind-hotel',
  kindHotelSoft: 'color-kind-hotel-soft',
  kindActivity: 'color-kind-activity',
  kindActivitySoft: 'color-kind-activity-soft',
  kindTicket: 'color-kind-ticket',
  kindTicketSoft: 'color-kind-ticket-soft',
  mapRoute: 'color-map-route',
  mapLand: 'color-map-land',
  mapLandAlt: 'color-map-land-alt',
  mapWater: 'color-map-water',
  backdrop: 'color-backdrop',
  overlayTop: 'color-overlay-top',
  overlayMid: 'color-overlay-mid',
  overlayBottom: 'color-overlay-bottom',
  glassSurface: 'color-glass-surface',
  glassSurfaceHover: 'color-glass-surface-hover',
  glassBorder: 'color-glass-border',
  textOnOverlayMuted: 'color-text-on-overlay-muted',
  photoPlaceholder: 'color-photo-placeholder',
  surfaceTranslucent: 'color-surface-translucent',
};

const entries = Object.entries(MAP) as [keyof typeof lightColors, string][];

describe('the mobile palette matches tokens.css', () => {
  it.each(entries)('light: %s', (token, property) => {
    const css = light.get(property);
    expect(css, `--${property} is missing from tokens.css`).toBeDefined();
    expect(rgba(lightColors[token])).toEqual(rgba(css as string));
  });

  it.each(entries)('dark: %s', (token, property) => {
    /*
     * A token the dark block does not override keeps its light value — which
     * is exactly what `darkColors` spreading `lightColors` expresses. Asserting
     * that here is what catches the reverse mistake: a dark override added to
     * the CSS and never mirrored, where the app would quietly keep painting
     * the light colour.
     */
     const expected = dark.get(property) ?? (light.get(property) as string);
    expect(rgba(darkColors[token])).toEqual(rgba(expected));
  });
});

describe('coverage of the mapping itself', () => {
  it('maps every colour token the mobile app declares', () => {
    // A token added to tokens.ts without a line in MAP would otherwise be
    // unguarded, which is the failure this whole file exists to prevent.
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(MAP).sort());
  });
});
