import { describe, expect, it, vi } from 'vitest';
import { createResource } from './createResource';

/**
 * The shared read model.
 *
 * Three of these behaviours are the ones that break screens rather than tests:
 * a snapshot whose identity churns is an infinite render loop, a refresh that
 * swaps the data reference re-renders every list for a result that has not
 * arrived, and a failed refresh that empties `data` blanks a page the reader
 * is looking at.
 */

const EMPTY: string[] = [];

/** A load whose resolution this test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('loading', () => {
  it('starts idle and empty', () => {
    const resource = createResource({ empty: EMPTY, load: async () => ['a'] });

    expect(resource.getSnapshot()).toEqual({ status: 'idle', data: EMPTY, error: null });
  });

  it('fetches when the first subscriber arrives', async () => {
    const load = vi.fn(async () => ['a']);
    const resource = createResource({ empty: EMPTY, load });

    resource.subscribe(() => undefined);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('ready'));

    // No provider, no bootstrap step, no useEffect in the components reading it.
    expect(load).toHaveBeenCalledTimes(1);
    expect(resource.getSnapshot().data).toEqual(['a']);
  });

  it('asks once however many subscribers arrive together', async () => {
    const load = vi.fn(async () => ['a']);
    const resource = createResource({ empty: EMPTY, load });

    resource.subscribe(() => undefined);
    resource.subscribe(() => undefined);
    resource.subscribe(() => undefined);

    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('ready'));

    // StrictMode double-mounts, and a busy screen subscribes from many cards.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers when the data arrives', async () => {
    const listener = vi.fn();
    const resource = createResource({ empty: EMPTY, load: async () => ['a'] });

    resource.subscribe(listener);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('ready'));

    expect(listener).toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', async () => {
    const gate = deferred<string[]>();
    const listener = vi.fn();
    const resource = createResource({ empty: EMPTY, load: () => gate.promise });

    const unsubscribe = resource.subscribe(listener);
    unsubscribe();
    listener.mockClear();

    gate.resolve(['a']);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('ready'));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('snapshot identity', () => {
  it('returns the same object between changes', async () => {
    const resource = createResource({ empty: EMPTY, load: async () => ['a'] });
    resource.subscribe(() => undefined);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('ready'));

    // `useSyncExternalStore` compares with Object.is and re-reads every
    // render. A fresh object per call is an infinite loop, and a quiet one.
    expect(resource.getSnapshot()).toBe(resource.getSnapshot());
  });

  it('keeps the data reference while a refresh is in flight', async () => {
    const resource = createResource({ empty: EMPTY, load: async () => ['a'] });
    resource.subscribe(() => undefined);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('ready'));

    const before = resource.getSnapshot().data;
    void resource.refresh();

    // A background refresh must not hand every list a new array identity and
    // re-render the screen for a result that has not arrived yet.
    expect(resource.getSnapshot().status).toBe('loading');
    expect(resource.getSnapshot().data).toBe(before);
  });
});

describe('failure', () => {
  it('reports the error without emptying the data', async () => {
    let attempt = 0;
    const resource = createResource({
      empty: EMPTY,
      load: async () => {
        attempt += 1;
        if (attempt === 1) return ['a'];
        throw new Error('offline');
      },
    });

    resource.subscribe(() => undefined);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('ready'));

    await resource.refresh();

    // A failed refresh must not blank a list the reader is looking at.
    expect(resource.getSnapshot().status).toBe('error');
    expect(resource.getSnapshot().data).toEqual(['a']);
    expect(resource.getSnapshot().error?.message).toBe('offline');
  });

  it('wraps a thrown non-error', async () => {
    const resource = createResource({
      empty: EMPTY,
      load: async () => {
        throw 'just a string';
      },
    });

    resource.subscribe(() => undefined);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('error'));

    expect(resource.getSnapshot().error).toBeInstanceOf(Error);
  });

  it('can be retried after a failure', async () => {
    let attempt = 0;
    const resource = createResource({
      empty: EMPTY,
      load: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('offline');
        return ['a'];
      },
    });

    resource.subscribe(() => undefined);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('error'));

    await resource.refresh();

    expect(resource.getSnapshot()).toMatchObject({ status: 'ready', data: ['a'], error: null });
  });
});

describe('set', () => {
  it('writes through without refetching', async () => {
    const load = vi.fn(async () => ['a']);
    const resource = createResource({ empty: EMPTY, load });
    resource.subscribe(() => undefined);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('ready'));

    resource.set(['a', 'b']);

    // The server already accepted the mutation and returned the new state;
    // asking for the list again would be a round trip for what we hold.
    expect(resource.getSnapshot().data).toEqual(['a', 'b']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('clears a previous error', async () => {
    const resource = createResource({
      empty: EMPTY,
      load: async () => {
        throw new Error('offline');
      },
    });
    resource.subscribe(() => undefined);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('error'));

    resource.set(['a']);

    expect(resource.getSnapshot()).toMatchObject({ status: 'ready', error: null });
  });

  it('notifies subscribers', async () => {
    const listener = vi.fn();
    const resource = createResource({ empty: EMPTY, load: async () => ['a'] });
    resource.subscribe(listener);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('ready'));
    listener.mockClear();

    resource.set(['a', 'b']);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('reset', () => {
  it('goes back to empty and unloaded', async () => {
    const resource = createResource({ empty: EMPTY, load: async () => ['a'] });
    resource.subscribe(() => undefined);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('ready'));

    resource.reset();

    // Sign-out: the next reader must not see the previous account's list.
    expect(resource.getSnapshot()).toEqual({ status: 'idle', data: EMPTY, error: null });
  });

  it('lets the next subscriber load again', async () => {
    const load = vi.fn(async () => ['a']);
    const resource = createResource({ empty: EMPTY, load });
    const unsubscribe = resource.subscribe(() => undefined);
    await vi.waitFor(() => expect(resource.getSnapshot().status).toBe('ready'));

    unsubscribe();
    resource.reset();
    resource.subscribe(() => undefined);

    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
});
