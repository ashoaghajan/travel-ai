/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { productAnalyticsService } from './productAnalytics.service';
import { STORAGE_KEYS, storageService } from './localStorage.service';

afterEach(() => {
  storageService.remove(STORAGE_KEYS.productAnalyticsConsent);
  storageService.remove(STORAGE_KEYS.productAnalytics);
});

describe('productAnalyticsService', () => {
  it('does not record events before explicit consent', () => {
    productAnalyticsService.recordTripCreated('private-trip-id');
    expect(productAnalyticsService.getSummary().trip_created).toBe(0);
    expect(storageService.get(STORAGE_KEYS.productAnalytics, null)).toBeNull();
  });

  it('records coarse milestones once without retaining raw identifiers', () => {
    productAnalyticsService.setConsent(true);
    productAnalyticsService.recordTripCreated('trip_private_123');
    productAnalyticsService.recordTripCreated('trip_private_123');
    productAnalyticsService.recordPlaceAdded('trip_private_123', 'place_private_456');
    productAnalyticsService.recordBookingSaved('booking_private_789');
    productAnalyticsService.recordReturnVisit(new Date(2027, 0, 1));
    productAnalyticsService.recordReturnVisit(new Date(2027, 0, 1, 20));

    const summary = productAnalyticsService.getSummary();
    expect(summary).toMatchObject({ trip_created: 1, place_added: 1, booking_saved: 1, returnDays: 1 });
    const stored = JSON.stringify(storageService.get(STORAGE_KEYS.productAnalytics, null));
    expect(stored).not.toContain('trip_private_123');
    expect(stored).not.toContain('place_private_456');
    expect(stored).not.toContain('booking_private_789');
  });

  it('clears locally stored metrics when consent is withdrawn', () => {
    productAnalyticsService.setConsent(true);
    productAnalyticsService.recordBookingSaved('booking_1');
    productAnalyticsService.setConsent(false);

    expect(productAnalyticsService.isConsented()).toBe(false);
    expect(productAnalyticsService.getSummary().booking_saved).toBe(0);
    expect(storageService.get(STORAGE_KEYS.productAnalytics, null)).toBeNull();
  });
});
