/**
 * @vitest-environment jsdom
 *
 * A single component test that proves the Testing Library harness works —
 * jsdom, rendering, jest-dom matchers and user events. Broader UI coverage is
 * deliberately out of scope for this pass.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Button } from './Button';

describe('Button', () => {
  it('renders a native button by default', () => {
    render(<Button>Save Trip</Button>);

    const button = screen.getByRole('button', { name: 'Save Trip' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
  });

  it('calls onClick when pressed', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save Trip</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Save Trip' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire while disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Save Trip
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save Trip' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link when given a destination', () => {
    render(
      <MemoryRouter>
        <Button to="/trips">View Full Itinerary</Button>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'View Full Itinerary' })).toHaveAttribute(
      'href',
      '/trips',
    );
  });

  it('keeps icons out of the accessible name', () => {
    render(
      <Button trailingIcon={<svg data-testid="icon" aria-hidden="true" />}>Get Started</Button>,
    );

    expect(screen.getByRole('button', { name: 'Get Started' })).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});
