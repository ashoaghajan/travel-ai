/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * OpenTripMap API key. Supplied through `.env.local`, never hard-coded.
   *
   * Like every `VITE_`-prefixed variable this is inlined into the client
   * bundle at build time, so it is not a secret in production — Stage 2 should
   * proxy these calls through the backend.
   */
  readonly VITE_OPENTRIPMAP_API_KEY?: string;

  /**
   * Affiliate tracking ids for the booking partners, appended to the outbound
   * links built in `partner.links.ts`. All optional: an unset id simply means
   * the link goes out untracked, which is the Stage 1 default.
   */
  readonly VITE_EXPEDIA_AFFILIATE_ID?: string;
  readonly VITE_BOOKING_AFFILIATE_ID?: string;
  readonly VITE_TRIP_AFFILIATE_ID?: string;
  readonly VITE_GETYOURGUIDE_AFFILIATE_ID?: string;

  /**
   * Google OAuth web client id, for the Sign in with Google button.
   *
   * Public by design and safe to ship in the bundle: it names which app a
   * credential was minted for, and the server checks it as the audience. The
   * client *secret* is not part of this flow at all.
   *
   * Unset simply means no Google button — the app works exactly as it did.
   */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
