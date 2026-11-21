# TCG Life

**A collector-life simulator built on the real Pokémon TCG.** You start with
$1,000, an empty binder and a town full of overpriced cardboard — and every card,
set, artwork and market price in the game is real.

![stack](https://img.shields.io/badge/stack-React%20%2B%20Hono%20%2B%20SQLite-blue)

You open packs, chase grails, grade slabs, haggle for collections and eventually
run the shop you used to buy from. Prices move on a game clock, rivals undercut
you, and the market does not care how much you paid.

## What you do

- **Open real sealed product** — boosters, bundles, Elite Trainer Boxes, displays,
  tins, blisters and promos at real MSRP, with pulls and odds built from each
  set's actual rarity ladder. You tear the pack open yourself.
- **Chase the cards** — 20,898 cards across 178 sets with official artwork,
  binders, set completion, wishlists and a pull history that crowns your best rip.
- **Buy and sell** — a marketplace feed anchored to real TCGplayer prices, local
  meetups, auctions, buylists and buyers who take their time to pay.
- **Grade slabs** — PSA, Beckett BGS and CGC. A copy's hidden centering, whitening
  and corners decide its odds, up to the CGC Pristine 10 gold label.
- **Run the business** — open a storefront, stock shelves, hire staff who have
  lives, run card shows and conventions, add satellite stores, borrow, insure,
  file tax.
- **Live with the market** — booms, reprint shocks, counterfeits, estate lots and
  rivals all move while you play.

## Download

Grab a build from [Releases](https://github.com/IcySilver23/tcggame/releases):

- **TCG-Life-Setup-0.77.66.0.exe** — Windows installer, per-user (no admin), with
  a Start Menu entry and optional desktop shortcut. Uninstalling keeps your save.
- **TCG-Life-0.77.66-portable-win64.zip** — unzip anywhere and run `TCG-Life.exe`.

Both need Windows 10/11 with the Microsoft Edge WebView2 runtime, which ships with
the OS. Nothing else has to be installed.

## Quick start

```bash
npm install
npm run dev        # API on 127.0.0.1:8787, game UI on http://localhost:5199
```

Building the Windows exe or installer from source is `bash scripts/build-exe.sh`
and `npm run build:installer`; the repository's `AGENTS.md` documents how the
game is put together.

## A clean save is the only save in here

No player's game is committed: `data/tcglife.db`, the `saves/` archives and
`release/` are gitignored. First boot writes a brand-new save — **$1,000, day 1,
an empty collection** — and seeds the full 20,898-card catalogue offline from the
tracked `data/catalog-seed.db`, so playing needs no API key and no network.

Delete `data/tcglife.db` to start over, or use **Settings → Reset save** to reset
the game while keeping the catalogue.

## Where the numbers come from

| What | Source | Labelled |
|---|---|---|
| Cards, sets, rarities, artwork | pokemontcg.io API v2 | — |
| USD market price | TCGplayer via pokemontcg.io | **LIVE** + retrieval date |
| EUR prices and sale averages | Cardmarket via pokemontcg.io | shown in price rows |
| Graded comps | PriceCharting, then eBay | **LIVE** / **GAME ESTIMATE** |
| Non-NM conditions, pack economics, gem odds | modelled on real anchors | **ESTIMATED** |

The simulation never invents a card's value — NPC listings, buyers and the shop
economy all derive from the real price anchors. Unknown data is left unknown
rather than guessed.

## Legal

Fan-made simulator. Not affiliated with or endorsed by The Pokémon Company. Card
text/artwork © Pokémon / Nintendo / Creatures Inc. / GAME FREAK inc. Market data ©
TCGplayer / Cardmarket, accessed via the pokemontcg.io API under its terms.
