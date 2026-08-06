import { MissingApiKeyError, OpenTripMapError } from '../../services/opentripmap.service';

/**
 * User-facing wording for an attraction lookup that failed.
 *
 * Shared by the explorer and the itinerary's attraction picker, so the sentence
 * that tells someone their API key is missing reads the same in both places.
 */

const GENERIC_ERROR = 'We could not load activities right now. Please try again.';

const MISSING_KEY_ERROR =
  'Activities need an OpenTripMap API key. Add VITE_OPENTRIPMAP_API_KEY to .env.local and restart the dev server.';

export function describeActivityError(error: unknown): string {
  if (error instanceof MissingApiKeyError) return MISSING_KEY_ERROR;
  if (error instanceof OpenTripMapError) return `${error.message} Please try again.`;
  return GENERIC_ERROR;
}
