import { describe, expect, it, vi } from 'vitest';
import type { ApiConversation, ApiDirectMessage } from '@ai-travel/shared';
import { http, resetWarmth } from './http';
import { messagesService } from './messages.service';

/** The wire shapes. Everything else about a conversation is the store's problem. */

const MESSAGE: ApiDirectMessage = {
  id: 'dm_1',
  senderId: 'u_1',
  recipientId: 'u_2',
  senderName: 'Ada',
  body: 'Anyone been to Yerevan?',
  createdAt: '2026-08-11T10:00:00.000Z',
  clientMessageId: 'msg_1',
};

const CONVERSATION: ApiConversation = {
  id: 'u_2',
  name: 'Grace',
  lastMessage: { body: 'see you', createdAt: '2026-08-11T10:00:00.000Z', isMine: false },
  unread: 2,
};

describe('messagesService', () => {
  it('lists everyone you could talk to', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([CONVERSATION]);

    await expect(messagesService.getConversations()).resolves.toEqual([CONVERSATION]);
    // No `?q=` at all when nobody has searched: an empty parameter is a filter
    // matching nothing in particular rather than the absence of one.
    expect(get).toHaveBeenCalledWith('/messages/conversations', { query: undefined });
  });

  it('narrows the list by name', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([]);

    await messagesService.getConversations('gra');

    expect(get).toHaveBeenCalledWith('/messages/conversations', { query: { q: 'gra' } });
  });

  it('reads one conversation, naming the other person', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([MESSAGE]);

    await expect(messagesService.getThread('u_2')).resolves.toEqual([MESSAGE]);
    expect(get).toHaveBeenCalledWith('/messages/with/u_2');
  });

  it('sends the body and the browser’s own id for it', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue(MESSAGE);

    await expect(messagesService.sendMessage('u_2', 'hello', 'msg_1')).resolves.toBe(MESSAGE);
    expect(post).toHaveBeenCalledWith('/messages/with/u_2', {
      body: 'hello',
      clientMessageId: 'msg_1',
    });
  });

  it('moves the read cursor for one conversation', async () => {
    const post = vi.spyOn(http, 'post').mockResolvedValue(undefined);

    await messagesService.markRead('u_2');

    expect(post).toHaveBeenCalledWith('/messages/with/u_2/read');
  });

  it('escapes the id when withdrawing a message', async () => {
    const remove = vi.spyOn(http, 'delete').mockResolvedValue(undefined);

    await messagesService.deleteMessage('dm/1');

    expect(remove).toHaveBeenCalledWith('/messages/dm%2F1');
  });

  it('escapes the person in every path that names one', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue([]);
    const post = vi.spyOn(http, 'post').mockResolvedValue(MESSAGE);

    await messagesService.getThread('u/2');
    await messagesService.sendMessage('u/2', 'hello', 'msg_1');
    await messagesService.markRead('u/2');

    expect(get).toHaveBeenCalledWith('/messages/with/u%2F2');
    expect(post.mock.calls.map((call) => call[0])).toEqual([
      '/messages/with/u%2F2',
      '/messages/with/u%2F2/read',
    ]);
  });

  it('asks the server to sign a listening token', async () => {
    const token = { clientId: 'u_1', mac: 'x', capability: '{}' };
    const get = vi.spyOn(http, 'get').mockResolvedValue(token);

    // Through `http`, not a bare fetch: that is what attaches the bearer token
    // and what renews it when Ably asks for a fresh one an hour later.
    await expect(messagesService.getRealtimeToken()).resolves.toBe(token);
    expect(get).toHaveBeenCalledWith('/messages/token');
  });

  it('nudges a sleeping API before somebody types', async () => {
    resetWarmth();
    const fetched = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    messagesService.wakeUp();

    // Fire-and-forget: nothing here waits on it, which is why the assertion
    // has to wait instead.
    await vi.waitFor(() => expect(fetched).toHaveBeenCalled());
    expect(String(fetched.mock.calls[0][0])).toContain('/health');
  });
});
