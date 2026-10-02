/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { guestDraftService } from './guestDraft.service';
import type { TripDraft } from '../types/trip.types';

const draft: TripDraft = {
  title: 'Five days in Lisbon',
  destination: 'Lisbon',
  destinationCity: 'Lisbon',
  destinationCountry: 'Portugal',
  startDate: '2027-05-01',
  endDate: '2027-05-05',
  travellers: 2,
  coverImage: '',
  itinerary: [],
};

afterEach(() => guestDraftService.clear());

describe('guestDraftService', () => {
  it('keeps a preview until it is claimed', () => {
    guestDraftService.save(draft);
    expect(guestDraftService.get()).toEqual(draft);
  });

  it('clears a claimed preview', () => {
    guestDraftService.save(draft);
    guestDraftService.clear();
    expect(guestDraftService.get()).toBeNull();
  });

  it('ignores malformed stored data', () => {
    localStorage.setItem('ai-travel-planner:guest-draft', '{broken');
    expect(guestDraftService.get()).toBeNull();
  });
});
