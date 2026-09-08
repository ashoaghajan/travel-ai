import { afterEach, describe, expect, it } from 'vitest';
import { anthropicProvider, plannerProvider } from './provider';

/**
 * Which model answers, and what happens when the answer is "none of them".
 *
 * The selection is deliberately forgiving. A typo in an environment variable
 * is a thing that happens on a deployment nobody can redeploy quickly, and
 * taking the server down at boot over one is a worse failure than quietly
 * using the provider that is configured — which is also the only one there is.
 */

const original = process.env.PLANNER_PROVIDER;

afterEach(() => {
  if (original === undefined) delete process.env.PLANNER_PROVIDER;
  else process.env.PLANNER_PROVIDER = original;
});

describe('plannerProvider', () => {
  it('is Anthropic when nothing is configured', () => {
    delete process.env.PLANNER_PROVIDER;

    expect(plannerProvider().id).toBe('anthropic');
  });

  it('takes the name from the environment', () => {
    process.env.PLANNER_PROVIDER = 'anthropic';

    expect(plannerProvider()).toBe(anthropicProvider);
  });

  it('ignores case and spacing, which a pasted value has plenty of', () => {
    process.env.PLANNER_PROVIDER = '  Anthropic ';

    expect(plannerProvider()).toBe(anthropicProvider);
  });

  it('falls back rather than throwing on a name it does not know', () => {
    process.env.PLANNER_PROVIDER = 'gpt-please';

    expect(plannerProvider().id).toBe('anthropic');
  });

  it('reads the environment per call, so a change lands without a restart', () => {
    process.env.PLANNER_PROVIDER = 'nonsense';
    expect(plannerProvider().id).toBe('anthropic');

    process.env.PLANNER_PROVIDER = 'anthropic';
    expect(plannerProvider()).toBe(anthropicProvider);
  });
});

describe('the interface a second provider has to satisfy', () => {
  it('is four functions and an id', () => {
    // Guards the shape rather than the implementation: this list is what a
    // new provider — an OpenAI-compatible endpoint, or a local model through
    // Ollama — has to fill in, and it should not grow without somebody
    // noticing that it did.
    expect(Object.keys(anthropicProvider).sort()).toEqual([
      'id',
      'isConfigured',
      'notConfigured',
      'streamChat',
      'toHttpError',
    ]);
  });

  it('reports whether this deployment has a key', () => {
    expect(typeof anthropicProvider.isConfigured()).toBe('boolean');
  });

  it('describes a missing key as a fact about the deployment, not a fault', () => {
    const error = anthropicProvider.notConfigured();

    // 503 rather than 500: the client reads this code and answers from its own
    // engine, which is a working planner rather than an apology.
    expect(error.status).toBe(503);
  });
});
