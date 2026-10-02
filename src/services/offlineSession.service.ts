import type { ApiUser } from '@ai-travel/shared';
import { STORAGE_KEYS, storageService } from './localStorage.service';

/** Last-known account profile used only when a persisted session is offline. */
export const offlineSessionService = {
  save(user: ApiUser): void {
    try {
      storageService.set(STORAGE_KEYS.offlineUser, user);
    } catch {
      // An account remains usable online if this device cannot cache the profile.
    }
  },

  read(ownerId: string | null): ApiUser | null {
    if (!ownerId) return null;
    const user = storageService.get<ApiUser | null>(STORAGE_KEYS.offlineUser, null);
    return user?.id === ownerId ? user : null;
  },
};
