/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccountMenu } from './AccountMenu';

const user = { id: 'u1', name: 'Ashot Aghajanyan', email: 'ashot@example.com' };

const currentUser = vi.hoisted(() => ({ value: null as typeof user | null }));
const signOut = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: currentUser.value,
    isAuthenticated: currentUser.value !== null,
    isLoading: false,
  }),
}));

vi.mock('../../store/auth.store', () => ({
  authStore: { signOut },
}));

function renderMenu() {
  return render(
    <MemoryRouter>
      <AccountMenu />
    </MemoryRouter>,
  );
}

describe('AccountMenu', () => {
  beforeEach(() => {
    currentUser.value = user;
    signOut.mockReset().mockResolvedValue(undefined);
  });

  it('renders nothing when nobody is signed in', () => {
    currentUser.value = null;
    const { container } = renderMenu();

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps sign out behind the avatar until it is clicked', async () => {
    renderMenu();

    expect(screen.queryByRole('menuitem', { name: /sign out/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `Account: ${user.name}` }));

    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByText(user.email)).toBeInTheDocument();
  });

  it('signs out when the menu item is chosen', async () => {
    renderMenu();

    await userEvent.click(screen.getByRole('button', { name: `Account: ${user.name}` }));
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and returns focus to the avatar', async () => {
    renderMenu();

    const trigger = screen.getByRole('button', { name: `Account: ${user.name}` });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menuitem', { name: /sign out/i })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes when a click lands outside', async () => {
    renderMenu();

    await userEvent.click(screen.getByRole('button', { name: `Account: ${user.name}` }));
    await userEvent.click(document.body);

    expect(screen.queryByRole('menuitem', { name: /sign out/i })).not.toBeInTheDocument();
  });
});
