import { MissingApiKeyError, OpenTripMapError } from '../../services/opentripmap.service';

/**
 * User-facing wording for an attraction lookup that failed.
 *
 * Shared by the explorer and the itinerary's attraction picker, so the sentence
 * that tells someone their API key is missing reads the same in both places.
 */

const GENERIC_ERROR = 'We could not load activities right now. Please try again.';

// Says whose problem it is. The key moved server-side, so a reader cannot fix
// this by editing anything they have — and telling them to edit `.env.local`,
// as this used to, sent them after a file that is not theirs and no longer
// holds the key anyway.
const MISSING_KEY_ERROR =
  'Activities are unavailable: this server has no OpenTripMap key configured.';

export function describeActivityError(error: unknown): string {
  if (error instanceof MissingApiKeyError) return MISSING_KEY_ERROR;
  if (error instanceof OpenTripMapError) return `${error.message} Please try again.`;
  return GENERIC_ERROR;
}
