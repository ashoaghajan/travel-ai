/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../types/travel.types';
import { savedActivityService } from './savedActivity.service';
import type { SavedActivity } from './savedActivity.service';
import { http } from './http';

/**
 * The shortlist client.
 *
 * What this file used to test — re-saving moving an entry to the top, the
 * 200-row cap, dropping a hand-edited record — moved to
 * `server/src/modules/library/`, where it runs against a real database. Two of
 * those are better there than here: the cap was client-enforced, so a second
 * device grew straight past it, and rows do not arrive half-written from
 * Postgres.
 *
 * What is left is the request each method makes, and the one property that
 * matters to every caller: a write answers with the whole list, so the screen
 * shows the shortlist that exists rather than the one it predicted.
 */

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

function saved(id: string): SavedActivity {
  return { activity: activity(id), savedAt: '2026-07-28T09:00:00.000Z' };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getSaved', () => {
  it('asks the shortlist endpoint', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([saved('a')]);

    await expect(savedActivityService.getSaved()).resolves.toHaveLength(1);
    expect(get).toHaveBeenCalledWith('/saved-activities');
  });
});

describe('save', () => {
  it('puts the attraction under its own id', async () => {
    const put = vi.spyOn(http, 'put').mockResolvedValue([saved('otm_cascade')]);

    await savedActivityService.save(activity('otm_cascade'));

    // A `PUT` keyed by id, not a `POST`: saving something already saved moves
    // it to the top rather than adding a second copy.
    expect(put).toHaveBeenCalledWith('/saved-activities/otm_cascade', {
      activity: activity('otm_cascade'),
    });
  });

  it('escapes an id that would otherwise split the path', async () => {
    const put = vi.spyOn(http, 'put').mockResolvedValue([]);

    await savedActivityService.save(activity('W311/676978'));

    expect(put.mock.calls[0][0]).toBe('/saved-activities/W311%2F676978');
  });

  it('answers with the whole shortlist', async () => {
    vi.spyOn(http, 'put').mockResolvedValue([saved('a'), saved('b')]);

    // Including the server's own cap, which the client cannot predict.
    await expect(savedActivityService.save(activity('a'))).resolves.toHaveLength(2);
  });
});

describe('remove', () => {
  it('deletes by id and answers with what is left', async () => {
    const remove = vi.spyOn(http, 'delete').mockResolvedValue([saved('b')]);

    await expect(savedActivityService.remove('a')).resolves.toEqual([saved('b')]);
    expect(remove).toHaveBeenCalledWith('/saved-activities/a');
  });
});

describe('clear', () => {
  it('empties the shortlist', async () => {
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);

    await savedActivityService.clear();

    expect(remove).toHaveBeenCalledWith('/saved-activities');
  });
});
