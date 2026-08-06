/**
 * What a planner prompt is asking for.
 *
 * The planner used to do one thing with every prompt: scan it for a place name
 * and emit an itinerary. "What is the weather in Abu Dhabi?" therefore produced
 * a five-day Abu Dhabi trip — it found a place, and building trips was the only
 * thing it knew how to do.
 *
 * This decides what was actually asked before anything is generated. It is
 * deliberately a set of rules rather than a model: the answers behind it are
 * themselves lookups against real APIs, and a classifier that is wrong in ways
 * a reader cannot predict is worse than one whose limits are legible.
 */

export type PromptIntent =
  /** Plan something. The default — a bare "Bali" is still a trip request. */
  | { kind: 'trip' }
  /** How warm is it, is it raining. `place` is null when none was named. */
  | { kind: 'weather'; place: string | null }
  /** Where is it, what country is it in. */
  | { kind: 'location'; place: string | null }
  /** A question this cannot answer. Said plainly rather than answered wrongly. */
  | { kind: 'unknown' };

/**
 * Words that mean "make me an itinerary", checked before anything else.
 *
 * "What should I do in Rome?" is a question by shape and a trip request by
 * intent, so these win over the question test below.
 */
const TRIP_PHRASES = [
  'plan',
  'itinerary',
  'trip to',
  'trip for',
  'travel to',
  'go to',
  'visit',
  'holiday',
  'vacation',
  'getaway',
  'things to do',
  'what to do',
  'do in',
  'see in',
  'day trip',
  'weekend in',
];

/** A day count or a party size only ever appears in a planning prompt. */
const TRIP_SHAPES = [/\b\d+\s*[- ]?\s*day/i, /\bdays?\s+in\b/i, /\b\d+\s+(?:people|adults|travellers|travelers)\b/i];

const WEATHER_WORDS = [
  'weather',
  'temperature',
  'forecast',
  'climate',
  'rain',
  'raining',
  'sunny',
  'snow',
  'humid',
  'how hot',
  'how cold',
  'how warm',
  'degrees',
];

const LOCATION_WORDS = [
  'where is',
  'where are',
  'located',
  'location of',
  'which country',
  'what country',
  'capital of',
  'how far',
];

/** Openers that make a sentence a question even without a question mark. */
const QUESTION_OPENERS = [
  'what',
  'where',
  'when',
  'why',
  'how',
  'is',
  'are',
  'was',
  'does',
  'do',
  'did',
  'can',
  'could',
  'should',
  'will',
  'tell me',
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function isQuestion(lowered: string): boolean {
  if (lowered.includes('?')) return true;

  const first = lowered.split(/\s+/)[0] ?? '';
  return QUESTION_OPENERS.some((opener) =>
    opener.includes(' ') ? lowered.startsWith(opener) : first === opener,
  );
}

/** Trailing words that are about *when*, not *where*. */
const TRAILING_TIME = [
  'right now',
  'now',
  'today',
  'tomorrow',
  'tonight',
  'this week',
  'this weekend',
  'next week',
  'in summer',
  'in winter',
  'like',
];

/** Words that are grammatically a place and never actually one. */
const PRONOUNS = new Set(['it', 'that', 'this', 'there', 'here', 'them']);

/**
 * Where a place can hide in a question, most specific phrasing first.
 *
 * "where is Porto?" names its place with no preposition at all, and "what
 * country is Bali in?" puts the preposition after it — neither is reachable by
 * looking for a trailing "in ...", which is why this is a list rather than one
 * expression.
 */
const PLACE_PATTERNS: RegExp[] = [
  /\b(?:what|which) country is\s+(.+?)\s+in\b/i,
  /\bwhere (?:is|are)\s+(.+)$/i,
  /\bcapital of\s+(.+)$/i,
];

/** The prepositions a place follows. Scanned for the last one, not the first. */
const PREPOSITION = /\b(?:in|at|near|around|for)\s+/gi;

/** A preposition left dangling at the end names nothing: "where is it in". */
const DANGLING_PREPOSITION = /\s+(?:in|at|near|around|for|to|on)$/i;

function tidy(place: string): string | null {
  let value = place.trim().replace(/[?!.,;:]+\s*$/, '').trim();
  value = value.replace(DANGLING_PREPOSITION, '').trim();

  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    for (const tail of TRAILING_TIME) {
      const lowered = value.toLowerCase();
      if (lowered.endsWith(` ${tail}`) || lowered === tail) {
        value = value.slice(0, value.length - tail.length).trim();
        value = value.replace(/[?!.,;:]+\s*$/, '').trim();
        trimmed = true;
        break;
      }
    }
  }

  if (!value || PRONOUNS.has(value.toLowerCase())) return null;
  return value;
}

/**
 * The place a question is about.
 *
 * The trailing form is scanned to the **last** match, not the first: "is it
 * warm in the evening in Split?" is about Split, and taking the first "in"
 * would answer for "the evening". Returns null rather than guessing when
 * nothing usable follows — the caller then asks which place was meant.
 */
export function extractPlace(prompt: string): string | null {
  const text = prompt.trim();

  for (const pattern of PLACE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const place = tidy(match[1]);
      if (place) return place;
    }
  }

  /*
   * From after the *last* preposition to the next punctuation. A single greedy
   * capture from the first one swallows the whole tail — "in the evening in
   * Split" comes back as one match whose place is the evening.
   */
  let after = -1;
  for (const match of text.matchAll(PREPOSITION)) {
    after = (match.index ?? 0) + match[0].length;
  }
  if (after === -1) return null;

  return tidy(text.slice(after).split(/[,?!.;:]/)[0]);
}

export function classifyPrompt(prompt: string): PromptIntent {
  const lowered = prompt.toLowerCase().trim();
  if (!lowered) return { kind: 'trip' };

  // Planning language wins: "what should I do in Rome" is a trip request
  // wearing a question mark.
  if (includesAny(lowered, TRIP_PHRASES) || TRIP_SHAPES.some((shape) => shape.test(lowered))) {
    return { kind: 'trip' };
  }

  if (!isQuestion(lowered)) return { kind: 'trip' };

  if (includesAny(lowered, WEATHER_WORDS)) {
    return { kind: 'weather', place: extractPlace(prompt) };
  }

  if (includesAny(lowered, LOCATION_WORDS)) {
    return { kind: 'location', place: extractPlace(prompt) };
  }

  return { kind: 'unknown' };
}
