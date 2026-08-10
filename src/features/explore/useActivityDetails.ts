import { useCallback, useEffect, useState } from 'react';
import { activityService } from '../../services/activity.service';
import type { ActivityDetails } from '../../services/activity.service';
import { MissingApiKeyError, OpenTripMapError } from '../../services/opentripmap.service';

const GENERIC_ERROR = 'We could not load this attraction. Please try again.';
const MISSING_KEY_ERROR =
  'This attraction is unavailable: the server has no OpenTripMap key configured.';

function describeError(error: unknown): string {
  if (error instanceof MissingApiKeyError) return MISSING_KEY_ERROR;
  if (error instanceof OpenTripMapError) return `${error.message} Please try again.`;
  return GENERIC_ERROR;
}

export type ActivityDetailsState = {
  activity: ActivityDetails | null;
  isLoading: boolean;
  error: string | null;
  /** True when the lookup succeeded but the place is genuinely unknown. */
  notFound: boolean;
  retry: () => void;
};

/**
 * One attraction, by its OpenTripMap id.
 *
 * `notFound` and `error` are kept apart on purpose: an id that does not exist
 * is a dead end the reader should be told about plainly, while a failed
 * request is worth offering a retry for.
 */
export function useActivityDetails(activityId: string | undefined): ActivityDetailsState {
  const [activity, setActivity] = useState<ActivityDetails | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!activityId) {
      setActivity(null);
      setStatus('missing');
      return;
    }

    let active = true;
    setStatus('loading');
    setError(null);

    activityService
      .getActivityById(activityId)
      .then((found) => {
        if (!active) return;

        setActivity(found);
        setStatus(found ? 'ready' : 'missing');
      })
      .catch((caught: unknown) => {
        if (!active) return;

        setActivity(null);
        setError(describeError(caught));
        setStatus('error');
      });

    return () => {
      active = false;
    };
  }, [activityId, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return {
    activity,
    isLoading: status === 'loading',
    error,
    notFound: status === 'missing',
    retry,
  };
}
