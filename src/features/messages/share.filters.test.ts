import { describe, expect, it } from 'vitest';
import { ApiError } from '../../services/http';
import { shareFailureMessage } from './share.filters';

describe('shareFailureMessage', () => {
  it('tells somebody to try again when trying again might work', () => {
    expect(shareFailureMessage(new Error('offline'))).toMatch(/Try again/);
  });

  it('says a trip is too big rather than advising the impossible', () => {
    const tooLarge = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'That request is too large.');

    // A trip over the body limit is over it on every attempt, so "try again"
    // is advice that cannot work — which is worse than none.
    expect(shareFailureMessage(tooLarge)).toMatch(/too large to share/);
    expect(shareFailureMessage(tooLarge)).not.toMatch(/Try again/);
  });

  it('treats any other API failure as worth retrying', () => {
    expect(shareFailureMessage(new ApiError(500, 'INTERNAL', 'boom'))).toMatch(/Try again/);
  });
});
