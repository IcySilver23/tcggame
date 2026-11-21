# TCG Life → 1.0

**Goal: polish to shippable.** No new systems. Everything we have becomes the 1.0
feature set, finished, balanced and readable — and it has to *feel* like a game
rather than a dashboard.

**Working method: one system at a time.** Each entry below is picked up, redesigned
and built, then reviewed live before the next one starts. This document is the order
and the intent, not a spec that can't move.

**Status as of 0.71.0 (2026-11-08).** Phase 1 is built, committed and has passed its
seven-venue exit review; Phase 2 is complete through 11.0. 12.0 and 13.0 are complete; the
rest of Phase 3 is untouched. Since this plan was written, the sealed
economy also gained an expected-value floor under boosters (0.65.0) and every bundle,
ETB, display and special collection (0.66.0), plus a full-catalog sealed audit.

---

## The three problems 1.0 exists to solve

Everything in this roadmap traces back to what's actually wrong today:

| # | Problem | What it looks like in play |
|---|---|---|
| 1 | **Every screen has the same shape** | header → filter chips → a list of rows → a modal. Pawn, Local Deals, BidBay and the Flea Market blur together even though their mechanics are totally different underneath. |
| 2 | **Decisions are too shallow** | once you've seen a venue a few times there's no judgment left — one obviously-correct button. The depth exists in the server, it just never reaches the player as a *choice*. |
| 3 | **Too much text, too little to do** | long explanations and dense rows make screens tiring to scan, and venues run out of reasons to return once you've seen each one's trick. |

**The design tension, named up front:** "no new systems" and "not enough to do" pull in
opposite directions. The resolution is that depth in 1.0 comes from **reshaping the
mechanics we already have into more decisions and better screen shapes** — not from
adding features. Where a venue genuinely needs something new to stay alive, that's
flagged as an open question rather than quietly smuggled in.

---

## Deal venues: the identity test

The DEALS section is seven venues, ~250 KB of server logic, and seven screens that all
look the same. The fix is to give each venue **one interaction verb** and build its
screen around that verb, so you can tell where you are with your eyes closed.

| Venue | The verb | What the player is actually deciding | Screen shape it should have |
|---|---|---|---|
| **BidBay** | **undercut** | price vs. speed against NPC competition who scan twice a tick | a marketplace: dense, fast, price-sorted, rival listings in your face |
| **Local Deals** | **meet** | cheap-and-risky vs. verified — no-shows, counterfeits, an inspection to buy | a message thread → a meetup, not a product grid |
| **Pawn Shop** | **hock** | instant cash now vs. a 30-day loan you have to service | a counter with a clock: your pawned cards and their due dates as the main object |
| **Estate Buyouts** | **gamble sight-unseen** | pay for more information, or take the number the heirs will accept | a negotiation table with a reveal ceremony at the end |
| **Yard Sales** | **read the table** | the peek is deliberately ambiguous — you're pricing from vibes | a driveway: tables, one-line peeks, haggle across the hood |
| **Flea Markets** | **dig** | which bin first, while NPC pickers drain the same bins in real time | a timed, competitive list — the bins *are* the UI |
| **Live Shopping** | **pounce** | real-time rooms, six formats, a clock that doesn't wait | a video room with rails, not a feed |

Every venue keeps its existing server mechanics. What changes is that the screen stops
being a template and starts being the thing the verb describes.

---

## Phase plan

Ordered for the one-at-a-time pace. Each row is one reviewable chunk.

### Phase 1 — DEALS (the priority)

- [x] **1.0 Deals hub** — one DEALS screen with the seven venues as sub-views behind a
  segmented control, plus a shared "where is this worth more?" strip that compares a
  card's ask across every venue at once. This is the container everything else lands in,
  and it's where consolidation starts paying off: one place to shop the whole underground.
- [x] **2.0 BidBay** — biggest, most-used venue first.
- [x] **3.0 Local Deals** — the messaging/meetup shape, counterfeit risk made visible.
- [x] **4.0 Pawn Shop** — the loan clock becomes the centerpiece instead of a footnote.
- [x] **5.0 Estate Buyouts** — negotiation first, reveal second.
- [x] **6.0 Yard Sales + Flea Markets** — siblings; they share the "in-person bargain"
  DNA and should be built together so the difference between them is obvious.
- [x] **7.0 Live Shopping** — largest server surface, most polished already; last so it
  inherits the patterns the other six establish.

**Exit test for the phase:** you can open each venue and name what you're there to do in
one sentence, and you can't confuse two of them.

**Status: Phase 1 exit review passed (0.68.0).** All seven venues have their verb-shaped
screens — BidBay is an eBay marketplace (undercut), Local Deals a seller-thread inbox
(meet), Pawn the Gold Exchange counter with loan tickets as the object (hock), Estate the
negotiation table with the reveal ceremony (gamble), Yard Sales the driveway tables
(read), Flea Markets the timed bins (dig), Live Shopping the Whatnot room (pounce). The
live review found one remaining blur: Local Deals was still a Marketplace tile grid and
read as a second BidBay. It now opens as a conversation list — seller, listing, risk,
meetup — with the listing attached inside the thread. The other six passed unchanged.

### Phase 2 — Consolidate the rest

**Status: 8.0 Collection hub built.** Collection, Binders, Set Completion and Wishlist are
one door with four modes (`#/collection/cards|binders|sets|wishlist`); the three old hashes
normalize into the hub, and the COLLECT section drops from 8 rows to 4 (Collection,
Portfolio, Achievements, Grading). It reuses the DEALS hub chrome (`.hub-bar`), which is
now the template 9.0–11.0 inherit.

**Status: 9.0 Market hub built.** Marketplace, Auction House and Buylist are one door with
three modes (`#/market/feed|auctions|buylist`); `#/auctions` and `#/buylist` normalize into
it. Pack Shop, Trading Post and Community keep their own rows, so MARKET is 4 doors instead
of 6 and the sidebar is down to 20.

**Status: 10.0 Events hub built.** Calendar, Conventions and Card Shows are one door with
three modes (`#/events/calendar|conventions|shows`); `#/calendar`, `#/convention` and
`#/shows` normalize into it. The calendar leads the bar as **Calendar** because it is the
index — and it is now a real month grid (Monday-first weekday columns, today ringed, month
paging bounded by what the scene has published, two chips per day then "+N more") with a
selected-day panel carrying the blurbs, countdowns and jump links. The two things you can
attend follow it. New links (calendar rows, the Home dashboard) write hub hashes directly;
the old ones keep working forever because server
feed items and existing saves still carry them. EVENTS is now 1 row, sidebar down to 18.

Both attend-venues shed their stacked walls this pass. **Conventions** is three states — a
hall that hasn't opened (countdown, prep list, your record), a door screen, and an entered
hall split into Floor / Booths / Estate / Your table. **Card Shows** keeps its organizer verb
but splits it: nothing booked is a plan (price the doors with live verdicts, sign headliners,
pick a hall with the cost math printed on it), and a booked show is a console with four
sections — The deal, Guests, My booth, Dealers — under a countdown banner. Past shows are rows
instead of a seven-column table, because at this width the table only ever showed the one
number you came for. Both venues share one segmented bar (`.seg-bar`) so the two organisers
read the same way.

**Status: Phase 2 complete.** 11.0 folded Storage into Inventory as a mode: one door with
an **Inventory** / **Storage & Auctions** bar, `#/inventory/storage` for the storage mode,
and the old `#/storage` hash normalized into it. The BUSINESS section is three rows —
Inventory, Card Shop and Resale Desk — so the sidebar is down to 17 doors.

Fold the remaining screens so the sidebar stops being a wall. Same principle as DEALS:
fewer doors, deeper rooms.

| Section today | Becomes | Why |
|---|---|---|
| COLLECT (8) | **Collection** hub — cards / sets / wishlist / binders as modes; Home, Portfolio, Grading, Achievements stay | Set Completion and Wishlist are *ways of looking at the same cards*; Home, Portfolio and Grading are genuinely different jobs |
| MARKET (6) | **Market** hub — feed / auctions / buylist as modes; Pack Shop, Trading Post, Community stay | Buylist and auctions are ways of buying — they belong as modes of one market, not separate doors |
| DEALS (7) | one **Deals** hub, seven sub-views | see Phase 1 |
| EVENTS (3) | **Events** — calendar / conventions / shows as modes | Conventions and Card Shows are both "things you attend"; the calendar is the index |
| BUSINESS (4) | Inventory absorbs **Storage**; Card Shop and Resale Desk stay | storage capacity already lives on the Inventory page |
| PLAY (2), SYSTEM (2) | unchanged | already right |

32 screens → 17 doors, every one of them earning its place.

- [x] 8.0 Collection hub
- [x] 9.0 Market hub
- [x] 10.0 Events hub
- [x] 11.0 Inventory absorbs Storage

### Phase 3 — The finish pass

The "feels finished" bar. This is the phase that decides whether it's 1.0.

**Status: 12.0 readability sweep complete (0.69.0).** The last dense explanations now
read as icon / bold label / one-line rule: Storage's locker gamble, Live Shopping's six
formats, Stream's break math, Pack Shop's sticker, Market's per-condition radar, Auction
House's header, Resale's ROI, Shop's rent/mortgage/accountant rows and Inventory's sealed
sell/dump/hold note. Short one-line subtitles were left as they were; the sweep changed
the shape of explanations, not a number or a server call.

**Status: 13.0 state audit complete (0.77.4).** Every screen in the navigation now carries
Pack Shop's three honest states — the first twelve (Achievements, Portfolio, Calendar, Set
Detail, Auction House, Card Shows, Conventions, the Pawn Shop, BidBay, Local Deals,
Buylist and the Sets gallery) and the rest: Home, Forum, Inventory, Market, Notifications,
Pack Battles, Settings, the Shop and its subpanels, Storage, Stream, Trade, Wishlist,
Collection, Binders, the Resale desk, Pull History, the Ship Bay and the card sheet,
plus the nested Card Shows booth panel and the Convention floor with its table view. A
failed first fetch names what could not load and offers Try again; a failed background
poll leaves the last good screen in place instead of blanking it. Screens whose parts
answer independently (Home's widgets, the Shop's tax/finance/staff/accountant panels,
the convention floor) say which part failed rather than hiding it or printing zeroes.
The panels that used to `return null` — storage, the tax desk, the books, the roster,
the floor — now say they are reading or that the read failed.

- [x] **12.0 Readability sweep** — every remaining wall of prose down to a TipList of
  scannable lines. The pattern is proven on BidBay/Pawn/Local; finish the job everywhere.
- [x] **13.0 State audit** — complete (0.77.4). Every screen has the three honest states
  Pack Shop has: loading, failure with a retry, and an empty state that says what to do
  next. No screen claims to be waiting on something while it is actually still fetching,
  and no failure reads as a real zero (no traders, no cards, no notifications). Two
  surface rules held throughout: a failed background poll keeps the last good data and
  only a failure with nothing to show becomes the error state, and an empty state names
  the next move rather than the absence alone.
- [x] **14.0 First ten minutes** — walked a genuinely fresh save (empty database,
  seeded catalogue) through the welcome tour, first pack, first sale and the Deals
  gate in 0.77.6. What the walk exposed: the tour promised five stops and had six;
  finishing it toasted "Tutorial skipped"; Home offered no first-move route at all,
  so "Make 3 sales" was the only sign Deals existed and the sentence explaining where
  sales come from only lived behind that lock; the Buylist — the intended first sales
  counter — was never named; and the Pack Shop's TYP percentage was undefined. Fixed
  in 0.77.6: a tickable first-moves checklist on Home (rip → sell at the Buylist →
  three sales), corrected tour copy and completion toast, TYP defined in the shop
  sign, and a first-save activity label that no longer credits the player with
  catalogue maintenance. The Deals row now opens its own gate screen instead of
  bouncing home (0.77.7), so the sentence naming every sale path is reachable
  before the gate opens rather than hidden behind it.
  A second walk (0.77.8) carried a fresh save past its first ten sales into the
  shop, grading and the closed convention. Grading was the gap: ten owned pulls
  produced no candidates at all, the "Worth grading now" panel disappeared with
  them, and the empty lab told the player to "Submit a card above" when nothing
  was above. It now names the cheapest open service, its fee and its raw-value
  floor, and says to sell cheaper cards raw. The locked Card Shop row read "Save
  $500" beside a $250 cheapest lease; it now reads "Save $500 · lease $250".
  The convention page held up: countdown, weekly clock and the four-part prep
  list answered when the doors open and what a show is for.
  A lock audit (0.77.10) found one gate that could never open: Stream demanded
  five followers, but followers are only awarded by finishing a stream, so the
  screen that grows the channel was the one the channel count kept shut. Stream
  now opens from the start. The remaining gates were checked for guidance that
  only existed inside: Deals already opens onto its own explanation (0.77.7),
  and Card Shop and Resale Desk now print the terms their pages used to keep to
  themselves on the locked row itself — rent and what a stocked case does, and
  that the desk buys under-market lots to flip.
  A third pass (0.77.11) checked the screens that are always open for copy that
  presumes progress. The sell comparison on a card was the offender: it showed
  the Instant dealer and Pawn counter beside the Market and Buylist as four
  equal doors on a save that cannot reach either (the Resale Desk wants $400
  cash, the Pawn Shop wants 3 sales), and a locked door could win "best". Those
  rows now carry their gate, dim, and cannot win; the footer names the best
  OPEN door. The rest of the sweep came back clean because the screens either
  hide a panel until its subject exists (Home's shop card, Card Shows' booth,
  Inventory's slab options) or already state the requirement.
  0.77.12 then made the comparison itself actionable: each row is a List or
  Sell button, the server re-checks that door's gate and performs that route's
  own sale, and the card sheet closes on a receipt. A locked door refuses the
  request even if it is hand-rolled, and the buylist's stale-quote guard keeps
  the paid number equal to the quoted one.
  0.77.13 fixed the sample catalogue's boot: `data/catalog-seed.db` carries the
  30th Celebration cards but no pack products, and the me55 phantom-rarity
  repair rebuilt its pull table before `me55-booster` existed, failing the pull
  rows' foreign key. The full catalogue builder now runs before both rarity
  repairs, so a seed save starts and its packs open; existing saves already had
  the products and were unaffected.
- [ ] **15.0 Balance pass** — the three economy audits the game already uses (the 200-lot
  auction sim, the 600-tick listing sim, and the full-catalog sealed audit added in
  0.65.0–0.66.0) re-run against every venue after Phase 1 reshapes them. Depth changes
  must not print money.- [ ] **16.0 Performance & polish** — route-level code-splitting landed in 0.77.5.
  The entry chunk is 45.55 kB (15.15 kB gzip) against 1,218.02 kB (343.43 kB gzip)
  in 0.77.4, and every screen is its own chunk (3.7–139.7 kB). React (140.87 kB) and
  the shared card/foil renderer (292.41 kB) are now separate cacheable chunks, so
  Home's first load is ~503 kB (155 kB gzip) instead of the whole app. Remaining
  polish for this item is not scoped yet.

### Cut from 1.0

Both items still open in the README's roadmap are **out of scope for 1.0**, because the
bar is "polish to shippable" and neither is polish:

- ~~Storefront customization & foot-traffic drivers~~ — new system → post-1.0
- ~~Health & burnout (stamina meter)~~ — new system → post-1.0

If either turns out to be load-bearing for how the game *feels*, it can come back in —
but it has to displace polish work, not add to it.

---

## What's already right (don't touch it)

Worth saying out loud so the pass doesn't churn things that work:

- The **price ladder** — a single cascade every price in the game resolves through,
  honestly labeled. It's the reason the game can be trusted.
- **Progressive unlocks** with live quest counters. The sidebar teaches itself.
- The **pack-opening ceremony** — the rip, the tiered reveals, the record chase. This is
  the game's best asset and it already feels like a game.
- **Sim-audited economies** — the rival shop, the auction floor and the listing feed
  have all been regression-tested headlessly, and 0.65.0–0.66.0 added a full-catalog
  audit of the booster and sealed expected-value floor. Any Phase 1 change should earn
  the same.
- **Honest labeling** — ESTIMATED / LIVE / snapshot log everywhere. Keep it through the
  readability sweep; shorter copy must not mean vaguer copy.

---

## Settled: unlock gates inside the Deals hub

**Problem.** Seven sidebar rows carry seven gates — Pawn 3 · Yard 3 · Local 5 · Flea 6 ·
BidBay 8 · Estate 10 · Live 12 sales — each printing its own hint and gold counter.
Consolidation replaces all seven with one row. Where do the other six go?

**Decision: the gates don't move and don't change. Only the surface they're printed on
moves — from the sidebar to inside the hub.**

1. **The hub's gate is the earliest venue gate: 3 sales.** Before that, DEALS is one 🔒
   row reading `Make 3 sales 0/3` — the same goal the sidebar shows today, minus six
   duplicates. It also makes an empty hub impossible: the moment the hub opens, the Pawn
   Shop opens with it.
2. **Venue thresholds stay as they are.** Inside the hub each venue is a tab, and a locked
   tab renders with the component the sidebar row uses today — 🔒, the hint, the live gold
   counter — just relocated. Tabs are **fixed order**; muscle memory for where BidBay
   lives must not depend on how many sales you've made.
3. **The "next goal" tracker becomes one line under the hub header** —
   `🔒 Next: Flea Markets · Make 6 sales (2/6)` — the nearest locked venue, same visual
   language as today's hint rows. One line instead of six rows *is* the consolidation win.
4. **Toasts are untouched.** `🔓 Unlocked: Flea Markets` fires on the same transition it
   does today, with no navigation hijack.
5. **Deep links get better, not worse.** The hub is a param route — `#/deals/live` —
   parsed by the `hash.split('/')` mechanism `#/set/:id` already uses. **`#/live` needs an
   explicit redirect: 10 server call sites write it as a feed href and your save already
   has 200 activity rows pointing at it.** Every old venue hash maps the same way rather
   than falling through to the unknown-view bounce. And a deep link to a still-locked
   venue now opens the hub *on that locked tab* with its gate named — today's bounce tells
   you what you can't have, this tells you where it lives.
6. **Existing saves are unaffected** — `unlockedSeen` seeds from current state on first
   load, so a save that already has everything open stays silent.

**Deliberately not doing:** collapsing the seven thresholds into one or two gates. The
3→5→6→8→10→12 ladder is pacing design — it's the reason a mid-game player still has
something to work toward after the tutorial ends.

**Result:** the sidebar carries **4 locked rows instead of 10** (Deals hub, Card Shop,
Resale Desk, Stream). Card Shop, Resale Desk and Stream keep their own rows —
consolidation is DEALS-only.

---

## Open questions for later phases

Not blocking Phase 1 — they get asked before the phase they affect starts.

1. **What stops a venue from running dry?** The "not enough to do" complaint is only
   fully solved if a venue has a reason to return on day 40. Some venues already do
   (weekend gates, rotating stock); others may need their existing rotation widened.
   That's reshaping, not adding — but it needs checking venue by venue.
2. **Is cross-venue arbitrage a real loop?** The shared "worth more elsewhere" strip in
   the Deals hub is the cheapest depth we can get: buy at the flea, sell on BidBay. If
   the numbers don't reward routing, the strip is decoration and should go.
3. **Live Shopping's size.** 84 KB of server code, already the most polished venue. Is
   it even in scope for a redesign, or does it just need to inherit the hub shell?
