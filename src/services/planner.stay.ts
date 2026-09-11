import type { PendingStay, ResolvedStay, StayCandidate, StayResume } from '../types/planner.types';
import { findStays } from './stay.service';

/**
 * Finding out where somebody is staying, one question at a time.
 *
 * A radius is measured from a point, and "within 2 km of your hotel" names a
 * point nothing in this app knows until it is asked for. The planner used to
 * guess — a hotel booked and not yet attached to a trip, or failing that the
 * middle of the city — and a guess is a poor foundation for a rule whose whole
 * job is to *remove* places from a trip.
 *
 * So there is a short conversation, and it is the same one for both tiers:
 *
 * 1. **Name it.** "Which hotel are you staying at?"
 * 2. **Confirm it.** The name is looked up and the matches are offered back,
 *    even when there is only one of them. This is the step that matters: a
 *    hotel name is not unique inside one city, let alone across them, and the
 *    cost of picking the wrong building is a whole city excluded from the trip
 *    with nothing on screen to say why.
 * 3. **Or place it by address.** A hotel too small or too new to be on the map
 *    finds nothing at step 2, and the address is the question that always has
 *    an answer. The point it resolves to is what the radius is drawn around.
 *
 * Every step has a way out. Most trips are planned before anything is booked,
 * so "not sure" is a first-class answer at any point and means the radius is
 * measured from the middle of the city — which is what the settings screen
 * already promises, and which is exactly the behaviour this flow replaced.
 *
 * **The transcript is the state.** What the planner is waiting for rides on
 * the message that asked (`PlannerMessage.pendingStay`), so a reload, a second
 * tab or a conversation picked up on a phone all resume correctly, and a
 * reader who wanders off mid-question leaves nothing behind to clean up.
 */

/** Either another question, or enough to plan with. */
export type StayStep =
  | { kind: 'ask'; reply: string; pending: PendingStay }
  | {
      kind: 'ready';
      /** Said before the trip appears. Null when there is nothing worth saying. */
      reply: string | null;
      /** Null for "there is no hotel" — plan around the centre, as promised. */
      stay: ResolvedStay | null;
      resume: StayResume;
    };

/** What somebody types to say there is no hotel to plan around. */
const NO_STAY = [
  'no',
  'none',
  'nope',
  'nothing',
  'not sure',
  'unsure',
  'no idea',
  'dont know',
  "don't know",
  'do not know',
  'idk',
  'dunno',
  'not booked',
  'nothing booked',
  'not yet',
  'no hotel',
  'havent booked',
  "haven't booked",
  'have not booked',
  'skip',
  'anywhere',
  'centre',
  'center',
  'city centre',
  'city center',
];

/**
 * Leads people put in front of the answer, stripped so the lookup sees a name.
 *
 * Longest first, and applied once. "we're staying at the Hotel Astoria" should
 * become "Hotel Astoria", not "Astoria" — "the" begins plenty of hotel names,
 * and stripping repeatedly would start eating the answer.
 */
const ANSWER_LEADS = [
  "i'm staying at the",
  'im staying at the',
  "we're staying at the",
  'were staying at the',
  'we are staying at the',
  'i am staying at the',
  "i'm staying at",
  'im staying at',
  "we're staying at",
  'were staying at',
  'we are staying at',
  'i am staying at',
  'staying at the',
  'staying at',
  'staying in',
  'the address is',
  'the hotel is',
  'hotel is',
  "it's the",
  'its the',
  "it's",
  'its',
  'at the',
  'at',
  'in the',
];

/** Long enough for the longest real hotel name and the longest real address. */
const MAX_ANSWER_LENGTH = 160;

/**
 * The hotel or address in an answer, or null for "there isn't one".
 *
 * Null is not a failure: it is the documented way out of every question here,
 * and it produces exactly the trip the planner built before this file existed.
 *
 * Anything that is not a refusal is taken at face value and handed to the
 * lookup, which is the only thing that can actually judge whether it names a
 * building. Guessing here would mean turning down real names for looking
 * unlikely, and hotels are named stranger things than this could anticipate.
 */
export function readStayAnswer(text: string): string | null {
  const cleaned = text.trim().replace(/[.!,;]+$/, '');
  const lower = cleaned.toLowerCase();

  if (cleaned === '' || NO_STAY.includes(lower)) return null;

  for (const lead of ANSWER_LEADS) {
    // The lead on its own — "staying at", and nothing after it. Not a name,
    // and looking one up would send the whole phrase to the geocoder.
    if (lower === lead) return null;

    if (lower.startsWith(`${lead} `)) {
      const rest = cleaned.slice(lead.length).trim();
      return rest === '' ? null : rest.slice(0, MAX_ANSWER_LENGTH);
    }
  }

  return cleaned.slice(0, MAX_ANSWER_LENGTH);
}

function middleOf(destination: string | null): string {
  return destination ? `the middle of ${destination}` : 'the middle of the city';
}

/** The sentence that ends the flow when nobody could name a hotel. */
function planningFromCentre(destination: string | null): string {
  return `I will plan around ${middleOf(destination)} instead, and you can set a hotel later from Settings → Planning.`;
}

/**
 * The first question.
 *
 * The radius is quoted back because it is the reason for the question and it
 * lives on a settings screen the reader is not currently looking at — "why is
 * it asking me this?" has to be answerable from the sentence itself. The way
 * out is offered in the same breath, because most trips are planned before
 * anything is booked and a question with no honest "I don't know" is a wall.
 */
export function beginStay(
  resume: StayResume,
  destination: string | null,
  limitKm: number,
): StayStep {
  const where = destination ? ` in ${destination}` : '';

  return {
    kind: 'ask',
    reply:
      `Which hotel are you staying at${where}? ` +
      `You have asked for activities within ${limitKm} km of it, so I need to know where it is before I choose any. ` +
      `If nothing is booked yet, say “not sure” and I will plan around ${middleOf(destination)}.`,
    pending: { step: 'name', destination, resume },
  };
}

/** The candidates, as a question. One match is still offered rather than assumed. */
function offer(pending: PendingStay, candidates: StayCandidate[], name: string): StayStep {
  const reply =
    candidates.length === 1
      ? `I found one place matching “${name}”. Is this it?`
      : `I found ${candidates.length} places matching “${name}”. Which one?`;

  return {
    kind: 'ask',
    reply,
    pending: { ...pending, step: 'choose', name, candidates },
  };
}

/**
 * One typed answer, and what it leaves the planner waiting for.
 *
 * Every path out of here either asks one more question or finishes, and the
 * questions cannot cycle: a name that finds nothing goes to the address, and
 * an address that finds nothing gives up and plans from the centre. A flow
 * that could ask twice for the same thing is one somebody gets stuck in.
 */
export async function advanceStay(pending: PendingStay, answer: string): Promise<StayStep> {
  const given = readStayAnswer(answer);

  if (given === null) {
    return {
      kind: 'ready',
      reply: planningFromCentre(pending.destination),
      stay: null,
      resume: pending.resume,
    };
  }

  const candidates = await findStays(given, pending.destination ?? undefined);

  if (candidates.length > 0) return offer(pending, candidates, given);

  /*
   * Nothing found. From the name that is a question worth asking — a small or
   * new hotel is often unmapped while its street is not. From an address it is
   * the end of the road: asking a third time would be pestering somebody who
   * has already told us twice, and the centre is a defensible answer.
   */
  if (pending.step === 'address') {
    return {
      kind: 'ready',
      reply: `I could not place “${given}” either. ${planningFromCentre(pending.destination)}`,
      stay: null,
      resume: pending.resume,
    };
  }

  return {
    kind: 'ask',
    reply:
      `I could not find “${given}” on the map. What is its address? ` +
      'A street and number is enough, and I will measure the radius from there. ' +
      `Or say “not sure” and I will use ${middleOf(pending.destination)}.`,
    pending: { ...pending, step: 'address', name: given, candidates: undefined },
  };
}

/**
 * A verb that plans something, beside a noun that is a trip.
 *
 * Both halves are required, and that is the whole design. A hotel name can
 * easily contain one — Holiday Inn, Trip Inn, Vacation Club are all real — and
 * mistaking one for a request to plan would throw away a question the reader
 * was busy answering. Neither pattern alone is safe; together they have no
 * plausible reading as the name of a building.
 */
const PLANS_SOMETHING = /\b(?:plan|create|make|build|organi[sz]e|book|arrange)\b/i;
const A_TRIP = /\b(?:trip|itinerary|holiday|vacation|getaway|weekend|days?|nights?)\b/i;

/**
 * Whether this is somebody asking for a trip rather than answering the question.
 *
 * The stay flow takes the next thing typed as its answer, which is right for
 * "Rooms Hotel" and wrong for "create a new trip in Tbilisi from 14 to 18 of
 * September" — that went to the hotel lookup in full and came back "I could
 * not find 'create a new trip in Tbilisi from 14 to 18 of September' on the
 * map", which is a planner arguing with somebody who has simply moved on.
 *
 * Deliberately narrow. The cost of reading a trip request as a hotel is a
 * dead end the reader has to back out of; the cost of reading a hotel as a
 * trip request is a question abandoned and a radius quietly measured from the
 * middle of a city. The second is the worse of the two, so this only fires on
 * a sentence that cannot be a building.
 */
export function asksForATripInstead(text: string): boolean {
  return PLANS_SOMETHING.test(text) && A_TRIP.test(text);
}

/**
 * A candidate picked from the list.
 *
 * Returns null rather than throwing on an id that is not in the list, which is
 * what a stale message rendered from an older transcript would send. The
 * caller treats that as a tap that did not land, because that is what it is.
 */
export function pickStay(pending: PendingStay, candidateId: string): StayStep | null {
  const chosen = pending.candidates?.find((candidate) => candidate.id === candidateId);
  if (!chosen) return null;

  return {
    kind: 'ready',
    reply: null,
    stay: { name: chosen.name, coordinates: chosen.coordinates },
    resume: pending.resume,
  };
}

/**
 * "None of these" — the way out of a list that does not contain the answer.
 *
 * Goes to the address rather than back to the name. The name has already been
 * tried and the list is what it produced, so asking for it again would offer
 * the same wrong options a second time.
 */
export function rejectStayCandidates(pending: PendingStay): StayStep {
  return {
    kind: 'ask',
    reply:
      'What is its address, then? ' +
      'A street and number is enough, and I will measure the radius from there. ' +
      `Or say “not sure” and I will use ${middleOf(pending.destination)}.`,
    pending: { ...pending, step: 'address', candidates: undefined },
  };
}
