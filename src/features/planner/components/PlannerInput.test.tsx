/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlannerInput } from './PlannerInput';

/**
 * The composer while an answer is arriving.
 *
 * It used to be disabled until the generation finished, which made the most
 * ordinary thing somebody wants to do — change their mind half way through a
 * long answer — impossible without waiting it out.
 */

describe('while nothing is generating', () => {
  it('sends what was typed', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<PlannerInput onSend={onSend} />);

    await user.type(screen.getByLabelText('Describe the trip you want'), 'Plan Kyoto{Enter}');

    expect(onSend).toHaveBeenCalledWith('Plan Kyoto');
  });

  it('will not send nothing', async () => {
    render(<PlannerInput onSend={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });
});

describe('while an answer is arriving', () => {
  it('still lets somebody type', async () => {
    const user = userEvent.setup();
    render(<PlannerInput isGenerating onSend={vi.fn()} onStop={vi.fn()} />);

    const field = screen.getByLabelText('Describe the trip you want');
    expect(field).not.toBeDisabled();

    await user.type(field, 'Actually, Osaka');
    expect(field).toHaveValue('Actually, Osaka');
  });

  it('offers to stop while there is nothing to send', async () => {
    const onStop = vi.fn();
    const user = userEvent.setup();
    render(<PlannerInput isGenerating onSend={vi.fn()} onStop={onStop} />);

    await user.click(screen.getByRole('button', { name: 'Stop generating' }));

    expect(onStop).toHaveBeenCalled();
  });

  it('becomes a send button the moment there is something to send', async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const user = userEvent.setup();
    render(<PlannerInput isGenerating onSend={onSend} onStop={onStop} />);

    await user.type(screen.getByLabelText('Describe the trip you want'), 'Actually, Osaka');

    // A prompt in the field says what the reader wants more clearly than a
    // stop would, and sending supersedes the turn in flight anyway.
    expect(screen.queryByRole('button', { name: 'Stop generating' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSend).toHaveBeenCalledWith('Actually, Osaka');
    expect(onStop).not.toHaveBeenCalled();
  });

  it('sends on Enter without waiting for the answer', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<PlannerInput isGenerating onSend={onSend} onStop={vi.fn()} />);

    await user.type(screen.getByLabelText('Describe the trip you want'), 'Osaka{Enter}');

    expect(onSend).toHaveBeenCalledWith('Osaka');
  });

  it('clears the field after superseding', async () => {
    const user = userEvent.setup();
    render(<PlannerInput isGenerating onSend={vi.fn()} onStop={vi.fn()} />);

    const field = screen.getByLabelText('Describe the trip you want');
    await user.type(field, 'Osaka{Enter}');

    expect(field).toHaveValue('');
  });
});
