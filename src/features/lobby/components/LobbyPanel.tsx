import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { lobbyStore, useLobby } from '../../../store/lobby.store';
import { useIsDesktop } from '../useLobbyPanel';
import { useLobbyRoom } from '../useLobbyRoom';
import { LobbyRoom } from './LobbyRoom';
import styles from './LobbyPanel.module.css';

/**
 * The lobby, in whichever container the screen has room for.
 *
 * Mounted once by `AppShell`, so it survives navigation and never exists for a
 * signed-out visitor. Its open state lives in the store rather than here,
 * because the button that toggles it is in `PageHeader` and remounts on every
 * page — two components that cannot share React state.
 *
 * Desktop is a third grid column: `main` narrows and nothing is covered.
 * Below the breakpoint it is a modal `<dialog>`, the pattern the rest of the
 * app already uses, which brings Escape, the focus trap and the backdrop from
 * the browser — and which is allowed to cover the bottom navigation, because
 * it is a whole screen and you close it to navigate. A fixed panel would cover
 * that bar permanently, which is why this is not one.
 */
export function LobbyPanel() {
  const { isOpen } = useLobby();
  const isDesktop = useIsDesktop();

  useLobbyRoom();

  if (!isOpen) return null;

  if (isDesktop) {
    return (
      <aside className={styles.column} aria-label="Lobby">
        <LobbyRoom onClose={() => lobbyStore.close()} />
      </aside>
    );
  }

  return <LobbyDialog onClose={() => lobbyStore.close()} />;
}

/** The phone shape: a full-screen modal, portalled out of the grid. */
function LobbyDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected || dialog.open) return;

    dialog.showModal();
    return () => dialog.close();
  }, []);

  // Into the body: a modal dialog is in the browser's top layer and has no
  // business claiming a cell in the shell's grid.
  return createPortal(
    <dialog ref={dialogRef} className={styles.dialog} aria-label="Lobby" onCancel={onClose}>
      <LobbyRoom onClose={onClose} />
    </dialog>,
    document.body,
  );
}
