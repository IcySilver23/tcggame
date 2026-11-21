# Pokémon TCG — Holofoil Rendering Roadmap

**Living document.** Update it whenever meaningful progress is made. Status words are
deliberately narrow:

- **Verified** — a source names the printing/pattern AND the project has a test proving the
  rendering keeps its mask, artwork and reflection rules.
- **Implemented** — the code and assets exist and are covered by tests, but the physical
  fidelity is not verified against a real card.
- **Identified** — the printing/pattern is recorded with a source, but no faithful
  reproduction ships yet.
- **Partial** — some of the phase exists; the gaps are listed.
- **Not started** — no code or data yet.

Last updated: 2026-11-08 · App version 0.69.0

---

## Current work

The renderer has no identified paper left to paint: `reports/unpainted-papers.md` sweeps
all 20,782 catalogue cards and finds **0** papers a source names without a sheet. 7,008 of
those cards carry a foil; 416 are on a documented finish whose paper no source names (the
Shiny Vault families, Gold Star, the Neo Destiny sheen and the rest of `special-treatment`),
and those draw plain foil, with a modelled relief where the finish is textured, rather than
borrowing an era sheet.

The last named family closed with **Sequin** in 0.59.0, and 0.59.9 made the family model
explicit: a card's finish is a paper family (Cosmos, Tinsel, Mirror, Water Web, Line,
Mirage, Starlight, Crosshatch, Confetti, Sequin and so on), while the per-card printing
database still answers card-by-card questions. Since 0.72.0 the Settings → Appearance
switch controls only the advanced treatment: every resolved paper renders at rest at a
fixed neutral tilt, and the switch adds pointer tilt, colour and relief. Before 0.72.0 it
gated the whole overlay, so a card at rest showed its scan and an off card fetched no
sheet. The work from 0.60.0 to 0.66.0 was the pack and sealed economy, not the foil
renderer; 0.65.0–0.66.0 added the expected-value floor and the full-catalog sealed audit.

**Immediate next step:** the remaining gaps are evidence and catalogue data, not
rendering: tilt photographs for the procedural papers, Japanese/Chinese-exclusive rows
(Phase 14), and the Phase 12 finishes whose paper no source names. The 0.66.0 sweep counts
four deliberate refusals, three evidence gaps, four open bugs and three unstarted phases
(`reports/open-holo-questions.md`).

---

## Phase status

| # | Phase | Status | Notes |
| --- | --- | --- | --- |
| 0 | Audit and stabilize | **In progress** | This document + corrections list below |
| 1 | Universal rendering engine | **Partial** | Multi-layer frames, per-region reflectivity, normal-map surface pass live for textured tiers; no GPU path or device motion |
| 2 | Printing database | **Implemented** | Rule provenance (`matchedRule`), `surfaceTexture`/`name`/`year` fields, promo variant; English only |
| 3 | Radiant Collection | **Implemented** | 57/57 configured; 27 foil + 13 non-foil verified, 17 modelled; report per card |
| 4 | Cosmos / Galaxy | **Implemented** | 1,055 printings resolved; 2 papers; concept textures. The 50 δ Delta Species holo rares left this count in 0.59.5 — they are plain foil, not Cosmos (B3). |
| 5 | Reverse holo | **Complete** | 112 expansions mapped, 10 papers painted, **112 validated**; the four EX papers and the modern tile papers are all proved per expansion |
| 6 | Vintage Starlight | **Implemented** | 47 holo rares painted; procedural sheet, per-card cut; texture is a reconstruction |
| 7 | Cracked Ice | **Partial** | Frost Rotom painted and validated; theme-deck rows absent from the catalog; false Trainer Kit rule removed |
| 8 | Additional vintage/promo families | **Partial** | Tinsel painted for all 152 bw1–bw11 holo rares (0.37.0); Black Bolt & White Flare deliberately refused — the 2025 return's sources disagree about which cards and describe a border. Mirror painted for nine BW promos (0.44.0), Crosshatch for the three Victory Cup promos (0.45.0) Line for the 541 standard holos of Sword & Shield through Crown Zenith (0.54.0) and Water Web for the 400 Sun & Moon–Cosmic Eclipse standard holos (0.55.0) and Mirage for the 338 Scarlet & Violet standard holos (0.56.0), and Sequin drawn as the last family paper (a polygon sheet worn by the 19 General Mills promos Bulbapedia names — see `reports/sequin-printings.md`). Papers still unpainted: none |
| 9 | EX-era specialty | **Partial** | ex→artBorder belt, EX reverse papers; stamps/logo not modelled |
| 10 | Modern special reverses | **Implemented** | Poké Ball and Master Ball papers, one-large and rows layouts; ten drawn sheets, one per printing; frame foil plus a modelled full-card etch; published Prismatic counts reproduced; large-ball size/placement measured from a real photo; inventory tags, two-slot pulls, pricing and detail-view foil wired. Ascended Heroes' first-slot Energy-pattern paper is painted as one large type stamp with its own explicit variant and per-type sheets; its six assigned papers (Poké Ball, Love, Friend, Quick, Dusk and the Team Rocket R) are painted card by card from the per-card assignment table, at the 0.434-card-width ring a real Snorunt photograph measures |
| 11 | Ultra rare and textured | **Partial** | Two modelled etched normal maps split by era (deep BW/XY, fine later); mask- and tilt-gated; no scan or per-card evidence |
| 12 | Shiny / Radiant / specialty | **Partial** | Four papers behind four families; `src/foil/shiny-db.ts` read by `printing-db.ts` at branch 1g; 377 rows resolve their own claim, 18 draw from a shipped sheet (Neo Revelation's Cosmos, the fifteen Radiant Pokémon and the 30th Celebration Shining Celebi's Confetti); Radiant Pokémon painted as a procedural etched lattice, unverified; Shiny Vault's embossed/etched finish identified per set (316 rows) with no repeat borrowed; Pokémon-only and various-parts areas approximated by the window and marked unverified |
| 13 | Promotional printings | **Partial** | Four pre-2012 programmes classified card by card (174 rows: 101 Cosmos, 64 non-holo, 4 Cracked Ice, 2 French Cosmos, 3 reverse); BW Black Star Promos 100 claims + 1 unlisted; Southern Islands, Pokémon Rumble and Best of Game classified; 38 named POP holo versions; no product pipeline |
| 14 | Japanese / Chinese exclusives | **Not started** | `language` axis exists; only `en` catalogued. Japanese and Chinese-exclusive cards need their own rows, set ids and foil evidence |
| 15 | Miscellaneous treatments | **Not started** | — |
| 16 | Automatic identification | **Implemented** | Rule engine + exclusions; no human review UI |
| 17 | Reference/asset pipeline | **Partial** | Generators, metadata, rights note; no photos |
| 18 | Debugging tools | **Partial** | Six stages plus relief-only, normal-map, pixel-diff and reference side-by-side views for textured cards; no reference photograph catalogued |
| 19 | Visual accuracy testing | **Partial** | Per-system suites; no full angle matrix |
| 20 | Performance | **Partial** | Texture cache, lazy load, reduced motion; no GPU |
| 21 | Database integration | **Implemented** | Viewer resolves every card through the DB |
| 22 | Collection-wide verification | **Partial** | Cosmos + reverse reports; no unified report |
| 23 | Maintenance / new releases | **Not started** | No import pipeline |

---

## Phase 0 — audit findings

### Working, tested

- **Layer contract** (`stages.ts`): base → mask → pattern → reflection → iridescence →
  composite. Face-on is byte-identical to the scan; nothing lands outside the mask; light
  never darkens a pixel. Enforced by six suites.
- **Masks** (`mask.ts`): rounded-card silhouette, art window, outside-art, art+border,
  full, full-art. Pure function shared by renderer and tests.
- **Printing database** (`printing-db.ts`): 20,782 cards resolve; explicit > modelled >
  set rule > inferred; statuses `verified` / `inferred` / `modelled` / `unresolved`.
- **Radiant**: 57 cards, per-card motifs, RC commons correctly plain, duplicate-decoration
  guard proven over white.
- **Cosmos**: 4 textures, 1,055 printings, 15 catalogue promo entries, reverse no longer borrows the
  Cosmos sheet.
- **Reverse**: 112 expansions, per-set masks (body vs window), eligibility exclusions,
  10 painted patterns, all 112 validated.

### Incomplete or inaccurate (corrections required)

1. ~~Generic tile fallback~~ **Fixed (0.19.0).** Unpainted printings used to show the RC6
   sheet's hearts and sparkles. They now render plain foil — uniform sweep and iridescence,
   no marks — and the inspector names the state ("no texture for this printing"). The RC6
   tile is no longer wired to any card that is not Radiant Collection, and a suite proves
   an unpainted printing adds no marks.
2. ~~Starlight is identified but unpainted~~ **Fixed (0.20.0).** Base/Jungle/Fossil
   holo rares now sample a procedural starfield sheet: 47 printings, the verified
   illustration window, one cut per card, never tiled. The printing claim is verified;
   the texture is a drawing and says so.
3. **No GPU path.** The pipeline is `getImageData`/`putImageData` on a 200×279 canvas.
   Adequate for thumbnails, not for full-screen cards at 60 fps.
4. **Surface relief is modelled, not measured.** Two etched normal maps ship, split by
   era, so textured ultra rares render with relief — but no scan or photograph verifies
   its depth, spacing or coverage, and Scarlet & Violet's art-specific textures are
   approximated by one fine relief (Phase 11).
5. **Reverse subject segmentation missing.** EX Delta Species→Power Keepers foil the artwork
   *background*, excluding the Pokémon; the build uses the whole window and marks the mask
   `approximated`.
6. ~~**δ Delta Species undetectable** from the card row, so those holos still get Cosmos.~~ **Fixed (0.59.5).** The marker is printed on the card and the catalogue carries it in the name; a generated index lists the 50 δ holo rares and they now resolve to `plain-holo`.
7. **Promo coverage is classified but not exhaustive.** The four pre-2012 programmes,
   BW Black Star Promos, Southern Islands, Pokémon Rumble and Best of Game are resolved
   card by card; BW32 Victini and three POP holo versions still make no claim because no
   source names their paper, and the catalogue still lacks some promo products. The
   remaining gaps are catalogue gaps, not guesses.
8. **Prime cards excluded conservatively** from reverse coverage; not verified either way.
9. **Cosmos/Radiant textures are concept art**, not scans; every metadata file says so.
10. **Inspector is dev-only.** The relief, normal-map, pixel-diff and reference
    side-by-side views are live, but no tilted photograph is catalogued, so the reference
    pane shows the flat scan and says it cannot confirm the relief (Phase 18). Reverse
    variants only appear there, not in a player-facing label.
11. **No mobile device-motion tilt**; pointer tilt works, reduced-motion is honoured.
12. **Stale untracked scripts** (`tmp/patch-*.cjs` history) — not shipped, but the working
    tree is noisy.
13. ~~EX Trainer Kits painted Cracked Ice~~ **Fixed (0.21.0).** `tk1a`/`tk1b`/`tk2a`/`tk2b`
    are 2004–05 EX Trainer Kits, before the pattern existed; the prefix rule is removed and
    all 44 cards make no foil claim.

### Verification status (0.66.0)

- `npm run typecheck` and `npm run build` are the release gate; both pass at 0.66.0.
- `tmp/check-open-holo-questions.ts` rebuilds `reports/open-holo-questions.json` and fails
  when this document's open-bug or unstarted-phase rows drift from it.
- `tmp/check-pattern-registry.ts` holds every `implemented` registry row to a sheet that
  actually exists, and parses the "Papers still unpainted" line below.
- The foil renderer is behind Settings → Appearance and off by default, so a fresh save
  shows scans; the dev inspector (Shift+H) still draws every layer when it is on.

---

## Phase 3 detail — Radiant Collection

All 57 cards (25 Legendary Treasures, 32 Generations) have a texture, a coverage
answer and an evidence sentence. `reports/radiant-printings.{json,md}` lists them.

| Group | Count | Status |
| --- | --- | --- |
| Generations RC commons | 13 | **Verified non-foil** |
| Legendary Treasures RC (full face) | 25 | **Verified** by set description + owner account |
| Generations RC6 (full bleed) | 1 | **Verified** by reference photographs |
| Generations RC16 (art window) | 1 | **Verified** by scan |
| Other Generations foil cards | 11 | **Modelled** art window — boundary undocumented |
| Generations full-art g1-RC21, RC28–RC32 | 6 | **Modelled** full-art field — boundary undocumented |

Remaining work: a card-specific photograph or scan for any modelled card would move
it into the verified column; none exists in this repo yet, so the report keeps them
modelled rather than averaging them into a claim.

## Phase 6 detail — Starlight (Base, Jungle, Fossil)

Bulbapedia's sentence is the whole brief: starbursts of different sizes, spread across
the image, slightly blurry. `scripts/starlight-foil.ts` draws that as a 1024px sheet
with four star classes (10 large, 46 medium, 210 small, 720 dust), measured at 3.90% ink
coverage and 0.946 peak; 5.5% of rows disagree across the wrap, so cards sample one
window and nothing tiles.

| Claim | Count | Status |
| --- | --- | --- |
| Holo rares identified as Starlight | 47 (16 Base, 16 Jungle, 15 Fossil) | **Verified** by the set description |
| Painted with the sheet | 47 | **Implemented** — procedural texture |
| Foil mask (illustration window) | 47 | **Verified** by "spread across the image"; 37.5% of the card box |
| Render-validated (Base Charizard, Jungle Clefable, Fossil Aerodactyl) | 3 | **Validated** numerically: at-rest identity, tilt lift, mask containment, duplicate-decoration guard |
| Texture verified against a real sheet | 0 | **Not verified** — no scan or photograph exists here |

Known exception: some Base Set Machamp cards carry Cosmos instead of Starlight
(Bulbapedia Error cards). The card row has no marker, so those copies still render
Starlight. Base Set 1st Edition and Unlimited share the foil; Base Set 2 is Cosmos.
`reports/starlight-printings.md` states each of these.

## Phase 7 detail — Cracked Ice

Bulbapedia: "irregular reflective shapes resembling pieces of cracked or shattered
glass", first used for the featured card in Platinum-series Theme Decks.

| Claim | Count | Status |
| --- | --- | --- |
| Named Cracked Ice printings in the catalog | 1 (Frost Rotom, `pl2-RT2`) | **Verified** — Bulbapedia names this English printing |
| Foil area | body, name bar and text foil; artwork matte | **Verified** by "over everything but the image of the Pokémon" |
| Painted | 1 | **Implemented** — procedural Voronoi sheet, 400 facets, tileable |
| Render-validated | 1 | **Validated**: at-rest identity, tilt light outside the window, flat facet interiors, bright cracks |
| Theme-deck printings available to wire | 0 | **Blocked** — no Platinum/HGSS/BW theme-deck sets in the catalog |
| Texture verified against a real sheet | 0 | **Not verified** — reconstruction |

The EX Trainer Kits (`tk1a`, `tk1b`, `tk2a`, `tk2b`; 44 cards) used to be painted
Cracked Ice by a prefix rule. They are 2004–05 products, before the pattern existed,
and the rule is gone; those rows now make no foil claim. `reports/crackedice-printings.md`
records the printing and the correction.

## Phase 5 detail — reverse holo

| Subphase | Era | Status |
| --- | --- | --- |
| 5A | Legendary Collection (fireworks) | **Validated** |
| 5B | Expedition (plain) | **Validated** — Aquapolis and Skyridge too, each against its own mask and render |
| 5C | EX era | **Validated** for all 16 EX expansions — flat body, energy symbols, background foil, pinwheel and Poké Ball; stamps/logos still not modelled |
| 5D | Diamond & Pearl | **Validated** for DP1–7; each expansion checked against its own mask and render |
| 5E | Platinum / HGSS | **Validated** — plain body paper across Platinum 1–4, HGSS 1–4 and Call of Legends |
| 5F | Black & White | BW1 plain **validated**; BW2–11 type symbol **validated** with per-card glyphs; XY shares the paper |
| 5G | XY | Shares the BW type-symbol paper — **validated** |
| 5H | Sun & Moon | **Validated** — one large per-card symbol on the left, SM1–12 and Detective Pikachu |
| 5I | Sword & Shield | **Validated** — tile lattice with the card’s own symbol, 15 expansions |
| 5J | Scarlet & Violet | **Validated** — nested tiles, symbol at different sizes, 16 expansions |
| 5K | Mega Evolution | **Validated** — plain background on the card body, 7 expansions |
| 5L | Last families | **Validated** — energy symbols in the window and plain foil in the artwork background |

Report: `reports/reverse-printings.md` (one row per expansion, with pinned patterns and
exclusions). **All 112 expansions are now validated**: the six earlier batches, the
whole Diamond & Pearl run, Platinum 1–4, HGSS 1–4, Call of Legends, Black & White 1, the
24 BW2–11/XY expansions on the type-symbol paper, the 13 Sun & Moon/Detective Pikachu
expansions with one large symbol at the left, the 15 Sword & Shield/Crown Zenith/Pokémon
GO/Futsal expansions on the tile paper, the 16 Scarlet & Violet sets on the nested tile
paper, and the last 22 — plain body, energy symbols inside the window, and plain foil in
the artwork background. Each is proved against its own mask, eligibility and render.

---

## Phase 6 — Starlight tasks

- [x] Identify Base/Jungle/Fossil Holo rares as `starlight` with the art-window mask.
- [x] Mark `PATTERNS.starlight.implemented === true` once the sheet ships.
- [x] Build a starfield sheet (starbursts of several sizes, slight blur) as a transparent
      texture + alpha, clearly labelled a reconstruction: `public/foil/starlight/sheet.png`.
- [x] Sample it in card space (one cut per card, set-seeded orientation).
- [x] Validate representative cards: Base Charizard, Jungle Clefable, Fossil Aerodactyl
      (numeric render checks; no photograph available for fidelity).
- [x] Report: printings identified vs painted vs validated —
      `reports/starlight-printings.{json,md}`.
- [x] Distinguish Base Set 1st Edition/Unlimited (same foil) from Base Set 2 Cosmos.

---

## Phase 12 — Shiny, Radiant and specialty papers

Identified, then wired: `src/foil/shiny-db.ts` names a paper per family, `printing-db.ts` reads
it at branch 1g, `scripts/shiny-report.ts` writes `reports/shiny-printings.{json,md}`, and
`tmp/check-shiny.ts` pins the counts and the resolution. That is 377 catalogue rows across 11
claims and four families; 18 of them draw from a shipped sheet — Neo Revelation's Cosmos, the
fifteen Radiant Pokémon and the 30th Celebration Shining Celebi's Confetti.

**Radiant Pokémon is painted.** `src/foil/radiant-etched-sheet.ts` draws a 16px etch inside a
128px diamond grid, `scripts/radiant-etched-foil.ts` writes `public/foil/radiant-etched/sheet.png`
and the GENERATED `radiant-etched-index.ts`, and `src/foil/radiant-etched.ts` cuts one window per
card. The sheet is a reconstruction — `textureVerified` false, no relief claimed — and
`reports/radiant-etched-printings.{json,md}` plus `tmp/check-radiant-etched.ts` carry the evidence.

- **Shining is four products.** Neo Revelation's pair is Cosmos in the illustration window; Neo
  Destiny's eight put "a reflective foil treatment on the Pokémon itself", a metallic sheen whose
  sheet no source names; Shining Legends repeats that look; three SM promos are separate products
  whose copy says only "foil"; and the Celebrations and 30th Celebration reprints carry the Classic
  Collection paper — Bulbapedia's "textured confetti holofoil pattern" — so the 2026 Shining Celebi
  resolves to `confetti` rather than to a guess.
- **Pokémon ★** is gold-tinted with "holographic shadows ... on various parts of the card":
  identified, no rectangle, no sheet.
- **Radiant Pokémon** (2022) is etched silver across the whole card, a different printing from
  Radiant Collection (2013), which stays `radiant`.
- **Shiny Vault / Shiny Rare** has a documented finish and no documented repeat: Bulbapedia's
  Hidden Fates page says its cards "All have a special embossed Holofoil treatment", Shining Fates
  repeats the treatment ("beautiful etched cards" in the product copy), and Paldean Fates gained a
  "holographic, silver, textured foil border" the Japanese set lacks. All 316 rows therefore
  resolve at `verified` to `special-treatment`, with no area claimed, and none borrows Starlight —
  or Cosmos, which is what the collector label "Galaxy holo" actually names.

  The Galaxy trap is worth stating plainly: two collector guides call the Shiny Vault look "Galaxy
  holo", and CardVeil documents "Cosmos Holofoil, often called Galaxy Holofoil" as the Base Set 2
  onward paper. The name is a synonym for a 2000–2011 sheet, not evidence for a 2019–2024 card, so
  the rows refuse it in writing.

The report's comparison section is empty, which is the point: the two files answer the same way.
The 416 cards on a documented finish with no named paper still draw plain foil (with a
modelled relief where the finish is textured), and the two Pokémon-only areas keep the
illustration window marked unverified.

---

## Phase 14 — Japanese and Chinese exclusive cards

The catalogue is English-only today: `language` exists on the printing record, but every
row is `en`, so a Japanese or Chinese card resolves to no claim rather than borrowing the
English one. That is the right default and the reason this phase is separate — an
exclusive printing is a different physical card, not a translation of an English one.

- [ ] Add Japanese and Chinese (Simplified and Traditional) printings as their own
      catalogue rows with a `language` value, set id and collector number, instead of
      mapping them onto the English row.
- [ ] Include the exclusives that have no English counterpart at all: Japanese promo
      sets and magazine/book inserts, and Chinese-exclusive main-set and promo cards.
- [ ] Record foil evidence per language. A pattern verified for the English set does not
      automatically transfer: set numbering, promo distribution and even the paper can
      differ, so each exclusive needs its own source and its own mask decision.
- [ ] Keep unmatched languages at `unresolved` — never fall back to the English pattern,
      and never let a marketplace language flag invent a foil variant.
- [ ] Extend `reports/reverse-printings.md` and the printing database report so the
      language axis is counted rather than silently English-only.

## Phase 10 detail — modern special reverses

Poké Ball and Master Ball reverses are ordinary reverse printings — foil on the frame
and text box, no ball foil inside the artwork — carrying a different stamp. The
print's fine etched field crosses artwork and body. It is modelled as a separate
full-card relief by `src/foil/reverse-etch.ts`, so the etch can shade the art while
the ball foil keeps its outside-art mask. `src/foil/reverse-special.ts` holds the printing table and
`scripts/reverse-special-foil.ts` writes four sheets into
`public/foil/reverse/special/` plus the generated index.

Both documented layouts ship: **one large ball** behind the attack text (Prismatic
Evolutions, Ascended Heroes) and **rows of balls** (Black Bolt, White Flare). Master
Ball carries an M on the upper half. The row references alternate large and small
balls in staggered rows; the shipped sheet now matches that alternation at five
columns, with measured outer rings of about 56px (large) and 32px (small) on a
335px-wide card, about 67.5px column pitch and 69px row pitch. The sampler corrects
for the card aspect so the balls stay round. The glyphs, facet spacing and exact
row registration remain modelled.

| Claim | Count | Status |
| --- | --- | --- |
| Sets with a ball reverse | 4 (Prismatic Evolutions, Black Bolt, White Flare, Ascended Heroes) | **Verified** by set guides |
| Set/stamp printings | 12 | **Verified** — the two fixed-stamp sets, plus Ascended Heroes' five assigned ball papers and its Team Rocket R |
| Eligible cards by the researched rule | 609 | **Implemented** — see the report; Ascended Heroes' 140 cards are counted from the per-card assignment instead |
| Published counts reproduced | 8/8 (Prismatic Evolutions 100 Poké Ball + 67 Master Ball; Ascended Heroes' 140 stamped cards across six papers) | **Verified** — the rule and the assignment both match exactly |
| Textures | 10 | **Modelled** — three real photos + two published renders reviewed for the ball layouts and the Ascended ball's size (a real Snorunt ring measures 0.434 card widths); the glyphs, the four assigned marks, the R, facet spacing and row registration are drawings |
| Reference coverage | 3 distinct photographs (Prismatic Sylveon Poké Ball, Umbreon Master Ball, Ascended Heroes Snorunt Poké Ball; 8 asset references) + 2 published renders | **Verified** for layout, large/small alternation, the large ball's size and placement, M and the etched area; exact row registration, ball texture, the four assigned marks and the R remain **modelled** |
| Stamp variants in the game | 7 tokens: 2 rolled (Poké Ball, Master Ball) and 5 assigned (Love, Friend, Quick, Dusk, Team Rocket R) | **Implemented** — inventory, pulls and pricing |
| Pack odds | Poké Ball 33.10% Prismatic / 30.56% Black Bolt & White Flare; Master Ball 1 in 20 Prismatic / 1 in 19 Black Bolt & White Flare; Ascended Heroes **87.31% an assigned paper**, 11.25% IR / 1.44% SIR | **Measured** for six printings and the Ascended replacements — TCGplayer opening studies; Ascended Heroes' 87.31% is **derived** from the measured second-slot hits |
| Reverse slots | Prismatic 2 (Poké Ball first, Master Ball second); Ascended Heroes 2 (Energy pattern first, the card's assigned paper second); Black Bolt and White Flare 1 | **Verified** for Prismatic and the Ascended Heroes split; both Ascended papers are painted |
| Stamp price premium | 1.5× for Poké Ball, the four assigned balls and the R; 8× for Master Ball | **Modelled** — labelled estimated in game; the assigned papers have no measured comps |

`reports/special-reverse-printings.md` records each set, layout, eligible count,
published count, source and the per-asset reference evidence. The three real
photographs confirm the large Poké Ball and Master Ball and that the etched field
crosses the art; the Sylveon photo measures the Poké Ball at about 0.52 card widths
across, centred about 0.675 down the card, and the Terastal render agrees, so the
sampler was corrected from the earlier ~0.63-wide stamp at v = 0.62. The ball glyphs
and facet spacing remain drawings; the rows sheet's five-column lattice, 56px/32px
outer rings and 67.5px/69px pitch are measured from the references, while its exact
registration remains a modelled reading. The etched field is now a modelled full-card relief: it shades the artwork
and body through its own mask, while the ball foil stays outside the art. The game's reverse slot now rolls the ball papers, stores
the token in inventory, prices it from the card's reverse row with a labelled
premium, and tags it in the binder. `server/services/special-reverse.ts` is the
game-side table; `tmp/check-special-pulls.ts` keeps it in step with the renderer
registry. Ascended Heroes' 87.31% is derived, not directly counted. Prismatic Evolutions keeps its real
two reverse slots (Poké Ball first, Master Ball second), so one pack can hold both.
Ascended Heroes also keeps two: the Energy-pattern reverse first and the card's own
assigned stamp second, in a 4-common / 3-uncommon / 2-reverse / 1-rare-or-hit pack.
Both Ascended papers are painted: the first draws one large type symbol for the
card's type, and the second paints the paper `src/foil/ball-stamps.ts` assigns —
Poké Ball, Love Ball, Friend Ball, Quick Ball, Dusk Ball, or Team Rocket's R. A real
Snorunt Poké Ball reverse measures that ring at 0.434 card widths, so the six
Ascended sheets are drawn at that size and the set's Poké Ball is a sheet of its own
rather than Prismatic's. That
slot therefore stores the card's own token rather than rolling a ball, and draws the
measured IR/SIR replacement when the stamp roll loses. Black Bolt and White Flare
keep one reverse slot.

What remains in this phase is evidence, not rendering: the four assigned marks and the R
have no photograph yet (step 7 below), and Prismatic's drawn ball size still disagrees
with its angled reference (step 8). Everything else here is measured and proved.

## Phase 11 detail — textured printings

The engine's surface pass is live and two reliefs ship, split by era:

- `etched-deep` for Black & White and XY full arts (set ids `bw*`, `xy*`, `g1*`,
  `dc*`), a coarser, deeper lattice;
- `etched` for Sun & Moon, Sword & Shield and Scarlet & Violet tiers, the finer lattice.

`src/foil/surface-textures.ts` routes by rarity and era; `scripts/surface-foil.ts`
writes both 512px normal maps into `public/foil/surface/`. The split is sourced from
the description of early full arts as "heavy with deeply etched texture" and later
ones as "lighter" and "finer, wavier"; the exact spacing and depth remain modelled.
Scarlet & Violet textures are art-specific in print, so one fine relief there is a
disclosed simplification.

| Claim | Count | Status |
| --- | --- | --- |
| Surfaces shipped | 3 | **Modelled** — two lattices and a grain, all drawings |
| Textured rarities routed | 14 labels | **Modelled** — the list is this build's choice |
| Cards in the catalogue covered | see `reports/surface-printings.md` | **Implemented** |
| Relief verified against a real card | 0 | **Not verified** — no scan or photograph |
| Mask containment / alpha / hue | all | **Validated** numerically |
| At rest | all | **Validated** — the scan, byte for byte |

The surface fades in with tilt, so a card at rest is unchanged. Ordinary reverse printings are
deliberately excluded. The four Shiny Vault rarities are the one shiny family that earns a surface,
 and it is its own granular grain rather than a lattice: macro photographs show a shimmer with no
 attributable repeat, so `sparkle` is drawn from that appearance while the paper stays unnamed. A modern ball reverse is the
one exception: its etch uses a full-card mask while the ball foil stays outside the
art, so the relief can cross the artwork without the stamp entering it. Remaining
work: reference evidence for either relief and per-card Scarlet & Violet textures. The inspector opens both era
examples and shows the relief, the normal map, a pixel diff against the scan and a
reference pane (which holds a flat scan until a tilted photograph is catalogued).

## Known bugs

| ID | Bug | Severity | Status |
| --- | --- | --- | --- |
| B1 | ~~Generic tile stands in for unpainted eras~~ | High | **Fixed 0.19.0** — plain foil, inspector badge |
| B2 | ~~Starlight fallback looks like a pattern~~ | High | **Fixed 0.20.0** — starfield sheet, 47 printings |
| B3 | ~~EX Delta Species δ undetectable~~ | Medium | **Fixed 0.59.5** — the marker is in the catalogue's card name, so `src/foil/delta-species-index.ts` (GENERATED by `scripts/delta-species-index.ts`) lists the 50 δ holo rares and they resolve to the `plain-holo` paper instead of Cosmos |
| B4 | D&P-era reverse artwork-background subject not segmented | Medium | Open (Phase 5C/9) |
| B5 | Prime reverse eligibility unverified | Low | Open |
| B6 | ~~No normal-map/embossed cards~~ | Medium | **Partial 0.28.0** — two modelled etched surfaces split by era; no reference relief |
| B7 | Promo catalogue partial | Medium | Accepted, documented |
| B8 | ~~EX Trainer Kits painted Cracked Ice by a prefix rule~~ | Medium | **Fixed 0.21.0** — rule removed, 44 cards plain |
| B9 | Large ball stamp was ~0.63 card widths at v = 0.62 | Medium | **Fixed 0.29.1** — measured against a real Sylveon photo, placed at v = 0.675. The drawn ring is 0.410 card widths, not the 0.52 that angled photo suggested; Ascended Heroes' own photograph measures 0.434 and ships at that size, so Prismatic's size is the open question in step 8 below |
| B10 | Ball-reverse etch uses the generic fine lattice | Low | **Partial 0.30.0** — full-card neutral relief now modelled; spacing/depth are not measured |

---

## Next development steps (ordered)

1. ~~Phase 0 correction 1~~ **shipped in 0.19.0**: unpainted printings render plain foil and
   the inspector says so. The remaining Phase 0 items are the reverse subject masks and the
   promo gaps; the δ disclosure is closed (0.59.5 — see B3).
2. ~~Phase 6~~ **shipped in 0.20.0**: procedural starfield, per-card cut, 47 printings,
   report and suite. Fidelity still needs a tilted photograph.
3. ~~Phase 7~~ **partial in 0.21.0**: Voronoi fracture, Frost Rotom (RT2) wired with
   the verified outside-art mask, Trainer Kit rule corrected. Blocked on theme-deck
   catalogue rows and on real photographs.
4. ~~Phase 5 DP2–7, Platinum/HGSS plain, BW type symbols, the Sun & Moon large symbol,
   the Sword & Shield tile paper, the Scarlet & Violet nested tile paper and the last
   three family papers~~ **shipped**: all 112 expansions validated. The EX-era set logos
   and stamped promos are still not modelled — they are printed decoration, not foil.
5. ~~Phase 11 first slice~~ **partial**: two modelled etched surfaces, split by era,
   routed by rarity, gated by mask and tilt; the inspector compares both. Reference
   evidence and per-card Scarlet & Violet textures remain.
6. ~~Phase 10~~ **shipped end to end**: Poké Ball and Master Ball reverses, both
   layouts, ten papers (Ascended Heroes' six included), report and suite, now rolled in
   packs, stored in inventory and priced with a labelled premium, including Prismatic's
   and Ascended Heroes' two reverse slots — both of the latter's faces are painted, the
   Energy symbol first and the card's assigned stamp second.
   Ascended Heroes' rate is now derived at 87.31% from TCGplayer's measured
   second-slot hits; a direct per-ball count would replace the derivation.
7. **Ascended Heroes' marks.** The photographs settle the ball's size and placement, not
   what each ball carries: the heart (Love), flower (Friend), bolt (Quick), crescent
   (Dusk) and the R on Team Rocket's are still drawn from description. One tilted photo of
   a Love Ball or Dusk Ball card, run through the ring/button fit in
   `tmp/measure-ascended-geometry.ts`, would move the marks, their size and their place in
   the cap from drawn to measured — and would either confirm or correct the R paper, for
   which no photograph exists at all today.
8. **Prismatic's ball size.** Its two one-large papers are drawn at a 0.410-card-width
   ring, from the 0.95 sampler window, while the angled Sylveon photo that fixed the
   placement suggested ~0.52 across. A face-on photograph of a Prismatic Poké Ball and a
   Master Ball would settle which is right; only then re-size, and only those two papers —
   Ascended Heroes now carries its own measured 0.434 and must not follow.
9. **Phase 14:** Japanese and Chinese-exclusive printings as separate language rows —
   set ids, sources, foil evidence and masks per language; never borrow the English claim.

Do not advance a phase past its tests; do not describe an approximation as verified.
