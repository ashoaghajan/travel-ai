import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../../../components/common/IconButton';
import { CloseIcon } from '../../../components/common/icons';
import { messagesStore, useMessages } from '../../../store/messages.store';
import { groupConversations } from '../conversation.filters';
import { useIsDesktop } from '../useIsDesktop';
import { useMessagesList } from '../useMessagesList';
import { ConversationList } from './ConversationList';
import { MessageThread } from './MessageThread';
import styles from './MessagesPanel.module.css';

/**
 * Private conversations, in whichever container the screen has room for.
 *
 * Mounted once by `AppShell`, so it survives navigation and never exists for a
 * signed-out visitor. Its open state lives in the store rather than here,
 * because the button that toggles it is in `PageHeader` and remounts on every
 * page — two components that cannot share React state.
 *
 * **Desktop is two panes side by side**, in a third grid column: the people on
 * the left, the conversation on the right, and picking somebody changes only
 * the right-hand side. **Below the breakpoint there is room for one**, so the
 * same two views become a drill-down — the list, then the conversation behind a
 * back arrow. That is the whole difference between the two layouts, and it is
 * why `activeUserId` lives in the store rather than being a route.
 *
 * The small container is a modal `<dialog>`, the pattern the rest of the app
 * already uses, which brings Escape, the focus trap and the backdrop from the
 * browser — and which is allowed to cover the bottom navigation, because it is
 * a whole screen and you close it to navigate. A fixed panel would cover that
 * bar permanently, which is why this is not one.
 */
export function MessagesPanel() {
  const { isOpen } = useMessages();
  const isDesktop = useIsDesktop();

  useMessagesList();

  if (!isOpen) return null;

  if (isDesktop) {
    return (
      <aside className={styles.column} aria-label="Messages">
        <PanelBody isDesktop onClose={() => messagesStore.close()} />
      </aside>
    );
  }

  return <MessagesDialog />;
}

/** The small-screen shape: a full-screen modal, portalled out of the grid. */
function MessagesDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => messagesStore.close();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected || dialog.open) return;

    dialog.showModal();
    return () => dialog.close();
  }, []);

  // Into the body: a modal dialog is in the browser's top layer and has no
  // business claiming a cell in the shell's grid.
  return createPortal(
    <dialog ref={dialogRef} className={styles.dialog} aria-label="Messages" onCancel={close}>
      <PanelBody isDesktop={false} onClose={close} />
    </dialog>,
    document.body,
  );
}

/**
 * The contents, in one pane or two.
 *
 * Split from the container because the container is the part that differs by
 * screen, and this is the part that only has to know how many panes it is
 * allowed to draw.
 */
function PanelBody({ isDesktop, onClose }: { isDesktop: boolean; onClose: () => void }) {
  const { conversations, onlineIds, activeUserId, connection, directory } = useMessages();

  const list = groupConversations(conversations, onlineIds);
  const active = activeUserId ? list.find((entry) => entry.id === activeUserId) : undefined;

  const thread = (
    <MessageThread
      userId={activeUserId}
      /*
       * The name from the list rather than from the messages: somebody with no
       * messages yet still has to be named in the header, and a name taken
       * from a message would freeze at whatever it was when they sent it.
       */
      name={active?.name ?? ''}
      isOnline={active?.isOnline ?? false}
      onBack={isDesktop ? undefined : () => messagesStore.closeThread()}
      onClose={isDesktop ? undefined : onClose}
    />
  );

  // One pane, showing the conversation that was picked.
  if (!isDesktop && activeUserId) return <div className={styles.body}>{thread}</div>;

  return (
    <div className={styles.body}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Messages</h2>
          {/*
            Only mentions the connection when there is something the reader
            would otherwise be confused by — a panel that has quietly stopped
            updating looks exactly like one where nobody is talking.
          */}
          <p className={styles.subtitle}>
            {connection === 'online' || connection === 'idle' ? (
              'Private, one to one'
            ) : connection === 'connecting' ? (
              'Connecting…'
            ) : (
              <span className={styles.stale}>Not live — reopen to refresh</span>
            )}
          </p>
        </div>

        <IconButton label="Close messages" onClick={onClose}>
          <CloseIcon size={20} />
        </IconButton>
      </header>

      <div className={isDesktop ? styles.panes : styles.pane}>
        <ConversationList
          conversations={list}
          activeUserId={activeUserId}
          status={directory}
          onSelect={(userId) => void messagesStore.openThread(userId)}
        />

        {isDesktop ? thread : null}
      </div>
    </div>
  );
}
