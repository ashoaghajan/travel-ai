/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cityService } from '../../../services/city.service';
import { CityField } from './CityField';

const CITIES = ['Acton', 'Adelaide', 'Albury', 'Brisbane', 'Cairns', 'Darwin'];

function Harness({ initial = '' }: { initial?: string }) {
  const [city, setCity] = useState(initial);

  return (
    <CityField
      id="city"
      value={city}
      onChange={setCity}
      suggest={(query) => cityService.filter(CITIES, query, 50)}
      placeholder="Search cities"
    />
  );
}

function optionNames(): string[] {
  return screen.getAllByRole('option').map((option) => option.textContent ?? '');
}

describe('CityField', () => {
  it('opens on the full list, not filtered by what is already chosen', async () => {
    render(<Harness initial="Acton" />);

    await userEvent.click(screen.getByRole('combobox'));

    // The bug this replaced: a datalist filtered itself down to "Acton" alone,
    // leaving no way to reach the other cities.
    expect(optionNames()).toEqual(CITIES);
    expect(screen.getByRole('combobox')).toHaveValue('Acton');
  });

  it('filters once the reader types', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.keyboard('ad');

    expect(optionNames()).toEqual(['Adelaide']);
  });

  it('changes the value when another city is picked', async () => {
    render(<Harness initial="Acton" />);

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'Darwin' }));

    expect(screen.getByRole('combobox')).toHaveValue('Darwin');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('reopens on the full list after a pick', async () => {
    render(<Harness initial="Acton" />);

    const input = screen.getByRole('combobox');
    await userEvent.click(input);
    await userEvent.click(screen.getByRole('option', { name: 'Darwin' }));
    await userEvent.click(input);

    expect(optionNames()).toEqual(CITIES);
  });

  it('marks the chosen city as selected', async () => {
    render(<Harness initial="Albury" />);

    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: 'Albury' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Acton' })).toHaveAttribute('aria-selected', 'false');
  });

  it('still accepts a city that is not in the list', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.keyboard('Narnia');

    expect(screen.getByRole('combobox')).toHaveValue('Narnia');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('picks with the keyboard and closes on Escape', async () => {
    render(<Harness />);

    const input = screen.getByRole('combobox');
    await userEvent.click(input);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(input).toHaveValue('Adelaide');

    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
