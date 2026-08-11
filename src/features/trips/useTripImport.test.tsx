/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@ai-travel/shared';
import { ApiError } from '../../services/http';
import { tripService } from '../../services/trip.service';
import { seedTrips } from '../../test/seedTrips';
import type { Trip } from '../../types/trip.types';
import { buildTripFile, serialiseTripFile } from '../../utils/tripFile';
import { useTripImport } from './useTripImport';

/**
 * Reading a trip out of a file and saving it here.
 *
 * The guarantee worth the most is the one about retries: a failed import that
 * had in fact committed must not leave the account holding the trip twice. That
 * rests entirely on which attempts share a `draftId`, so it is asserted on the
 * spy's arguments rather than on anything visible.
 */

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_1',
    draftId: 'draft_original',
    title: 'One week in Yerevan',
    destination: 'Yerevan',
    startDate: '2027-09-02',
    endDate: '2027-09-06',
    travellers: 2,
    coverImage: '',
    itinerary: [
      {
        id: 'day_1',
        dayNumber: 1,
        date: '2027-09-02',
        destination: 'Yerevan',
        summary: '',
        activities: [
          {
            id: 'act_1',
            time: '10:00',
            title: 'Cascade',
            description: '',
            category: 'culture',
          },
        ],
      },
    ],
    notes: [{ id: 'note_1', text: 'Wine tour', createdAt: 'x', updatedAt: 'x' }],
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}

/** A file as the reader would have picked it off disk. */
function tripFile(trip: Trip = makeTrip()): File {
  return new File([serialiseTripFile(buildTripFile(trip))], 'yerevan.trip.json', {
    type: 'application/json',
  });
}

function fileOf(contents: string): File {
  return new File([contents], 'whatever.json', { type: 'application/json' });
}

beforeEach(async () => {
  await seedTrips([]);
});

describe('reading the file', () => {
  it('describes what is in it before anything is saved', async () => {
    const { result } = renderHook(() => useTripImport());

    await act(() => result.current.selectFile(tripFile()));

    expect(result.current.stage).toBe('ready');
    expect(result.current.preview).toMatchObject({
      title: 'One week in Yerevan',
      days: 1,
      activities: 1,
      notes: 1,
    });
    expect(result.current.error).toBeNull();
  });

  it('says what is wrong with a file it cannot read', async () => {
    const { result } = renderHook(() => useTripImport());

    await act(() => result.current.selectFile(fileOf('not json at all')));

    expect(result.current.stage).toBe('choosing');
    expect(result.current.preview).toBeNull();
    expect(result.current.error).toMatch(/not JSON/i);
  });

  it('refuses somebody else’s JSON', async () => {
    const { result } = renderHook(() => useTripImport());

    await act(() => result.current.selectFile(fileOf('{"hello":"world"}')));

    expect(result.current.error).toMatch(/not a trip file/i);
  });

  it('refuses an enormous file without reading it', async () => {
    const { result } = renderHook(() => useTripImport());
    const huge = tripFile();

    // Reading it first is the thing being avoided — a 500 MB pick should never
    // reach memory just to be told it is not a trip.
    Object.defineProperty(huge, 'size', { value: 8 * 1024 * 1024 });
    const read = vi.spyOn(huge, 'text');

    await act(() => result.current.selectFile(huge));

    expect(read).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/too large/i);
  });

  it('does nothing when the picker is dismissed', async () => {
    const { result } = renderHook(() => useTripImport());

    await act(() => result.current.selectFile(null));

    expect(result.current.stage).toBe('choosing');
    expect(result.current.error).toBeNull();
  });

  it('forgets the first file when a second is chosen', async () => {
    const { result } = renderHook(() => useTripImport());

    await act(() => result.current.selectFile(tripFile()));
    await act(() => result.current.selectFile(fileOf('nonsense')));

    expect(result.current.preview).toBeNull();
    expect(result.current.stage).toBe('choosing');
  });
});

describe('saving it', () => {
  it('creates a trip from the file', async () => {
    const saved = makeTrip({ id: 'trip_new' });
    const create = vi.spyOn(tripService, 'createTrip').mockResolvedValue(saved);

    const { result } = renderHook(() => useTripImport());
    await act(() => result.current.selectFile(tripFile()));

    let returned: Trip | null = null;
    await act(async () => {
      returned = await result.current.submit();
    });

    expect(returned).toBe(saved);
    expect(result.current.stage).toBe('done');

    // The file's own id and draft key never travel — the importer gets a trip
    // of their own, not a claim to be the exporter's.
    const draft = create.mock.calls[0][0];
    expect(draft).not.toHaveProperty('id');
    expect(draft.draftId).toMatch(/^draft_/);
    expect(draft.draftId).not.toBe('draft_original');
    expect(draft.title).toBe('One week in Yerevan');
    expect(draft.notes).toHaveLength(1);
  });

  it('warns instead of saving when the account already has this trip', async () => {
    await seedTrips([makeTrip()]);
    const create = vi.spyOn(tripService, 'createTrip');

    const { result } = renderHook(() => useTripImport());
    await act(() => result.current.selectFile(tripFile()));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.stage).toBe('duplicate');
    expect(result.current.duplicate?.id).toBe('trip_1');
    expect(create).not.toHaveBeenCalled();
  });

  it('goes ahead when the reader says so anyway', async () => {
    await seedTrips([makeTrip()]);
    const saved = makeTrip({ id: 'trip_second' });
    vi.spyOn(tripService, 'createTrip').mockResolvedValue(saved);

    const { result } = renderHook(() => useTripImport());
    await act(() => result.current.selectFile(tripFile()));
    await act(async () => {
      await result.current.submit();
    });

    let returned: Trip | null = null;
    await act(async () => {
      returned = await result.current.importAnyway();
    });

    expect(returned).toBe(saved);
    expect(result.current.stage).toBe('done');
  });
});

describe('when it goes wrong', () => {
  it('retries with the same draft key, so a lost reply cannot make two trips', async () => {
    const create = vi
      .spyOn(tripService, 'createTrip')
      .mockRejectedValueOnce(new ApiError(0, ERROR_CODES.NETWORK, 'offline'))
      .mockResolvedValueOnce(makeTrip({ id: 'trip_new' }));

    const { result } = renderHook(() => useTripImport());
    await act(() => result.current.selectFile(tripFile()));

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.stage).toBe('ready');
    expect(result.current.error).toMatch(/could not reach the server/i);

    await act(async () => {
      await result.current.submit();
    });

    // Same key both times: if the first write had committed after all, the
    // server replays it rather than creating a twin.
    expect(create.mock.calls[0][0].draftId).toBe(create.mock.calls[1][0].draftId);
    expect(result.current.stage).toBe('done');
  });

  it('gives a fresh draft key to a file chosen again later', async () => {
    const create = vi.spyOn(tripService, 'createTrip').mockResolvedValue(makeTrip());

    const { result } = renderHook(() => useTripImport());

    await act(() => result.current.selectFile(tripFile()));
    await act(async () => {
      await result.current.submit();
    });

    // The first import put the trip on the account, so picking the same file
    // again is now caught by the duplicate gate — which is the choice the
    // reader is allowed to overrule.
    await act(() => result.current.selectFile(tripFile()));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.stage).toBe('duplicate');

    await act(async () => {
      await result.current.importAnyway();
    });

    // Deliberately importing the same file twice must really produce two trips.
    expect(create.mock.calls[0][0].draftId).not.toBe(create.mock.calls[1][0].draftId);
  });

  it('names the day and activity the server objected to', async () => {
    vi.spyOn(tripService, 'createTrip').mockRejectedValue(
      new ApiError(422, ERROR_CODES.VALIDATION_FAILED, 'Some of those details are not valid.', {
        'itinerary.2.activities.0.time': 'Use a 24-hour time, like 09:30.',
      }),
    );

    const { result } = renderHook(() => useTripImport());
    await act(() => result.current.selectFile(tripFile()));
    await act(async () => {
      await result.current.submit();
    });

    await waitFor(() =>
      expect(result.current.error).toBe(
        'We could not import this file. Day 3, activity 1: Use a 24-hour time, like 09:30.',
      ),
    );
  });

  it('falls back to a plain sentence when the server names nothing useful', async () => {
    vi.spyOn(tripService, 'createTrip').mockRejectedValue(
      new ApiError(422, ERROR_CODES.VALIDATION_FAILED, 'nope', null),
    );

    const { result } = renderHook(() => useTripImport());
    await act(() => result.current.selectFile(tripFile()));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toMatch(/Some of its details are not valid/);
  });

  it('says so when the trip is too big for the server', async () => {
    vi.spyOn(tripService, 'createTrip').mockRejectedValue(
      new ApiError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, 'That request is too large.'),
    );

    const { result } = renderHook(() => useTripImport());
    await act(() => result.current.selectFile(tripFile()));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toMatch(/too large to import/i);
  });

  it('has something to say about a failure it does not recognise', async () => {
    vi.spyOn(tripService, 'createTrip').mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useTripImport());
    await act(() => result.current.selectFile(tripFile()));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toMatch(/could not import this file/i);
  });

  it('saves nothing when nothing has been chosen', async () => {
    const create = vi.spyOn(tripService, 'createTrip');
    const { result } = renderHook(() => useTripImport());

    await act(async () => {
      expect(await result.current.submit()).toBeNull();
      expect(await result.current.importAnyway()).toBeNull();
    });

    expect(create).not.toHaveBeenCalled();
  });
});
