import { afterEach, describe, expect, it, vi } from 'vitest';
import { toPlainText, wikimediaService } from './wikimedia.service';

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

    await expect(wikimediaService.getImageFileNames(['Q1', 'Q2'])).resolves.toEqual(
      new Map([
        ['Q1', 'Bali Museum.jpg'],
        ['Q2', 'Sanur.jpg'],
      ]),
    );
  });

  it('leaves out entities with no image claim', async () => {
    stubFetch(async () => jsonResponse({ entities: { Q1: entity('A.jpg'), Q2: { claims: {} } } }));

    const files = await wikimediaService.getImageFileNames(['Q1', 'Q2']);

    expect(files.has('Q2')).toBe(false);
  });

  it('asks for no more than fifty ids per request', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ entities: {} }));
    const ids = Array.from({ length: 120 }, (_, index) => `Q${index}`);

    await wikimediaService.getImageFileNames(ids);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const requested = new URL(String(call[0])).searchParams.get('ids')?.split('|') ?? [];
      expect(requested.length).toBeLessThanOrEqual(50);
    }
  });

  it('makes no request for an empty list', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}));

    await expect(wikimediaService.getImageFileNames([])).resolves.toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks Wikimedia to send CORS headers', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ entities: {} }));

    await wikimediaService.getImageFileNames(['Q1']);

    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('origin')).toBe('*');
  });
});

describe('getImageInfo', () => {
  it('returns the thumbnail with its attribution', async () => {
    stubFetch(async () => jsonResponse({ query: { pages: [page('Bali Museum.jpg')] } }));

    const images = await wikimediaService.getImageInfo(['Bali Museum.jpg']);

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

    expect((await wikimediaService.getImageInfo(['Map.svg'])).get('Map.svg')?.url).toBe(
      'https://upload.example/Map.svg',
    );
  });

  it('skips a file Commons will not serve at all', async () => {
    stubFetch(async () =>
      jsonResponse({ query: { pages: [{ title: 'File:Gone.jpg', imageinfo: undefined }] } }),
    );

    await expect(wikimediaService.getImageInfo(['Gone.jpg'])).resolves.toEqual(new Map());
  });

  it('omits attribution fields the file has no metadata for', async () => {
    stubFetch(async () =>
      jsonResponse({ query: { pages: [page('A.jpg', { extmetadata: {} })] } }),
    );

    const image = (await wikimediaService.getImageInfo(['A.jpg'])).get('A.jpg');

    expect(image?.author).toBeUndefined();
    expect(image?.license).toBeUndefined();
  });

  it('requests a card-sized thumbnail', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ query: { pages: [] } }));

    await wikimediaService.getImageInfo(['A.jpg']);

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

    const images = await wikimediaService.getImages(['Q1']);

    expect(images.get('Q1')?.url).toBe('https://upload.example/Bali Museum.jpg');
    expect(images.get('Q1')?.license).toBe('CC BY-SA 4.0');
  });

  it('asks Commons about each file once when entities share a photo', async () => {
    const fetchMock = stubFetch(async (url) =>
      url.includes('wikidata')
        ? jsonResponse({ entities: { Q1: entity('Shared.jpg'), Q2: entity('Shared.jpg') } })
        : jsonResponse({ query: { pages: [page('Shared.jpg')] } }),
    );

    const images = await wikimediaService.getImages(['Q1', 'Q2']);

    expect(images.size).toBe(2);
    const commons = fetchMock.mock.calls.find((call) => String(call[0]).includes('commons'));
    expect(new URL(String(commons?.[0])).searchParams.get('titles')).toBe('File:Shared.jpg');
  });

  it('drops an entity whose file Commons does not return', async () => {
    stubFetch(async (url) =>
      url.includes('wikidata')
        ? jsonResponse({ entities: { Q1: entity('Missing.jpg') } })
        : jsonResponse({ query: { pages: [] } }),
    );

    await expect(wikimediaService.getImages(['Q1'])).resolves.toEqual(new Map());
  });
});

describe('when Wikimedia is unavailable', () => {
  it('returns nothing rather than failing the screen', async () => {
    stubFetch(async () => {
      throw new Error('offline');
    });

    await expect(wikimediaService.getImages(['Q1'])).resolves.toEqual(new Map());
  });

  it('treats an error status as no image', async () => {
    stubFetch(async () => jsonResponse({}, 503));

    await expect(wikimediaService.getImages(['Q1'])).resolves.toEqual(new Map());
  });

  it('survives a malformed response', async () => {
    stubFetch(async () => {
      const response = jsonResponse({});
      response.json = async () => {
        throw new Error('not json');
      };
      return response;
    });

    await expect(wikimediaService.getImages(['Q1'])).resolves.toEqual(new Map());
  });
});
