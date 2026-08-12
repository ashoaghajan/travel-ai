import { useEffect, useState } from 'react';

/** The one breakpoint this app has — see `AppShell.module.css`. */
const DESKTOP = '(min-width: 1024px)';

/**
 * Whether there is room for a third column.
 *
 * The panel cannot answer this in CSS alone: below the breakpoint it is a
 * native `<dialog>` opened with `showModal()`, and that is an imperative call
 * with no declarative equivalent. So the layout question has to be answered in
 * JavaScript and the component renders one of two containers.
 *
 * `matchMedia` is missing in some test environments and in SSR, where the
 * honest answer is "not desktop" rather than a crash.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => matches());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(DESKTOP);
    const update = () => setIsDesktop(query.matches);

    update();
    query.addEventListener('change', update);

    return () => query.removeEventListener('change', update);
  }, []);

  return isDesktop;
}

function matches(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;

  return window.matchMedia(DESKTOP).matches;
}
