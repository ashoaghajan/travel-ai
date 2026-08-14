import { randomUUID } from 'expo-crypto';

/**
 * Generates a client-side id.
 *
 * **A copy of `src/utils/id.ts` with a real random source.** The web reaches
 * for `globalThis.crypto.randomUUID` and falls back to `Date.now()` plus
 * `Math.random()` when it is absent. Hermes has no `crypto.randomUUID`, so on
 * a phone that fallback is not a fallback — it is the only path, every time.
 *
 * That matters more than the web's comment suggests. These ids are minted here
 * and then *persisted to the server*: a trip keeps the id its client gave it,
 * which is what makes the import endpoint idempotent. `Math.random()` is not
 * seeded per device and has no collision guarantee across them, so two phones
 * creating a trip in the same millisecond is a real, if unlikely, way to lose
 * somebody's data.
 *
 * `expo-crypto` is backed by the platform's secure random generator, so the
 * uniqueness the ids are already relied upon to have becomes true.
 */
export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
