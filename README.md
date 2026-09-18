# TCG Life

A collector-life simulator built on the **real** Pokémon Trading Card Game — real cards, real sets, real TCGplayer market prices, real card artwork. No invented cards. No invented prices.

![stack](https://img.shields.io/badge/stack-React%20%2B%20Hono%20%2B%20SQLite-blue)

## Quick start

```bash
npm install
npm run dev        # starts API (127.0.0.1:8787) + web UI (http://localhost:5199)
```

On first launch the server syncs **every Pokémon TCG set** from the official API in the background (shop-priority sets first). You can play immediately; cards and prices appear as each set lands. The sync is checkpointed per set and resumes automatically on restart.

Optional: a free API key from [pokemontcg.io](https://pokemontcg.io) raises the rate limit from 1,000 to 20,000 requests/day — paste it in **Settings** (or set `POKEMONTCG_API_KEY`).

## What's in Phase 1 (all functional)

- **Home dashboard** — cash / collection / inventory / net worth, live activity feed, market watch
- **Collection** — your cards as real artwork, filters (set, rarity, type, owned), sorts, live values
- **Set completion** — every real expansion, completion %, missing-card silhouettes, estimated completion cost
- **Card detail** — stock-ticker view: large art, market price with source badge (LIVE · TCGplayer, retrieval date), condition tiers, price-snapshot history chart, buy/sell/wishlist/favorite
- **Marketplace** — simulated NPC seller feed anchored to real market prices; BELOW/AT/ABOVE badges; good deals get sniped by other buyers
- **Pack shop** — real sealed products at real MSRP (151, Surging Sparks, Prismatic Evolutions, Paldean Fates); estimated pull economics computed from each set's actual rarity distribution
- **Pack opening** — the ceremony: staged reveals, hit detection, epic animations for big pulls, session summary with ROI
- **Inventory** — raw / listed / sealed tabs, cost basis, bulk list-at-market, sales log
- **Selling** — list cards; NPC buyers purchase over game time (10% marketplace fee)
- **Wishlist** — tracked at live prices
- **Settings** — API key, sync stats/restart, data-source attribution, save reset

## Data & honesty rules

| What | Source | Labeled |
|---|---|---|
| Card identity, sets, rarities, images | pokemontcg.io API v2 | — |
| USD market price | TCGplayer via pokemontcg.io | **LIVE** (+ retrieval date) |
| EUR prices & sale averages | Cardmarket via pokemontcg.io | shown in price rows |
| Non-NM conditions, pack economics | multipliers on real anchors | **ESTIMATED** |
| Price history | our daily snapshot log (SQLite) | **snapshot log** |

- Card artwork is hot-loaded from the API's official CDN (`images.pokemontcg.io`) — nothing is copied into this repo.
- Sealed-product MSRPs are official Pokémon Center retail; sealed market premiums are not live-synced and are treated as paid cost.
- The simulation (NPC listings, buyer behavior) never invents card values — it derives everything from the synced TCGplayer anchors.

## Architecture

```
server/            Hono API (port 8787) + SQLite (data/tcglife.db)
  services/sync.ts     resumable pokemontcg.io sync (priority sets first)
  services/market.ts   price resolution, snapshots, NPC feed, sales engine, game clock
  services/packs.ts    sealed catalog, pull tables from real rarity data, pull roller
src/               React SPA (Vite, port 5199)
  views/               Home, Collection, SetDetail, CardDetail, Market, Packs,
                       PackOpening, Inventory, Wishlist, PullHistory, Settings
```

Game time: the world ticks when you play (state polls every 15s; at most one tick per 20s). NPC listings expire, deals get sniped, your listings sell faster when undercut.

## Roadmap

**Shipped so far:** the full Phase 1 loop · binders with drag-and-drop · NPC trading with reputation · grading with real PSA/BGS/CGC/SGC prices and a live tax-savings estimate on every GRADE button (fees are deductible business expenses — the line shows the honest-bracket savings, the aggressive-books number on hover, or "no tax benefit" while profits sit under the allowance) · PriceCharting + eBay as live price sources · conventions with vendor booths · estate lots with estimated-vs-realized reveals · live auctions with NPC bidding wars · Pack Battles with rivalries, grudge matches, and spectator chat · Pack Battle tournaments (4- and 8-player single-elim brackets, escalating rounds, championship purse) · **the streaming room** — run your own pack-opening channel with live viewers, reactive chat, tips on hits, and persistent followers · **WotC ghost pulls** — vintage packs can contain 1st Edition stamped cards priced from real market data, plus a full sealed catalog for every synced set with out-of-print appreciation (sealed climbs once print runs end; hold or sell at market) · a live dashboard (show-circuit P&L, weekly net-worth chart, all-time collector record) · **the event calendar** — the whole scene runs on a weekly rhythm: weekend flea markets, Sunday mega shows, Wednesday/Grand-Slam tournament nights, and Friday sponsor drops, all visible on a dedicated Calendar screen with live countdowns.

Still on the road:

- **Phase 4 — Business:** vendor tables **(shipped)** — rent a spot at any show (entrance / main floor / back wall, priced by foot traffic), stock it from your binder at your own ask prices, and sell to NPC walk-up buyers whose appetite follows real market anchors, the mid-show rush, and your location's traffic; unsold stock returns to your collection at close, every sale is logged with buyer attribution and profit · **the card shop (shipped)** — a permanent storefront: sign a lease (hole-in-the-wall / storefront / flagship with daily rent), buy display cases, stock them from your binder at your own prices, and serve walk-in customers whose traffic follows the hour of day, your prices vs real market, and your shop's reputation; fair deals build word of mouth, gouging quietly kills the business · **advanced finance (shipped)** — a business credit line sized to your shop's revenue and credit score (1.2–3.5%/day by tier), daily interest accrual, bank auto-drafts when rent comes due with a 5%/day overdraft penalty, and three bounced drafts trigger a full repossession; debt nets against net worth, clean payoffs build your score · **shop staff (shipped)** — hire a buyer (sources underpriced cards off the market feed straight into your cases), a grader (auto-submits high-EV candidates to PSA), and counter help (lifts walk-in traffic up to ×1.9); quality tiers set wages, payroll drafts on rent day, a bounced payroll and everyone walks, and every employee keeps a track record · **bulk boxes (shipped)** — the dollar bin: package junk cards at a flat per-card price, walk-in diggers buy them by the handful (bigger handfuls from cheaper bins), full bins sell faster than picked-over ones, and a Bin Dealer will buy out a whole box at 60¢ on the dollar · **mystery grab bags (shipped)** — sealed 10-card packs with one guaranteed hit worth ≥5× the bag price: assemble them from your own junk plus an underpriced hit, sell to walk-in gamblers (huge hits build reputation), or rip one yourself for the reveal · **weekly P&L (shipped)** — every shop money event lands in a Monday-anchored ledger: product-line revenue (cases / dollar bins / grab bags) vs overhead (rent, payroll, loan interest), with margin-on-revenue, an overspend warning, and a week-over-week trend table · **shop dashboard card (shipped)** — the Home screen tracks your shop's daily net as a bar chart, 7-day revenue, reputation trend, best-selling product line, and lifetime shop net · **business license & quarterly taxes (shipped)** — the shop is now a real business: a $150/year **business license** (trade without one and code enforcement sweeps for a $60 fine; lapsing past a 21-day grace auto-renews while cash holds, with +5 credit for staying registered) plus a **$25/quarter license renewal fee** the city charges on the shop tick — short on cash and it stays past due with the license card flagging it, 21 days of stalling suspends the license, and back-paying from the 🧾 panel stands enforcement down; **quarterly estimated taxes** instead of one monthly bill (the 🧾 panel projects the quarter-to-date bill and suggests 25% — pay as you earn, any amount, any time), and a **true-up return** when each quarter closes: estimates and prior-quarter credits apply first, overpayments refund or roll forward as credit, and underpaying past the safe harbor (80% of the true bill) draws a 10% fine on the spot — all still on progressive brackets with the small-collector allowance, grading/overhead deductions, and loss carryforward · **tax strategy & audits (shipped)** — file honest books (📗, audits pass) or aggressive ones (📕): phantom deductions pad every return at 35% of write-offs, cutting the check today, but each padded return rolls a 45% audit chance on later filing cycles — a caught cheat lands as a pending AUDIT FINDING with two doors — pay the penalty (savings + 50%, credit −40, reputation −10) or **bribe the auditor** (an envelope of 2× the penalty, scaled by the auditor's mood; no record, no credit hit, no rep loss — but auditors gossip and each bribe makes the next one pricier, while ignored findings auto-escalate to the full fine plus the rep hit on the next tick); the panel shows the savings-vs-penalty math before you commit and warns while returns are still under audit watch · **nonprofit charter (shipped)** — file for $75 and the shop goes tax-exempt: no quarterly income tax (the return files itself at $0) and no sales tax at the register — but mission replaces margin: walk-ins browse 20% more and spend 15% less per visit, every sale is donation-framed in the books, and revoking the charter brings capitalism roaring back · **city sales tax (shipped)** — 6% base rate collected at the register on every case, dollar-bin, and grab-bag sale as trust money that was never yours: carved out of the till at the point of sale, shown in the P&L but excluded from revenue, net, and income tax, and remitted to city hall automatically each day (or on demand from the 🏛️ panel) with a month-by-month filing history · **special district surtaxes (shipped)** — the rate isn't flat: convention weekends sit in a hospitality district (+2% during the Mega Collectors Show and Weekend Flea Market → 8%), tournaments carry an arena-district penny (+1% during the Mini Invitational and Grand Slam → 7%), the register always charges whatever is live at the moment of sale, every trust entry records its rate and district, and the 🏛️ panel flags the surcharge while it's running · **reselling operation (shipped)**
- **Polish (shipped):** wishlist price alerts — set a target on any wishlisted card and the market tick fires a 🔔 into the activity feed the moment the live price drops to it (once per day per card, editable in the Wishlist) · **weekly market-mover digest** — the biggest 7-day gainers and losers across every tracked card, auto-posted to your feed each Monday and previewed live on the Home dashboard, all computed from real stored price history · audit findings with the **bribe-the-auditor door** — an envelope priced by the auditor's mood, no record no credit hit, but auditors gossip and ignored findings escalate

**Up next — the addon roadmap:**

- **Phase 5 — Empire:**
  - **The online storefront** — an eBay-style marketplace: list anything at any price, NPC bargain hunters browse a live feed and snipe underpriced listings, ~13% seller fees and a shipping delay per order, and a feedback rating that feeds sales speed. Your walk-in shop and your listings now compete for the same customers — channel conflict, faithfully simulated.
  - **Host your own card show** — flip the convention system: book the venue, set gate fees, sell vendor tables to NPC dealers (who price off the same real market anchors you do), and schedule it on the event calendar. A great show builds city reputation and a tidy table-rent profit; a dead one loses the hall deposit.
  - **Second location / franchise** — hire a manager, open a second storefront, transfer stock between locations, share the credit line, and read a per-location P&L. The flagship runs itself… badly, if you hired cheap.
  - **Case breaks on stream** — sell break spots for sealed boxes on your channel: viewers claim teams, the rip plays out live in chat with the pulls going to the spot-holders, and you keep the product margin plus the content.
- **Systems that touch everything:**
  - **Supplies & condition wear** — penny sleeves, toploaders, one-touches, and binders as purchasable stock; unprotected inventory slowly ticks down condition (NM → LP) while sleeved cards hold. A new expense line with a real effect on every card you own.
  - **Storage & the vault** — collection capacity pressure: rent storage units by the month, or keep everything in the spare room and feel the walls close in.
  - **Insurance** — a monthly premium sized to collection value, and disaster events (roof leak, break-in) that damage random stock if you're uninsured.
  - **Market regimes & reprint shocks** — bull/bear cycles that lift or sink the whole board, set-rotation hype windows, and reprint announcements that crater a card overnight — with the digest tipping you off.
  - **Consignment counter** — NPC collectors consign cards to your shop for a 20% cut; you price them, they wait, and slow sellers get pulled. Inventory you never paid for.
  - **The rival shop across the street** — an NPC store with its own cases, pricing, and staff; price wars, poached walk-ins, and eventually the option to buy them out.
- **Small & shiny:**
  - **Achievements & milestones** — badges on the Home dashboard for set completions, profit milestones, gem rates, and streaks.
  - **Bulk actions in compact Inventory mode** — select all in view, list all picked at market in one shot, and send the whole selection to grading together; the density views make hundreds of cards visible, so picking them should scale too.
  - **Compact density for the remaining product panels** — give the Shop, Grading, and Convention views the same ▦▦☰ compact treatment on their product panels (cases, grading candidates, vendor booths) so every heavy screen has a dense mode.
  - **Set-grouped browse mode** — a group-by-set layout with sticky set headers for Collection and Inventory: scroll through your cards organized by era and set, with per-set counts and values in the header.
  - **Bulk actions** — multi-select repricing by percentage, mass-sleeve, mass-list; the late-game shop has hundreds of cards and one-at-a-time doesn't scale.
  - **Suggested-donation round-ups** at the nonprofit register — customers round the ask up to the next dollar for reputation.
  - **Seasonal events** — tax-free weekends, holiday demand spikes, and new-release midnight openings on the calendar.
  - **The accountant hire** — auto-pays suggested estimates, flags deductions, and talks you out of cooking the books (or doesn't).

## Legal

Fan-made simulator. Not affiliated with or endorsed by The Pokémon Company. Card text/artwork © Pokémon / Nintendo / Creatures Inc. / GAME FREAK inc. Market data © TCGplayer / Cardmarket, accessed via the pokemontcg.io API under its terms.
