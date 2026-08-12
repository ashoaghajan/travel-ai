import { describe, expect, it, vi } from 'vitest';
import type { ApiDirectMessage, ApiSharedTrip } from '@ai-travel/shared';
import { http } from './http';
import { shareService } from './share.service';

/** The wire shapes. What a share *means* is the store's and the card's problem. */

const SNAPSHOT = {
  title: 'Berlin in Early Autumn',
  destination: 'Berlin, Germany',
  startDate: '2026-09-07',
  endDate: '2026-09-11',
  travellers: 2,
  coverImage: '/assets/city-9f2a1b.jpg',
  coverImageId: 'city',
  itinerary: [],
};

describe('shareService', () => {
  it('offers a trip to one person, with the browser’s own id for it', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({ id: 'dm_1' } as ApiDirectMessage);

    await shareService.shareTrip('trip_1', 'u_2', SNAPSHOT, 'cm_1');

    expect(post).toHaveBeenCalledWith('/trips/trip_1/share', {
      toUserId: 'u_2',
      trip: SNAPSHOT,
      clientMessageId: 'cm_1',
    });
  });

  it('reads one offer, itinerary and all', async () => {
    const offer = { share: { id: 's_1' }, trip: SNAPSHOT } as unknown as ApiSharedTrip;
    const get = vi.spyOn(http, 'get').mockResolvedValue(offer);

    await expect(shareService.getShare('s_1')).resolves.toBe(offer);
    expect(get).toHaveBeenCalledWith('/shares/s_1');
  });

  it('sends the rebuilt trip when taking one up', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({ id: 'trip_2' });
    const draft = { title: 'Berlin in Early Autumn' } as never;

    await shareService.acceptShare('s_1', draft);

    // The trip goes up from here because resolving each photograph against
    // this build is a thing only this side can do.
    expect(post).toHaveBeenCalledWith('/shares/s_1/accept', draft);
  });

  it('withdraws an offer', async () => {
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);

    await shareService.revokeShare('s_1');

    expect(remove).toHaveBeenCalledWith('/shares/s_1');
  });

  it('escapes every id it puts in a path', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({} as ApiDirectMessage);
    const get = vi.spyOn(http, 'get').mockResolvedValue({} as ApiSharedTrip);
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);

    await shareService.shareTrip('trip/1', 'u_2', SNAPSHOT, 'cm_1');
    await shareService.getShare('s/1');
    await shareService.acceptShare('s/1', {} as never);
    await shareService.revokeShare('s/1');

    expect(post.mock.calls.map((call) => call[0])).toEqual([
      '/trips/trip%2F1/share',
      '/shares/s%2F1/accept',
    ]);
    expect(get).toHaveBeenCalledWith('/shares/s%2F1');
    expect(remove).toHaveBeenCalledWith('/shares/s%2F1');
  });
});
