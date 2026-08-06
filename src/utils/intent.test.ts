import { describe, expect, it } from 'vitest';
import { classifyPrompt, extractPlace } from './intent';

describe('classifyPrompt — trips', () => {
  it('reads an explicit planning request as a trip', () => {
    expect(classifyPrompt('Plan a 7-day trip to Bali for a couple in June.')).toEqual({
      kind: 'trip',
    });
  });

  it('reads a bare place name as a trip, which is what it always was', () => {
    expect(classifyPrompt('Bali')).toEqual({ kind: 'trip' });
  });

  it('reads a day count as planning even with no verb', () => {
    expect(classifyPrompt('5 days in Lisbon')).toEqual({ kind: 'trip' });
  });

  it('lets planning language win over a question mark', () => {
    // A trip request wearing a question mark — answering "I cannot help" here
    // would be worse than the itinerary the reader wanted.
    expect(classifyPrompt('what should I do in Rome?')).toEqual({ kind: 'trip' });
    expect(classifyPrompt('things to do in Porto?')).toEqual({ kind: 'trip' });
  });

  it('treats an empty prompt as a trip, as the generator always did', () => {
    expect(classifyPrompt('   ')).toEqual({ kind: 'trip' });
  });
});

describe('classifyPrompt — weather', () => {
  it('recognises the question that used to build a trip', () => {
    expect(classifyPrompt('what is the weather in Abu Dhabi?')).toEqual({
      kind: 'weather',
      place: 'Abu Dhabi',
    });
  });

  it('recognises it without a question mark', () => {
    expect(classifyPrompt('how hot is it in Cairo')).toEqual({ kind: 'weather', place: 'Cairo' });
  });

  it('recognises rain and temperature phrasings', () => {
    expect(classifyPrompt('is it raining in London?')).toMatchObject({ kind: 'weather' });
    expect(classifyPrompt('what is the temperature in Oslo?')).toMatchObject({ kind: 'weather' });
    expect(classifyPrompt("what's the forecast for Tokyo?")).toMatchObject({ kind: 'weather' });
  });

  it('answers with no place when none was named', () => {
    expect(classifyPrompt('what is the weather?')).toEqual({ kind: 'weather', place: null });
  });
});

describe('classifyPrompt — location', () => {
  it('recognises where a place is', () => {
    expect(classifyPrompt('where is Yerevan?')).toEqual({ kind: 'location', place: 'Yerevan' });
  });

  it('recognises which country a place is in', () => {
    expect(classifyPrompt('what country is Bali in?')).toMatchObject({ kind: 'location' });
  });
});

describe('classifyPrompt — beyond it', () => {
  it('declines a question it has no provider for', () => {
    expect(classifyPrompt('is the tap water safe in Hanoi?')).toEqual({ kind: 'unknown' });
    expect(classifyPrompt('do I need a visa for Japan?')).toEqual({ kind: 'unknown' });
  });
});

describe('extractPlace', () => {
  it('takes what follows "in"', () => {
    expect(extractPlace('what is the weather in Abu Dhabi?')).toBe('Abu Dhabi');
  });

  it('strips the trailing question mark', () => {
    expect(extractPlace('where is Porto?')).toBe('Porto');
  });

  it('drops trailing words about time rather than place', () => {
    expect(extractPlace('weather in Lisbon right now')).toBe('Lisbon');
    expect(extractPlace('weather in Lisbon today')).toBe('Lisbon');
    expect(extractPlace('what is the weather in Lisbon like')).toBe('Lisbon');
  });

  it('takes the last preposition, so "in" inside a sentence does not win', () => {
    expect(extractPlace('is it warm in the evening in Split?')).toBe('Split');
  });

  it('is null when nothing follows', () => {
    expect(extractPlace('what is the weather?')).toBeNull();
  });

  it('is null when the preposition ends the sentence', () => {
    expect(extractPlace('where is it in')).toBeNull();
  });
});
