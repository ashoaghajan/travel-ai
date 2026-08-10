/**
 * Telling the app's other tabs that something changed.
 *
 * The storage-backed stores got this for free: `localStorage` fires a `storage`
 * event in every other tab, so a save in one refreshed the rest. Moving a store
 * to the API removes that, and losing it would be a silent regression — two
 * tabs open on the trips list, a save in one, and the other keeps showing the
 * old list until it is reloaded by hand.
 *
 * Deliberately carries no payload. A message says only "trips changed"; the
 * receiving tab refetches. Sending the new data instead would mean trusting one
 * tab's copy, and they can be at different versions.
 */

export type BroadcastTopic = 'trips' | 'bookings';

const CHANNEL_NAME = 'ai-travel-planner';

type Message = { topic: BroadcastTopic };

/**
 * Null where `BroadcastChannel` is missing — older Safari, jsdom without the
 * polyfill, any non-browser context. Cross-tab sync is a nicety; nothing here
 * may fail without it.
 */
const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;

export function broadcast(topic: BroadcastTopic): void {
  channel?.postMessage({ topic } satisfies Message);
}

/**
 * Run `listener` when another tab announces this topic.
 *
 * Only other tabs: `BroadcastChannel` does not deliver a tab its own messages,
 * which is exactly right here — the sending tab already applied the change.
 */
export function onBroadcast(topic: BroadcastTopic, listener: () => void): () => void {
  if (!channel) return () => undefined;

  const handle = (event: MessageEvent<Message>) => {
    if (event.data?.topic === topic) listener();
  };

  channel.addEventListener('message', handle);

  return () => channel.removeEventListener('message', handle);
}
