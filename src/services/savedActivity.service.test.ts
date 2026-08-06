/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../types/travel.types';
import { STORAGE_KEYS, storageService } from './localStorage.service';
import {
  readIsSaved,
  readSavedSync,
  savedActivityService,
} from './savedActivity.service';

function activity(id: string, title = `Place ${id}`): Activity {
  return {
    id,
    title,
    category: 'culture',
    description: 'Museums · 1.2 km from centre',
    price: 0,
    rating: 5,
    reviews: 0,
    image: 'city.jpg',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-28T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('saving', () => {
  it('starts empty', async () => {
    await expect(savedActivityService.getSaved()).resolves.toEqual([]);
  });

  it('persists under the documented key', async () => {
    await savedActivityService.save(activity('N1'));

    expect(STORAGE_KEYS.savedActivities).toBe('ai-travel-planner:savedActivities');
    expect(localStorage.getItem(STORAGE_KEYS.savedActivities)).toContain('N1');
  });

  it('stores the whole card, not just the id', async () => {
    await savedActivityService.save(activity('N1', 'Museum Bali'));

    const [entry] = await savedActivityService.getSaved();

    expect(entry.activity.title).toBe('Museum Bali');
    expect(entry.activity.image).toBe('city.jpg');
    expect(entry.savedAt).toBe('2026-07-28T09:00:00.000Z');
  });

  it('keeps the newest first', async () => {
    await savedActivityService.save(activity('N1'));
    await savedActivityService.save(activity('N2'));

    const saved = await savedActivityService.getSaved();

    expect(saved.map((entry) => entry.activity.id)).toEqual(['N2', 'N1']);
  });

  it('re-saving refreshes the copy and moves it to the top', async () => {
    await savedActivityService.save(activity('N1', 'Old title'));
    await savedActivityService.save(activity('N2'));

    await savedActivityService.save(activity('N1', 'New title'));

    const saved = await savedActivityService.getSaved();
    expect(saved).toHaveLength(2);
    expect(saved[0].activity.title).toBe('New title');
  });

  it('removes one entry, leaving the rest', async () => {
    await savedActivityService.save(activity('N1'));
    await savedActivityService.save(activity('N2'));

    await savedActivityService.remove('N1');

    expect((await savedActivityService.getSaved()).map((entry) => entry.activity.id)).toEqual([
      'N2',
    ]);
  });

  it('removing something absent is harmless', async () => {
    await savedActivityService.save(activity('N1'));

    await expect(savedActivityService.remove('nope')).resolves.toHaveLength(1);
  });

  it('clears everything', async () => {
    await savedActivityService.save(activity('N1'));

    await savedActivityService.clear();

    expect(await savedActivityService.getSaved()).toEqual([]);
  });

  it('caps the list so it cannot grow without bound', async () => {
    for (let index = 0; index < 205; index += 1) {
      await savedActivityService.save(activity(`N${index}`));
    }

    expect(await savedActivityService.getSaved()).toHaveLength(200);
  });
});

describe('toggle', () => {
  it('saves when absent and reports it saved', async () => {
    await expect(savedActivityService.toggle(activity('N1'))).resolves.toBe(true);
    expect(readIsSaved('N1')).toBe(true);
  });

  it('removes when present and reports it unsaved', async () => {
    await savedActivityService.save(activity('N1'));

    await expect(savedActivityService.toggle(activity('N1'))).resolves.toBe(false);
    expect(readIsSaved('N1')).toBe(false);
  });
});

describe('reading a corrupt store', () => {
  it('treats unparseable storage as empty', async () => {
    localStorage.setItem(STORAGE_KEYS.savedActivities, 'not json');

    await expect(savedActivityService.getSaved()).resolves.toEqual([]);
  });

  it('ignores a value that is not a list', async () => {
    storageService.set(STORAGE_KEYS.savedActivities, { nope: true });

    expect(readSavedSync()).toEqual([]);
  });

  it('drops entries that are not shaped like a saved activity', async () => {
    storageService.set(STORAGE_KEYS.savedActivities, [
      { activity: activity('N1'), savedAt: '2026-07-28T09:00:00.000Z' },
      { activity: { id: 'N2' }, savedAt: '2026-07-28T09:00:00.000Z' },
      { savedAt: '2026-07-28T09:00:00.000Z' },
      null,
      'nonsense',
    ]);

    const saved = await savedActivityService.getSaved();

    expect(saved.map((entry) => entry.activity.id)).toEqual(['N1']);
  });
});
