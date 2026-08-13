/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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

/**
 * Dictating a prompt instead of typing it.
 *
 * The browser does the transcription, so the control exists only where the
 * browser does — and the composer must not depend on it in any way.
 */
describe('the microphone', () => {
  function installSpeechApi() {
    const started: string[] = [];

    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;

      start() {
        started.push('start');
        heard = (transcript: string, isFinal: boolean) =>
          this.onresult?.({
            resultIndex: 0,
            results: Object.assign([Object.assign([{ transcript }], { isFinal })], { length: 1 }),
          });
      }

      stop() {
        this.onend?.();
      }

      abort() {}
    }

    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;

    return started;
  }

  let heard: (transcript: string, isFinal: boolean) => void = () => undefined;

  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it('is absent where the browser cannot do it', () => {
    render(<PlannerInput onSend={vi.fn()} />);

    // A button that cannot work is worse than no button.
    expect(screen.queryByRole('button', { name: /Dictate/ })).not.toBeInTheDocument();
  });

  it('appends what was said to what was typed', async () => {
    installSpeechApi();
    const user = userEvent.setup();
    render(<PlannerInput onSend={vi.fn()} />);

    const field = screen.getByLabelText('Describe the trip you want');
    await user.type(field, 'Plan a trip');
    await user.click(screen.getByRole('button', { name: 'Dictate a message' }));

    act(() => heard('to Kyoto in April', true));

    // Somebody may have typed half a sentence before reaching for the
    // microphone; what they said continues it rather than replacing it.
    expect(field).toHaveValue('Plan a trip to Kyoto in April');
  });

  it('shows the words being revised without committing them', async () => {
    installSpeechApi();
    const user = userEvent.setup();
    render(<PlannerInput onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Dictate a message' }));
    act(() => heard('plan a trip to Kyo', false));

    const field = screen.getByLabelText('Describe the trip you want');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', 'plan a trip to Kyo');
  });

  it('stops when the prompt is sent', async () => {
    installSpeechApi();
    const user = userEvent.setup();
    render(<PlannerInput onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Dictate a message' }));
    await user.type(screen.getByLabelText('Describe the trip you want'), 'Plan Kyoto{Enter}');

    // Sending is the end of what was being dictated, whichever way it is sent.
    expect(screen.getByRole('button', { name: 'Dictate a message' })).toBeInTheDocument();
  });

  it('says when it is listening, for anybody not looking at the colour', async () => {
    installSpeechApi();
    const user = userEvent.setup();
    render(<PlannerInput onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Dictate a message' }));

    const button = screen.getByRole('button', { name: 'Stop dictating' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});
