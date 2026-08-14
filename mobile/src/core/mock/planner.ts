import type { PlannerMessage } from '../types/planner.types';
import { buildTripDraft } from '../services/mockAi.service';
import { DEMO_DESTINATION } from './destinations';

/** README "Stage 1 Mock Trip": Bali, 7 itinerary days, 2 travellers, from May 20. */
const DEMO_TRIP_DAYS = 7;
const DEMO_TRIP_TRAVELLERS = 2;

function nextMay20(today = new Date()): Date {
  const isPast = today.getMonth() > 4 || (today.getMonth() === 4 && today.getDate() > 20);
  return new Date(today.getFullYear() + (isPast ? 1 : 0), 4, 20);
}

export const DEMO_TRIP_DRAFT = buildTripDraft({
  template: DEMO_DESTINATION,
  destinationName: DEMO_DESTINATION.name,
  days: DEMO_TRIP_DAYS,
  travellers: DEMO_TRIP_TRAVELLERS,
  startDate: nextMay20(),
  // Fixed so saving the seeded trip stays idempotent across reloads.
  draftId: 'draft_demo-bali-adventure',
});

/**
 * The conversation the planner opens with, from DESIGN_SPEC Screen 2. It is
 * built by the same generator a live prompt uses, so the seeded trip behaves
 * exactly like a generated one — including saving.
 */
export const SEED_CONVERSATION: PlannerMessage[] = [
  {
    id: 'seed-user',
    author: 'user',
    content:
      'Plan a 7-day trip to Bali for a couple in June. We love beaches, nature and good food.',
  },
  {
    id: 'seed-ai',
    author: 'ai',
    content: "Sure! Here's a 7-day Bali itinerary crafted for you:",
    trip: DEMO_TRIP_DRAFT,
  },
];
