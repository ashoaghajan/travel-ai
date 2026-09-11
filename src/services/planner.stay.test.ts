import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingStay, StayResume } from '../types/planner.types';
import * as stays from './stay.service';
import { advanceStay, beginStay, pickStay, readStayAnswer, rejectStayCandidates } from './planner.stay';

/**
 * The conversation that finds out where somebody is staying.
 *
 * Two properties matter more than any single answer here, and most of these
 * exist to hold them.
 *
 * **It always terminates.** A name that finds nothing asks for an address; an
 * address that finds nothing gives up and plans from the centre. Nothing here
 * may ask twice for the same thing, because a flow that can is one somebody
 * gets stuck in with a trip they cannot reach.
 *
 * **It always has a way out.** Most trips are planned before anything is
 * booked, so "not sure" has to end the questions at every step rather than at
 * the first one.
 */

const RESUME: StayResume = { kind: 'prompt', prompt: 'plan 3 days in Tbilisi' };

const MATCH = {
  id: 'osm-1',
  name: 'Rooms Hotel',
  address: '14 Merab Kostava Street, Tbilisi',
  coordinates: { lat: 41.733, lng: 44.79 },
};

const OTHER = {
  id: 'osm-2',
  name: 'Rooms Hotel Kazbegi',
  address: 'Gergeti, Stepantsminda',
  coordinates: { lat: 42.66, lng: 44.64 },
};

function pending(overrides: Partial<PendingStay> = {}): PendingStay {
  return { step: 'name', destination: 'Tbilisi', resume: RESUME, ...overrides };
}

function found(...candidates: (typeof MATCH)[]) {
  return vi.spyOn(stays, 'findStays').mockResolvedValue(candidates);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readStayAnswer', () => {
  it('takes a bare name at face value', () => {
    expect(readStayAnswer('Rooms Hotel')).toBe('Rooms Hotel');
  });

  it('strips the lead people put in front of an answer', () => {
    expect(readStayAnswer("we're staying at the Hotel Astoria")).toBe('Hotel Astoria');
    expect(readStayAnswer('at Rooms Hotel.')).toBe('Rooms Hotel');
  });

  /*
   * Applied once. "the" begins plenty of real hotel names, and a loop that
   * kept stripping would turn "The Hotel Astoria" into "Astoria" — a
   * different, and often real, hotel.
   */
  it('strips one lead, not every word that looks like one', () => {
    expect(readStayAnswer('staying at the The Grand')).toBe('The Grand');
  });

  it('reads a refusal as no hotel at all', () => {
    for (const answer of ['not sure', 'No idea', "haven't booked", 'nothing booked', 'idk']) {
      expect(readStayAnswer(answer)).toBeNull();
    }
  });

  it('reads a lead with nothing after it as a refusal rather than an empty name', () => {
    expect(readStayAnswer('staying at ')).toBeNull();
  });
});

describe('beginStay', () => {
  it('names the city and the radius, so the question can answer itself', () => {
    const step = beginStay(RESUME, 'Tbilisi', 3);

    expect(step.kind).toBe('ask');
    if (step.kind !== 'ask') return;

    expect(step.reply).toContain('Tbilisi');
    expect(step.reply).toContain('3 km');
    // The way out, offered in the same breath as the question.
    expect(step.reply).toContain('not sure');
    expect(step.pending.step).toBe('name');
  });

  it('still asks when the prompt named no city it could recognise', () => {
    const step = beginStay(RESUME, null, 5);

    expect(step.kind).toBe('ask');
    if (step.kind !== 'ask') return;

    expect(step.reply).toContain('the middle of the city');
  });
});

describe('advanceStay', () => {
  it('offers the matches for a name, one of them included', async () => {
    found(MATCH);

    const step = await advanceStay(pending(), 'Rooms Hotel');

    expect(step.kind).toBe('ask');
    if (step.kind !== 'ask') return;

    expect(step.pending.step).toBe('choose');
    expect(step.pending.candidates).toEqual([MATCH]);
    // One match is confirmed rather than assumed: a radius round the wrong
    // building is a whole city excluded with nothing on screen to say why.
    expect(step.reply).toContain('Is this it?');
  });

  it('asks which one when several share the name', async () => {
    found(MATCH, OTHER);

    const step = await advanceStay(pending(), 'Rooms Hotel');

    expect(step.kind).toBe('ask');
    if (step.kind !== 'ask') return;

    expect(step.reply).toContain('2 places');
    expect(step.pending.candidates).toHaveLength(2);
  });

  it('bounds the lookup to the destination', async () => {
    const search = found(MATCH);

    await advanceStay(pending(), 'Rooms Hotel');

    expect(search).toHaveBeenCalledWith('Rooms Hotel', 'Tbilisi');
  });

  it('asks for the address when the name finds nothing', async () => {
    found();

    const step = await advanceStay(pending(), 'The Nameless Inn');

    expect(step.kind).toBe('ask');
    if (step.kind !== 'ask') return;

    expect(step.pending.step).toBe('address');
    expect(step.pending.name).toBe('The Nameless Inn');
    expect(step.reply).toContain('address');
  });

  it('places a hotel by its address when the name could not be found', async () => {
    found(MATCH);

    const step = await advanceStay(pending({ step: 'address' }), '14 Merab Kostava Street');

    expect(step.kind).toBe('ask');
    if (step.kind !== 'ask') return;

    expect(step.pending.step).toBe('choose');
    expect(step.pending.candidates).toEqual([MATCH]);
  });

  /*
   * The end of the road, and the reason this flow cannot loop. Asking a third
   * time would be pestering somebody who has already answered twice.
   */
  it('gives up on the centre when the address finds nothing either', async () => {
    found();

    const step = await advanceStay(pending({ step: 'address' }), 'somewhere near the park');

    expect(step.kind).toBe('ready');
    if (step.kind !== 'ready') return;

    expect(step.stay).toBeNull();
    expect(step.reply).toContain('the middle of Tbilisi');
    expect(step.resume).toEqual(RESUME);
  });

  it('takes a refusal at any step as an answer, and asks nothing more', async () => {
    const search = found(MATCH);

    for (const step of ['name', 'choose', 'address'] as const) {
      const result = await advanceStay(pending({ step }), 'not sure');

      expect(result.kind).toBe('ready');
      if (result.kind !== 'ready') return;

      expect(result.stay).toBeNull();
    }

    // Nothing was looked up: a refusal is an answer, not a query.
    expect(search).not.toHaveBeenCalled();
  });
});

describe('pickStay', () => {
  it('finishes with the building they pointed at', () => {
    const step = pickStay(pending({ step: 'choose', candidates: [MATCH, OTHER] }), 'osm-2');

    expect(step?.kind).toBe('ready');
    if (step?.kind !== 'ready') return;

    expect(step.stay).toEqual({ name: OTHER.name, coordinates: OTHER.coordinates });
  });

  /*
   * A stale render, or a transcript written by an older version of this. The
   * caller treats null as a tap that did not land, which is what it is.
   */
  it('answers null for an id the message does not carry', () => {
    expect(pickStay(pending({ step: 'choose', candidates: [MATCH] }), 'osm-9')).toBeNull();
  });
});

describe('rejectStayCandidates', () => {
  it('asks for the address rather than for the name again', () => {
    const step = rejectStayCandidates(pending({ step: 'choose', candidates: [MATCH] }));

    expect(step.kind).toBe('ask');
    if (step.kind !== 'ask') return;

    expect(step.pending.step).toBe('address');
    // The list is gone with the question it belonged to; offering the same
    // wrong options twice is the one thing "none of these" must not do.
    expect(step.pending.candidates).toBeUndefined();
  });
});
