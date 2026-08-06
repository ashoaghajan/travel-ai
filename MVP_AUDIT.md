# MVP Audit — AI Travel Planner (Stage 1)

**Date:** 28 July 2026
**Scope:** the whole application, audited against `README.md` (Stage 1 Definition of Done, data models, folder structure) and `DESIGN_SPEC.md` (screens, component inventory, design rules).

---

## 1. Verdict

Stage 1 is **feature-complete**. All 11 routes from README's route list exist and render, every screen in DESIGN_SPEC §8 is built, all 21 components in the §9 inventory exist, and all five localStorage keys have a real consumer.

| Check | Result |
|---|---|
| TypeScript (`tsc -b --noEmit`) | ✅ 0 errors, `strict` on, no `any` in `src/` |
| Lint (`oxlint`) | ✅ 0 errors, 0 warnings |
| Production build | ✅ 380 kB JS (118 kB gzip), 57 kB CSS (9 kB gzip) |
| Routes render | ✅ 18 paths incl. query-string variants and an unknown URL |
| Console errors/warnings during render | ✅ 0 |
| Dead internal links | ✅ 0 (8 unique internal link targets, all match a real route) |
| Duplicate saves | ✅ prevented at the service layer, verified |
| Automated audit suite | ✅ 61/61 checks |

**The one thing this audit cannot certify: nothing has been seen in a browser.** No browser tooling was available in any session, so every visual, layout and interaction claim below is reasoned from the code and verified structurally through server-side rendering — not observed. See §5.1.

---

## 2. Completed features

### 2.1 README Definition of Done

| Item | Status | Where |
|---|---|---|
| Landing page | ✅ | `features/landing` |
| Planner dashboard | ✅ | `features/planner` |
| User can type a trip request | ✅ | `PlannerInput` → `usePlanner.generate` |
| Mock AI itinerary is generated | ✅ | `services/mockAi.service.ts` behind `plannerService` |
| Trip can be saved to localStorage | ✅ | `tripService.createTrip` |
| Saved trips can be viewed | ✅ | `/trips`, sidebar, profile |
| Trip details page | ✅ | `/trips/:tripId` |
| Itinerary timeline | ✅ | `ItineraryTimeline` |
| Map placeholder | ✅ | `MapView` (SVG route, purple markers) |
| Flight search with mock data | ✅ | `/flights` |
| Hotel search with mock data | ✅ | `/hotels` |
| Activities explorer with mock data | ✅ | `/activities` |
| Partner booking page | ✅ | `/bookings` |
| Trip summary page | ✅ | `/trips/:tripId/summary` |
| Works on desktop | ⚠️ built for it, not visually verified |
| Works on mobile | ⚠️ built for it, not visually verified |
| Design tokens used consistently | ✅ every colour, space, radius and shadow now resolves to a token — 0 raw values outside `tokens.css` |

### 2.2 Routes

All routes render, including query-string states and unknown URLs.

```
/                        Landing
/planner                 AI planner (seeded conversation, restored from storage)
/trips                   Saved trips + resume link
/trips/:tripId           Details — Itinerary · Map · Bookings · Notes (?tab=)
/trips/:tripId/summary   Checkout-style cost summary
/flights                 Search form + mock results (sortable)
/hotels                  Filter · Sort · Map + mock stays
/activities              Category chips + mock activities (?category=)
/bookings                Partner tabs (?tab=)
/profile                 Guest identity, stats, recent trips
/settings                Appearance · Notifications · Storage
*                        Not found (inside the shell, keeps navigation)
```

### 2.3 Component inventory (DESIGN_SPEC §9)

All 21 present: AppShell, Sidebar, BottomNavigation, PageHeader, Button, Card, TripCard, ItineraryDayCard, ChatMessage, PlannerInput, FlightSearchForm, FlightResultCard, HotelCard, ActivityCard, PartnerCard, TripSummaryCard, MapView, Tabs, CategoryChips, Avatar, IconButton.

Beyond the inventory: `EmptyState`, `Skeleton`, `Switch`, `CardImage`, `Logo`, `ItineraryPreview`, `TypingIndicator`, `ItineraryTimeline`, `HotelToolbar`, `HotelFilterPanel`, `SettingsSection`, `BackLink`, `RecentTrips`, `UpgradeCard`, `MapView`.

### 2.4 Persistence

| Key | Owner | Restores on reload |
|---|---|---|
| `ai-travel-planner:trips` | `trip.service` | Saved trips |
| `ai-travel-planner:chatHistory` | `chat.service` | Planner conversation (versioned) |
| `ai-travel-planner:activeTripId` | `trip.service` | "Continue where you left off" |
| `ai-travel-planner:settings` | `settings.service` | Theme + notification prefs |
| `ai-travel-planner:recentSearches` | `search.service` | Last flight search |

`localStorage.service.ts` is the only module that touches `window.localStorage` — verified by grep; no page or component imports it directly. Cross-tab sync runs through one mechanism (`storageService.subscribe`) used by the trip store, active-trip pointer, chat history and settings.

---

## 3. What this audit added

### 3.1 Loading, empty and error states

| Screen | Loading | Empty | Error |
|---|---|---|---|
| Trips | 3 skeleton cards | "No saved trips yet" + CTA | delete failure banner |
| Trip details | skeleton | "Trip is no longer saved" | delete failure banner |
| Trip summary | skeleton | not-found state | save failure banner |
| Flights | 3 skeleton cards | "No flights for this route" | search failure banner |
| Hotels | 3 skeleton cards | "No stays match these filters" + clear | search failure banner |
| Activities | 3 skeleton cards | "Nothing in this category yet" | load failure banner |
| Planner | typing indicator | n/a (always seeded) | generation + save failures |
| Bookings | n/a (static config) | "No partners here yet" | n/a |
| Profile | n/a (synchronous store read) | "No saved trips yet" + CTA | n/a |
| Settings | n/a | n/a | preference save failure |
| **Any route** | — | **new:** Not Found page inside the shell | **new:** `RouteErrorPage` via `errorElement` |

Two genuinely new states: a **404 page that keeps the navigation** (previously unknown URLs silently redirected to the marketing page, hiding typos) and a **route-level error boundary**, so a render error shows a recovery screen instead of a blank page.

### 3.2 Accessibility

Added in this pass:

- **Skip-to-content link** — first focusable element on every page, targets `#main-content`.
- **Document titles per route** — driven by `handle.title` in the route table; previously every page was titled "AI Travel Planner".
- **Route announcements** — a polite live region announces the new page after navigation, which SPAs otherwise do silently.
- **Focus management** — focus moves to `<main>` after navigation (skipped on first load so it never steals focus or scroll).

Already in place and verified across all 18 rendered paths:

- Exactly one `<h1>` per page; `<main>` landmark on every page.
- Every icon-only button and link has an accessible name (checked by stripping tag content and requiring `aria-label` or visually-hidden text — 0 offenders).
- Every `<svg>` is `aria-hidden`; every `<img>` has an `alt` attribute.
- Tabs: `role="tablist"`, `aria-selected`, `aria-controls`, roving arrow-key navigation. Chips: `role="group"` + `aria-pressed`. Switches: `role="switch"`. Map: `role="img"` with a stop-by-stop label.
- Loading regions carry `aria-busy` plus a visually-hidden status message.
- `:focus-visible` ring on every interactive element, with a white variant on photography.
- `prefers-reduced-motion` honoured globally and in the auto-scroll.

### 3.3 Layout stability

- Every card image sits in an `aspect-ratio` container, so images reserve space before they load — no shift.
- **Fixed:** navigating between pages kept the previous scroll offset (`main` is the scroll container, so React Router's scroll restoration does not apply). Now resets on route change.
- **Fixed:** persisted trips store build-hashed image URLs, which go stale after a deploy. `CardImage` drops a failed image so the card falls back to its gradient instead of showing a broken-image icon.

### 3.4 Design token discipline

Five bypasses found and removed (hero placeholder colour, two text shadows, card hover shadow, bottom-bar shadow, map caption background, overlay midpoint). `src/**/*.css` now contains **zero** raw colour values outside `tokens.css`.

---

## 4. Remaining issues

Ordered by how much they would hurt.

| # | Issue | Impact | Effort |
|---|---|---|---|
| 1 | ~~**No automated test suite.**~~ **Resolved 28 Jul 2026** — Vitest + Testing Library added; 254 tests across the service layer and pure functions, 99% statement coverage with thresholds enforced. UI coverage is still one smoke test. | ~~High~~ | done |
| 2 | **Nothing verified in a browser.** No visual, responsive, or interaction confirmation at any viewport. | High | 1–2 hours with a browser |
| 3 | **Theme preference does nothing.** Settings stores `light`/`dark`/`system`; tokens are light-only. | Medium | ~half a day (dark token set + `data-theme`) |
| 4 | **No toast system.** DESIGN_SPEC rule 19 asks for toasts on save actions; inline `role="status"` messages stand in. | Medium | 2–3 hours |
| 5 | ~~**Trips are not editable.**~~ **Resolved.** `TripDetailsPage` now edits name, dates and travellers through `EditTripModal`, and the itinerary through `ItineraryTimeline` + `AttractionPickerDialog`; `TripsPage` opens the same modal. "Customise Trip" on the planner was inert for longer — it saves the draft and opens the trip for editing as of the planner fix. | — | done |
| 6 | **Demo trip totals don't match DESIGN_SPEC Screen 8.** Standardising on 7 days / 6 nights (your call) means hotels bill 6 nights ($1,080, not $1,260), and the itinerary has 14 activities rather than 4 — total $3,898 vs the spec's $3,708. Layout matches; only derived figures differ. | Low | decision, not code |
| 7 | **Flights/Hotels are URL-only.** Nothing links to them: the spec's nav is Home · Trips · Explore · Bookings · Profile. | Low | 1 hour (search entry points on the trip screen) |
| 8 | **Hotel and activity photos are generic**, not the named properties. Noted in `assets/CREDITS.md`. | Low | asset sourcing |
| 9 | **Multi-city flights searches the first leg only**, with a note saying so. | Low | 2–3 hours |
| 10 | **No "clear local data" control.** The obvious companion to the storage section on a localStorage-only app. | Low | 1 hour |

---

## 5. Technical debt

### 5.1 Verification debt (partly repaid)

**Resolved for the service layer and pure functions.** `npm test` runs 254 tests over the services, the filter modules and the utilities — 99% statements, 94% branches, 100% functions, with coverage thresholds that fail the run on regression. The suite was mutation-checked (breaking `nightsBetween`'s guard and `createTrip`'s dedupe both produced failures), and writing it surfaced a real bug in `fromIsoDate`.

**Still outstanding: UI coverage.** One `Button` test proves the Testing Library harness works; no page, hook or interaction is covered.

Server-side rendering **cannot reach any state behind a `useEffect`**, because effects don't run during SSR — jsdom now can, but no test uses it that way yet. Everything gated on an async load — the trips grid, flight results, the trip details tabs, filter interactions — has only ever been verified in its *loading* state at page level, or by rendering the child component directly with props. That is the single largest blind spot in the codebase.

### 5.2 Architectural debt

- **`readTripsSync` / `readActiveTripId`** exist purely so the store paints stored state on first render. Stage 2 must replace them with the async API plus a loading state. Documented in the service.
- **Two persistence idioms.** `tripService` is async (mirrors future endpoints); `settingsService`, `chatService` and `searchService` are synchronous (device-local, no round trip to model). Defensible, but a new contributor will ask.
- **`Partner` data is app config, not inventory** — imported directly with no service, unlike flights/hotels/activities. Deliberate, and the one list screen with no loading state.
- **Form field styling is duplicated** between `FlightSearchForm` and `HotelFilterPanel`. A shared `Field`/`Select` primitive is the obvious extraction; deferred to avoid speculative abstraction.
- **`Trip.draftId` is optional** for backwards compatibility with trips saved before dedupe existed. It can become required once no such data is in the wild.

### 5.3 Asset debt

- 14 images, ~1.9 MB total, bundled as JPEGs. No `srcset` beyond the landing hero, no WebP/AVIF.
- Inter loads from Google Fonts — the app's only external request. It degrades to the system stack, but self-hosting removes the dependency and the FOUT.
- CC BY-SA imagery requires attribution; `assets/CREDITS.md` must stay in sync with any swap.

### 5.4 Content debt

- Each activity category holds exactly one activity, so filtering is proven but unimpressive.
- Only one destination template (Bali) has bespoke itinerary content; everything else falls back to generic day templates.

---

## 6. Recommendations before Phase 2

**Do these first — they are cheap and they de-risk everything after:**

1. **Install Vitest + jsdom and port the audit suite into `src/**/*.test.ts`.** The checks already exist; they just need a permanent home. Prioritise: the pure functions (`calculateTripCosts`, `applyHotelFilters`, `sortHotels`, `groupItineraryStops`, prompt parsing), then the services against a fake storage, then component render tests for the states SSR cannot reach.
2. **Open the app in a browser at 375 / 768 / 1440 px** and walk the eleven routes. Specifically unconfirmed: the sticky planner composer above the bottom bar on iOS, horizontal card scrolling, map label collisions on narrow screens, the sidebar at short viewport heights, and safe-area padding on a real device.
3. **Decide the demo trip's canonical dates** (issue #6). Every downstream cost display depends on it.

**Then, before backend work starts:**

4. **Freeze the service contracts.** `tripService`, `plannerService`, `flightService`, `hotelService`, `activityService` and `searchService` are the entire surface Stage 2 replaces. Write the endpoint mapping down — `createTrip` → `POST /api/trips`, `generateItinerary` → `POST /api/planner/generate` — and treat any component that reaches around them as a bug.
5. **Plan the localStorage → API migration.** Trips carry client-generated ids (`trip_<uuid>`) and `draftId`; the server will issue its own. Decide now whether first login uploads local trips and remaps ids, or whether local data is simply dropped.
6. **Add the toast system** (issue #4) before more screens invent their own inline status lines — there are five already.
7. **Introduce an auth boundary** while the app still has none: `CURRENT_USER` is a single guest constant, and every screen reads it directly. A `useCurrentUser()` hook now means Stage 2 changes one file.

**Nice to have, not blocking:**

8. Dark mode (issue #3) — the token architecture already supports it; it needs a dark value set and a `data-theme` switch.
9. Trip editing (issue #5) — the persistence layer is ready and tested; only the UI is missing.
10. Self-host Inter, and generate WebP variants of the 14 images.

---

## 7. Audit method

- **Static:** `tsc -b --noEmit` (strict), `oxlint`, production build, plus greps for direct `localStorage` access, raw colour values, `any`, and `TODO`.
- **Dynamic:** the real route table (`src/app/routeTable.tsx`) mounted in a memory router and server-rendered at 18 paths, with `console.error`/`console.warn` captured throughout, every rendered `href` matched against the route table, and per-page assertions for landmarks, headings, loading states, and ARIA wiring. 61/61 passed.
- **Not covered:** anything requiring a real DOM — layout, paint, scroll behaviour, focus order in practice, and any state behind a `useEffect`.
