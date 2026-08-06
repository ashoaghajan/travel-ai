/**
 * Generates a client-side id. Stage 2 will get ids from the database, so this
 * only needs to be unique within one browser.
 */
export function createId(prefix: string): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  return `${prefix}_${uuid}`;
}
