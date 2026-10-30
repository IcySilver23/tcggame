# TCG Life → 1.0

**Goal: polish to shippable.** No new systems. Everything we have becomes the 1.0
feature set, finished, balanced and readable — and it has to *feel* like a game
rather than a dashboard.

**Working method: one system at a time.** Each entry below is picked up, redesigned
and built, then reviewed live before the next one starts. This document is the order
and the intent, not a spec that can't move.

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

**Status: Phase 1 built.** All seven venues have their verb-shaped screens — BidBay is an
eBay marketplace (undercut), Local Deals a Marketplace thread (meet), Pawn the Gold
Exchange counter with loan tickets as the object (hock), Estate the negotiation table with
the reveal ceremony (gamble), Yard Sales the driveway tables (read), Flea Markets the
timed bins (dig), Live Shopping the Whatnot room (pounce). Uncommitted on disk at the
time of writing; the exit test is the next live review, not this line.

### Phase 2 — Consolidate the rest

**Status: 8.0 Collection hub built.** Collection, Binders, Set Completion and Wishlist are
one door with four modes (`#/collection/cards|binders|sets|wishlist`); the three old hashes
normalize into the hub, and the COLLECT section drops from 8 rows to 4 (Collection,
Portfolio, Achievements, Grading). It reuses the DEALS hub chrome (`.hub-bar`), which is
now the template 9.0–11.0 inherit.

**Next up: 9.0 Market hub** — Market, Auction House and Buylist as modes of one market;
Pack Shop, Trading Post and Community keep their own doors.

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

32 screens → 18 doors, every one of them earning its place.

- [x] 8.0 Collection hub
- [ ] 9.0 Market hub
- [ ] 10.0 Events hub
- [ ] 11.0 Inventory absorbs Storage

### Phase 3 — The finish pass

The "feels finished" bar. This is the phase that decides whether it's 1.0.

- [ ] **12.0 Readability sweep** — every remaining wall of prose down to a TipList of
  scannable lines. The pattern is proven on BidBay/Pawn/Local; finish the job everywhere.
- [ ] **13.0 State audit** — every screen gets the three honest states Pack Shop now has:
  loading, failure with a retry, and an empty state that says what to do next. No screen
  may claim to be waiting on something while it's actually still fetching.
- [ ] **14.0 First ten minutes** — walk a brand-new save end to end with fresh eyes.
  The unlock gates and next-unlock hints already exist; the question is whether a new
  player knows *what game they're playing* by minute three.
- [ ] **15.0 Balance pass** — the two economy audits the game already uses (the 200-lot
  auction sim, the 600-tick listing sim) re-run against every venue after Phase 1
  reshapes them. Depth changes must not print money.
- [ ] **16.0 Performance & polish** — the bundle is 801 kB / 216 kB gzip; route-level
  code-splitting is the obvious win once the screens are consolidated.

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
  have all been regression-tested headlessly. Any Phase 1 change should earn the same.
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
