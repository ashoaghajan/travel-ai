# Stage 2 — API & Database Integration Plan

**Status:** phases 0–2 built; phases 3–7 outstanding
**Audience:** the execution agent implementing this
**Sources of truth:** `README.md` §"Stage 2" (L527–674), `DESIGN_SPEC.md`, `MVP_AUDIT.md`

## What was actually built, and where it departed from this plan

Phases 0, 1 and 2 are done. Accounts are real; trips are still in localStorage,
which is exactly the ship state phase 2 describes. Four deviations, all
deliberate:

1. **Phase 0 was scoped down.** Only `api.types.ts` and `error-codes.ts` went
   into `shared/`; the domain types stayed in `src/types/` with no re-export
   shims, because auth needed none of them. The full type move is still owed
   whenever phase 4 wants it. No `docker-compose.yml` — see below.
2. **SQLite, not Postgres.** No Postgres was installed and the Docker daemon
   was not running. The schema avoids `enum` and every `@db.*` native type, so
   the move is a provider swap plus a fresh migration. Prisma's `Json` works on
   SQLite (stored as TEXT, not filterable), which is what phase 4's itinerary
   needs.
3. **Prisma 7 changed the shape of phase 1.** The connection URL is no longer
   allowed in `schema.prisma`; it lives in `prisma.config.ts`, and the runtime
   client takes a driver adapter (`@prisma/adapter-better-sqlite3`).
4. **Login and registration are rate-limited.** This plan throttles only
   `/api/explore/*` and `/api/reference/*`, which left credential stuffing
   unmetered on the one endpoint where guessing pays. Limits are per address
   and per account, and only failures count.

Also: `@node-rs/argon2` rather than `argon2`, to avoid a node-gyp build; the
API listens on **3001** because another project holds 3000; and the toast
system named in phase 2 was **not** built — the auth screens use the same
inline `role="alert"` messages as the rest of the app, so it is still owed.

**Risk #24 is resolved:** guest mode is retired. Every `AppShell` route
requires an account.

**Added beyond this plan: Sign in with Google.** Google Identity Services ID
tokens, verified server-side with `google-auth-library` and exchanged for our
own session, plus `AuthIdentity` (keyed on the provider's `sub`) and a nullable
`User.passwordHash`. A Google sign-in whose email already belongs to a password
account is **refused rather than linked** — auto-linking is only safe once
password signups are email-verified, which they are not — so the profile screen
gained a Connect/Disconnect control for doing it deliberately. Optional
throughout: with no client id the button is absent and the endpoints answer
`PROVIDER_NOT_CONFIGURED`.

Because trips remain local while accounts are real, `src/services/localData.service.ts`
swaps the *contents* of the storage keys at sign-in rather than namespacing the
keys themselves — the module-level caches in `trip.store.ts` capture their key
at import and would never see a key that changed. Phase 4 replaces it.

---

## Context

The app is a Stage 1, frontend-only React 19 + Vite SPA (~15.5k LOC). All user data lives in
`localStorage`; flights, hotels, partners, the "AI" planner and the current user are mock data.
`README.md` already specifies the target — Node + Express + PostgreSQL + Prisma + JWT — and names
the endpoints. This plan turns that into ordered, executable work.

**The codebase was built for this migration and is in unusually good shape for it:**

- `src/services/localStorage.service.ts` is the *only* module that touches `window.localStorage`.
- **Zero components read storage directly** (verified by grep — only doc comments mention it).
- Domain services are already `async` and endpoint-shaped, each with a docblock naming its
  future endpoint.
- `editTrip.ts:toPatch()` is already documented as "the body of a `PATCH /api/trips/:id`".
- `utils/id.ts` says outright: *"Stage 2 will get ids from the database."*

**The one real refactor is the synchronous assumption.** `src/store/trip.store.ts` and
`savedActivity.store.ts` build their `useSyncExternalStore` snapshot from a *synchronous*
localStorage read (`readTripsSync`, `readActiveTripId`, `readSavedSync`). HTTP cannot serve a
synchronous first paint. Everything else is additive.

Secondary gaps: there is no auth boundary (`src/mock/user.ts` `CURRENT_USER` is imported straight
into `PlannerPage.tsx:7` and `ProfilePage.tsx:11`), and `VITE_OPENTRIPMAP_API_KEY` is inlined into
the client bundle.

**Confirmed decisions:** backend + frontend wiring · Express/Postgres/Prisma/JWT as specified ·
full auth now · one-time import of localStorage data on first login.

---

## 1. Repo layout — npm workspaces, frontend stays at the root

Moving the Vite app into `apps/web/` would rewrite both tsconfigs, `vite.config.ts`, the coverage
globs, `index.html` and every tool path for zero functional gain.

```
/                        # workspace root AND the web app package
  package.json           # + "workspaces": ["shared", "server"]
  vite.config.ts         # + resolve.alias + server.proxy
  tsconfig.json          # + { "path": "./shared" }, { "path": "./server" }
  docker-compose.yml     # NEW: postgres:17 for local dev
  src/                   # unchanged frontend
  shared/                # NEW: the client/server contract
  server/                # NEW: Express + Prisma
```

A root package that is also the workspace root is valid npm and is the lowest-churn option.

### Sharing types without duplication

`src/types/*.ts` is already the contract. Move the **bodies** to `shared/`, leave re-export shims
behind — 4 files touched instead of ~60 import statements.

```ts
// src/types/trip.types.ts
export * from '@ai-travel/shared/trip.types';
```

```
shared/src/
  index.ts            # types only — NO zod (see gotcha #20)
  trip.types.ts  travel.types.ts  planner.types.ts  settings.types.ts   # moved verbatim
  reference.types.ts  # Country, ActivitiesResult, SavedActivity (today inside services)
  api.types.ts        # TripPatch + request/response DTOs
  error-codes.ts      # const object (NOT a TS enum — erasableSyntaxOnly is on)
  schemas/            # zod — SEPARATE export path so it never reaches the client bundle
```

Wiring:

```ts
// vite.config.ts
resolve: { alias: { '@ai-travel/shared': path.resolve(__dirname, 'shared/src') } },
server:  { proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } } },
```

The dev proxy makes the API **same-origin**, which is what makes httpOnly cookies painless (§5).

---

## 2. Prisma schema — itinerary is **JSONB**, not relational tables

This is the plan's biggest call, and it goes against the reflex. The reasoning:

1. **`toPatch()` already sends whole-itinerary replacement.** `editTrip.ts:159` does
   `if (JSON.stringify(clean.itinerary) !== JSON.stringify(trip.itinerary)) patch.itinerary = …`.
   Relational storage turns every trip edit into a three-way diff/upsert/delete across two child
   tables. JSONB makes it one `UPDATE`.
2. **Nothing ever queries inside the itinerary.** Days and activities are only ever read as part
   of a whole trip. No cross-trip activity search, no per-activity index, no join.
3. **The nested ids are already client-generated and stable** (`act_<uuid>` from
   `toItineraryActivity` and `editTrip.addActivity`). There is no server identity to preserve.
4. **`addActivityToDay` is not a counter-argument.** Its ordering and duplicate rules already
   exist as pure logic in `trip.service.ts:137-171` — lift it verbatim and run it inside a
   transaction with `SELECT … FOR UPDATE`. That is ~10 lines.

| Cost | Mitigation |
|---|---|
| No referential integrity inside the itinerary | zod-validate `ItineraryDay[]` on every write, shared by POST and PATCH |
| Lost updates from two tabs | `version Int` + optimistic concurrency; `addActivityToDay` takes a row lock |
| Harder to go relational later | Keep the JSON byte-identical to `ItineraryDay[]` so a backfill is a mechanical `jsonb_array_elements` |

Revisit only if a real AI provider needs to mutate individual activities server-side, or you add
cross-trip activity analytics.

```prisma
generator client { provider = "prisma-client-js" }
datasource db    { provider = "postgresql"; url = env("DATABASE_URL") }

enum ActivityCategory { food nature culture adventure relaxation travel }
enum ThemePreference  { system light dark }
enum ChatAuthor       { user ai }
enum SearchKind       { flight }

model User {
  id                     String    @id @default(uuid())
  email                  String
  emailKey               String    @unique          // lower(trim(email))
  name                   String
  passwordHash           String
  localImportCompletedAt DateTime?                   // the one-time-import marker (§7)
  // SetNull preserves tripService.deleteTrip's invariant: never leave the
  // pointer aimed at a trip that no longer exists.
  activeTripId           String?
  activeTrip             Trip?     @relation("ActiveTrip", fields: [activeTripId], references: [id], onDelete: SetNull)
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt

  trips           Trip[]          @relation("OwnedTrips")
  savedActivities SavedActivity[]
  refreshTokens   RefreshToken[]
  settings        UserSettings?
  recentSearches  RecentSearch[]
  conversations   Conversation[]
}

model Trip {
  id                 String   @id                    // client-format id — see §3
  userId             String
  user               User     @relation("OwnedTrips", fields: [userId], references: [id], onDelete: Cascade)
  draftId            String?                         // idempotency key; NULLs are distinct in PG
  title              String
  destination        String
  destinationCountry String?
  destinationCity    String?
  startDate          String                          // 'YYYY-MM-DD' STRING — gotcha #4
  endDate            String
  travellers         Int
  coverImage         String
  itinerary          Json                            // ItineraryDay[], zod-validated on write
  flightsEstimate    Float?
  hotelsEstimate     Float?
  activitiesEstimate Float?
  version            Int      @default(0)            // optimistic concurrency for PATCH
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  activeFor User[] @relation("ActiveTrip")

  @@unique([userId, draftId])
  @@index([userId, createdAt(sort: Desc)])
}

model SavedActivity {
  id         String           @id @default(uuid())
  userId     String
  user       User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  activityId String                                   // Activity.id = OpenTripMap xid
  category   ActivityCategory                         // promoted out of the payload for SQL filtering
  title      String
  activity   Json                                     // the whole Activity — see the service docblock
  savedAt    DateTime         @default(now())

  @@unique([userId, activityId])
  @@index([userId, savedAt(sort: Desc)])
}

model RefreshToken {
  id           String    @id @default(uuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash    String    @unique                      // sha256; the raw token only lives in the cookie
  familyId     String                                 // rotation family for reuse detection
  expiresAt    DateTime
  revokedAt    DateTime?
  replacedById String?
  userAgent    String?
  ip           String?
  createdAt    DateTime  @default(now())

  @@index([userId])
  @@index([familyId])
}

model UserSettings {
  userId        String          @id
  user          User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  theme         ThemePreference @default(system)
  tripReminders Boolean         @default(true)
  priceAlerts   Boolean         @default(false)
  updatedAt     DateTime        @updatedAt
}

model RecentSearch {
  id          String     @id @default(uuid())
  userId      String
  user        User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind        SearchKind @default(flight)
  query       Json                                    // FlightSearchQuery
  fingerprint String                                  // server-side form of isSameFlightSearch()
  searchedAt  DateTime   @default(now())

  @@unique([userId, kind, fingerprint])
  @@index([userId, searchedAt(sort: Desc)])
}

model Conversation {
  id        String        @id
  userId    String
  user      User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String?
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  messages  ChatMessage[]

  @@index([userId, updatedAt(sort: Desc)])
}

model ChatMessage {
  id             String       @id
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  author         ChatAuthor
  content        String
  tripDraft      Json?                                // the TripDraft on an AI turn
  position       Int                                  // deterministic order for a whole-list PUT
  createdAt      DateTime     @default(now())

  @@unique([conversationId, position])
}
```

`UserSettings` uses **columns, not JSON** — the shape is tiny and fixed and the enum validates for
free. `RecentSearch.query` and `SavedActivity.activity` are JSON because they mirror
provider-shaped payloads that will change. Estimates are `Float?` not `Decimal` — `Prisma.Decimal`
serialises to an object and would force a mapper for what are display estimates, not money.

---

## 3. Id strategy — **keep the client-generated id format as the PK**

`String @id` with no `@default`.

1. **Migration needs zero remapping.** Local `trip_abc` stays `trip_abc`, so `activeTripId` still
   resolves, bookmarked `/trips/trip_abc` URLs still work, and `usePlanner`'s `draftId → tripId`
   map (`usePlanner.ts:64-75`) still holds. This alone decides it.
2. **Idempotency becomes a database guarantee** via `@@unique([userId, draftId])` — a real upsert
   instead of a read-then-write race.
3. `createId()` uses `crypto.randomUUID()`; collision risk is nil.

**But `POST /api/trips` receives a `TripDraft`, which by definition has no `id`.** So:

- **Normal creates:** the server mints `trip_<uuid>` — same format, server-controlled.
  `TripDraft` and `plannerService`'s output shape are untouched.
- **Migration only:** `POST /api/migrate/local` accepts caller-supplied ids.

Every query still filters by `userId`; a globally-unique id never grants cross-user access. On the
theoretical cross-user PK collision (`P2002`), the server re-mints and reports the mapping in
`remappedTripIds` — the client already renders from the response, so it is invisible.

```ts
const clientId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9-]{8,64}$`), `Expected a ${prefix} id`);
```

---

## 4. Endpoint surface

Every error: `{ "error": { "code": "TRIP_NOT_FOUND", "message": "…", "details": null } }`.
HTTP status carries the class; `code` carries the meaning. Codes live in
`shared/src/error-codes.ts` and are what the client maps back to its existing error classes.

### Auth
| Method | Path | Body → Response |
|---|---|---|
| POST | `/api/auth/register` | `{name,email,password}` → `201 {user, accessToken, expiresIn}` + `Set-Cookie: rt=…` |
| POST | `/api/auth/login` | `{email,password}` → `200 {user, accessToken, expiresIn}` + cookie |
| POST | `/api/auth/refresh` | — (cookie) → `200 {accessToken, expiresIn}` + rotated cookie |
| POST | `/api/auth/logout` | — → `204`, cookie cleared, family revoked |
| GET | `/api/me` | → `200 {id,name,email,isGuest:false, activeTripId, localImportCompletedAt, settings}` |
| PATCH | `/api/me` | `{name?}` → `200 User` |

`GET /api/me` deliberately returns `activeTripId` **and** `settings` so app boot is one round trip.

Codes: `INVALID_CREDENTIALS` 401 · `EMAIL_TAKEN` 409 · `WEAK_PASSWORD` 422 · `UNAUTHENTICATED` 401
· `TOKEN_EXPIRED` 401 · `REFRESH_REUSED` 401.

### Trips
| Method | Path | Notes |
|---|---|---|
| GET | `/api/trips` | `{trips: Trip[]}` newest first |
| GET | `/api/trips/:id` | `404 TRIP_NOT_FOUND` |
| POST | `/api/trips` | `TripDraft` → `201 Trip`, or **`200 Trip`** when `draftId` already exists |
| PATCH | `/api/trips/:id` | `TripPatch` → `200 Trip` / `409 STALE_TRIP` |
| DELETE | `/api/trips/:id` | `204`, idempotent (matches today's non-throwing `deleteTrip`) |
| POST | `/api/trips/:id/days/:dayId/activities` | `{activity, time?}` → `200 Trip` / `404 DAY_NOT_FOUND` / `409 ACTIVITY_ALREADY_ON_DAY` |
| PUT | `/api/me/active-trip` | `{tripId: string \| null}` → `204` |

`TripPatch` is **not** `Partial<TripDraft>` — see gotcha #1:

```ts
/** `null` clears a field; an absent key means no change. `undefined` never survives JSON. */
export type TripPatch = {
  title?: string; destination?: string;
  destinationCountry?: string | null; destinationCity?: string | null;
  startDate?: string; endDate?: string; travellers?: number; coverImage?: string;
  itinerary?: ItineraryDay[];
  flightsEstimate?: number | null; hotelsEstimate?: number | null; activitiesEstimate?: number | null;
};
```

An **empty** PATCH body must succeed and bump `updatedAt` — `useTrips.ts:87` calls
`updateTrip(tripId, {})` as a deliberate touch.

### Saved activities
`GET /api/saved-activities` → newest first, capped 200 ·
`PUT /api/saved-activities/:activityId` (upsert = "re-saving moves it to the top") ·
`DELETE /api/saved-activities/:activityId` · `DELETE /api/saved-activities`.
`toggle()` stays a client-side composition, exactly as today.

### Planner
`POST /api/planner/generate` `{prompt, conversationId?}` → `GeneratedItinerary`.
`mockAi.service.ts` moves server-side verbatim, so the real-LLM swap later touches one file.

### Settings / searches / chat
`GET|PUT /api/settings` · `GET|POST /api/searches/flights` (max 5) · `DELETE /api/searches` ·
`GET|PUT|DELETE /api/conversations/current`.

### Reference data — domain endpoints, not a raw proxy

Move the whole composition server-side. This kills the key leak, lets one cache serve every user,
and removes ~1,200 lines of HTTP plumbing from the client bundle.

`GET /api/reference/countries` · `GET /api/reference/countries/:name/cities` ·
`GET /api/explore/activities?city&countryCode&offset&limit` → `ActivitiesResult` ·
`GET /api/explore/activities/:id` · `GET /api/flights/search` · `GET /api/hotels/search` ·
`GET /api/partners` · `GET /api/health`.

`opentripmap.service.ts`, `wikimedia.service.ts`, the fetch halves of `country.service.ts` /
`city.service.ts`, and the mapping half of `activity.service.ts` all move to
`server/src/modules/explore/`. The client keeps its localStorage TTL caches (well-tested, instant
back-navigation) but `load` becomes one `http.get`.

`/api/explore/*` and `/api/reference/*` are the only endpoints servable unauthenticated —
**rate-limit them by IP**, because the OpenTripMap quota is now yours to burn.

### Migration
`POST /api/migrate/local` → `{alreadyMigrated, imported:{…}, remappedTripIds, migratedAt}`.

---

## 5. Auth mechanics

### Access token **in memory**, refresh token in an **httpOnly cookie**

| | Where | Lifetime | Why |
|---|---|---|---|
| Access | module variable in `src/services/http.ts` | 15 min | Not reachable by an XSS `localStorage` sweep; never sent automatically → **zero CSRF surface** |
| Refresh | opaque 32 bytes, `httpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=30d` | 30 d, rotated | Not reachable from JS; path-scoped to three endpoints |

Against the alternatives: **all-in-localStorage** loses the tokens to one XSS — and this app renders
third-party OpenTripMap descriptions and Wikimedia attribution text. **Access-token-in-cookie**
reintroduces CSRF and then needs a double-submit token. The cost of in-memory is one silent refresh
at boot, which you need anyway to answer "am I logged in?".

Hashing: `argon2id` (`memoryCost 19456, timeCost 2, parallelism 1`), `bcryptjs` cost 12 only if the
native build fights CI. Minimum 10 characters, no composition rules.

**Rotation with reuse detection:** each refresh mints a new token in the same `familyId` and
revokes the old. A revoked token presented again revokes the whole family (`401 REFRESH_REUSED`).
Allow a **5-second grace window** on a just-rotated token or two tabs waking together will log each
other out — see gotcha #10.

`requireAuth` distinguishes `TOKEN_EXPIRED` from `UNAUTHENTICATED`; the client needs that to decide
whether to attempt a refresh. **No endpoint may accept a `userId` from the client.**

### How 401s reach the UI

```ts
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const response = await send(path, init);
  if (response.status !== 401) return parse<T>(response);

  const { code } = await readError(response);

  // Recoverable exactly once, and via ONE shared refresh — five parallel
  // requests must not fire five refreshes.
  if (code === ERROR_CODES.TOKEN_EXPIRED && !init.isRetry) {
    refreshing ??= refreshAccessToken().finally(() => { refreshing = null; });
    if (await refreshing) return request<T>(path, { ...init, isRetry: true });
  }

  accessToken = null;
  signedOut.emit();            // → auth.store reset → resetAllStores() → guard redirects
  throw new ApiError(401, code, 'Your session has ended. Please sign in again.');
}
```

Because every trip-reading screen lives inside the protected `AppShell`, no store ever fetches
while logged out — the 401 path is genuine mid-session expiry, not a normal flow.

---

## 6. The frontend refactor

Keep `useSyncExternalStore`; replace the **source** of the snapshot. No Context provider (forces a
provider tree, re-renders on every field change, rewrites all call sites). No TanStack Query (12kb
and a second paradigm for exactly two shared read models).

### `src/store/createResource.ts` (new)

```ts
export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ResourceSnapshot<T> = { status: ResourceStatus; data: T; error: Error | null };

export function createResource<T>(options: { key: StoreKey; empty: T; load: () => Promise<T> }) {
  // One cached object per change. useSyncExternalStore compares with Object.is
  // and re-reads every render — a freshly built snapshot loops forever.
  let snapshot: ResourceSnapshot<T> = { status: 'idle', data: options.empty, error: null };
  const listeners = new Set<() => void>();
  let inFlight: Promise<void> | null = null;

  function load(force = false): Promise<void> {
    if (inFlight && !force) return inFlight;              // StrictMode double-mount → one request
    emit({ ...snapshot, status: 'loading' });             // `data` identity survives
    inFlight = options.load()
      .then((data) => emit({ status: 'ready', data, error: null }))
      .catch((e: unknown) => emit({ status: 'error', data: snapshot.data, error: asError(e) }))
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    /** The first subscriber triggers the fetch — no provider, no bootstrap step. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (snapshot.status === 'idle') void load();
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    set(data: T) { emit({ status: 'ready', data, error: null }); },   // write-through, no refetch
    refresh: () => load(true),
    reset() { /* back to empty; used on sign-out */ },
  };
}
```

Two load-bearing properties: the "loading" emit **reuses the same `data` reference** so background
refreshes don't re-render list consumers; and `subscribe()` kicking off the fetch means existing
call sites need no `useEffect`.

### `src/store/trip.store.ts` — same public surface

```ts
const EMPTY_TRIPS: Trip[] = [];                     // module-level, stable identity

const tripsResource = createResource<Trip[]>({ key: 'trips', empty: EMPTY_TRIPS,
  load: () => tripService.getTrips() });

const selectTrips = () => tripsResource.getSnapshot().data;

/** UNCHANGED SIGNATURE — most call sites do not move. */
export function useTrips(): Trip[] {
  return useSyncExternalStore(tripsResource.subscribe, selectTrips, selectTrips);
}

/** NEW — for consumers that need to distinguish "loading" from "none". */
export function useTripsResource(): ResourceSnapshot<Trip[]> { … }

export const tripStore = {
  async saveTrip(draft: TripDraft): Promise<Trip> {
    const trip = await tripService.createTrip(draft);
    tripsResource.set(upsertNewestFirst(selectTrips(), trip));   // server's response, never a local merge
    broadcast('trips');
    return trip;
  },
  // updateTrip / addActivityToDay are identical in shape: the server returns the
  // whole Trip, so each is set(replaceById(current, returned)).
  …
};
```

**Call-site impact: 6 of 9 unchanged** — `Sidebar.tsx:42`, `AddToTripDialog.tsx:41,80`,
`ProfilePage.tsx:21`, `SettingsPage.tsx:28`, `TripsPage.tsx:45`, `usePlanner.ts:23` all keep
working verbatim. The three that change are improvements:

- `useSavedTrips` (`useTrips.ts:19-64`) drops its ad-hoc effect and reads `status` from the
  resource. **Return shape unchanged**, so `TripsPage` doesn't move.
- `useTripDetails` (`useTrips.ts:135`) reads from the resource; when `ready` and the id is absent
  (a deep link to a trip not in the list), it does one `getTripById` and merges — else `notFound`.
- `ActivityDetailsPage` gains a loading state for `useIsActivitySaved`, so the heart icon doesn't
  flash "unsaved" before the list arrives.

### Cross-tab sync replacement — `src/store/sync.ts` (new)

The `storage` event disappears with localStorage. Replace with a `BroadcastChannel('ai-travel:store')`
that mutations post to and resources listen on, plus `revalidate.ts` refreshing on
`visibilitychange`/`focus` when the last load is older than 30s. This preserves the "a change in
another tab reaches every subscriber" promise the current docblocks make.

### `src/services/http.ts` (new)

Base URL (`import.meta.env.VITE_API_URL ?? '/api'`), query building, JSON headers,
`credentials: 'include'`, `204 → undefined`, non-JSON error bodies, a dead-network `TypeError`
mapped to `ApiError(0, 'NETWORK')`, and the single-flight refresh above.

**Error mapping keeps the existing UI copy alive** — the highest-leverage detail in the whole
frontend refactor:

```ts
function rethrowTripError(error: unknown): never {
  if (error instanceof ApiError) {
    if (error.code === ERROR_CODES.TRIP_NOT_FOUND) throw new TripNotFoundError(error.details as string);
    if (error.code === ERROR_CODES.DAY_NOT_FOUND) throw new ItineraryDayNotFoundError(error.details as string);
    if (error.code === ERROR_CODES.ACTIVITY_ALREADY_ON_DAY) throw new ActivityAlreadyOnDayError(error.details as string);
  }
  throw error;
}
```

`useEditTrip.describeError` and `AddToTripDialog.describeError` then need **zero edits**. The domain
error classes are the contract; `ApiError` never escapes the service layer.

### Auth boundary

```
src/services/auth.service.ts     register / login / logout / me / refresh
src/store/auth.store.ts          session resource + signIn/signOut + migration trigger
src/hooks/useCurrentUser.ts      { user, status, isAuthenticated, isLoading }
src/features/auth/pages/{LoginPage,RegisterPage}.tsx  + useAuthForm.ts
src/app/ProtectedRoute.tsx       redirect to /login?next=… while unauthenticated
src/app/AuthBootstrap.tsx        awaits the initial me()/refresh before rendering routes
```

Delete `src/mock/user.ts`; `PlannerPage.tsx:7,75` and `ProfilePage.tsx:11,47,51,52` switch to
`useCurrentUser()`. ProfilePage's inert Sign In button becomes a real link. `/login` and `/register`
go **outside** `AppShell` (like the landing page); `AppShell` gets wrapped in `<ProtectedRoute>`.

### The three synchronous services stay synchronous

| Service | Verdict |
|---|---|
| `settings.service.ts` | **Local-first, sync.** Theme must apply before first paint or you get a FOUC; a network read cannot do that. Keep signatures byte-identical, add a fire-and-forget `PUT /api/settings` inside `saveSettings` plus a merge-on-login pull. |
| `search.service.ts` | **Local-first, sync.** Making `getLastFlightSearch()` a Promise would cost `useFlightSearch` its instant-restore for no visible gain. Mirror on write. |
| `chat.service.ts` | **Local-first, sync**, mirrored in a late phase. A request/response model would force a rewrite of `usePlanner`'s `commitMessages`/`messagesRef` machinery — high risk, low value. |

These are *device* state mirrored to the account; trips and saved activities are *account* state.

---

## 7. One-time localStorage migration

**Marker on both sides, server authoritative.** Server `User.localImportCompletedAt` stops a second
device re-importing. Client `ai-travel-planner:migratedFor = {userId, at, counts}` means a *second
browser* with its own local data can still contribute. Server-only would silently drop Browser B;
client-only would re-import after a storage clear.

```
sign-in / register succeeds
  └─ auth.store sets the session (user, activeTripId, settings from /api/me)
  └─ void runLocalImport(user)                      // never blocks the redirect
       1. local marker matches this user            -> stop
       2. user.localImportCompletedAt != null       -> write marker, stop
       3. collect via the existing services (not raw storage):
          trips, activeTripId, savedActivities, settings, recentSearches, chatMessages
       4. everything empty (the common case)        -> write marker, stop
       5. POST /api/migrate/local
       6. on 200:
          a. apply remappedTripIds to the local activeTripId and chat-history references
          b. refreshAllStores()
          c. write the local marker
          d. ARCHIVE the local keys, do not delete
          e. toast: "We moved 4 trips saved on this device into your account."
       7. on failure: touch nothing, no marker, retry next sign-in, show a "Try again" banner
```

Because ids are preserved, the endpoint is naturally idempotent:

```ts
await prisma.$transaction(async (tx) => {
  for (const trip of payload.trips) {
    await tx.trip.upsert({ where: { id: trip.id }, create: { ...toRow(trip), userId }, update: {} });
  }
  await tx.savedActivity.createMany({ data: payload.savedActivities.map(toRow), skipDuplicates: true });
  // searches by (userId, kind, fingerprint); messages by (conversationId, position)
  await tx.user.update({ where: { id: userId }, data: { localImportCompletedAt: new Date(), activeTripId } });
});
```

Calling it after `localImportCompletedAt` is set returns `200 {alreadyMigrated: true, …}`, **not**
a `409` — a no-op success is far easier for the client than an error it must special-case.

**Reference caches are explicitly excluded** and never uploaded: `countries` (v1),
`activities` (v4, 5-min TTL), `cities:<Country>` (v1, LRU 5), and `selectedCountry`/`selectedCity`
(explorer UI position, which `exploreService` already treats as device-scoped). They keep working
untouched. Document this so nobody "fixes" it later.

**Do not delete the local data immediately.** Rename to `ai-travel-planner:archive:*` and add a
"Clear local backup" action in Settings — the storage-usage panel already renders these keys, so
the affordance has a home. This is the rollback path.

---

## 8. Phasing

Every phase ends with `npm run typecheck && npm run lint && npm test` green and the app booting.
**The frontend is never broken between phases.**

| # | Phase | Ship state |
|---|---|---|
| **0** | Workspaces; move types to `shared/` + re-export shims; `api.types.ts`, `error-codes.ts`; `src/services/http.ts` **+ its tests** (nothing calls it yet); Vite alias + proxy; `docker-compose.yml` | Identical app, plus a tested HTTP client and a shared contract |
| **1** | Server skeleton: app factory, zod-validated `env.ts`, Prisma singleton, error envelope, `GET /api/health`, Supertest harness, first migration | Server boots; SPA untouched |
| **2** | Auth end-to-end: server module + argon2 + rotation/reuse detection + `requireAuth`; client `auth.service`/`auth.store`/`useCurrentUser()`/Login/Register/`ProtectedRoute`/`AuthBootstrap`. **Add the toast system here** — auth is the first flow that needs it, and MVP_AUDIT flags 5 ad-hoc status lines | Users can register and sign in; trips still local |
| **3** ⭐ | **The async store refactor — still on localStorage.** `createResource`, `sync.ts`, `revalidate.ts`; rewrite both stores; update `useSavedTrips`/`useTripDetails`/`ActivityDetailsPage`; delete `readTripsSync`/`readActiveTripId`/`readSavedSync`; add jsdom store tests | Identical behaviour, async plumbing in place |
| **4** | Trips API (JSONB itinerary, locked `addActivityToDay`, `PUT /api/me/active-trip`) + migration module; swap `trip.service.ts` bodies to `http.*`; add `rethrowTripError`; **fix `toPatch()` to emit `null`** | Trips in Postgres; local trips imported on first sign-in; multi-device sync works |
| **5** | Saved activities — same pattern, much smaller | |
| **6** | Move explore/reference/planner/travel mocks server-side; **delete `VITE_OPENTRIPMAP_API_KEY`** and rotate it; update the `MISSING_KEY_ERROR` copy in `useExplore.ts:17-18` | No secret in the bundle; one cache serves everyone |
| **7** | Settings/searches/chat mirroring; `mock/partners.ts` behind `GET /api/partners`; "Clear local backup"; update README Stage 2 to match what was built | |

**Phase 3 is the critical insight.** It is the highest-risk change, and it runs against a data
source that never fails, never 401s, and resolves in a microtask. Every loading-state bug surfaces
there, in isolation, with no backend to blame.

---

## 9. Testing

**Keep the existing gate** (98 statements / 90 branches / **100 functions** / 98 lines over
`src/services/**`, `src/features/**/*.filters.ts`, `src/utils/**`). When services become fetch
calls the existing pattern already covers it — `opentripmap.service.test.ts` is exactly this shape
today. Extend it; don't replace it.

Add `src/test/http.ts`: `mockFetch(responses)`, `jsonResponse`, `errorResponse`, `lastRequest()`.

`functions: 100` is the brittle threshold. Per new service that means: happy path, each mapped
error code, the unmapped fallthrough, the `204` path, network failure, and both refresh-retry
branches. **`http.ts` alone deserves ~15 tests.**

**Do not introduce MSW for the unit suite.** It runs in `environment: 'node'`, is fast, and would
add a server lifecycle to 254 tests that need none. Revisit only if page-level integration tests
arrive in Phase 3+.

**Extend the coverage `include` to `src/store/**` in Phase 3, after the tests land** (adding the
glob first fails the gate). The stores are about to become the most complex frontend logic;
leaving them unaudited would be the wrong trade.

**Watch the denominator in Phase 6.** Moving ~1,200 lines of well-covered service code server-side
shifts the percentage. Recompute thresholds from the actual post-move numbers rather than assuming
98 still holds — `vite.config.ts` states the intent is "just under what the suite achieves".

**Backend:** separate Vitest project at `server/vitest.config.ts` with its own coverage config —
never merged into the frontend's. Unit-test the itinerary mutation (lift `trip.service.ts`'s
existing cases verbatim — they are already the spec), token rotation/reuse, hashing, migration
merge, and the ported mock AI generator. Integration-test with Supertest against a real Postgres
(`TRUNCATE … RESTART IDENTITY CASCADE` between tests beats transaction rollback with Prisma).
Cover per module: **authz (user A cannot read user B's trip — one test per resource route)**,
validation rejection, idempotency (same `draftId` twice, same migration twice), and the 409 paths.
Start thresholds at 85/75/90/85 and ratchet — holding a new backend to `functions: 100` produces
ceremonial tests.

**Contract drift** needs no tooling: `shared/` is the type source for the client and the validation
source for the server, so a renamed field is a compile error on the other side.

---

## 10. Risks & gotchas

Ordered by how much time they cost if missed.

1. **`toPatch()` cannot express "clear this field" over HTTP.** `editTrip.ts:148,151` set
   `clean.destinationCountry || undefined`. This works today because `{...trips[index], ...patch}`
   spreads an explicit `undefined` and overwrites — but `JSON.stringify({x: undefined})` yields
   `{}`, so **the clear is silently dropped**. Fix in Phase 4: emit `null`, change the return type
   to `TripPatch`, and have the server treat `null` as clear / absent as no-change. Add a test for
   "user removes the country from a trip".
2. **`useSyncExternalStore` snapshot identity.** A freshly built object from `getSnapshot` is an
   infinite render loop. `useExplore.ts:338-360` already documents this trap with its
   `cachedKey`/`cachedSelection` pair — read it before writing `createResource`. `empty` must be a
   module-level constant.
3. **`useEditTrip` re-baselines on `trip.updatedAt`** (`useEditTrip.ts:81-87`). If a store keeps a
   locally-merged trip instead of the server's response, `updatedAt` never changes and the form
   reads dirty forever. **Rule: every mutation writes the server's response into the store.** That
   is why every mutating endpoint returns the full `Trip`.
4. **Date-only fields must be `String`.** `startDate`/`endDate`/`ItineraryDay.date` are compared as
   strings (`editTrip.ts:103`: `draft.endDate < draft.startDate`). A Prisma `DateTime` round-trips
   through UTC and shifts the date by a day for anyone east or west of the server. Guard with
   `/^\d{4}-\d{2}-\d{2}$/`. Conversely `createdAt`/`updatedAt` must serialise via `.toISOString()`.
5. **`erasableSyntaxOnly: true`** — no TS `enum`, no parameter properties, no decorators anywhere
   the setting reaches. Use `const` objects for error codes (matches the existing `as const` style).
6. **StrictMode double-mount fires two fetches.** The in-flight dedupe in `createResource` is
   load-bearing, not an optimisation. Test it.
7. **Empty array vs not-loaded — the most likely visible regression.** `useTrips()` returns `[]`
   while loading, which today can only mean "no trips". Audited each consumer:
   - `TripsPage.tsx:83,90` — **safe**, already gates its `EmptyState` on `isLoading`.
   - `ProfilePage.tsx:29,89,97` — **will flash**: stats and `EmptyState` straight off the array.
   - `Sidebar.tsx:42` (RecentTrips) — **will flash**, same reason.
   - `SettingsPage.tsx:28` — trip count briefly reads 0.
   - `AddToTripDialog.tsx:41` — would briefly offer "no trips to add to".
   Give these `useTripsResource()` and a skeleton branch **in Phase 3**, not later.
8. **Empty PATCH must succeed.** `useTrips.ts:87` uses `updateTrip(tripId, {})` as a touch. A zod
   schema with `.strict()` plus an "at least one key" refinement breaks the summary page's Save.
9. **`addActivityToDay` under concurrency.** Read-modify-write of JSONB without a lock loses one of
   two simultaneous adds. Wrap in `$transaction` with `SELECT id FROM "Trip" WHERE id=$1 AND
   "userId"=$2 FOR UPDATE` first. Also reproduce `minutesOf()`'s rule (`trip.service.ts:48`) that
   unparseable times sink to the end, or imports land in the wrong place.
10. **Refresh-token grace window.** Two tabs waking from sleep both POST the same cookie. Without a
    few seconds of grace, reuse detection fires and logs the user out. This *will* happen on your
    first real test.
11. **Cookie `Secure` in dev.** Some browsers drop `Secure` cookies over plain `http://localhost`.
    Drive it from `NODE_ENV`, and **never set a cookie `Domain`** (host-only avoids subdomain leak).
12. **`useTripDetails` writes on every mount** (`useTrips.ts:165-167` calls `setActiveTrip`). Over
    HTTP that is a `PUT` per page open. Guard with `if (activeTripId !== trip.id)`.
13. **`GET /api/me` must be the only boot request** — return `activeTripId` and `settings` from it
    and push them into their resources via `.set()`. Easy to forget, hard to notice.
14. **Server-side caps.** `MAX_SAVED = 200` (`savedActivity.service.ts:19`) and `MAX_RECENT = 5`
    (`search.service.ts:10`) are client-enforced today. Enforce in the API too or a second device
    grows the list past the cap.
15. **Legacy trips carry only `destination`**, not `destinationCountry`/`City`. Three places resolve
    this at read time (`explore.service.ts:112-113`, `editTrip.ts:50-52`). Keep the columns nullable
    and do **not** "fix up" the data during migration.
16. **Mirror validation server-side.** `editTrip.ts:validate()` has the real rules — non-empty
    title, a city or country, `endDate >= startDate`, `travellers >= 1`, time matching
    `/^([01]\d|2[0-3]):[0-5]\d$/`. Client validation is UX, not enforcement.
17. **`.env.local` holds a live OpenTripMap key** already inlined into every build shipped so far.
    **Rotate it** in Phase 6 — don't just relocate it.
18. **`express.json()` defaults to 100kb.** A migration payload of 20 trips plus saved `Activity`
    objects will exceed it. Set `limit: '2mb'` on the migration route.
19. **Workspace hoisting** puts `express` and `@prisma/client` in the root `node_modules`, importable
    from `src/`. Add an oxlint `no-restricted-imports` rule (`server/**`, `express*` banned from
    `src/**`) or you'll ship a server package into the browser bundle one distracted afternoon.
20. **`zod` must not reach the client bundle.** Two export paths on `@ai-travel/shared` (types at
    `.`, schemas at `./schemas`). Verify with a bundle inspection at the end of Phase 0.
21. **`storageService.usage()`** on Settings (`SettingsPage.tsx:28`) will report near-zero once user
    data leaves localStorage. Repurpose it for cache usage or remove it — don't leave a misleading 0 B.
22. **Deleting `readTripsSync` breaks `trip.service.test.ts`.** Budget for test updates in Phase 3;
    don't let "tests still pass" hide that they were asserting a removed API.
23. **Explore selection flickers during load** — `resolveSelection` returns `EMPTY_SELECTION` while
    trips load, then settles. `autoExploredRef` (`useExplore.ts:278`) prevents a double search.
    Acceptable; do not "fix" it by blocking render.
24. **Guest mode is being decided by omission.** This plan protects every `AppShell` route, so the
    app requires an account. That is the clean choice and it keeps the trip store unambiguous. **If
    you want the planner to work signed-out, say so before Phase 3** — retrofitting a dual-source
    store afterwards is genuinely hard.

---

## 11. Verification

Per phase:

```bash
npm run typecheck && npm run lint && npm run test     # client gate must stay green
npm --workspace server run test                       # Supertest + Postgres
npm run build
```

End-to-end smoke after Phase 4, with server + client running:

1. Register → land authenticated on `/planner`.
2. Generate an itinerary, save → appears in `/trips` and the Sidebar.
3. Hard-reload → trip persists (from the API now, not localStorage).
4. Edit title, dates, an activity time → PATCH sends only the diff; reload confirms.
5. **Clear a trip's country** → it actually clears (gotcha #1 regression test).
6. Explore → save an attraction → Add To Trip → lands time-ordered; adding twice shows the
   duplicate message (now a `409`).
7. **Sign in as a second user → sees none of the first user's trips.** Back to the first → intact.
8. Two tabs → a save in one updates the other (BroadcastChannel path).
9. With Stage-1 data seeded in localStorage, first sign-in imports it, archives the local keys and
   sets `localImportCompletedAt`; signing out and back in does **not** re-import or duplicate.
10. After Phase 6 — DevTools Network: nothing goes to `api.opentripmap.com` from the browser, and
    `grep -r "opentripmap" dist/` finds only proxy paths, no key.
