import { afterEach, describe, expect, it, vi } from 'vitest';
import { wikimediaService } from './wikimedia.service';

/**
 * The client half of the photograph lookup.
 *
 * The Wikidata and Commons conversation lives in
 * `server/src/modules/places/wikimedia.ts` and is tested there. What is left
 * here is small but load-bearing: a grid must never fail because a decorative
 * photograph could not be fetched, and a large grid must stay inside the
 * endpoint's id cap.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function stubFetch(implementation: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn((input: string | URL) => implementation(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const IMAGE = {
  url: 'https://upload.example/A.jpg',
  descriptionUrl: 'https://commons.example/File:A.jpg',
  author: 'Someone',
  license: 'CC BY-SA 4.0',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getImages', () => {
  it('keys the photographs by entity id', async () => {
    stubFetch(async () => jsonResponse({ Q1: IMAGE }));

    const images = await wikimediaService.getImages(['Q1']);

    expect(images.get('Q1')).toEqual(IMAGE);
  });

  it('asks our API, never Wikimedia', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}));

    await wikimediaService.getImages(['Q1']);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/images/wikidata');
    expect(url).not.toContain('wikidata.org');
  });

  it('makes no request for an empty list', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}));

    await expect(wikimediaService.getImages([])).resolves.toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks about each entity once', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}));

    await wikimediaService.getImages(['Q1', 'Q1', 'Q2']);

    const ids = new URL(String(fetchMock.mock.calls[0][0]), 'http://x').searchParams.get('ids');
    expect(ids).toBe('Q1,Q2');
  });

  it('splits a grid larger than the endpoint accepts', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}));
    const ids = Array.from({ length: 250 }, (_, index) => `Q${index}`);

    await wikimediaService.getImages(ids);

    // The endpoint caps a request at 100 ids and would reject the lot.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const requested = new URL(String(call[0]), 'http://x').searchParams.get('ids')?.split(',');
      expect(requested?.length).toBeLessThanOrEqual(100);
    }
  });

  it('returns nothing rather than failing the grid', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    // A card falls back to its own category artwork. An error state over a
    // missing decorative photograph would be wildly out of proportion.
    await expect(wikimediaService.getImages(['Q1'])).resolves.toEqual(new Map());
  });

  it('keeps the photographs from batches that did succeed', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `Q${index}`);

    stubFetch(async (url) => {
      if (url.includes('Q100')) throw new Error('offline');
      return jsonResponse({ Q1: IMAGE });
    });

    const images = await wikimediaService.getImages(ids);

    // One failed batch must not discard the ninety-nine cards that did resolve.
    expect(images.get('Q1')).toEqual(IMAGE);
  });

  it('ignores an entry with no url', async () => {
    stubFetch(async () => jsonResponse({ Q1: { descriptionUrl: 'x' } }));

    // A card rendering `<img src="undefined">` is worse than one with no photo.
    await expect(wikimediaService.getImages(['Q1'])).resolves.toEqual(new Map());
  });
});
