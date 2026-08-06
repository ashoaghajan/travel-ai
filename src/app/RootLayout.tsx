import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useMatches } from 'react-router-dom';
import styles from './RootLayout.module.css';

const APP_NAME = 'AI Travel Planner';

/** Route metadata used for the document title and the route announcement. */
export type RouteHandle = {
  title?: string;
};

function useRouteTitle(): string {
  const matches = useMatches();

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index].handle as RouteHandle | undefined;
    if (handle?.title) return handle.title;
  }

  return APP_NAME;
}

/**
 * App frame shared by every route.
 *
 * Single-page navigation does not move focus, retitle the document or tell a
 * screen reader anything happened — this puts all three back, plus the
 * skip link that keyboard users need to get past the navigation.
 */
export function RootLayout() {
  const title = useRouteTitle();
  const { pathname } = useLocation();
  const [announcement, setAnnouncement] = useState('');
  const isFirstRender = useRef(true);

  useEffect(() => {
    document.title = title === APP_NAME ? APP_NAME : `${title} · ${APP_NAME}`;

    // Don't steal focus or announce on the initial load.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    setAnnouncement(`${title} page`);
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [title, pathname]);

  return (
    <>
      <a href="#main-content" className={styles.skipLink}>
        Skip to main content
      </a>

      <Outlet />

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
