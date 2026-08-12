import { useCallback, useState } from 'react';
import type { ApiSharedTrip } from '@ai-travel/shared';
import { shareService } from '../../services/share.service';
import { messagesStore } from '../../store/messages.store';
import { createId } from '../../utils/id';
import { toTripDraft } from '../../utils/tripFile';
import type { ExportedTrip } from '../../utils/tripFile';

const LOAD_ERROR = 'We could not open that trip.';
const ACCEPT_ERROR = 'We could not add that trip. Try again.';
const REVOKE_ERROR = 'We could not withdraw that trip.';

export type SharedTripState = {
  /** The offer being looked at, or null when nothing is open. */
  offer: ApiSharedTrip | null;
  isPreviewOpen: boolean;
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  preview: (shareId: string) => Promise<void>;
  closePreview: () => void;
  accept: (shareId: string) => Promise<void>;
  revoke: (shareId: string) => Promise<void>;
};

/**
 * What a reader can do with a trip somebody offered them.
 *
 * A hook rather than store state, because none of it is shared: two panels
 * never look at the same offer, and nothing outside the card that was pressed
 * cares whether a preview is open. What *is* shared — the card's state — goes
 * back to the store, which is what makes both ends agree.
 */
export function useSharedTrip(): SharedTripState {
  const [offer, setOffer] = useState<ApiSharedTrip | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useCallback(async (shareId: string) => {
    setIsPreviewOpen(true);
    setIsLoading(true);
    setError(null);

    try {
      setOffer(await shareService.getShare(shareId));
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const closePreview = useCallback(() => {
    setIsPreviewOpen(false);
    setOffer(null);
    setError(null);
  }, []);

  /**
   * Takes up an offer.
   *
   * The snapshot is fetched first even when a preview already has it, because
   * accepting from the card is one press and the itinerary is what gets sent —
   * a stale copy held from a preview opened ten minutes ago would write ten
   * minutes of nothing.
   *
   * `toTripDraft` is the import path, unchanged: it mints fresh ids, resolves
   * each photograph against *this* build, and drops what does not travel. The
   * server then validates the result as it would any hand-made trip.
   */
  const accept = useCallback(async (shareId: string) => {
    setIsBusy(true);
    setError(null);

    try {
      const { trip } = await shareService.getShare(shareId);
      const draft = toTripDraft(trip as ExportedTrip, createId('draft'));

      await shareService.acceptShare(shareId, draft);

      // Patched here rather than waited for: the card must change under the
      // finger that pressed it, and a browser with no realtime at all still
      // has to show what just happened.
      messagesStore.noteShareAccepted(shareId);
      setIsPreviewOpen(false);
      setOffer(null);
    } catch {
      setError(ACCEPT_ERROR);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const revoke = useCallback(async (shareId: string) => {
    setIsBusy(true);
    setError(null);

    try {
      await shareService.revokeShare(shareId);
      messagesStore.noteShareRevoked(shareId);
    } catch {
      setError(REVOKE_ERROR);
    } finally {
      setIsBusy(false);
    }
  }, []);

  return {
    offer,
    isPreviewOpen,
    isLoading,
    isBusy,
    error,
    preview,
    closePreview,
    accept,
    revoke,
  };
}
