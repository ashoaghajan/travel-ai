/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MessageItem } from './MessageItem';

/**
 * What a send says about itself while it is in flight.
 *
 * The API sleeps after fifteen idle minutes and takes about a minute to wake,
 * and this panel is the one screen where that is invisible: the other person's
 * messages keep arriving over the socket while your own hangs. The copy exists
 * to turn "broken for me specifically" into "the server is waking up".
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function pendingMessage() {
  return render(<MessageItem body="hello" isOwn pending />);
}

describe('a message on its way', () => {
  it('says nothing at first', () => {
    pendingMessage();

    // Most sends finish inside a second. A label that appears and vanishes is
    // worse than no label.
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    expect(screen.queryByText(/still sending/i)).not.toBeInTheDocument();
  });

  it('admits to sending after a few seconds', () => {
    pendingMessage();

    act(() => vi.advanceTimersByTime(4000));

    expect(screen.getByText('Sending…')).toBeInTheDocument();
  });

  it('explains itself once it is really slow', () => {
    pendingMessage();

    act(() => vi.advanceTimersByTime(15_000));

    expect(screen.getByText('Still sending — the server may be waking up.')).toBeInTheDocument();
  });

  it('stops explaining once it has landed', () => {
    const { rerender } = pendingMessage();
    act(() => vi.advanceTimersByTime(15_000));

    rerender(<MessageItem body="hello" isOwn createdAt="2026-08-11T10:00:00.000Z" />);

    expect(screen.queryByText(/still sending/i)).not.toBeInTheDocument();
  });

  it('says nothing about waking up when the send has failed', () => {
    render(<MessageItem body="hello" isOwn failed />);

    act(() => vi.advanceTimersByTime(15_000));

    // "Not sent" with a way out is the whole message; a note about the server
    // waking up alongside it would be describing a different situation.
    expect(screen.getByText('Not sent.')).toBeInTheDocument();
    expect(screen.queryByText(/still sending/i)).not.toBeInTheDocument();
  });
});
