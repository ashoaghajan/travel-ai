/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Airport } from '../../../types/travel.types';
import { airportService } from '../../../services/airport.service';
import { AirportField } from './AirportField';

/**
 * The airport picker.
 *
 * A combobox rather than a `<select>`, so the behaviours worth pinning are the
 * ones a native select gave for free: keyboard navigation, choosing a value,
 * and showing the chosen one afterwards.
 */

const MILAN: Airport[] = [
  { code: 'MXP', city: 'Milan', name: 'Milano Malpensa Airport', countryCode: 'IT' },
  { code: 'LIN', city: 'Milan', name: 'Milano Linate Airport', countryCode: 'IT' },
];

beforeEach(() => {
  vi.spyOn(airportService, 'search').mockResolvedValue(MILAN);
});

afterEach(() => {
  localStorage.clear();
});

function setup(value = 'JFK') {
  const onChange = vi.fn();
  render(<AirportField label="From" value={value} onChange={onChange} />);

  return { onChange, user: userEvent.setup() };
}

const field = () => screen.getByRole('combobox', { name: 'From' });

describe('AirportField', () => {
  it('shows the chosen airport when closed', () => {
    setup('JFK');

    expect(field()).toHaveValue('JFK - New York');
  });

  it('offers matches for what is typed', async () => {
    const { user } = setup();

    await user.click(field());
    await user.type(field(), 'milan');

    expect(await screen.findByRole('option', { name: /Malpensa/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Linate/ })).toBeInTheDocument();
  });

  it('reports the code when an option is chosen', async () => {
    const { user, onChange } = setup();

    await user.click(field());
    await user.type(field(), 'milan');
    await user.click(await screen.findByRole('option', { name: /Malpensa/ }));

    expect(onChange).toHaveBeenCalledWith('MXP');
  });

  it('moves through the list with the arrow keys and picks with Enter', async () => {
    const { user, onChange } = setup();

    await user.click(field());
    await user.type(field(), 'milan');
    await screen.findByRole('option', { name: /Malpensa/ });

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith('LIN');
  });

  it('closes on Escape without choosing anything', async () => {
    const { user, onChange } = setup();

    await user.click(field());
    await user.type(field(), 'milan');
    await screen.findByRole('option', { name: /Malpensa/ });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says so when nothing matches', async () => {
    vi.spyOn(airportService, 'search').mockResolvedValue([]);
    const { user } = setup();

    await user.click(field());
    await user.type(field(), 'zzzzz');

    expect(await screen.findByText(/No airports match/)).toBeInTheDocument();
  });

  /*
   * The reason `remember` exists. `partner.links.ts` is pure and synchronous
   * and needs this airport's *city* to build a hotel search later, so choosing
   * one has to record it.
   */
  it('remembers the chosen airport so its city can be named later', async () => {
    const { user } = setup();

    await user.click(field());
    await user.type(field(), 'milan');
    await user.click(await screen.findByRole('option', { name: /Malpensa/ }));

    expect(airportService.resolve('MXP')?.city).toBe('Milan');
  });

  it('follows the value when the caller changes it, as the swap button does', () => {
    const { rerender } = render(<AirportField label="From" value="JFK" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('JFK - New York');

    rerender(<AirportField label="From" value="LHR" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('LHR - London');
  });

  it('marks itself up as a combobox', async () => {
    const { user } = setup();

    expect(field()).toHaveAttribute('aria-expanded', 'false');

    await user.click(field());
    await user.type(field(), 'milan');
    await screen.findByRole('option', { name: /Malpensa/ });

    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(field()).toHaveAttribute('aria-activedescendant');
  });
});
