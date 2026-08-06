/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FederatedSignIn } from './FederatedSignIn';

/**
 * What the sign-in screens show when Google is, and is not, configured.
 *
 * The unconfigured case is the one that regressed: the button disappeared with
 * no trace anywhere, which is indistinguishable from it never having been
 * built. These pin that development always says something.
 */

function renderIt() {
  render(
    <MemoryRouter>
      <FederatedSignIn text="signin_with" />
    </MemoryRouter>,
  );
}

const HINT = /Google sign-in is off/;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('with no client id', () => {
  it('explains the absence in development', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    vi.stubEnv('DEV', true);

    renderIt();

    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(screen.getByText(HINT).textContent).toContain('VITE_GOOGLE_CLIENT_ID');
  });

  // A note aimed at whoever is running the dev server has no business on a
  // page a real user is looking at.
  it('renders nothing at all in a build', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    vi.stubEnv('DEV', false);

    const { container } = render(
      <MemoryRouter>
        <FederatedSignIn text="signin_with" />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  // A lone "or" above the email form, with nothing above it, is worse than no
  // divider at all.
  it('never leaves the divider stranded', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    vi.stubEnv('DEV', true);

    renderIt();

    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });
});

describe('with a client id', () => {
  it('drops the hint and shows the divider', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'abc.apps.googleusercontent.com');
    vi.stubEnv('DEV', true);

    renderIt();

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    expect(screen.getByText('or')).toBeInTheDocument();
  });
});
