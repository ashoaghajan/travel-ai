/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile, readTextFile } from './fileTransfer.service';

/**
 * The two things that only work in a browser.
 *
 * jsdom implements neither half of the object-URL API, so both are stubbed —
 * which is convenient, because the thing worth asserting is that the URL is
 * released rather than what it contains.
 */

let created: Blob[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((blob: Blob) => {
      created.push(blob);
      return `blob:test/${created.length}`;
    }),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadTextFile', () => {
  it('clicks an anchor carrying the filename', () => {
    const clicks: HTMLAnchorElement[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function mockClick(this: HTMLAnchorElement) {
        clicks.push(this);
      });

    downloadTextFile('yerevan.trip.json', '{"a":1}');

    expect(click).toHaveBeenCalledTimes(1);
    expect(clicks[0].download).toBe('yerevan.trip.json');
    expect(clicks[0].href).toBe('blob:test/1');
  });

  it('writes the text into a blob of the given type', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    downloadTextFile('yerevan.trip.json', '{"a":1}');

    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('application/json');
    expect(await created[0].text()).toBe('{"a":1}');
  });

  it('leaves nothing behind in the document', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    downloadTextFile('yerevan.trip.json', '{}');

    expect(document.querySelector('a')).toBeNull();
    expect(revoked).toEqual(['blob:test/1']);
  });

  it('releases the blob even when the click fails', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });

    // An object URL holds its blob in memory until it is revoked, so a download
    // the browser refuses must not also leak the file.
    expect(() => downloadTextFile('yerevan.trip.json', '{}')).toThrow('blocked');
    expect(revoked).toEqual(['blob:test/1']);
    expect(document.querySelector('a')).toBeNull();
  });
});

describe('readTextFile', () => {
  it('reads the file back as text', async () => {
    const file = new File(['{"kind":"ai-travel.trip"}'], 'yerevan.trip.json', {
      type: 'application/json',
    });

    await expect(readTextFile(file)).resolves.toBe('{"kind":"ai-travel.trip"}');
  });
});
