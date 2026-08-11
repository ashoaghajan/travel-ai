import { describe, expect, it } from 'vitest';
import { BUNDLED_IMAGES } from '../assets/bundled-images';
import type { Trip } from '../types/trip.types';
import {
  TRIP_FILE_KIND,
  TRIP_FILE_VERSION,
  buildTripFile,
  findDuplicateTrip,
  parseTripFile,
  safeImageUrl,
  serialiseTripFile,
  toTripDraft,
  tripFieldLabel,
  tripFileMessage,
  tripFileName,
} from './tripFile';

/**
 * The file format, both directions.
 *
 * Two rules carry most of these tests. A file must never carry anything that
 * belongs to the account that wrote it — an id, a draft key, a booking — and a
 * file arriving from a stranger must never be trusted to describe itself
 * correctly.
 */

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    draftId: 'draft_9',
    title: 'One week in Yerevan',
    destination: 'Yerevan',
    destinationCountry: 'Armenia',
    destinationCity: 'Yerevan',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    coverImage: 'https://images.example/cover.jpg',
    itinerary: [
      {
        id: 'day_1',
        dayNumber: 1,
        date: '2027-09-02',
        destination: 'Yerevan',
        summary: 'Old town on foot',
        activities: [
          {
            id: 'act_1',
            time: '10:00',
            title: 'Cascade complex',
            description: 'Steps, sculpture and the view from the top',
            category: 'culture',
            priceEstimate: 15,
            image: 'https://images.example/cascade.jpg',
            sourceActivityId: 'otm_12345',
            coordinates: { lat: 40.19, lng: 44.51 },
          },
        ],
      },
    ],
    notes: [
      { id: 'note_1', text: 'Book the wine tour', createdAt: '2026-08-01', updatedAt: '2026-08-02' },
    ],
    flightsEstimate: 420,
    hotelsEstimate: 600,
    activitiesEstimate: 180,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

/** A file as it lands on disk, so the tests read the way an importer does. */
function fileFrom(trip: Trip): string {
  return serialiseTripFile(buildTripFile(trip));
}

describe('buildTripFile', () => {
  it('stamps the envelope', () => {
    const file = buildTripFile(makeTrip(), '2026-08-11T10:31:07.000Z');

    expect(file.kind).toBe(TRIP_FILE_KIND);
    expect(file.version).toBe(TRIP_FILE_VERSION);
    expect(file.exportedAt).toBe('2026-08-11T10:31:07.000Z');
  });

  it('dates the file itself when nothing says otherwise', () => {
    expect(Date.parse(buildTripFile(makeTrip()).exportedAt)).not.toBeNaN();
  });

  it('leaves behind everything that belongs to the account that wrote it', () => {
    const trip = { ...makeTrip(), bookings: [] } as Trip;
    const { trip: exported } = buildTripFile(trip);

    // The importer's copy is a new trip, not a claim to be this one.
    for (const key of ['id', 'draftId', 'createdAt', 'updatedAt', 'version', 'bookings']) {
      expect(exported).not.toHaveProperty(key);
    }
  });

  it('carries the plan, the notes and the estimates', () => {
    const { trip } = buildTripFile(makeTrip());

    expect(trip.itinerary).toHaveLength(1);
    expect(trip.notes).toHaveLength(1);
    expect(trip.flightsEstimate).toBe(420);
    expect(trip.hotelsEstimate).toBe(600);
    expect(trip.activitiesEstimate).toBe(180);
  });

  it('omits optional fields rather than writing them empty', () => {
    const { trip } = buildTripFile(
      makeTrip({
        destinationCountry: undefined,
        destinationCity: undefined,
        notes: [],
        flightsEstimate: undefined,
        hotelsEstimate: undefined,
        activitiesEstimate: undefined,
      }),
    );

    expect(trip).not.toHaveProperty('destinationCountry');
    expect(trip).not.toHaveProperty('destinationCity');
    expect(trip).not.toHaveProperty('notes');
    expect(trip).not.toHaveProperty('flightsEstimate');
    expect(trip).not.toHaveProperty('hotelsEstimate');
    expect(trip).not.toHaveProperty('activitiesEstimate');
  });

  it('names the bundled cover it uses, so another build can find it again', () => {
    const { trip } = buildTripFile(makeTrip({ coverImage: BUNDLED_IMAGES['generic/city'] }));

    // The path is content-hashed, differs between a laptop and a deployment,
    // and moves again with the next build. The id does none of those.
    expect(trip.coverImageId).toBe('generic/city');
  });

  it('has no id to give for a cover of its own', () => {
    expect(buildTripFile(makeTrip()).trip).not.toHaveProperty('coverImageId');
  });
});

describe('tripFileName', () => {
  it('slugs the title and dates the file', () => {
    expect(tripFileName(makeTrip())).toBe('one-week-in-yerevan-2027-09-02.trip.json');
  });

  it('folds punctuation, accents and runs of spaces', () => {
    expect(tripFileName(makeTrip({ title: '  Sagrada Família — 2 days!  ' }))).toBe(
      'sagrada-familia-2-days-2027-09-02.trip.json',
    );
  });

  it('falls back rather than producing a nameless file', () => {
    expect(tripFileName(makeTrip({ title: '???' }))).toBe('trip-2027-09-02.trip.json');
  });

  it('caps a long title without leaving a trailing dash', () => {
    const name = tripFileName(makeTrip({ title: 'a'.repeat(40) + ' ' + 'b'.repeat(40) }));

    expect(name).toBe(`${'a'.repeat(40)}-${'b'.repeat(19)}-2027-09-02.trip.json`);
    expect(name).not.toContain('--');
  });
});

describe('parseTripFile', () => {
  it('round-trips a trip this app exported', () => {
    const parsed = parseTripFile(fileFrom(makeTrip()));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.trip.title).toBe('One week in Yerevan');
    expect(parsed.trip.startDate).toBe('2027-09-02');
    expect(parsed.trip.travellers).toBe(2);
    expect(parsed.trip.itinerary[0].activities[0].title).toBe('Cascade complex');
    expect(parsed.trip.itinerary[0].activities[0].coordinates).toEqual({ lat: 40.19, lng: 44.51 });
    expect(parsed.trip.notes?.[0].text).toBe('Book the wine tour');
    expect(parsed.trip.flightsEstimate).toBe(420);
  });

  it('describes the file for the reader before anything is saved', () => {
    const parsed = parseTripFile(fileFrom(makeTrip()));

    expect(parsed.ok && parsed.preview).toEqual({
      title: 'One week in Yerevan',
      destination: 'Yerevan',
      startDate: '2027-09-02',
      endDate: '2027-09-06',
      travellers: 2,
      days: 1,
      activities: 1,
      notes: 1,
    });
  });

  it('mints new day and activity ids', () => {
    const parsed = parseTripFile(fileFrom(makeTrip()));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Nothing outside the trip's own JSON points at these, and the server
    // bounds their length without requiring them to be distinct — so a
    // hand-edited file cannot hand two activities the same id.
    expect(parsed.trip.itinerary[0].id).not.toBe('day_1');
    expect(parsed.trip.itinerary[0].id).toMatch(/^day_/);
    expect(parsed.trip.itinerary[0].activities[0].id).not.toBe('act_1');
    expect(parsed.trip.itinerary[0].activities[0].id).toMatch(/^act_/);
  });

  it('keeps sourceActivityId, which is what stops the same place being added twice', () => {
    const parsed = parseTripFile(fileFrom(makeTrip()));

    expect(parsed.ok && parsed.trip.itinerary[0].activities[0].sourceActivityId).toBe('otm_12345');
  });

  it('gives every day and activity an id of its own', () => {
    const trip = makeTrip();
    const day = trip.itinerary[0];
    const file = fileFrom({
      ...trip,
      itinerary: [day, { ...day }],
    });

    const parsed = parseTripFile(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const [first, second] = parsed.trip.itinerary;
    expect(first.id).not.toBe(second.id);
    expect(first.activities[0].id).not.toBe(second.activities[0].id);
  });

  it('resolves bundled pictures against this build, not the one that wrote them', () => {
    const trip = makeTrip({
      coverImage: BUNDLED_IMAGES['generic/coast'],
      itinerary: [
        {
          ...makeTrip().itinerary[0],
          image: BUNDLED_IMAGES['itinerary/day-1-ubud'],
          activities: [
            { ...makeTrip().itinerary[0].activities[0], image: BUNDLED_IMAGES['generic/food'] },
          ],
        },
      ],
    });

    /*
     * The case this exists for: a trip exported from a laptop, where assets are
     * served as `/src/assets/…`, imported into a deployed build that has only
     * ever served `/assets/<hash>.jpg`. Every URL in the file is a 404 there,
     * so the ids are the only thing that can save the photographs.
     */
    const stale = fileFrom(trip)
      .replaceAll(BUNDLED_IMAGES['generic/coast'], '/src/assets/generic/coast.jpg')
      .replaceAll(BUNDLED_IMAGES['itinerary/day-1-ubud'], '/src/assets/itinerary/day-1-ubud.jpg')
      .replaceAll(BUNDLED_IMAGES['generic/food'], '/src/assets/generic/food.jpg');

    const parsed = parseTripFile(stale);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.trip.coverImage).toBe(BUNDLED_IMAGES['generic/coast']);
    expect(parsed.trip.itinerary[0].image).toBe(BUNDLED_IMAGES['itinerary/day-1-ubud']);
    expect(parsed.trip.itinerary[0].activities[0].image).toBe(BUNDLED_IMAGES['generic/food']);
  });

  it('keeps a remote photo as it is — nothing to translate', () => {
    const parsed = parseTripFile(fileFrom(makeTrip()));

    expect(parsed.ok && parsed.trip.coverImage).toBe('https://images.example/cover.jpg');
  });

  it('falls back to the URL when this build no longer ships that picture', () => {
    const file = JSON.parse(fileFrom(makeTrip()));
    file.trip.coverImageId = 'generic/retired-in-2027';

    // A file from a newer build naming a photo we dropped: better the remote
    // URL it also carries than no cover at all.
    expect(parseTripFile(JSON.stringify(file))).toMatchObject({
      ok: true,
      trip: { coverImage: 'https://images.example/cover.jpg' },
    });
  });

  it('drops unknown keys', () => {
    const file = JSON.parse(fileFrom(makeTrip()));
    file.trip.somethingElse = 'ignored';
    file.trip.itinerary[0].activities[0].somethingElse = 'ignored';

    const parsed = parseTripFile(JSON.stringify(file));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.trip).not.toHaveProperty('somethingElse');
    expect(parsed.trip.itinerary[0].activities[0]).not.toHaveProperty('somethingElse');
  });

  it('fills in a day number and note timestamps a file left out', () => {
    const file = JSON.parse(fileFrom(makeTrip()));
    delete file.trip.itinerary[0].dayNumber;
    delete file.trip.notes[0].createdAt;
    delete file.trip.notes[0].updatedAt;

    const parsed = parseTripFile(JSON.stringify(file));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.trip.itinerary[0].dayNumber).toBe(1);
    expect(parsed.trip.notes?.[0].createdAt).toBe(parsed.trip.notes?.[0].updatedAt);
  });

  it('reads a trip with no notes at all', () => {
    const parsed = parseTripFile(fileFrom(makeTrip({ notes: undefined })));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.trip.notes).toBeUndefined();
    expect(parsed.preview.notes).toBe(0);
  });

  it.each([
    ['not JSON at all', 'not json', 'not-json'],
    ['an empty file', '', 'not-json'],
    ['a JSON array', '[]', 'not-a-trip-file'],
    ['an unrelated object', '{"hello":"world"}', 'not-a-trip-file'],
    ['somebody else’s format', '{"kind":"other.trip","version":1,"trip":{}}', 'not-a-trip-file'],
    [
      'a version that is not a version',
      `{"kind":"${TRIP_FILE_KIND}","version":"one","trip":{}}`,
      'not-a-trip-file',
    ],
    [
      'a version below one',
      `{"kind":"${TRIP_FILE_KIND}","version":0,"trip":{}}`,
      'not-a-trip-file',
    ],
    [
      'a version this build cannot read',
      `{"kind":"${TRIP_FILE_KIND}","version":2,"trip":{}}`,
      'newer-version',
    ],
    ['no trip in it', `{"kind":"${TRIP_FILE_KIND}","version":1}`, 'malformed'],
  ])('refuses %s', (_case, contents, problem) => {
    expect(parseTripFile(contents)).toEqual({ ok: false, problem });
  });

  it.each([
    ['title', ''],
    ['title', '   '],
    ['startDate', 42],
    ['endDate', null],
    ['travellers', 'two'],
    ['travellers', Number.NaN],
    ['itinerary', {}],
  ])('refuses a file whose %s is %p', (field, value) => {
    const file = JSON.parse(fileFrom(makeTrip()));
    file.trip[field] = value;

    expect(parseTripFile(JSON.stringify(file))).toEqual({ ok: false, problem: 'malformed' });
  });

  it.each([
    ['a day that is not an object', (file: any) => (file.trip.itinerary[0] = 'monday')],
    ['a day with no activities array', (file: any) => delete file.trip.itinerary[0].activities],
    ['an activity that is not an object', (file: any) => (file.trip.itinerary[0].activities[0] = 1)],
    ['notes that are not a list', (file: any) => (file.trip.notes = 'be on time')],
    ['a note that is not an object', (file: any) => (file.trip.notes[0] = 'be on time')],
    ['a note with no text', (file: any) => delete file.trip.notes[0].text],
  ])('refuses %s', (_case, damage) => {
    const file = JSON.parse(fileFrom(makeTrip()));
    damage(file);

    expect(parseTripFile(JSON.stringify(file))).toEqual({ ok: false, problem: 'malformed' });
  });

  it('drops coordinates it cannot use rather than refusing the whole trip', () => {
    const file = JSON.parse(fileFrom(makeTrip()));
    file.trip.itinerary[0].activities[0].coordinates = { lat: 'north', lng: 44.51 };
    file.trip.itinerary[0].coordinates = null;

    const parsed = parseTripFile(JSON.stringify(file));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.trip.itinerary[0].activities[0].coordinates).toBeUndefined();
    expect(parsed.trip.itinerary[0]).not.toHaveProperty('coordinates');
  });

  it('keeps a day image the app could have written', () => {
    const file = JSON.parse(fileFrom(makeTrip()));
    file.trip.itinerary[0].image = 'https://images.example/day.jpg';

    expect(parseTripFile(JSON.stringify(file))).toMatchObject({
      ok: true,
      trip: { itinerary: [{ image: 'https://images.example/day.jpg' }] },
    });
  });

  it('drops an image the app would never point at', () => {
    const file = JSON.parse(fileFrom(makeTrip()));
    file.trip.coverImage = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    file.trip.itinerary[0].activities[0].image = 'blob:https://evil.example/1';

    const parsed = parseTripFile(JSON.stringify(file));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.trip.coverImage).toBe('');
    expect(parsed.trip.itinerary[0].activities[0]).not.toHaveProperty('image');
  });

  it('drops a source id that is only whitespace', () => {
    const file = JSON.parse(fileFrom(makeTrip()));
    file.trip.itinerary[0].activities[0].sourceActivityId = '  ';

    expect(parseTripFile(JSON.stringify(file))).toMatchObject({
      ok: true,
      trip: { itinerary: [{ activities: [{}] }] },
    });
  });
});

describe('safeImageUrl', () => {
  it.each([
    ['https://images.example/a.jpg', 'https://images.example/a.jpg'],
    ['http://images.example/a.jpg', 'http://images.example/a.jpg'],
    ['/assets/city-9f2a1b.jpg', '/assets/city-9f2a1b.jpg'],
    ['  https://images.example/a.jpg  ', 'https://images.example/a.jpg'],
  ])('keeps %s', (value, expected) => {
    expect(safeImageUrl(value)).toBe(expected);
  });

  it.each([
    ['data:image/png;base64,AAAA'],
    ['blob:https://evil.example/1'],
    ['javascript:alert(1)'],
    ['//evil.example/a.jpg'],
    ['not a url'],
    [''],
    ['   '],
  ])('drops %s', (value) => {
    expect(safeImageUrl(value)).toBeUndefined();
  });

  it.each([[42], [null], [undefined], [{}]])('drops the non-string %p', (value) => {
    expect(safeImageUrl(value)).toBeUndefined();
  });
});

describe('toTripDraft', () => {
  it('attaches the caller’s draft key and drops the cover id', () => {
    const cover = BUNDLED_IMAGES['generic/city'];
    const parsed = parseTripFile(fileFrom(makeTrip({ coverImage: cover })));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const draft = toTripDraft(parsed.trip, 'draft_abc');

    expect(draft.draftId).toBe('draft_abc');
    // The ids are a transport detail; what goes to the server is a plain trip.
    expect(draft).not.toHaveProperty('coverImageId');
    expect(draft.itinerary[0]).not.toHaveProperty('imageId');
    expect(draft.coverImage).toBe(cover);
  });
});

describe('findDuplicateTrip', () => {
  const preview = {
    title: 'One week in Yerevan',
    destination: 'Yerevan',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    days: 1,
    activities: 1,
    notes: 0,
  };

  it('finds the trip a second import of the same file would copy', () => {
    const trip = makeTrip();

    expect(findDuplicateTrip([trip], preview)).toBe(trip);
  });

  it('ignores case and spacing in the title', () => {
    const trip = makeTrip({ title: '  one   week  IN yerevan ' });

    expect(findDuplicateTrip([trip], preview)).toBe(trip);
  });

  it.each([
    ['a different title', { title: 'Two weeks in Yerevan' }],
    ['a different start date', { startDate: '2027-09-03' }],
    ['a different end date', { endDate: '2027-09-07' }],
  ])('does not flag %s', (_case, overrides) => {
    expect(findDuplicateTrip([makeTrip(overrides)], preview)).toBeNull();
  });

  it('finds nothing in an empty account', () => {
    expect(findDuplicateTrip([], preview)).toBeNull();
  });
});

describe('tripFieldLabel', () => {
  it.each([
    ['title', 'The trip title'],
    ['destination', 'The destination'],
    ['destinationCountry', 'The country'],
    ['destinationCity', 'The city'],
    ['startDate', 'The start date'],
    ['endDate', 'The end date'],
    ['travellers', 'The number of travellers'],
    ['coverImage', 'The cover image'],
    ['itinerary.2', 'Day 3'],
    ['itinerary.2.date', 'Day 3'],
    ['itinerary.2.activities.0', 'Day 3, activity 1'],
    ['itinerary.2.activities.0.time', 'Day 3, activity 1'],
    ['notes.4.text', 'Note 5'],
    ['_', 'This file'],
    ['somethingNew', 'This file'],
  ])('says %s as "%s"', (path, label) => {
    expect(tripFieldLabel(path)).toBe(label);
  });
});

describe('tripFileMessage', () => {
  it.each(['not-json', 'not-a-trip-file', 'newer-version', 'malformed'] as const)(
    'has a sentence for %s',
    (problem) => {
      expect(tripFileMessage(problem)).toMatch(/\w/);
    },
  );
});
