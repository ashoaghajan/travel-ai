import type { ApiDirectMessage, ApiSharedTrip } from '@ai-travel/shared';
import type { Trip, TripDraft } from '../types/trip.types';
import type { ExportedTrip } from '../utils/tripFile';
import { http } from './http';

/**
 * Offering a trip to somebody, over HTTP.
 *
 * No React component may import this file.
 *
 * The snapshot travels up from here rather than being built on the server, and
 * the reason is a photograph: a bundled cover is a content-hashed path that
 * differs between one build and the next, so only this side can turn it back
 * into the stable name that survives the trip. `buildTripFile` already does
 * that for the export file, and a share is that file with a recipient.
 */
export const shareService = {
  /**
   * Offers one of your trips to one person.
   *
   * `clientMessageId` is minted by the caller, as it is for a written message
   * and for the same reason: a cold instance takes a minute to answer, and the
   * second press must not become a second offer.
   */
  async shareTrip(
    tripId: string,
    toUserId: string,
    trip: ExportedTrip,
    clientMessageId: string,
  ): Promise<ApiDirectMessage> {
    return http.post<ApiDirectMessage>(`/trips/${encodeURIComponent(tripId)}/share`, {
      toUserId,
      trip,
      clientMessageId,
    });
  },

  /** The offer with the itinerary inside it — fetched only when somebody looks. */
  async getShare(shareId: string): Promise<ApiSharedTrip> {
    return http.get<ApiSharedTrip>(`/shares/${encodeURIComponent(shareId)}`);
  },

  /**
   * Takes up an offer, as a copy.
   *
   * The trip goes up from here because turning a snapshot back into one is the
   * import path, and the import path is this side's: it resolves each
   * photograph against *this* build. The server validates it exactly as it
   * validates a trip made by hand, and keys the copy to the share so a second
   * press returns the first trip.
   */
  async acceptShare(shareId: string, trip: TripDraft): Promise<Trip> {
    return http.post<Trip>(`/shares/${encodeURIComponent(shareId)}/accept`, trip);
  },

  /** Withdraws an offer nobody has taken up yet. */
  async revokeShare(shareId: string): Promise<void> {
    await http.delete<void>(`/shares/${encodeURIComponent(shareId)}`);
  },
};
