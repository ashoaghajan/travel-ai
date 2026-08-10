import { afterEach, describe, expect, it, vi } from 'vitest';
import { getImageFileNames, getImageInfo, getImages, toPlainText } from './wikimedia';

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

/** One Wikidata entity carrying a P18 image claim. */
function entity(fileName: string) {
  return { claims: { P18: [{ mainsnak: { datavalue: { value: fileName } } }] } };
}

/** One Commons page for a file. */
function page(fileName: string, overrides: Record<string, unknown> = {}) {
  return {
    title: `File:${fileName}`,
    imageinfo: [
      {
        thumburl: `https://upload.example/${fileName}`,
        descriptionurl: `https://commons.example/File:${fileName}`,
        extmetadata: {
          Artist: { value: '<a href="/wiki/User:Someone">Someone</a>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
        },
        ...overrides,
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toPlainText', () => {
  it('reduces a metadata fragment to its words', () => {
    expect(toPlainText('<a href="/wiki/User:PHGCOM" class="x">PHGCOM</a>')).toBe('PHGCOM');
  });

  it('decodes the entities Commons escapes', () => {
    expect(toPlainText('Tom &amp; Jerry&#039;s &quot;photo&quot;')).toBe(`Tom & Jerry's "photo"`);
  });

  it('collapses the whitespace left behind by stripped markup', () => {
    expect(toPlainText('<p>  Jakub   </p>\n<span> Hałun </span>')).toBe('Jakub Hałun');
  });
});

describe('getImageFileNames', () => {
  it('maps entity ids to file names', async () => {
    stubFetch(async () =>
      jsonResponse({ entities: { Q1: entity('Bali Museum.jpg'), Q2: entity('Sanur.jpg') } }),
    );

    await expect(getImageFileNames(['Q1', 'Q2'])).resolves.toEqual({ value: new Map([
        ['Q1', 'Bali Museum.jpg'],
        ['Q2', 'Sanur.jpg'],
      ]), complete: true });
  });

  it('leaves out entities with no image claim', async () => {
    stubFetch(async () => jsonResponse({ entities: { Q1: entity('A.jpg'), Q2: { claims: {} } } }));

    const files = (await getImageFileNames(['Q1', 'Q2'])).value;

    expect(files.has('Q2')).toBe(false);
  });

  it('asks for no more than fifty ids per request', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ entities: {} }));
    const ids = Array.from({ length: 120 }, (_, index) => `Q${index}`);

    await getImageFileNames(ids);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const requested = new URL(String(call[0])).searchParams.get('ids')?.split('|') ?? [];
      expect(requested.length).toBeLessThanOrEqual(50);
    }
  });

  it('makes no request for an empty list', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}));

    await expect(getImageFileNames([])).resolves.toEqual({ value: new Map(), complete: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends no CORS origin, having no browser to satisfy', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ entities: {} }));

    await getImageFileNames(['Q1']);

    // The client used to set `origin=*` to make Wikimedia return CORS headers.
    // Server-side there is no preflight to appease, and asking for one would
    // be cargo cult.
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('origin')).toBeNull();
  });
});

describe('getImageInfo', () => {
  it('returns the thumbnail with its attribution', async () => {
    stubFetch(async () => jsonResponse({ query: { pages: [page('Bali Museum.jpg')] } }));

    const images = (await getImageInfo(['Bali Museum.jpg'])).value;

    expect(images.get('Bali Museum.jpg')).toEqual({
      url: 'https://upload.example/Bali Museum.jpg',
      descriptionUrl: 'https://commons.example/File:Bali Museum.jpg',
      author: 'Someone',
      license: 'CC BY-SA 4.0',
    });
  });

  it('falls back to the full-size url when Commons cannot make a thumbnail', async () => {
    stubFetch(async () =>
      jsonResponse({
        query: {
          pages: [
            page('Map.svg', { thumburl: undefined, url: 'https://upload.example/Map.svg' }),
          ],
        },
      }),
    );

    expect((await getImageInfo(['Map.svg'])).value.get('Map.svg')?.url).toBe(
      'https://upload.example/Map.svg',
    );
  });

  it('skips a file Commons will not serve at all', async () => {
    stubFetch(async () =>
      jsonResponse({ query: { pages: [{ title: 'File:Gone.jpg', imageinfo: undefined }] } }),
    );

    await expect(getImageInfo(['Gone.jpg'])).resolves.toEqual({ value: new Map(), complete: true });
  });

  it('omits attribution fields the file has no metadata for', async () => {
    stubFetch(async () =>
      jsonResponse({ query: { pages: [page('A.jpg', { extmetadata: {} })] } }),
    );

    const image = (await getImageInfo(['A.jpg'])).value.get('A.jpg');

    expect(image?.author).toBeUndefined();
    expect(image?.license).toBeUndefined();
  });

  it('requests a card-sized thumbnail', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ query: { pages: [] } }));

    await getImageInfo(['A.jpg']);

    const params = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect(params.get('titles')).toBe('File:A.jpg');
    expect(Number(params.get('iiurlwidth'))).toBeGreaterThan(0);
  });
});

describe('getImages', () => {
  it('resolves both stages into one lookup', async () => {
    stubFetch(async (url) =>
      url.includes('wikidata')
        ? jsonResponse({ entities: { Q1: entity('Bali Museum.jpg') } })
        : jsonResponse({ query: { pages: [page('Bali Museum.jpg')] } }),
    );

    const images = (await getImages(['Q1'])).value;

    expect(images.Q1?.url).toBe('https://upload.example/Bali Museum.jpg');
    expect(images.Q1?.license).toBe('CC BY-SA 4.0');
  });

  it('asks Commons about each file once when entities share a photo', async () => {
    const fetchMock = stubFetch(async (url) =>
      url.includes('wikidata')
        ? jsonResponse({ entities: { Q1: entity('Shared.jpg'), Q2: entity('Shared.jpg') } })
        : jsonResponse({ query: { pages: [page('Shared.jpg')] } }),
    );

    const images = (await getImages(['Q1', 'Q2'])).value;

    expect(Object.keys(images)).toHaveLength(2);
    const commons = fetchMock.mock.calls.find((call) => String(call[0]).includes('commons'));
    expect(new URL(String(commons?.[0])).searchParams.get('titles')).toBe('File:Shared.jpg');
  });

  it('drops an entity whose file Commons does not return', async () => {
    stubFetch(async (url) =>
      url.includes('wikidata')
        ? jsonResponse({ entities: { Q1: entity('Missing.jpg') } })
        : jsonResponse({ query: { pages: [] } }),
    );

    await expect(getImages(['Q1'])).resolves.toMatchObject({ value: {} });
  });
});

describe('when Wikimedia is unavailable', () => {
  it('returns nothing rather than failing the screen', async () => {
    stubFetch(async () => {
      throw new Error('offline');
    });

    await expect(getImages(['Q1'])).resolves.toMatchObject({ value: {} });
  });

  it('treats an error status as no image', async () => {
    stubFetch(async () => jsonResponse({}, 503));

    await expect(getImages(['Q1'])).resolves.toMatchObject({ value: {} });
  });

  it('survives a malformed response', async () => {
    stubFetch(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('not json');
          },
        }) as unknown as Response,
    );

    await expect(getImages(['Q1'])).resolves.toMatchObject({ value: {} });
  });
});

describe('telling "no photograph" apart from "the lookup failed"', () => {
  it('reports a successful lookup as complete', async () => {
    stubFetch(async (url) =>
      url.includes('wikidata')
        ? jsonResponse({ entities: { Q1: { claims: {} } } })
        : jsonResponse({ query: { pages: [] } }),
    );

    // Q1 genuinely has no P18. That is a durable fact the caller may cache.
    await expect(getImages(['Q1'])).resolves.toEqual({ value: {}, complete: true });
  });

  it('reports a failed Wikidata call as incomplete', async () => {
    stubFetch(async (url) => {
      if (url.includes('wikidata')) throw new Error('offline');
      return jsonResponse({ query: { pages: [] } });
    });

    // Identical empty result, entirely different meaning. `wbgetentities`
    // fails a whole batch for one unknown id, so without this a single stale
    // reference would let the caller cache "no photograph" for every other
    // attraction in the request.
    await expect(getImages(['Q1'])).resolves.toEqual({ value: {}, complete: false });
  });

  it('reports a failed Commons call as incomplete', async () => {
    stubFetch(async (url) => {
      if (url.includes('wikidata')) return jsonResponse({ entities: { Q1: entity('A.jpg') } });
      throw new Error('offline');
    });

    await expect(getImages(['Q1'])).resolves.toEqual({ value: {}, complete: false });
  });
});

describe('MediaWiki error bodies', () => {
  it('treats a 200 carrying an error as a failure, not an empty answer', async () => {
    stubFetch(async (url) =>
      url.includes('wikidata')
        ? jsonResponse({ error: { code: 'no-such-entity', info: 'Could not find Q999.' } })
        : jsonResponse({ query: { pages: [] } }),
    );

    // `wbgetentities` fails the whole batch for one unknown id and still
    // answers 200. Reading that as "no entity here has a photograph" is how a
    // single stale id blanks every real attraction beside it.
    await expect(getImages(['Q1'])).resolves.toEqual({ value: {}, complete: false });
  });

  it('treats a Commons error body the same way', async () => {
    stubFetch(async (url) =>
      url.includes('wikidata')
        ? jsonResponse({ entities: { Q1: entity('A.jpg') } })
        : jsonResponse({ error: { code: 'badvalue' } }),
    );

    await expect(getImages(['Q1'])).resolves.toEqual({ value: {}, complete: false });
  });
});
