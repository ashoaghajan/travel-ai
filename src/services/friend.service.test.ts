import { describe, expect, it, vi } from 'vitest';
import { http } from './http';
import { friendService } from './friend.service';

/** The wire shapes. What a friendship *means* is the store's problem. */

describe('friendService', () => {
  it('reads the friends, the requests and the counts', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([]);

    await friendService.getFriends();
    await friendService.getRequests();
    await friendService.getStats();

    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/friends',
      '/friends/requests',
      '/friends/stats',
    ]);
  });

  it('searches with a name, and without one', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([]);

    await friendService.searchPeople('gra');
    await friendService.searchPeople();

    expect(get.mock.calls[0]).toEqual(['/friends/search', { query: { q: 'gra' } }]);
    // No `?q=` at all when nobody has searched: an empty parameter is a filter
    // matching nothing in particular rather than the absence of one.
    expect(get.mock.calls[1]).toEqual(['/friends/search', { query: undefined }]);
  });

  it('hands back where the caller now stands after asking', async () => {
    vi.spyOn(http, 'post').mockResolvedValue({ status: 'friends' });

    // Not always `outgoing`: asking somebody who already asked you accepts.
    await expect(friendService.addFriend('u_1')).resolves.toBe('friends');
  });

  it('accepts, and removes', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({ status: 'friends' });
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);

    await friendService.acceptFriend('u_1');
    await friendService.removeFriend('u_1');

    expect(post).toHaveBeenCalledWith('/friends/u_1/accept');
    expect(remove).toHaveBeenCalledWith('/friends/u_1');
  });

  it('escapes every id it puts in a path', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue({ status: 'none' });
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);

    await friendService.addFriend('u/1');
    await friendService.acceptFriend('u/1');
    await friendService.removeFriend('u/1');

    expect(post.mock.calls.map((call) => call[0])).toEqual(['/friends/u%2F1', '/friends/u%2F1/accept']);
    expect(remove).toHaveBeenCalledWith('/friends/u%2F1');
  });
});
