/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { plannerService } from '../../../services/planner.service';
import type { ItineraryDay } from '../../../types/trip.types';
import { TripScheduleAssistant } from './TripScheduleAssistant';

const days: ItineraryDay[] = [
  {
    id: 'day-1',
    dayNumber: 1,
    date: '2027-06-01',
    destination: 'Lisbon',
    summary: 'Arrival',
    activities: [{
      id: 'existing', time: '09:00', title: 'Existing activity', description: 'Keep this.', category: 'culture',
    }],
  },
];

describe('TripScheduleAssistant', () => {
  it('only adds generated suggestions to the chosen day when asked', async () => {
    const suggested = {
      id: 'suggested-day',
      dayNumber: 1,
      date: '2027-06-01',
      destination: 'Lisbon',
      summary: 'Food and nature',
      activities: [{
        id: 'generated-id',
        time: '12:00',
        title: 'Riverside food market',
        description: 'Try local snacks.',
        category: 'food' as const,
      }],
    };
    vi.spyOn(plannerService, 'generateItinerary').mockResolvedValue({
      reply: 'Here are some ideas.',
      trip: { title: 'Lisbon ideas', itinerary: [suggested] } as never,
    });
    const onAddIdeas = vi.fn();
    const user = userEvent.setup();

    render(
      <TripScheduleAssistant
        title="Lisbon trip"
        destination="Lisbon"
        startDate="2027-06-01"
        travellers={2}
        days={days}
        onAddIdeas={onAddIdeas}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'What would you like to add?' }), 'Local food and nature');
    await user.click(screen.getByRole('button', { name: 'Suggest activities' }));

    expect(await screen.findByText('Riverside food market')).toBeInTheDocument();
    expect(onAddIdeas).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Add 1 idea' }));
    expect(onAddIdeas).toHaveBeenCalledWith('day-1', [suggested.activities[0]]);
    expect(await screen.findByRole('button', { name: 'Added to trip' })).toBeDisabled();
  });
});
