import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../app/routes';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { authStore } from '../../store/auth.store';
import { Avatar } from '../common/Avatar';
import { SignOutIcon } from '../common/icons';
import styles from './AccountMenu.module.css';

/**
 * The avatar in the page header, and the account actions behind it.
 *
 * Sign-out used to sit exposed at the bottom of the sidebar. It is a rare,
 * destructive-feeling action, so it belongs one deliberate click away under
 * the avatar — where the convention puts it — rather than permanently on
 * screen next to the navigation.
 *
 * Sign-out is the only item today. The menu is still built as a real ARIA
 * menu so adding theme, language or shortcuts later is a new `<li>`, not a
 * rewrite.
 */
export function AccountMenu() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Opening with the keyboard has to land somewhere, and the only sensible
  // landing spot is the first item.
  useEffect(() => {
    if (isOpen) firstItemRef.current?.focus();
  }, [isOpen]);

  // A click anywhere else is a dismissal.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  if (!user) return null;

  function close({ restoreFocus }: { restoreFocus: boolean }) {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  async function signOut() {
    setIsSigningOut(true);

    // `signOut` clears the local session even if the request fails, so there
    // is no failure mode that should keep the user in the app.
    await authStore.signOut();
    navigate(ROUTES.login, { replace: true });
  }

  return (
    <div
      className={styles.root}
      ref={rootRef}
      // Escape closes from anywhere inside, including the focused menu item.
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.preventDefault();
          close({ restoreFocus: true });
        }
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={`Account: ${user.name}`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Avatar name={user.name} />
      </button>

      {isOpen ? (
        <div className={styles.menu} id={menuId} role="menu" aria-label="Account">
          <div className={styles.identity}>
            <Avatar name={user.name} size="sm" />
            <div className={styles.identityText}>
              <p className={styles.name}>{user.name}</p>
              <p className={styles.email}>{user.email}</p>
            </div>
          </div>

          <hr className={styles.divider} />

          <button
            type="button"
            ref={firstItemRef}
            role="menuitem"
            className={styles.item}
            disabled={isSigningOut}
            onClick={signOut}
          >
            <span className={styles.itemIcon}>
              <SignOutIcon size={18} />
            </span>
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
