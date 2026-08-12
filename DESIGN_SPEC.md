# AI Travel Planner Design Spec

## 1. Purpose

This file describes how the AI Travel Planner application should look and feel.

Treat this file as the visual design source of truth.

The goal is to help a coding agent recreate the generated concept image as a real React application without requiring a Figma file.

This file focuses on appearance, layout, UI components, visual behaviour, and screen composition.

Functional planning and implementation order are described in README.md.

---

## 2. Visual Direction

The application should feel like a modern AI travel assistant.

The design should be:

- Modern
- Clean
- Premium
- Friendly
- AI-first
- Travel-focused
- Calm
- Spacious
- Easy to scan

The visual style should feel like a mix of:

```txt
Airbnb
TripIt
Notion
ChatGPT
Modern SaaS dashboard
Modern mobile travel app
```

Use:

- White cards
- Light grey page backgrounds
- Purple brand accents
- Large rounded corners
- Soft shadows
- Travel photography
- Clean typography
- Dashboard layout on desktop
- Mobile-app layout on small screens

---

## 3. Brand Identity

Product name:

```txt
AI Travel Planner
```

Short brand label:

```txt
AI Travel
```

Tone:

- Smart
- Helpful
- Calm
- Clear
- Premium but accessible
- Minimal but not empty

---

## 4. Colour System

Use these colours consistently.

```css
:root {
  --color-primary: #6d3fef;
  --color-primary-hover: #5b32d6;
  --color-primary-soft: #efe9ff;

  --color-background: #f7f8fc;
  --color-surface: #ffffff;
  --color-surface-muted: #f3f4f8;

  --color-border: #e5e7ef;

  --color-text-main: #111827;
  --color-text-muted: #6b7280;
  --color-text-light: #ffffff;

  --color-success: #16a34a;
  --color-warning: #f59e0b;
  --color-danger: #dc2626;

  --color-map-route: #6d3fef;
}
```

## Colour Usage Rules

- Primary buttons must use purple.
- Active navigation item should use soft purple background and purple text.
- User chat bubbles should use purple background with white text.
- AI chat bubbles should use light grey background with dark text.
- Page background should be very light grey.
- Cards should be white.
- Borders should be subtle light grey.
- Map route lines and map pins should be purple.
- Avoid heavy black borders.

---

## 5. Typography

Use Inter or a similar modern sans-serif font.

```css
font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Recommended type scale:

```css
--font-xs: 12px;
--font-sm: 14px;
--font-md: 16px;
--font-lg: 20px;
--font-xl: 28px;
--font-2xl: 36px;
```

Typography usage:

- Hero title: 36px, bold
- Page title: 24px to 28px, semibold
- Section title: 18px to 20px, semibold
- Card title: 15px to 16px, semibold
- Body text: 14px to 16px
- Metadata: 12px to 13px, muted grey

---

## 6. Spacing, Radius, And Shadows

Use generous spacing.

```css
--space-xs: 4px;
--space-sm: 8px;
--space-md: 12px;
--space-lg: 16px;
--space-xl: 24px;
--space-2xl: 32px;
```

Border radius:

```css
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 18px;
--radius-xl: 24px;
```

Shadows:

```css
--shadow-card: 0 8px 24px rgba(17, 24, 39, 0.08);
--shadow-soft: 0 4px 14px rgba(17, 24, 39, 0.06);
```

Rules:

- All cards should have rounded corners.
- Buttons should have rounded corners.
- Inputs should have rounded corners.
- Shadows should be soft.
- Avoid sharp rectangular UI.
- Avoid dense layouts.

---

## 7. Responsive Layout

The app should support desktop web and mobile web.

### Desktop Layout

Use a dashboard shell.

```txt
| Sidebar | Main Content |
```

Sidebar width:

```css
width: 280px;
```

Main content:

```css
padding: 24px;
background: #f7f8fc;
```

### Mobile Layout

Use a mobile app style layout.

- Hide desktop sidebar.
- Show bottom navigation.
- Use full-width cards.
- Stack content vertically.
- Use sticky headers where helpful.

Mobile bottom navigation items:

```txt
Home
Trips
Explore
Bookings
Profile
```

Breakpoints:

```txt
Mobile: 0px to 767px
Tablet: 768px to 1023px
Desktop: 1024px and above
```

---

# 8. Screen Designs

## Screen 1: Landing Page

Route:

```txt
/
```

Purpose:

Introduce the product and let the user start planning.

Visual layout:

- Full-screen scenic travel background image.
- Dark overlay on top of the image.
- Logo in the top-left.
- Main headline in the centre or centre-left.
- Two buttons below headline.
- Three white feature cards near the bottom.

Text:

```txt
Your AI Travel Planner
Plan the perfect trip in minutes.
Customised. Smart. Effortless.
```

Buttons:

```txt
Get Started
Sign In
```

Both now lead to an account: "Get Started" opens `/register`, "Sign In" opens
`/login`. The planner is behind the auth boundary, so neither can enter the app
directly any more.

Feature cards:

```txt
Smart Itineraries
Real-time Options
Book with Confidence
```

Visual requirements:

- Hero text should be white.
- Primary CTA should be purple.
- Secondary button should be semi-transparent or muted.
- Feature cards should be white with small purple icons.
- Background image should feel like mountains, lake, island, or premium travel.

---

## Screen 1b: Sign In and Create Account

Routes:

```txt
/login
/register
```

Purpose:

Open or resume an account. Added in Stage 2; this spec previously described no
auth screens at all, so the layout below is a record of what was built rather
than a design that predated it.

Both share one frame: logo top-left, a single white card centred on the page
background, at most 26rem wide.

Sign in fields:

```txt
Email
Password
```

Create account fields:

```txt
Name
Email
Password
```

Copy:

```txt
Welcome back / Sign in to reach your trips from anywhere.
Create your account / Save your trips and pick them up on any device.
```

Above the fields, when Google sign-in is configured, sits Google's own button
and an "or" divider. The button is rendered by Google's script rather than
drawn by us — their branding terms require the real thing — so it does not
follow this spec's button styling. Button and divider appear and disappear
together; with no client id configured, neither is present.

Visual requirements:

- Fields reuse Screen 3's control styling exactly — same height, radius, border
  and focus ring.
- Submit is a full-width purple primary button; while it is working the label
  changes to "Signing in…" / "Creating your account…" and it is disabled.
- Field errors appear under the field in danger red, and only after the first
  submit attempt — never while the user is still typing.
- A server error appears above the submit button on a soft danger background.
- The password field on Create account carries a hint: "At least 10 characters.
  Length beats punctuation."
- Each card ends with a link to the other screen.

---

## Screen 2: AI Planner Dashboard

Route:

```txt
/planner
```

Purpose:

Main AI chat planning screen.

Desktop layout:

```txt
Left sidebar
Main planner area
```

Sidebar content:

```txt
AI Travel
+ New Trip
Home
Trips
Explore
Bookings
Profile
Settings
Recent Trips
Upgrade to Pro
```

Recent trips examples:

```txt
Bali Adventure
May 20 - May 28

Europe Summer
Jun 10 - Jun 20

Japan in Autumn
Nov 5 - Nov 15
```

Main header:

```txt
AI Travel Planner
```

Top-right header icons:

- Share icon
- Bookmark icon
- User avatar

Chat design:

- User message aligned to the right.
- User message has purple background and white text.
- AI message aligned to the left.
- AI message has soft grey background and dark text.

Example user message:

```txt
Plan a 7-day trip to Bali for a couple in June. We love beaches, nature and good food.
```

Example AI message:

```txt
Sure! Here's a 7-day Bali itinerary crafted for you:
```

Itinerary preview:

Cards should appear horizontally on desktop.

Each card should contain:

- Travel image
- Day number
- Destination
- Short description

Cards:

```txt
Day 1
Ubud
Welcome & relax in Ubud

Day 2
Ubud
Explore temples & rice terraces

Day 3
Nusa Penida
Beach day & snorkelling

Day 4
Uluwatu
Cliffs, sunset & Kecak dance
```

Buttons below cards:

```txt
View Full Itinerary
Customise Trip
```

Bottom input:

```txt
Ask me anything...
```

Send button:

- Circular
- Purple
- Positioned at the right side of the input

---

## Screen 3: Trip Details With Map

Route:

```txt
/trips/:tripId
```

Purpose:

Show the selected trip itinerary and a visual route map.

Layout:

```txt
Top header
Tabs
Left itinerary timeline
Right map view
```

Header:

```txt
Bali Adventure
May 20 - May 28 · 2 Travellers
```

Tabs:

```txt
Itinerary
Map
Bookings
Notes
```

Left timeline items:

```txt
Day 1 · May 20
Ubud
Check in and relax

Day 2 · May 21
Ubud
Temples & rice terraces

Day 3 · May 22
Nusa Penida
Beach & snorkelling

Day 4 · May 23
Uluwatu
Sunset & Kecak dance

Day 5 · May 24
Seminyak
Beach day & shopping

Day 6 · May 25
Canggu
Food & surf culture

Day 7 · May 26
Departure
Last-minute shopping
```

Right map visual:

- Pale green land.
- Pale blue water.
- Purple route line.
- Purple destination markers.
- Labels for route stops.

Map labels:

```txt
Day 1-2 Ubud
Day 3 Nusa Penida
Day 4 Uluwatu
Day 5 Seminyak
Day 6 Canggu
```

Stage 1 rule:

If real map integration is not ready, create a custom placeholder map card with fake route lines and markers.

Do not block the UI because of map provider setup.

---

## Screen 4: Flight Search

Route:

```txt
/flights
```

Purpose:

Show a mobile-style flight search experience with mock data.

Header:

```txt
Search Flights
```

Trip type tabs:

```txt
Round Trip
One Way
Multi-city
```

Search form fields:

```txt
From: JFK - New York
To: DPS - Denpasar Bali
Depart: May 20, Tue
Return: May 28, Wed
Travellers: 2 Adults
```

Button:

```txt
Search Flights
```

Results heading:

```txt
Best Options
```

Sort:

```txt
Recommended
```

Flight result card example:

```txt
Emirates
11:30 PM
JFK
8:15 AM
DPS
28h 45m
1 stop
$1,124 per person
```

Other sample airlines:

```txt
Qatar Airways
Singapore Airlines
```

Visual rules:

- Use white cards.
- Use airline icon or logo placeholder.
- Price should be visually easy to notice.
- Layout should work especially well on mobile.

---

## Screen 5: Hotels

Route:

```txt
/hotels
```

Purpose:

Show hotel results using mock data.

Header:

```txt
Hotels in Ubud
May 20 - May 22, 2 Guests
```

Actions:

```txt
Filter
Sort
Map
```

Hotel cards should include:

- Image
- Hotel name
- Hotel category
- Location
- Rating
- Review count
- Price per night

Sample hotel cards:

```txt
Komaneka at Bisma
Luxury Resort · Ubud
4.8 (345)
$320 / night

Alaya Resort Ubud
5★ Resort · Ubud
4.6 (312)
$195 / night

The Ubud Village Resort
Resort · Ubud
4.5 (298)
$160 / night

Element by Westin Bali Ubud
Resort · Ubud
4.4 (210)
$138 / night
```

Visual rules:

- Cards should be image-heavy.
- Hotel image should be on the left for wider layouts.
- Price should be aligned to the right where possible.
- Use a vertical list on mobile.

---

## Screen 6: Activities Explorer

Route:

```txt
/activities
```

Purpose:

Show activities and tours using mock data.

Header:

```txt
Top Activities in Bali
```

Category chips:

```txt
All
Nature
Adventure
Culture
Food
```

Activity cards:

```txt
Nusa Penida Day Trip
Snorkelling, Beaches & Views
$75 per person
4.8 (1200)

Ubud Rice Terrace Tour
Private Tour
$45 per person
4.7 (650)

Uluwatu Sunset & Kecak Dance
Show & Transfer
$25 per person
4.6 (890)

Bali Food Tour
Local Experience
$55 per person
4.9 (640)
```

Visual rules:

- Use large photos.
- Use card grid on tablet and desktop.
- Use one column on mobile.
- Active category chip should be purple.

---

## Screen 7: Partner Booking

Route:

```txt
/bookings
```

Purpose:

Show trusted partner booking options.

Stage 1 does not include direct booking.

Tabs:

```txt
Flights
Hotels
Activities
```

Message:

```txt
We'll take you to our trusted partners to complete your booking.
```

Partner cards:

```txt
Expedia
Great prices on flights & hotels

Booking.com
Wide selection of hotels

Trip.com
Competitive prices worldwide

GetYourGuide
Top activities & experiences
```

Each card should include:

```txt
View Deals
```

"View Deals" opens the partner in a new tab with the search already filled in
from the reader's last flight search, falling back to the partner's home page
when there is not enough to search with. Above the bottom note, one line says
what the links carry — "Prefilled with JFK → DPS · Sep 20 - Sep 28 · 2
travellers" — or invites a flight search when there is nothing saved yet.

Bottom note:

```txt
By continuing, you'll be leaving AI Travel and going to our trusted partner's website.
```

Visual rules:

- Partner cards should be clean and simple.
- Use brand-coloured placeholder squares or icons.
- Keep this screen less complex than real checkout.

---

## Screen 8: Trip Summary

Route:

```txt
/trips/:tripId/summary
```

Purpose:

Show saved trip summary and estimated total price.

Header card:

```txt
Bali Adventure
May 20 - May 28 · 2 Travellers
```

Cost rows:

```txt
Flights              $2,248
Hotels 7 nights      $1,260
Activities 4           $200
Total USD            $3,708
```

Buttons:

```txt
Save Trip
Share Trip
```

Visual rules:

- Summary screen should feel like a clean checkout card.
- Total should be larger and bold.
- Save Trip should be purple.
- Share Trip can be secondary.

---

# 9. Component Design Inventory

Create reusable UI components.

```txt
AppShell
Sidebar
BottomNavigation
PageHeader
Button
Card
TripCard
ItineraryDayCard
ChatMessage
PlannerInput
FlightSearchForm
FlightResultCard
HotelCard
ActivityCard
PartnerCard
TripSummaryCard
MapView
Tabs
CategoryChips
Avatar
IconButton
```

---

# 10. Design Rules For The Coding Agent

Follow these rules strictly:

```txt
1. Use purple as the main brand colour.
2. Use white cards on a very light grey page background.
3. Use large rounded corners.
4. Use soft shadows.
5. Use travel images in trip, hotel, and activity cards.
6. Use a desktop sidebar.
7. Use mobile bottom navigation.
8. Use chat bubbles for the AI planner screen.
9. Use itinerary cards with images.
10. Use a timeline layout for trip details.
11. Use a map area with purple route markers.
12. Use mock data only in Stage 1.
13. Save all user-generated trips in localStorage.
14. Do not build backend in Stage 1.  (Stage 2 has: accounts are real.)
15. Keep components reusable and typed.
16. Make the app responsive.
17. Use loading states even for mock generation.
18. Use empty states for no trips.
19. Use toast messages for save actions.
20. Keep booking simple with partner redirect cards.
```

---

# 11. What The Final UI Should Resemble

The final UI should visually resemble a polished travel planning dashboard.

The design should include these visual sections:

```txt
1. Large hero landing page with mountain, lake, island, or travel image.
2. AI planner dashboard with sidebar and chat interface.
3. Horizontal itinerary cards with travel images.
4. Trip details page with itinerary timeline on the left and map on the right.
5. Mobile-style flight search screen.
6. Hotel listing screen with image cards.
7. Activity discovery grid.
8. Partner booking list.
9. Trip summary checkout-style card.
```

---

## Surface 9: Messages — **built**

Not one of the numbered screens, and deliberately: it is chrome rather than a
destination. A collapsible column beside the main content at ≥1024px, a
full-screen `<dialog>` below that, and a toggle in `PageHeader`'s actions on
every signed-in screen.

- **Two panes on desktop, one at a time below it.** 600px wide: a 210px list of
  people, then the conversation. The same two views become a drill-down on a
  phone — the list, then the thread behind a back arrow — which is why the
  selected person is store state rather than a route.
- **Bubbles borrow the planner's vocabulary, not its component.** Own messages
  purple and right, the other person's grey and left — but `ChatMessage.tsx` is
  sized for a 640px conversation and this panel is barely half that.
- **No name on a bubble.** With exactly two people in a conversation the header
  already says who the other one is, and which side a message sits on says
  which of the two wrote it.
- **A presence dot rings the avatar rather than sitting inside it** —
  `.avatar` is `overflow: hidden` — and carries a visually-hidden
  "Online"/"Offline". `--color-success` against `--color-text-muted` is exactly
  the pair WCAG 1.4.1 exists for; the list must not signal by hue alone.
- **One mark on the toggle, never two.** The unread count — the server's, summed
  across conversations — takes the corner whenever there is one; a green
  presence dot stands in only when there is nothing to read. Both on a 40px
  button would make neither legible.
- **The preview is one clipped line.** A preview that wrapped would let one long
  message push every other person off the screen.
- **The conversation follows only from its live edge.** A reader who has
  scrolled back is offered "New messages ↓" instead of being dragged to the
  bottom — the panel is on every page, so that would happen while they are
  doing something else.
- **An empty thread says who can read it.** "Only the two of you can read it" —
  a private message has no public witness, and saying so plainly is the
  cheapest honest thing this surface can do.
- **`prefers-reduced-motion`** turns off both the smooth scroll and the
  affordance's entrance.

---

# 12. Short Instruction For Coding Agent

```txt
Build the UI according to DESIGN_SPEC.md. Match the visual direction: purple branding, white rounded cards, soft shadows, light grey backgrounds, travel imagery, AI chat planner, itinerary cards, trip timeline, map-style view, flight search, hotel cards, activity cards, partner booking cards, and checkout-style trip summary. Use README.md for the build plan and app structure. Start with Stage 1 only and do not build backend code yet.
```
