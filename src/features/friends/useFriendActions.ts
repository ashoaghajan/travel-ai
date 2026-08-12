import { useCallback, useState } from 'react';
import { friendStore } from '../../store/friend.store';

const FAILED = 'That did not work. Try again.';

export type FriendActions = {
  /** Whose row is mid-request, so one button can say so and the rest can wait. */
  busyId: string | null;
  error: string | null;
  /**
   * Bumped after every successful change.
   *
   * What the directory search watches, rather than the friend and request
   * lists themselves: those are arrays, and an effect keyed on an array is
   * keyed on its identity — which happens to change when a fetch returns new
   * objects and happens not to when it returns the same ones. A counter says
   * plainly what is meant: something about this reader's relationships moved.
   */
  changedAt: number;
  add: (userId: string) => Promise<void>;
  accept: (userId: string) => Promise<void>;
  remove: (userId: string) => Promise<void>;
};

/**
 * The three things a row can do, and what it looks like while doing one.
 *
 * A hook rather than store state: which button is spinning is a fact about
 * this screen, not about the account. What the *result* is goes to the store,
 * which is what makes the counts and the other list agree afterwards.
 */
export function useFriendActions(): FriendActions {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changedAt, setChangedAt] = useState(0);

  const run = useCallback(async (userId: string, action: () => Promise<void>) => {
    setBusyId(userId);
    setError(null);

    try {
      await action();
      setChangedAt((count) => count + 1);
    } catch {
      setError(FAILED);
    } finally {
      setBusyId(null);
    }
  }, []);

  return {
    busyId,
    error,
    changedAt,
    add: useCallback((userId) => run(userId, () => friendStore.add(userId)), [run]),
    accept: useCallback((userId) => run(userId, () => friendStore.accept(userId)), [run]),
    remove: useCallback((userId) => run(userId, () => friendStore.remove(userId)), [run]),
  };
}
