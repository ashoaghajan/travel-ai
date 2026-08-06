/**
 * The Google Identity Services script, and the shape of the bit we use.
 *
 * GIS is loaded from `accounts.google.com` at runtime — the app's only
 * third-party script, and unavoidable: the button has to be Google's own, both
 * because their branding terms require it and because only their code can mint
 * a credential.
 */

/** Only the members we call; GIS exposes a great deal more. */
type GoogleIdentityServices = {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }) => void;
      renderButton: (
        parent: HTMLElement,
        options: {
          type?: 'standard' | 'icon';
          theme?: 'outline' | 'filled_blue' | 'filled_black';
          size?: 'small' | 'medium' | 'large';
          text?: 'signin_with' | 'signup_with' | 'continue_with';
          shape?: 'rectangular' | 'pill';
          width?: number;
          logo_alignment?: 'left' | 'center';
        },
      ) => void;
      disableAutoSelect: () => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

export type { GoogleIdentityServices };

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

/**
 * The client id, or null when Google sign-in has not been set up.
 *
 * Public by design — it is compiled into the bundle, and verification only
 * uses it as the audience. There is no client secret in this flow.
 */
export function googleClientId(): string | null {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || null;
}

let loading: Promise<GoogleIdentityServices> | null = null;

/**
 * Load GIS once, however many buttons ask for it.
 *
 * Two sign-in buttons on one page, or a remount, must not add a second script
 * tag — so the promise is cached rather than the fact of having started.
 */
export function loadGoogleIdentityServices(): Promise<GoogleIdentityServices> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);

  loading ??= new Promise<GoogleIdentityServices>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement('script');

    function settle() {
      if (window.google?.accounts?.id) resolve(window.google);
      else reject(new Error('Google Identity Services loaded but exposed no client.'));
    }

    script.addEventListener('load', settle, { once: true });
    script.addEventListener(
      'error',
      () => {
        // Let a later attempt retry — a blocked or flaky first load should not
        // disable the button for the rest of the session.
        loading = null;
        reject(new Error('Could not load Google Identity Services.'));
      },
      { once: true },
    );

    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  });

  return loading;
}
