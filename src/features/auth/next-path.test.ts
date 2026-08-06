import { describe, expect, it } from 'vitest';
import { ROUTES } from '../../app/routes';
import { safeNextPath } from './next-path';

/**
 * `?next=` arrives from the URL bar, so it is attacker-controlled. These are
 * the cases that decide whether the sign-in form can be turned into an open
 * redirect.
 */
describe('safeNextPath', () => {
  it('returns an in-app path unchanged', () => {
    expect(safeNextPath('/trips')).toBe('/trips');
    expect(safeNextPath('/trips/abc?tab=map')).toBe('/trips/abc?tab=map');
  });

  it('falls back to the planner when there is nothing to resume', () => {
    expect(safeNextPath(null)).toBe(ROUTES.planner);
    expect(safeNextPath('')).toBe(ROUTES.planner);
  });

  it('refuses an absolute URL to another site', () => {
    expect(safeNextPath('https://phishing.example/login')).toBe(ROUTES.planner);
  });

  // `//host` inherits the current scheme and leaves the site — the classic
  // way past a naive "must start with /" check.
  it('refuses a protocol-relative URL', () => {
    expect(safeNextPath('//phishing.example')).toBe(ROUTES.planner);
  });

  // Some browsers normalise a backslash to a forward slash first.
  it('refuses a backslash-escaped host', () => {
    expect(safeNextPath('/\\phishing.example')).toBe(ROUTES.planner);
  });

  it('refuses a relative path that could escape', () => {
    expect(safeNextPath('../admin')).toBe(ROUTES.planner);
  });

  it('does not send the user back to the form they just used', () => {
    expect(safeNextPath(ROUTES.login)).toBe(ROUTES.planner);
    expect(safeNextPath(ROUTES.register)).toBe(ROUTES.planner);
  });
});
