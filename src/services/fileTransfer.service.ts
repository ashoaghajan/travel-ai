/**
 * Handing a file to the browser, and taking one back.
 *
 * No React component may import this file.
 *
 * Deliberately knows nothing about trips. These are the two DOM manoeuvres a
 * download and an upload need — an object URL behind a synthetic click, and a
 * `File` read as text — and keeping them here means the trip format can be
 * tested as pure functions and the awkward part can be tested on its own.
 */

/**
 * Saves `text` as a file called `filename`.
 *
 * There is no browser API for "save this string"; the way to do it is to point
 * an anchor at an object URL and click it. The details are all load-bearing:
 * the anchor is attached to the document because Firefox ignores a click on a
 * detached one, and the URL is revoked in a `finally` because an object URL
 * holds its blob in memory until it is released or the page goes away.
 */
export function downloadTextFile(
  filename: string,
  text: string,
  type = 'application/json',
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

/** The contents of a file the reader picked. Rejects if it cannot be read. */
export function readTextFile(file: File): Promise<string> {
  return file.text();
}
