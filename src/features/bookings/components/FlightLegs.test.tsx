/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BookingContext } from '../../../types/travel.types';
import { FlightLegs } from './FlightLegs';

/**
 * The stepper that replaced the second From/To pair.
 *
 * Two things it has to keep doing: show each leg's route without asking for
 * it, and stay navigable in both directions.
 */

const AUH_EVN: BookingContext = {
  tripType: 'round-trip',
  originCode: 'AUH',
  destinationCode: 'EVN',
  destinationCity: 'Yerevan',
  destinationCountry: 'Armenia',
  departDate: '2026-09-14',
  returnDate: '2026-09-19',
  travellers: 2,
};

describe('FlightLegs', () => {
  it('shows both legs of the journey the search describes', () => {
    render(<FlightLegs context={AUH_EVN} value="outbound" onChange={() => {}} />);

    expect(screen.getByText('AUH → EVN · Sep 14')).toBeInTheDocument();
    // Reversed without anybody saying so — the point of the change.
    expect(screen.getByText('EVN → AUH · Sep 19')).toBeInTheDocument();
  });

  it('offers no airport fields at all', () => {
    render(<FlightLegs context={AUH_EVN} value="outbound" onChange={() => {}} />);

    expect(screen.queryByLabelText(/^from/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^to/i)).not.toBeInTheDocument();
  });

  it('marks the step on screen as the current one', () => {
    render(<FlightLegs context={AUH_EVN} value="return" onChange={() => {}} />);

    expect(screen.getByRole('button', { name: /return/i })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByRole('button', { name: /outbound/i })).not.toHaveAttribute('aria-current');
  });

  it('moves to a step when it is clicked', async () => {
    const onChange = vi.fn();
    render(<FlightLegs context={AUH_EVN} value="outbound" onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /return/i }));

    expect(onChange).toHaveBeenCalledWith('return');
  });

  it('goes back to the outbound after it has been taken', async () => {
    const onChange = vi.fn();
    render(
      <FlightLegs context={AUH_EVN} value="return" onChange={onChange} chosen={['outbound']} />,
    );

    // A reader who books the outbound on a partner site and wants to change it
    // must not be stranded on step two.
    await userEvent.click(screen.getByRole('button', { name: /outbound/i }));

    expect(onChange).toHaveBeenCalledWith('outbound');
  });

  it('says a chosen leg is chosen in words, not only with a tick', () => {
    render(
      <FlightLegs context={AUH_EVN} value="return" onChange={() => {}} chosen={['outbound']} />,
    );

    expect(
      screen.getByRole('button', { name: 'Outbound: AUH → EVN · Sep 14 — chosen' }),
    ).toBeInTheDocument();
    // The one still to take says nothing of the sort.
    expect(screen.getByRole('button', { name: 'Return: EVN → AUH · Sep 19' })).toBeInTheDocument();
  });

  it('drops the steps entirely for a one-way search', () => {
    render(
      <FlightLegs
        context={{ ...AUH_EVN, tripType: 'one-way', returnDate: null }}
        value="outbound"
        onChange={() => {}}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // Still says what is being priced — there is just nothing to choose.
    expect(screen.getByText('AUH → EVN · Sep 14')).toBeInTheDocument();
  });

  it('renders nothing when the search describes no route yet', () => {
    const { container } = render(
      <FlightLegs
        context={{
          ...AUH_EVN,
          tripType: 'one-way',
          originCode: null,
          destinationCode: null,
          departDate: null,
          returnDate: null,
        }}
        value="outbound"
        onChange={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
