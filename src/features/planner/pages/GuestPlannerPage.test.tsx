/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { authService } from '../../../services/auth.service';
import { plannerService } from '../../../services/planner.service';
import { guestDraftService } from '../../../services/guestDraft.service';
import { authStore } from '../../../store/auth.store';
import { setAccessToken } from '../../../services/http';
import type { TripDraft } from '../../../types/trip.types';
import { GuestPlannerPage } from './GuestPlannerPage';

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

async function becomeAnonymous() {
  authStore.reset();
  vi.spyOn(authService, 'restore').mockResolvedValue(null);
  await authStore.bootstrap();
}

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/try', element: <GuestPlannerPage /> },
      { path: '/register', element: <h1>Create account</h1> },
    ],
    { initialEntries: ['/try'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  authStore.reset();
  setAccessToken(null);
  guestDraftService.clear();
  vi.restoreAllMocks();
});

describe('GuestPlannerPage', () => {
  it('generates a preview before account creation and saves it for signup', async () => {
    await becomeAnonymous();
    vi.spyOn(plannerService, 'generateItinerary').mockResolvedValue({ reply: 'Here is a plan.', trip: draft });
    const user = userEvent.setup();
    const router = renderPage();

    await user.type(
      screen.getByRole('textbox', { name: 'Describe your trip' }),
      'Five days in Lisbon with food and culture',
    );
    await user.click(screen.getByRole('button', { name: 'Create my itinerary' }));

    expect(await screen.findByRole('heading', { name: 'Here’s a starting point for your trip.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Five days in Lisbon' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/try');

    await user.click(screen.getByRole('button', { name: 'Save Trip' }));

    expect(await screen.findByRole('heading', { name: 'Create account' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/register');
    expect(guestDraftService.get()).toEqual(draft);
  });
});
