import { useCallback, useState } from 'react';
import type { ApiSharedTrip } from '@ai-travel/shared';
import { shareService } from '../../services/share.service';
import type { TripDraft, TripNote } from '../../types/trip.types';
import { messagesStore } from '../../store/messages.store';
import { tripStore } from '../../store/trip.store';
import { createId } from '../../utils/id';
import { toTripDraft } from '../../utils/tripFile';
import type { ExportedTrip } from '../../utils/tripFile';

/**
 * Where a copy came from, written into it once.
 *
 * A note rather than a column: it travels with the trip wherever it goes next,
 * it survives the share row being deleted, and it is the reader's to remove —
 * which a field they could not edit would not be. Cheap and honest.
 *
 * Skipped when the sender is unknown; "Shared by undefined" is worse than
 * saying nothing.
 */
function withProvenance(draft: TripDraft, sharedBy?: string): TripDraft {
  if (!sharedBy) return draft;

  const now = new Date();
  const note: TripNote = {
    id: createId('note'),
    text: `Shared by ${sharedBy} on ${now.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}.`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  // First, so it reads as a heading on the copy rather than as an afterthought
  // under whatever the sender had written.
  return { ...draft, notes: [note, ...(draft.notes ?? [])] };
}

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
  accept: (shareId: string, sharedBy?: string) => Promise<void>;
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
  const accept = useCallback(async (shareId: string, sharedBy?: string) => {
    setIsBusy(true);
    setError(null);

    try {
      const { trip } = await shareService.getShare(shareId);
      const draft = withProvenance(toTripDraft(trip as ExportedTrip, createId('draft')), sharedBy);

      const accepted = await shareService.acceptShare(shareId, draft);

      /*
       * Filed with the trips this account already holds.
       *
       * Without this the row exists and nothing reading `tripStore` knows:
       * the trips page, the sidebar's recent trips and the planner all render
       * a list fetched before the accept, and only a reload fixes it.
       */
      tripStore.adoptTrip(accepted);

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
