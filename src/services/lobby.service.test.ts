import { describe, expect, it, vi } from 'vitest';
import type { ApiLobbyMessage } from '@ai-travel/shared';
import { http } from './http';
import { lobbyService } from './lobby.service';

/** The wire shapes. Everything else about the room is the store's problem. */

const MESSAGE: ApiLobbyMessage = {
  id: 'lm_1',
  userId: 'u_1',
  authorName: 'Ada',
  body: 'Anyone been to Yerevan?',
  createdAt: '2026-08-11T10:00:00.000Z',
  clientMessageId: 'msg_1',
};

describe('lobbyService', () => {
  it('reads the room', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([MESSAGE]);

    await expect(lobbyService.getMessages()).resolves.toEqual([MESSAGE]);
    expect(get).toHaveBeenCalledWith('/lobby/messages');
  });

  it('sends the body and the browser’s own id for it', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue(MESSAGE);

    await expect(lobbyService.sendMessage('hello', 'msg_1')).resolves.toBe(MESSAGE);
    expect(post).toHaveBeenCalledWith('/lobby/messages', {
      body: 'hello',
      clientMessageId: 'msg_1',
    });
  });

  it('escapes the id when withdrawing a message', async () => {
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);

    await lobbyService.deleteMessage('lm/1');

    expect(remove).toHaveBeenCalledWith('/lobby/messages/lm%2F1');
  });

  it('asks the server to sign a listening token', async () => {
    const token = { clientId: 'u_1', mac: 'x', capability: '{}' };
    const get = vi.spyOn(http, 'get').mockResolvedValue(token);

    // Through `http`, not a bare fetch: that is what attaches the bearer token
    // and what renews it when Ably asks for a fresh one an hour later.
    await expect(lobbyService.getRealtimeToken()).resolves.toBe(token);
    expect(get).toHaveBeenCalledWith('/lobby/token');
  });

  it('reads who is in the room', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([{ id: 'u_1', name: 'Ada' }]);

    await expect(lobbyService.getPeople()).resolves.toEqual([{ id: 'u_1', name: 'Ada' }]);
    // No `?online=` at all when nobody is present — an empty parameter would
    // be a claim about the presence set rather than the absence of one.
    expect(get).toHaveBeenCalledWith('/lobby/people', { query: undefined });
  });

  it('carries the presence set up with the request', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([]);

    await lobbyService.getPeople(['u_1', 'u_2']);

    expect(get).toHaveBeenCalledWith('/lobby/people', { query: { online: 'u_1,u_2' } });
  });
});
