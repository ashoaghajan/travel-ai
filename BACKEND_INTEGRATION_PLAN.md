# Backend Integration — Closing the localStorage Gaps

> **Status:** Milestones 1-4 complete. Five milestones, in the order listed.
> Temporary working document — delete once the milestones land.

## Milestones at a glance

| # | Milestone | Size | Depends on |
|---|---|---|---|
| 1 | [Proxy third-party APIs](#milestone-1--proxy-the-third-party-apis-rotate-the-leaked-key) ✅ done | small | — |
| 2 | [Trips in Postgres](#milestone-2--trips-in-postgres) ✅ done | large | — |
| 3 | [Settings and active trip on `/api/me`](#milestone-3--settings-and-active-trip-on-apime) ✅ done | small | 2 |
| 4 | [Bookings in Postgres](#milestone-4--bookings-in-postgres) ✅ done | medium | 2 |
| 5 | [Saved activities, chat history, recent searches](#milestone-5--saved-activities-chat-history-recent-searches) | medium | 2 |

Milestone 1 is independent of the rest and goes first because it is the only security issue.
Milestone 2 carries the shared cost of making the stores asynchronous, which is why 3–5 depend
on it.

## Context

The app has a real backend, but it only owns **authentication**. Postgres holds three models —
`User`, `AuthIdentity`, `RefreshToken` — and the server otherwise acts as a proxy: the Anthropic
planner call, four travel-provider searches, and the currency rates endpoint.

Every piece of *user content* still lives in the browser:

| Domain | Storage key | Service | Already async? |
|---|---|---|---|
| Trips | `trips` | `src/services/trip.service.ts` | yes |
| Active trip | `activeTripId` | `src/services/trip.service.ts` | yes |
| Bookings | `bookings` | `src/services/booking.service.ts` | yes |
| Saved activities | `savedActivities` | `src/services/savedActivity.service.ts` | yes |
| Settings (incl. currency) | `settings` | `src/services/settings.service.ts` | **no — sync** |
| Planner chat history | `chatHistory` | `src/services/chat.service.ts` | **no — sync** |
| Recent searches | `recentSearches` | `src/services/search.service.ts` | **no — sync** |
| Explorer country/city | `selectedCountry`, `selectedCity` | `src/services/explore.service.ts` | stays device-local |

Per-account separation is a localStorage trick: `src/services/localData.service.ts` archives one
account's keys under `archive:<userId>:` and restores the next account's on sign-in. It works on
one device and cannot work across two.

Separately, `VITE_OPENTRIPMAP_API_KEY` is **inlined into every bundle shipped so far** and readable
by anyone who loads the site (`src/services/opentripmap.service.ts:11`).

**Outcome:** user content lives in Postgres, scoped to the account, synced across devices; no
third-party key reaches the browser. This also unblocks trip import/export, which needs a
server-side uniqueness constraint to enforce the duplicate rule rather than trusting the client.

**Decided up front:** the app keeps requiring an account. `RequireAuth` already wraps every app
route (`src/app/routeTable.tsx:66`), so the trip store has exactly one source. Guest mode is
deliberately not supported — retrofitting a dual-source store later is genuinely hard.

**Reuse, don't reinvent.** `STAGE_2_PLAN.md` already designs most of this: §2 the Prisma schema,
§6 `createResource`, §7 the one-time migration. The one thing it does **not** cover is
**bookings**, which postdate the plan and are designed in Milestone 4 below.

---

## Milestone 1 — Proxy the third-party APIs, rotate the leaked key

First because it is the only real security issue, the smallest of the five, and entirely
independent of the store work.

`server/src/modules/travel/` already proxies flights, hotels, Viator activities and airports, with
a TTL cache in `travel/cache.ts`. Follow that shape for the rest:

| Service | Host | Why |
|---|---|---|
| `opentripmap.service.ts` | `api.opentripmap.com` | **the leaked key** |
| `wikimedia.service.ts` | `wikidata.org`, `commons.wikimedia.org` | one shared cache instead of one per browser |
| `country.service.ts` | `countriesnow.space` | same |
| `city.service.ts` | `countriesnow.space` | same |
| `weather.service.ts` | `open-meteo.com` | same |

Remove `VITE_OPENTRIPMAP_API_KEY` from `.env.example` and keep the key only in `server/.env` as
`OPENTRIPMAP_API_KEY`.

**Rotation was considered and deliberately skipped.** The key is read-only, carries no personal
data and has no billing attached, so the worst case is quota exhaustion rather than a breach — and
OpenTripMap does not appear to offer key regeneration. The structurally important half is done
regardless: no future build carries a key, so the exposure has stopped growing. Rotate
opportunistically if it ever becomes possible, or if quota is consumed unaccountably; it is now a
one-line change in `server/.env` with no client rebuild.

Also add a `no-restricted-imports` rule to `.oxlintrc.json` (which has no such rule today) banning
`server/**` and `express*` from `src/**`. Workspace hoisting puts `express` and `@prisma/client` in
the root `node_modules`, importable from `src/` — this is how a server package ends up in the
browser bundle one distracted afternoon.

**Done when:** DevTools shows no browser request to `api.opentripmap.com`, and
`grep -r "opentripmap" dist/` finds only proxy paths — no key.

---

## Milestone 2 — Trips in Postgres

The largest milestone: it carries the shared cost of making the stores asynchronous.

### 2a. Async store foundation (prerequisite)

Build `src/store/createResource.ts` exactly as specified in `STAGE_2_PLAN.md` §6 —
`{ status, data, error }` snapshots, first subscriber triggers the load, single-flight, and the
`loading` emit **reuses the same `data` reference** so background refreshes don't re-render list
consumers. `src/store/createStorageSnapshot.ts:10-11` already carries a docblock anticipating this
exact replacement.

Rewrite `src/store/trip.store.ts` on top of it. **`useTrips()` keeps its signature**, so most call
sites don't move. Delete `readTripsSync` / `readActiveTripId` (`trip.service.ts:202-208`).

Two things the exploration turned up that shape the work:

- **17 call sites across 13 files** consume raw store hooks (`useTrips`, `useActiveTripId`,
  `useBookings`, `useTripBookings`, `useBookingsByTrip`, `useIsActivitySaved`) with **zero**
  loading-state handling — e.g. `src/components/navigation/Sidebar.tsx:43`,
  `src/features/planner/usePlanner.ts:34`, `src/features/explore/useExplore.ts:74`. Each needs
  either a loading state or to route through a wrapper hook.
- **`useSavedTrips` / `useTripDetails`** (`src/features/trips/useTrips.ts:19-64, 135-174`) already
  expose the right `isLoading` / `notFound` contract and `TripDetailsPage.tsx:69` already consumes
  it correctly. But the rendered data comes from the *synchronous snapshot*, and the `.then()`
  discards its resolved value. Fix them to use what the promise returns — the snapshot will no
  longer be pre-populated.

### 2b. Schema

Add `Trip` per `STAGE_2_PLAN.md` §2. Key columns: client-format `id`, `userId`, `draftId` with
`@@unique([userId, draftId])` for the existing idempotency rule, `itinerary Json`, `version Int`
for optimistic concurrency, `startDate`/`endDate` as **strings** (`YYYY-MM-DD`, not `DateTime`).
Add `User.activeTripId` with `onDelete: SetNull`.

**Two schema decisions to make explicitly**, because `schema.prisma:1-13` states that the models
deliberately stay free of enums and native types to keep the Postgres swap cheap:

- **Itinerary as JSONB — accept.** The reasoning in `STAGE_2_PLAN.md` §2 holds: `editTrip.ts:159`
  already sends whole-itinerary replacement, nothing ever queries inside an itinerary, and nested
  ids are client-generated. This is the first `Json` column in the schema; note it in the header
  comment rather than letting it silently contradict.
- **Prefer `String` over Prisma `enum`.** `STAGE_2_PLAN.md` proposes enums for category, theme and
  booking kind. Plain `String` columns validated by zod preserve the portability the schema comment
  values, at no real cost.

Migrations: only one exists (`20260806000000_init_postgres`). Add models with
`npm run prisma:migrate` from `server/`, commit the generated SQL; `prisma:deploy` is what tests
and production run.

### 2c. API

New `server/src/modules/trips/`, mirroring the `auth` module: router + service + tests, `requireAuth`
(router-wide via `router.use()`, as in `me.routes.ts:16`), zod schemas in `shared/src/schemas/`,
errors thrown as `HttpError` from `server/src/errors.ts`. Scope every query by `userIdOf(request)`
— never an id from the body. Add a `toApiTrip` mapper following `toApiUser` (`auth.service.ts:72-85`).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/trips` | newest first |
| GET | `/api/trips/:id` | `404 TRIP_NOT_FOUND` |
| POST | `/api/trips` | `201`, or **`200`** when `draftId` already exists |
| PATCH | `/api/trips/:id` | `409 STALE_TRIP` on version mismatch |
| DELETE | `/api/trips/:id` | `204`, idempotent |
| POST | `/api/trips/:id/days/:dayId/activities` | row-locked; `409 ACTIVITY_ALREADY_ON_DAY` |
| PUT | `/api/me/active-trip` | `{tripId: string \| null}` → `204` |

Lift the ordering and duplicate rules at `trip.service.ts:137-171` **verbatim** into the
transaction — already pure logic. Mirror `editTrip.ts:validate()` server-side (non-empty title, a
city or country, `endDate >= startDate`, `travellers >= 1`, time matching
`/^([01]\d|2[0-3]):[0-5]\d$/`). Client validation is UX, not enforcement.

### 2d. Client

Swap the bodies of `src/services/trip.service.ts` to `http.*`, keeping every signature —
`src/services/auth.service.ts` is the clean 1:1 reference. **Do not copy `hotel.service.ts`'s
fallback-to-sample-data pattern**: a failed trips fetch must not silently render invented trips.

Add `rethrowTripError` mapping API error codes back to the existing `TripNotFoundError` /
`ItineraryDayNotFoundError` / `ActivityAlreadyOnDayError` classes, so no caller changes.

**Fix `toPatch()` to emit `null`** rather than dropping the key — clearing a trip's country
currently cannot round-trip through JSON.

### 2e. One-time migration

`POST /api/migrate/local` per `STAGE_2_PLAN.md` §7. Server `User.localImportCompletedAt`
(`schema.prisma:37`, pre-provisioned for exactly this) is authoritative; the client also writes
`ai-travel-planner:migratedFor` so a *second browser* with its own local data can still contribute.
Ids are preserved, so the endpoint is idempotent by construction — calling it after the marker is
set returns `200 {alreadyMigrated: true}`, **not** a `409`.

Set `limit: '2mb'` on this route; `express.json()` defaults to 100kb and 20 trips will exceed it.

**Archive the local keys, never delete them.** That is the rollback path. Add a "Clear local
backup" action in Settings, where the storage-usage panel already gives it a home.

### Done when
Trips survive a hard reload from Postgres, a second account sees none of the first's trips, and
Stage-1 localStorage data imports exactly once across sign-out and back in.

---

## Milestone 3 — Settings and active trip on `/api/me`

Small, and it makes the currency preference follow the account rather than the device.

- Add `UserSettings` per `STAGE_2_PLAN.md` §2 — **columns, not JSON** — plus a **`currency`
  column**, which the plan predates.
- Extend `GET /api/me` to return `activeTripId` and `settings` so **app boot stays one round
  trip**, pushing both into their resources via `.set()`.
- `PUT /api/settings`; swap `src/services/settings.service.ts` to `http.*`.

Note this service is **synchronous today** (`getSettings()`, `saveSettings()`), so it needs an
async conversion, not just a body swap. Its consumers — `src/features/settings/useSettings.ts`,
`src/app/useAppliedTheme.ts`, and `src/store/currency.store.ts` — all read it synchronously and
must move to the resource.

### Done when
Changing currency on one device shows up on another after a reload, and boot issues one request.

---

## Milestone 4 — Bookings in Postgres

Not covered by `STAGE_2_PLAN.md` — designed here.

```prisma
model Booking {
  id         String   @id                    // client-format id
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tripId     String?                         // nullable by design
  trip       Trip?    @relation(fields: [tripId], references: [id], onDelete: SetNull)
  kind       String                          // flight | hotel | ticket | activity
  status     String   @default("saved")      // saved | booked
  title      String
  date       String                          // 'YYYY-MM-DD', empty when unknown
  endDate    String?
  reference  String   @default("")
  price      Float?
  priceBasis Json?                           // PriceBasis, captured at save time
  url        String?
  source     Json?                           // BookingSource snapshot
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([userId, createdAt(sort: Desc)])
  @@index([tripId])
}
```

`onDelete: SetNull` is deliberate and preserves today's behaviour: deleting a trip does **not**
delete its bookings (`src/store/booking.store.ts:99-104`); orphans surface through
`useUnassignedBookings`.

REST: `GET|POST /api/bookings`, `PATCH|DELETE /api/bookings/:id`. The 577-line
`booking.service.ts` is mostly client-side mapping (`flightToBookingDrafts`, price basis, partner
links) — that logic **stays put**; only the persistence calls move.

Keep `booking.migration.ts` (legacy `Trip.bookings` → booking store) running client-side *before*
the upload, so a Stage-1 trip's embedded bookings migrate correctly.

### Done when
Bookings persist server-side, survive a trip deletion as unassigned, and follow the account.

---

## Milestone 5 — Saved activities, chat history, recent searches

Three small domains, same pattern.

- **SavedActivity** — model designed in `STAGE_2_PLAN.md` §2. Enforce `MAX_SAVED = 200`
  **server-side**; it is client-only today (`savedActivity.service.ts:19`), so a second device
  would grow the list past the cap.
- **Conversation / ChatMessage** — models designed in the plan; `position` gives deterministic
  order for a whole-list `PUT`. `chat.service.ts` is **synchronous today** — needs the async
  conversion.
- **RecentSearch** — model designed in the plan; `fingerprint` is the server-side form of
  `isSameFlightSearch()`. Enforce `MAX_RECENT = 5` server-side. `search.service.ts` is
  **synchronous today** — same conversion.

`selectedCountry` / `selectedCity` **stay in localStorage** — explorer UI position, which
`exploreService` already treats as device-scoped. Document it so nobody "fixes" it.

Once this lands, seven of `localData.service.ts`'s nine `OWNED_KEYS` are obsolete. Reduce that
module to whatever the one-time import still needs, and delete the rest.

### Done when
All three follow the account across devices, with caps enforced server-side.

---

## Cross-cutting notes

- **Coverage gate.** `vite.config.ts:36-57` holds `src/services/**` to 98% statements / 90%
  branches / **100% functions** / 98% lines. Every service in this plan is inside that gate, and
  HTTP migration adds new error branches (401, network, timeout) that all need covering.
  `src/store/**` is *not* gated, so the store rewrite won't trip it.
- **Server test isolation.** `server/src/test/setup.ts:101-108` truncates in `beforeEach` with
  `deleteMany()` calls in FK-safe order. **Every new model needs its line added there**, children
  first, or tests will leak state into each other.
- **`zod` must not reach the client bundle.** `@ai-travel/shared` keeps two export paths — types at
  `.`, schemas at `./schemas`. Shared validation goes in `shared/src/schemas/`; client-side form
  checks stay hand-written, as they are today.
- **Legacy trips carry only `destination`**, not `destinationCountry`/`City`. Keep those columns
  nullable and do **not** "fix up" the data during migration.
- **`storageService.usage()`** on the Settings screen will report near-zero once user data leaves
  localStorage. Repurpose it for cache usage or remove it — don't leave a misleading 0 B.
- **Deleting `readTripsSync` breaks `trip.service.test.ts`** (462 lines, jsdom, reaches into
  `storageService` directly in ~8 places). Budget for the rewrite; don't let "tests still pass"
  hide that they were asserting a removed API.

---

## Verification

Per milestone:

```bash
npm run typecheck && npm run lint && npm run test    # client gate
npm run test:api                                     # Supertest + Postgres (docker compose up -d)
npm run build
```

Server tests are real integration tests against `aitravel_test` — no Prisma mocking. Authenticated
endpoints follow `me.routes.test.ts`: `signUp()` from `server/src/test/harness.ts`, then
`.set('Authorization', 'Bearer ' + accessToken)`, plus a companion test asserting `401`
`UNAUTHENTICATED` with no token.

End-to-end after Milestone 2, server and client running:

1. Register → generate an itinerary → save → appears in `/trips`.
2. Hard-reload → the trip persists, now from the API.
3. Edit title, dates, an activity time → reload confirms.
4. **Clear a trip's country** → it actually clears (the `toPatch()` null regression).
5. Explore → save an attraction → Add To Trip → time-ordered; adding twice gives a `409`.
6. **Sign in as a second user → sees none of the first user's trips.** Switch back → intact.
7. Seed Stage-1 data in localStorage → first sign-in imports it, archives the local keys, sets
   `localImportCompletedAt`; sign out and back in does **not** re-import or duplicate.

After Milestone 1: DevTools Network shows nothing going to `api.opentripmap.com`, and the old key
is revoked at the provider.

---

## Follow-on (not in this plan)

Trip import/export — the feature that surfaced these gaps — lands after Milestone 2, where the
duplicate rule can be a `@@unique` constraint on the server rather than a client-side check.
