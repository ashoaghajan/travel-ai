/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TripNote } from '../../../types/trip.types';
import { TripNotes } from './TripNotes';

const NOTE: TripNote = {
  id: 'note-1',
  text: 'Pack adapters',
  createdAt: '2027-05-01T09:00:00.000Z',
  updatedAt: '2027-05-01T09:00:00.000Z',
};

/** The `editing` bundle, with every handler a spy the test can read back. */
function editing(overrides: { errors?: Record<string, string>; disabled?: boolean } = {}) {
  return {
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

describe('TripNotes', () => {
  it('points at Edit Trip when there is nothing to show', () => {
    render(<TripNotes notes={[]} />);

    expect(screen.getByText('No notes yet')).toBeInTheDocument();
    expect(screen.getByText(/Choose Edit Trip to add one/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
  });

  it('reads as text outside edit mode, with no way to change it', () => {
    render(<TripNotes notes={[NOTE]} />);

    expect(screen.getByText('Pack adapters')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('offers Add note in edit mode, even with no notes yet', async () => {
    const edit = editing();
    render(<TripNotes notes={[]} editing={edit} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));

    expect(edit.onAdd).toHaveBeenCalledTimes(1);
  });

  it('turns each note into a textarea in edit mode', async () => {
    const edit = editing();
    render(<TripNotes notes={[NOTE]} editing={edit} />);

    await userEvent.type(screen.getByRole('textbox', { name: 'Note' }), '!');

    expect(edit.onEdit).toHaveBeenLastCalledWith('note-1', 'Pack adapters!');
  });

  it('removes a note', async () => {
    const edit = editing();
    render(<TripNotes notes={[NOTE]} editing={edit} />);

    await userEvent.click(screen.getByRole('button', { name: /Remove note/ }));

    expect(edit.onDelete).toHaveBeenCalledWith('note-1');
  });

  it('says Added until the note has been edited, then Edited', () => {
    const { rerender } = render(<TripNotes notes={[NOTE]} />);
    expect(screen.getByText(/^Added /)).toBeInTheDocument();

    rerender(<TripNotes notes={[{ ...NOTE, updatedAt: '2027-05-04T09:00:00.000Z' }]} />);
    expect(screen.getByText(/^Edited /)).toBeInTheDocument();
  });

  it('shows the message for one note against that note', () => {
    render(<TripNotes notes={[NOTE]} editing={editing({ errors: { 'note-1': 'Write it.' } })} />);

    expect(screen.getByText('Write it.')).toBeInTheDocument();
  });

  it('locks the controls while a save is in flight', () => {
    render(<TripNotes notes={[NOTE]} editing={editing({ disabled: true })} />);

    expect(screen.getByRole('textbox', { name: 'Note' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled();
  });
});
