import { archiveKey, STORAGE_KEYS, storageService } from './localStorage.service';
import type { StorageKey } from './localStorage.service';

/**
 * Whose trips these are.
 *
 * Accounts are real, but trips still live in this browser until the trips API
 * lands. Without something in between, signing in as a second person on a
 * shared machine would show them the first person's itineraries.
 *
 * The obvious fix — putting the user id in the storage keys — does not work
 * here. `trip.store.ts` and `savedActivity.store.ts` capture their key once,
 * at module load, so a key that changes at sign-in is simply never read again.
 *
 * So the key stays fixed and the *contents* move. On sign-in the outgoing
 * account's data is archived under its own id and the incoming account's is
 * restored over the top. Because every write goes through `storageService`,
 * which notifies subscribers, the stores refresh on their own and no component
 * has to know this happened.
 *
 * Nothing is ever deleted: this is the only copy until an account can hold it.
 */

/**
 * The keys that belong to a person.
 *
 * `countries`, `activities`, `geocodes` and the city lists are reference data
 * — the same answers for everybody, expensive to refetch, and pointless to
 * duplicate per account. Leave them alone. (Documented so nobody "fixes" it.)
 */
const OWNED_KEYS: StorageKey[] = [
  STORAGE_KEYS.trips,
  STORAGE_KEYS.activeTripId,
  STORAGE_KEYS.chatHistory,
  STORAGE_KEYS.settings,
  STORAGE_KEYS.recentSearches,
  STORAGE_KEYS.savedActivities,
  STORAGE_KEYS.bookings,
  STORAGE_KEYS.selectedCountry,
  STORAGE_KEYS.selectedCity,
];

/** The id whose data is currently in the live keys, or null for nobody's. */
export function currentOwner(): string | null {
  return storageService.get<string | null>(STORAGE_KEYS.ownerUserId, null);
}

function move(from: StorageKey, to: StorageKey): void {
  const value = storageService.get<unknown>(from, undefined);

  if (value === undefined) {
    storageService.remove(to);
    return;
  }

  try {
    storageService.set(to, value);
  } catch {
    // Storage full or blocked. Better to leave both copies where they are
    // than to remove the source and lose the data outright.
    return;
  }

  storageService.remove(from);
}

/** Where unowned data is parked when it cannot simply be inherited. */
const GUEST_OWNER = 'guest';

function hasStoredData(owner: string): boolean {
  return OWNED_KEYS.some(
    (key) => storageService.get<unknown>(archiveKey(owner, key), undefined) !== undefined,
  );
}

/**
 * Point the live keys at `userId`'s data.
 *
 * Safe to call on every sign-in: when the same account signs in again there is
 * nothing to move, and it returns without touching storage.
 */
export function claimLocalData(userId: string): void {
  const owner = currentOwner();
  if (owner === userId) return;

  if (owner) {
    // Park the outgoing account's data. That empties the live keys, so a
    // missing archive for the incoming account correctly leaves them empty
    // rather than showing them somebody else's trips.
    for (const key of OWNED_KEYS) move(key, archiveKey(owner, key));
    for (const key of OWNED_KEYS) move(archiveKey(userId, key), key);

    storageService.set(STORAGE_KEYS.ownerUserId, userId);
    return;
  }

  // Nobody owned the live data. Ordinarily that means guest data from before
  // accounts existed, and the first account to sign in inherits it — almost
  // always the same person who created it. Leave it exactly where it is.
  if (hasStoredData(userId)) {
    // Unless this account already has an archive, which is the better claim.
    // The unowned data still is not deleted: it goes under `guest`, because
    // this module's one promise is that nothing is thrown away.
    for (const key of OWNED_KEYS) move(key, archiveKey(GUEST_OWNER, key));
    for (const key of OWNED_KEYS) move(archiveKey(userId, key), key);
  }

  storageService.set(STORAGE_KEYS.ownerUserId, userId);
}

/**
 * Park the signed-out account's data and leave the live keys empty.
 *
 * The next person to sign in on this browser starts with a clean app rather
 * than someone else's trips, and the owner gets theirs back on return.
 */
export function releaseLocalData(): void {
  const owner = currentOwner();
  if (!owner) return;

  for (const key of OWNED_KEYS) move(key, archiveKey(owner, key));

  storageService.remove(STORAGE_KEYS.ownerUserId);
}
