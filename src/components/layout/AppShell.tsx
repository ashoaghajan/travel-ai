import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../navigation/Sidebar';
import { BottomNavigation } from '../navigation/BottomNavigation';
import { LobbyPanel } from '../../features/lobby/components/LobbyPanel';
import { useLobbyConnection } from '../../features/lobby/useLobbyConnection';
import styles from './AppShell.module.css';

/**
 * Dashboard shell (DESIGN_SPEC §7): 280px sidebar plus scrolling main region
 * on desktop; below 1024px the sidebar is hidden and bottom navigation takes
 * over. Used as a layout route so the chrome survives navigation.
 */
export function AppShell() {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // Held here rather than in the panel, so the room stays connected — and the
  // unread badge stays truthful — while the panel is collapsed.
  useLobbyConnection();

  // `main` scrolls, not the document, so React Router's scroll restoration
  // does not apply — without this a new page opens at the old scroll offset.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className={styles.shell}>
      <Sidebar className={styles.sidebar} />
      <main id="main-content" ref={mainRef} tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
      {/*
        Mounted here rather than per page so the room survives navigation —
        and, because this shell is inside `RequireAuth`, so that it never
        exists for a signed-out visitor.
      */}
      <LobbyPanel />
      <BottomNavigation className={styles.bottomNav} />
    </div>
  );
}
