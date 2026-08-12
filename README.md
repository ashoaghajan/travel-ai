# AI Travel Planner

## Running it

The app is now two processes: the SPA, and an API that owns accounts. Both are
needed — every screen except the landing and auth pages requires signing in.

```bash
npm install

# The database. Needs Docker running; nothing else to install.
docker compose up -d

# One-time: server configuration.
cp server/.env.example server/.env
# Put a JWT_SECRET in it. Generate one with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# Every other key in that file is optional; each one names what is lost
# without it. ABLY_API_KEY is the newest — without it messages still work,
# it just stops updating until you refresh.
npm run db:migrate

# Two terminals, or two tabs:
npm run dev:api    # API   → http://localhost:3001
npm run dev        # SPA   → http://localhost:5173
```

The SPA proxies `/api` to the API, which makes them same-origin — that is what
lets the refresh cookie work with no CORS configuration at all, and the shape
production has to preserve.

The database is Postgres, on host port **5433** rather than 5432 — the default
is claimed too often for a first `docker compose up` to be reliable, and
connecting to somebody else's database is a worse failure than a refused
connection. `docker compose down -v` throws the data away.

It was SQLite until deployment made that untenable: a SQLite database is a
file, and a host gives you a fresh filesystem on every release, so accounts and
sessions would not survive one.

```bash
npm test          # SPA suite
npm run test:api  # API suite — needs `docker compose up -d`
npm run typecheck
npm run lint
```

The API suite runs against a real Postgres, in its own `aitravel_test`
database which it creates on demand. Not a mocked client: the unique
constraint on `emailKey`, the cascade deletes and the family-wide token revoke
are behaviours of the database, and a mock would assert only that we called it.

---

## 1. Product Vision

AI Travel Planner is an AI-powered travel planning application that helps users plan trips faster and more intelligently.

The product should allow users to:

- Generate complete travel itineraries
- Build and edit day-by-day trip plans
- Browse mock flights, hotels, and activities
- View a trip route on a map-style screen
- Save trips locally in the first version
- Later sync trips across devices through a backend
- Eventually redirect users to travel partners or integrate real travel APIs

The first version must focus on proving the product experience without backend complexity.

---

## 2. Development Strategy

The application will be built in two main stages.

```txt
Stage 1: Frontend-only MVP
Stage 2: Backend integration
```

---

# Stage 1: Frontend-Only MVP

## Goal

Build a fully usable frontend application without a backend.

All data should be stored in the browser using localStorage.

No real flight, hotel, booking, payment, or AI API is required in Stage 1.

Use mock data and mocked AI responses.

---

## Stage 1 Tech Stack

```txt
React
TypeScript
Vite
React Router
LocalStorage
Mock data
CSS Modules or one chosen styling approach
```

Optional, if useful:

```txt
Zustand
TanStack Query
Mantine UI
Mapbox or Google Maps later
```

For the first MVP, avoid unnecessary complexity.

---

## Stage 1 Main Features

### 1. Landing Page

The user should see a polished travel-focused landing page with:

- Product name
- Hero travel image
- Main call-to-action
- Secondary sign-in button
- Three feature cards

Example headline:

```txt
Your AI Travel Planner
Plan the perfect trip in minutes.
Customised. Smart. Effortless.
```

---

### 2. AI Planner Dashboard

The main planning screen should behave like an AI chat planner.

The user can type a prompt such as:

```txt
Plan a 7-day trip to Bali for a couple in June. We love beaches, nature and good food.
```

The application should then show a mocked AI response and generate a sample itinerary.

The screen should include:

- Sidebar on desktop
- Chat messages
- Prompt input
- Generated itinerary preview cards
- Recent trips section
- Save trip action

---

### 3. Trip Management

The user should be able to:

- Save a generated trip
- View saved trips
- Open a trip details page
- Delete a trip
- Update a trip locally

All saved trips must be persisted in localStorage.

---

### 4. Trip Details Page

The user should see a full itinerary view containing:

- Trip name
- Trip dates
- Number of travellers
- Day-by-day itinerary timeline
- Map or map placeholder
- Tabs for itinerary, map, bookings, and notes

The map can be mocked in Stage 1. It does not need to use a real map provider immediately.

---

### 5. Flight Search Page

The user should see a mock flight search screen.

Required elements:

- Trip type tabs
- From field
- To field
- Departure date
- Return date
- Travellers
- Search button
- Mock flight result cards
- Sort option

Use mock data only.

---

### 6. Hotel Search Page

The user should see a mock hotel listing screen.

Required elements:

- Destination heading
- Date and guest information
- Filter button
- Sort button
- Map button
- Hotel cards with image, name, rating, reviews, and price

Use mock data only.

---

### 7. Activities Explorer

The user should be able to browse mocked travel activities.

Required elements:

- Category chips
- Activity cards
- Image
- Title
- Description
- Price
- Rating

Categories can include:

```txt
All
Nature
Adventure
Culture
Food
```

---

### 8. Partner Booking Page

In Stage 1, the app should not perform direct bookings.

Instead, show partner cards such as:

```txt
Expedia
Booking.com
Trip.com
GetYourGuide
```

Each partner card should have a simple button:

```txt
View Deals
```

The user should understand that booking happens outside the application.

"View Deals" is a real outbound link, prefilled from the reader's last flight
search — route, dates and party size — so they land on the partner's results
rather than an empty form. Where a partner needs something the app cannot
supply, the link falls back to that partner's home page. This is still not a
booking: no partner API is called, no key is held and no payment is taken. See
`src/features/bookings/partner.links.ts`.

---

### 9. Trip Summary Page

The trip summary should show:

- Trip cover image
- Trip name
- Dates
- Travellers
- Flight estimate
- Hotel estimate
- Activity estimate
- Total estimate
- Save Trip button
- Share Trip button

Example:

```txt
Flights              $2,248
Hotels 7 nights      $1,260
Activities 4           $200
Total USD            $3,708
```

---

## Stage 1 LocalStorage Keys

Use predictable localStorage keys.

```txt
ai-travel-planner:trips
ai-travel-planner:activeTripId
ai-travel-planner:chatHistory
ai-travel-planner:settings
ai-travel-planner:recentSearches
```

---

## Stage 1 Recommended Routes

Stage 2 added `/login` and `/register`. They sit outside `AppShell` alongside
the landing page; every route below them now requires an account.

```txt
/
/login
/register
/planner
/trips
/trips/:tripId
/trips/:tripId/summary
/flights
/hotels
/activities
/bookings
/profile
/settings
```

---

## Stage 1 Recommended Folder Structure

```txt
src/
  app/
    App.tsx
    router.tsx
    theme.ts
  assets/
  components/
    common/
    layout/
    cards/
    navigation/
  features/
    planner/
    trips/
    flights/
    hotels/
    activities/
    bookings/
  mock/
    trips.ts
    flights.ts
    hotels.ts
    activities.ts
    partners.ts
  services/
    localStorage.service.ts
    mockAi.service.ts
    trip.service.ts
  store/
    trip.store.ts
    ui.store.ts
  types/
    trip.types.ts
    travel.types.ts
  utils/
```

---

## Stage 1 Data Models

### Trip

```ts
export type Trip = {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  travellers: number;
  coverImage: string;
  itinerary: ItineraryDay[];
  flightsEstimate?: number;
  hotelsEstimate?: number;
  activitiesEstimate?: number;
  createdAt: string;
  updatedAt: string;
};
```

### ItineraryDay

```ts
export type ItineraryDay = {
  id: string;
  dayNumber: number;
  date: string;
  destination: string;
  summary: string;
  activities: ItineraryActivity[];
  coordinates?: {
    lat: number;
    lng: number;
  };
};
```

### ItineraryActivity

```ts
export type ItineraryActivity = {
  id: string;
  time: string;
  title: string;
  description: string;
  category: "food" | "nature" | "culture" | "adventure" | "relaxation" | "travel";
  priceEstimate?: number;
  image?: string;
};
```

### Flight

```ts
export type Flight = {
  id: string;
  airline: string;
  from: string;
  to: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  price: number;
};
```

### Hotel

```ts
export type Hotel = {
  id: string;
  name: string;
  location: string;
  category: string;
  rating: number;
  reviews: number;
  pricePerNight: number;
  image: string;
};
```

### Activity

```ts
export type Activity = {
  id: string;
  title: string;
  category: string;
  description: string;
  price: number;
  rating: number;
  reviews: number;
  image: string;
};
```

---

## Stage 1 Mock Trip

Use this as the default demo trip.

```txt
Bali Adventure
May 20 - May 28
2 Travellers
```

Destinations:

```txt
Ubud
Nusa Penida
Uluwatu
Seminyak
Canggu
```

Trip theme:

```txt
Beaches
Nature
Food
Culture
Relaxation
```

The mock trip should include:

- 7 itinerary days
- 3 flight results
- 4 hotel results
- 4 activity results
- 4 partner booking options
- Cost summary

---

## Stage 1 Implementation Order

Build in this order:

```txt
1. Project setup
2. Global theme tokens
3. App shell
4. Routing
5. Landing page
6. Planner dashboard
7. Sidebar and mobile bottom navigation
8. LocalStorage service
9. Mock AI itinerary generation
10. Trips page
11. Trip details page
12. Mock map view
13. Flight search page
14. Hotel search page
15. Activities page
16. Partner booking page
17. Trip summary page
18. Responsive polish
19. Loading, empty, and error states
```

---

## Stage 1 Definition Of Done

Stage 1 is complete when:

```txt
[ ] Landing page exists
[ ] Planner dashboard exists
[ ] User can type a trip request
[ ] Mock AI itinerary is generated
[ ] Trip can be saved to localStorage
[ ] Saved trips can be viewed
[ ] Trip details page exists
[ ] Itinerary timeline exists
[ ] Map placeholder or map view exists
[ ] Flight search with mock data exists
[ ] Hotel search with mock data exists
[ ] Activities explorer with mock data exists
[ ] Partner booking page exists
[ ] Trip summary page exists
[ ] App works on desktop
[ ] App works on mobile
[ ] Design tokens are used consistently
```

---

# Stage 2: Backend Integration

## Goal

Replace local-only storage with a real backend so users can access trips across devices.

---

## Stage 2 Tech Stack

```txt
Node.js
Express
PostgreSQL
Prisma ORM
JWT authentication
```

Possible hosting:

```txt
Frontend: Vercel or Azure Static Web Apps
Backend: Azure App Service, Railway, Render, or similar
Database: Azure PostgreSQL, Supabase, Neon, or similar
```

---

## Stage 2 Main Features

### 1. Authentication — **built**

Register, login, logout and the current-user endpoint are implemented, along
with token refresh. Password reset is still deferred, and there is no email
verification.

```txt
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/me
PATCH /api/me
```

How it works, and why:

- **Passwords** are hashed with argon2id (`@node-rs/argon2` — prebuilt, so no
  native toolchain is needed). Minimum ten characters, no composition rules.
- **Access tokens** are JWTs that live for fifteen minutes in a module
  variable, never in storage. An XSS that sweeps `localStorage` finds nothing,
  and because the token is attached by hand there is no CSRF surface.
- **Refresh tokens** are 32 opaque random bytes in an `httpOnly` cookie scoped
  to `/api/auth`, rotated on every use. Only their sha256 is stored. Replaying
  a rotated token revokes its whole family — except within a five-second grace
  window, which is what stops two tabs waking together from signing each other
  out.
- **A sign-in lasts six hours**, counted from the sign-in itself
  (`SESSION_TTL_HOURS`). An absolute cap rather than an idle timeout: rotation
  inherits the deadline the session was born with, so refreshing buys no extra
  time and leaving the app overnight always means signing in again. A sliding
  window would have kept an active reader signed in indefinitely, which is the
  behaviour this replaced.
- **The cost** of an in-memory token is that a reload has no session until the
  cookie has been exchanged. `AuthBootstrap` does that once before any route
  renders; without it every refresh would bounce a signed-in user to `/login`.
- **Login and registration are rate-limited**, by address and by account. The
  original Stage 2 plan throttled only the public explore endpoints, which
  left credential stuffing unmetered.

**Guest mode is gone.** Everything inside `AppShell` requires an account; only
the landing page and the two auth pages are public. This resolves the open
question STAGE_2_PLAN raised as risk #24.

---

### Sign in with Google

The Google Identity Services button hands the browser an ID token; the server
verifies it and issues one of our own sessions, so everything downstream —
refresh, boot, per-account local data — is identical whichever door was used.

```txt
POST   /api/auth/google         sign in or sign up
POST   /api/auth/google/link    connect, while signed in
DELETE /api/auth/google/link    disconnect
```

**No client secret is involved.** Verifying an ID token needs only the public
client id, which is why this flow suits an app whose frontend is a static
bundle. If you find yourself pasting a secret somewhere, something is wrong.

**A collision with a password account is refused, not linked.** Most products
link automatically when the email matches, and that is unsafe here: our own
signups are not email-verified, so anyone could register an address they do not
own and wait for its owner to arrive through Google. Instead:

| Situation | Result |
|---|---|
| Google email is new | Account created, signed in |
| Identity already known (matched on Google's `sub`) | Signed in |
| Email belongs to a password account | Refused — sign in with the password, then connect from Profile |
| Signed in, connecting from Profile | Linked |

Identities are keyed on Google's `sub`, never on email, because a Google
account's address can change. Disconnecting is refused when it would leave no
way to sign in. The proper fix for the collision case is to verify password
signups by email and then link safely; that needs a mail provider and has not
been done.

#### Creating the client id

Nothing above works until you make one. Google moved this out of *APIs &
Services → Credentials* into the **Google Auth Platform**:

1. Go to **[console.cloud.google.com/auth/clients](https://console.cloud.google.com/auth/clients)**,
   create or pick a project, then **Create client** → application type
   **Web application**.
2. **Authorised JavaScript origins** — add *both*:

   ```txt
   http://localhost
   http://localhost:5173
   ```

   Scheme, host and port only. **A trailing slash or a path is rejected**, and
   a wrong origin is the usual cause of a button that renders but refuses to
   sign anyone in. Leave *Authorised redirect URIs* empty: this flow returns
   the credential to a JavaScript callback and never redirects.
3. Configure the consent screen at
   **[console.cloud.google.com/auth/branding](https://console.cloud.google.com/auth/branding)**
   — app name and support email, audience **External**, and add your own
   address as a test user. That is enough for development.
4. Copy the **Client ID**, ending `.apps.googleusercontent.com`. **Ignore the
   client secret** — this flow never uses one, and it should not be pasted
   anywhere.
5. Put the same value in `.env.local` as `VITE_GOOGLE_CLIENT_ID` and in
   `server/.env` as `GOOGLE_CLIENT_ID`. **Restart both processes**: Vite and
   the API read their environment only at startup, so the button will not
   appear until you do.

Google One Tap requires HTTPS, but this implementation uses the explicit
rendered button, so plain `http://localhost` is fine.

Until a client id is set the button is absent and email sign-in works as
before. In development the sign-in pages say so where the button would be.

---

### 2. Trips API

Replace localStorage trip persistence with backend APIs.

```txt
GET    /api/trips
GET    /api/trips/:id
POST   /api/trips
PATCH  /api/trips/:id
DELETE /api/trips/:id
```

---

### Moving a trip between accounts — **built**

A trip can be exported to a file and imported into somebody else's account.
Export is the download icon in the trip details header; import is on the
My Trips page, beside "New Trip" and in the empty state.

**There is no import endpoint.** `POST /api/trips` already accepts a whole trip
and mints the id itself, so an import is a create whose body came off disk —
which means `createTripSchema` is still the single thing deciding what a trip
may contain, on an imported trip exactly as on a typed one. The client half
(`src/utils/tripFile.ts`) is structural only: it turns bytes into a `TripDraft`,
or says in one sentence why it cannot.

The file:

```jsonc
{
  "kind": "ai-travel.trip",
  "version": 1,
  "exportedAt": "2026-08-11T09:14:22.317Z",
  "trip": { "title": "…", "startDate": "…", "itinerary": [ … ], "notes": [ … ] }
}
```

- **Bookings are not in it.** An itinerary activity is a guess and copies
  harmlessly; a booking is a fact about the exporter — a confirmation number,
  a price they paid — and writing it into another account would state their
  booking as the importer's own. Notes travel, because they are part of the plan.
- **Nothing identifying the exporter is in it** either: no name, no email, no
  user id. A file that says who made it is a file that leaks who made it.
- **`id`, `draftId`, `createdAt`, `updatedAt` and `version` are stripped.** The
  importer's copy is a new trip, not a claim to be the old one. Exporting
  `draftId` in particular would make a second import of the same file collide
  on `@@unique([userId, draftId])` and silently return the first trip.
- **Day and activity ids are re-minted on import.** Nothing outside the trip's
  own JSON points at them, and the schema bounds their length without requiring
  them to be distinct — so a hand-edited file could otherwise give two
  activities one id, and the editor would delete both when asked for one.
  `sourceActivityId` is preserved: it is what stops the same attraction being
  added to a day twice.
- **Bundled photographs travel by name, not by URL.** Every picture the app
  ships is a Vite asset import, so what a trip stores is whatever *this* build
  resolved it to — `/src/assets/generic/coast.jpg` on a laptop,
  `/assets/coast-9f2a1b.jpg` in a deployment, a different hash again next
  build. A file therefore carries `coverImageId` on the trip and `imageId` on
  each day and activity, and the importer resolves those against its own build
  (`src/assets/bundled-images.ts`). Without it, a trip exported from localhost
  and imported into staging would point every photograph at a path that
  environment has never served. The URL stays in the file as the fallback for
  anything not ours — an OpenTripMap photo needs no translation.
- **A newer `version` is refused, not best-guessed.** A version 2 file may carry
  a whole section this reader has never heard of, and silently dropping half a
  trip is worse than asking someone to update.
- **Image URLs are filtered to `http(s)` and bundled asset paths.** Not an XSS
  guard — `<img src>` is not a script context — but the app only ever writes
  those two shapes, and a file from a stranger can carry a megabyte of inline
  `data:` per activity.

Importing a trip the account already holds — same title, same dates — warns and
offers "Import anyway". Nothing is ever overwritten. One draft key is minted per
file chosen, so a retry after a lost reply resolves to the trip that may already
have been created rather than making a second, while picking the file again
later deliberately makes a new one.

Bodies are capped at 1 MB by `express.json`; over that the API answers **413
`PAYLOAD_TOO_LARGE`** rather than the 500 it used to, and the client refuses a
file over 4 MB before reading it at all.

---

### 3. Planner API

Move itinerary generation to the backend.

```txt
POST /api/planner/generate
```

The frontend sends the user prompt.

The backend returns a structured itinerary.

---

### 4. AI Integration

Integrate one AI provider later.

Possible providers:

```txt
OpenAI
Azure OpenAI
```

Expected flow:

```txt
User prompt
Frontend
Backend API
AI provider
Structured itinerary response
Database save
Frontend render
```

---

### 5. Real Travel APIs

Only integrate real travel APIs after the MVP is validated.

Possible future APIs:

```txt
Flights: Duffel, Travelpayouts (Aviasales), Kiwi
Hotels: Booking.com partner APIs, Expedia partner APIs
Activities: GetYourGuide, Viator
Maps: Google Maps, Mapbox
```

Amadeus used to head that flights list. It no longer belongs there: Amadeus
decommissioned its Self-Service developer portal on 17 July 2026 and disabled
the keys issued through it. Its Enterprise APIs continue, but they are a sales
process, not a signup. Of the replacements, Duffel is self-serve with a free
sandbox and a paid production tier, and Travelpayouts is free but returns
cached prices rather than a live search.

Every one of them is server-side only — none send `Access-Control-Allow-Origin`,
so they cannot be called from the browser whatever the price. That is why real
flight data waits for the Stage 2 backend to proxy it.

Do not integrate real paid APIs in Stage 1.

---

### 6. Multi-Device Sync

After backend integration, users should be able to log in from mobile and desktop and see the same saved trips.

This is not possible with localStorage only.

---

### 7. Direct messages — **built**

Private conversations between two accounts. A panel docked beside the main
content on desktop — the people on the left, the conversation on the right — a
full-screen drill-down on a phone, and a toggle in the page header carrying a
count of everything waiting.

It replaced a single public room that every signed-in account shared. The room
worked, but it was the wrong product: what was wanted was a list of people you
could pick one of. `LobbyMessage` and its table are gone (dropped in
`20260812090000_drop_lobby_messages`), and a great deal of the room carried over
unchanged — the optimistic bubble, the retry story, the presence rules and the
no-publish token below are all its work.

```txt
GET    /api/messages/conversations       every account but yours, + last message + unread
GET    /api/messages/with/:userId        the newest 50 of that thread, oldest first
POST   /api/messages/with/:userId        30 per minute, per account
POST   /api/messages/with/:userId/read   move the read cursor to now
DELETE /api/messages/:id                 your own only
GET    /api/messages/token               an hour-long listening token
```

Nothing here is called `chat`. That word is already spoken for by the private
transcript between one reader and the planner (`planner.types.ts`), and the two
have opposite shapes: that is one conversation per account, read and written
whole by its owner; this is appended to by two writers and read as a tail. So
`DirectMessage` is a relational table rather than a JSON document.

**A conversation is an unordered pair**, and `pairKey` — `min(a,b):max(a,b)`,
written on create and never accepted from a client — is what gives it an
identity. Without it every thread read is `(a=A AND b=B) OR (a=B AND b=A)`,
which no single index serves.

**The client cannot publish.** Realtime is Ably, and the API key never leaves
the server; the browser gets a token this server signs, pinned to the caller's
own user id. It grants `subscribe` on `user:<caller>` and `subscribe` +
`presence` on `presence:global`, and deliberately **not** `publish` anywhere.
So every message goes through `POST /api/messages/with/:userId`, where it is
validated, throttled and written down before anyone sees it — and one browser
physically cannot attach to another person's inbox, which is what makes a
private conversation private at the transport rather than by a filter in a
query. A test asserts that exact capability JSON, because it is the line the
whole design rests on.

**Two channels, and a message publishes to both ends.** `user:<recipientId>` is
obvious; `user:<senderId>` is not redundant — it is how the sender's other tabs
and their phone learn about a message they sent from this one. Presence is
global and on its own channel, because the people list shows everyone's status
rather than only the status of people you already have a thread with.

`ABLY_API_KEY` is optional and the degradation is deliberate: without it
messages still send, persist and load — you just reopen a conversation to see
anything new. `GET /api/messages/token` answers `PROVIDER_NOT_CONFIGURED`, the
connection resolves to `unavailable`, and the panel's subtitle reads "Not live
— reopen to refresh" rather than looking broken or silently going stale. **The
key's capability must cover `presence:*` and `user:*`**; a key scoped to only
one of them mints tokens for the other that report success and then deliver
nothing, forever. See `server/.env.example`.

`clientMessageId` carries the retry story on both sides. A sleeping instance
takes about a minute to answer and the reader will press the button again long
before it does, so a send is an upsert on `(senderId, clientMessageId)` and the
second attempt returns the first message instead of duplicating it. In the
browser, unconfirmed sends live in their own list: with no server id they cannot
collide with anything that has one, so confirmed messages upsert by id and the
POST response and the copy off the channel produce identical state in either
order — which matters, because the channel usually wins.

**Unread is a cursor in Postgres**, not a tally kept since this tab opened.
`ConversationRead` holds one row per conversation a reader has opened, and
opening a thread moves it to now — so reading on a phone clears the badge on the
laptop, and a reload does not resurrect it. A cursor rather than a `readAt` per
message: marking a thread read is then one upsert instead of an UPDATE across
every row in it.

**Every account is listable, by name.** `/messages/conversations` returns every
account but the caller's, capped at 200 and filterable with `?q=`, because you
cannot message somebody you cannot find. That knowingly reverses the public
room's narrower rule, and it is recorded rather than discovered later. An email
never leaves the server: the query projects `id` and `name` only, and a test
asserts the serialised body contains no address at all.

**Presence is Ably's, not ours.** `enter()` on connect, `get()` for the roster,
`subscribe()` for changes — no heartbeat, no `lastSeenAt` column, no reaper,
and nothing to go stale the day a second instance appears. Three rules carry
it, and each is a bug inverted:

- **Rebuild from `presence.get()` on every event; never apply the event.**
  Closing one of three tabs fires `leave` while the person is still present in
  the other two. `get()` reads the SDK's local member map, so this is free.
- **Dedupe by `clientId`** — the user's id, pinned server-side when the token
  is signed. Three tabs are three members and one person.
- **Enter carrying nothing.** The `presence` capability lets a client enter
  with arbitrary data beside its correctly-pinned id, so a name taken from
  there would be whatever that client typed. Names come from the server-side
  join and nowhere else.

`close()` leaves the presence set before closing the socket, and `reset()` goes
through it — otherwise a signed-out reader stays online to everyone else until
Ably times the member out. Signing out also drops every thread: private
conversations are exactly what the next person on this browser must not inherit.

**A cold instance is visible only here.** The API sleeps after fifteen idle
minutes and takes about a minute to wake. Every other screen simply waits; this
is the one place where the other person's messages keep arriving over the socket
while your own send hangs, which reads as broken for you specifically. So a
pending bubble escalates — silent, then "Sending…", then "Still sending — the
server may be waking up." — and focusing the composer pings `/health` if nothing
has succeeded in ten minutes. **On focus, never on an interval:** a periodic
ping would burn the free tier's instance-hours and defeat the sleeping it exists
to work around.

**Still no report and no block**, and that matters more than it did for a public
room: an unwanted private message has no witness. Proportionate for a small,
trusted group, and the trigger is written down — if this ever opens past one,
report and block come before any other messaging feature. Soft delete is kept
precisely so that stays possible.

---

### 8. Sharing a trip through a conversation — **built**

A trip can be handed to somebody you can message. It arrives in the thread as a
card, opens as a read-only itinerary, and becomes their own copy only if they
accept it.

```txt
POST   /api/trips/:id/share   { toUserId, trip }  → the message carrying it
GET    /api/shares/:id                             → the snapshot, either party only
POST   /api/shares/:id/accept { trip }             → the new trip; idempotent
DELETE /api/shares/:id                             → withdraw, sender only, before acceptance
```

**The snapshot is an `ExportedTrip`** — byte for byte the document `Export`
already writes to a file. The format, its validation and the code that turns it
back into a trip all existed before this feature did, so nothing here is a
second answer to "what is a trip when it moves": new ids, notes travel,
bookings do not.

**The browser builds that snapshot, not the server**, and it has to. A bundled
photograph's URL is a content hash (`/assets/city-9f2a1b.jpg`) that differs
between one build and the next, so the URL alone would point the recipient at a
file their copy of the app has never served. `bundledImageId` turns it back into
`city`, and that map lives in the client bundle. The server's job is to refuse
anything not shaped like a trip, which is `share.schemas.ts`.

**A share is a message.** It lands in the thread on the channel that already
exists — no second inbox, no new realtime work — and the row is written by one
nested create alongside the message, because half of that pair existing is the
one state this must never reach. The message still carries a body ("Shared a
trip: Berlin in Early Autumn"), which is what the conversation list previews and
what a screen reader reads.

**Offer, never convert.** Nothing enters the recipient's account until they
accept, which is the same principle that keeps an itinerary activity a guess and
a booking a fact. Accepting is idempotent through a `draftId` derived from the
share, so a double tap on a sleeping instance cannot leave two copies — the
protection `clientMessageId` gives a send, for the same reason.

**A snapshot outlives its source.** `TripShare.tripId` is nullable and nulls on
delete, so an offer already on somebody's screen still opens after the sender has
deleted the trip it came from. Editing the original afterwards does not rewrite
what was handed over, in either direction.

**Withdrawing works until it does not.** The sender can take back an offer nobody
has taken up; once somebody has added the trip it is theirs, and reaching into
another account to delete a trip is not what revoke means. The card says which of
those happened rather than disappearing.

---

## Backend Preparation Rule

Even in Stage 1, frontend services should be written as if they will later call APIs.

Use service methods such as:

```txt
tripService.getTrips()
tripService.createTrip()
tripService.updateTrip()
tripService.deleteTrip()
plannerService.generateItinerary()
```

In Stage 1, these methods use localStorage and mock data.

In Stage 2, these methods should call Express API endpoints.

---

# Short Instruction For Coding Agent

```txt
Build the AI Travel Planner React + TypeScript app in two stages. Start with Stage 1 only. Do not build backend yet. Use localStorage and mock data. Implement the screens, routes, data models, and folder structure described in README.md. Follow DESIGN_SPEC.md for all visual design decisions. Keep services abstracted so Stage 2 can replace localStorage with Node.js + Express APIs later.
```
