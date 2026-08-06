import { useEffect, useState } from 'react';

/** How far ahead of the viewport the next page starts loading. */
const ROOT_MARGIN = '300px';

/**
 * Calls `onLoadMore` while the returned sentinel sits in — or just below —
 * the viewport and `enabled` is true.
 *
 * The sentinel is held in state rather than a ref because it does not exist
 * during the first render: the observer has to attach when the element
 * mounts, which a ref object would not tell us about.
 *
 * Re-running on `enabled` and `onLoadMore` is what makes the list keep
 * filling. `IntersectionObserver` only reports *changes*, so a sentinel that
 * stays on screen after a page loads never fires a second time; watching the
 * loading flags instead means the next page starts as soon as the last one
 * lands, until the growing list finally pushes the sentinel out of view.
 */
export function useInfiniteScroll(
  onLoadMore: () => void,
  enabled: boolean,
): (node: HTMLElement | null) => void {
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // No observer in jsdom, and none in a handful of old browsers. The page
    // still works — it just grows by the button instead of by scrolling.
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => setIsVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: ROOT_MARGIN },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel]);

  useEffect(() => {
    if (isVisible && enabled) onLoadMore();
  }, [isVisible, enabled, onLoadMore]);

  return setSentinel;
}
