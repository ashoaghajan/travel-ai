import { ApiError } from '../../services/http';

/**
 * What to say when sharing a trip fails.
 *
 * Pure, and in its own file for the reason the other `*.filters.ts` modules
 * are: the interesting part is which failure gets which sentence, and that is
 * worth asserting without rendering a dialog.
 */

const GENERIC = 'We could not share that trip. Try again.';

/**
 * The sentence for one failure.
 *
 * The size case is the one worth telling apart. "Try again" is advice, and
 * advice that cannot work is worse than none: a trip over the body limit will
 * be over it on every attempt, so saying so is the only honest answer.
 */
export function shareFailureMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 413) {
    return 'This trip is too large to share. Try removing a few days or some long notes.';
  }

  return GENERIC;
}
