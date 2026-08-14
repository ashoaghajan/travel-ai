import { createMMKV } from 'react-native-mmkv';

/**
 * MMKV, wearing the shape of `window.localStorage`.
 *
 * **The point of the disguise is the diff.** `localStorage.service.ts` is two
 * hundred lines of key registry, JSON handling, subscription fan-out and usage
 * accounting wrapped around about six lines that actually touch the browser.
 * Presenting the same five members here means the copy of that file differs
 * from the web's in exactly those six lines, so the two cannot quietly grow
 * apart — and the day `core/` is extracted for real, this is the only thing
 * that has to be injected.
 *
 * MMKV rather than AsyncStorage, and the reason is the signature above: the
 * facade is **synchronous**, and about twenty services plus the store
 * snapshots are written against that. AsyncStorage would turn every one of
 * them into a promise for no benefit a phone can perceive.
 *
 * MMKV is also fast enough that the sync API is not a lie — it is memory
 * mapped, so a read is a memory access rather than a file one.
 */

const mmkv = createMMKV({ id: 'ai-travel' });

/**
 * The subset of the `Storage` interface the facade actually uses.
 *
 * Stated rather than claiming to implement `Storage`: `clear()` and the index
 * signature are not needed, and pretending to provide them would invite
 * somebody to call one.
 */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
};

export const mmkvStorage: StorageLike = {
  // MMKV answers `undefined` for a missing key; the facade tests for `null`.
  getItem: (key) => mmkv.getString(key) ?? null,
  setItem: (key, value) => mmkv.set(key, value),
  removeItem: (key) => void mmkv.remove(key),

  /*
   * `length` and `key(i)` exist only so `cityListKeys()` can walk the store.
   * MMKV has no index-based access, so both are served from `getAllKeys()`.
   * That is a full array each call, which would be wasteful in a loop — and is
   * not, because the one caller walks it once and the alternative is changing
   * a file that otherwise ports untouched.
   */
  get length() {
    return mmkv.getAllKeys().length;
  },
  key: (index) => mmkv.getAllKeys()[index] ?? null,
};
