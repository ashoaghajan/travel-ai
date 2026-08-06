import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from './id';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createId', () => {
  it('prefixes the id', () => {
    expect(createId('trip')).toMatch(/^trip_/);
  });

  it('returns a different id each time', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createId('day')));
    expect(ids.size).toBe(50);
  });

  it('falls back when crypto.randomUUID is unavailable', () => {
    // Non-secure contexts (plain http) do not expose randomUUID.
    vi.stubGlobal('crypto', {});

    const id = createId('activity');

    expect(id).toMatch(/^activity_/);
    expect(id.length).toBeGreaterThan('activity_'.length);
  });

  it('still returns unique ids on the fallback path', () => {
    vi.stubGlobal('crypto', {});

    const ids = new Set(Array.from({ length: 50 }, () => createId('x')));
    expect(ids.size).toBe(50);
  });
});
