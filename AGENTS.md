# Project conventions

## The in-game changelog ships with every update

`CHANGELOG.json` is what the **✨ What's New** panel reads (`/api/changelog` →
`src/views/WhatsNew.tsx`). Every player-visible change must land there in the
same piece of work that made the change — never leave it for later, and never
ship a build whose changelog is older than the code.

The panel leads with the newest release's `highlights`; **View full changelog**
opens every entry ever shipped, in full.

For each update:

1. **Add one entry at the top of `entries`** (newest first — the panel walks the
   list in order and marks the newest as "you are here").
2. **Bump the version** in `package.json` (patch for fixes, minor for new
   systems) so the entry actually badges as unseen. `APP_VERSION` is read from
   `package.json`; `changelog:seenVersion` is per-save, so a version bump is what
   makes the badge light up.
3. **Fill in the schema** exactly: `version`, `date` (`YYYY-MM-DD`), `title`
   (short, evocative — "Real prices, real packs"), `highlights` (three to five
   one-string headlines) and `features` (every item, in full).
4. **Two levels, two audiences — `highlights` vs `features`.** `highlights` is
   what the ✨ What's New panel shows for that release: the major changes only,
   one plain sentence each, about 200 characters at most, with just the numbers
   a player needs. `features` is the complete record that **View full changelog**
   renders and that the release notes are generated from, so it keeps the small
   print too — the extra line in the P&L, the sales tax, the copy that moved. The
   slim panel falls back to `features` when an entry has no `highlights`, so
   every new release ships with them; entries written before the split show their
   `features` in the full view only. If in doubt, write the highlight first and
   move the detail down into `features` — it is the panel, not the release, that
   has to stay short.

   **Only the newest entry's highlights are all visible.** The panel prints every
   highlight of the current release, but an earlier version is a single dated row
   that shows `highlights[0]` and no more, so give it exactly one line and let the
   rest of the story live in `features`. Three to five highlights are for the release
   you are shipping, not for history.

   **Never bake a count into an entry.** "All 288 updates" is wrong the moment
   the next release lands, and the changelog is shipped inside the build, so the
   number has to be rebuilt to be corrected. Say "every update ever shipped" and
   let the panel show the count itself.
5. **Write features for the player, not the diff.** Name the screen or system,
   say what was wrong before when it helps, and give the concrete numbers or
   behaviour they will notice. Existing entries are the house style: a full
   sentence or three each, no file names, no commit talk.
6. **Say so honestly.** If part of a change is a simplification (pack odds
   scaled to the game's ten-card packs, a researched price that is a range being
   treated as a point, unknown data left alone), the entry should admit it
   rather than implying perfect fidelity. Both levels carry that honesty: a
   highlight says what is modelled, the matching feature says which part.

Run `npm run typecheck` (the script pins the 4 GB heap tsc needs) and `npm run build` before
calling the update done; the changelog is bundled into the server at build time.

### Phase 5 revision: colour may be dimmer than white, never brighter

Phase 5 originally held the coloured composite to exactly the neutral layer's
luminance. That only holds while the tint's brightest channel fits the pixel's
headroom, and it quietly capped how bright the foil could ever be: raise the
light at all and saturated pixels hit the wall (measured: a violet tint wanting
320/255 of a 221-unit headroom), so the old code scaled the whole highlight down
to keep the hue — a dimmer glint than the white one it replaced.

The reflection now carries a wider band, an earlier rise and an 0.85 peak, and
the rule is stated as the two things that are actually true: **where the tint
fits the headroom, brightness is identical to the neutral layer** (≤1.6/255);
**everywhere, the coloured highlight never out-shines it**. At 60° a full-bleed
RC6 now averages +43.6/255 of neutral light and +31.6/255 coloured, and RC16's
window +98.9 and +66.7. Washing the hue toward white to win the brightness back
was tried and rejected: it spends the one thing this layer owns to buy
something the layer beneath it already controls.

## Other standing conventions

- `scripts/unnamed-finish-report.ts` sweeps the catalogue the same way and writes
  `reports/unnamed-finish.{json,md}`: one record per card the renderer resolves to
  `special-treatment`, carrying what the sources say about that family's finish and the specific
  evidence that would let its paper be named and its area cut. It deliberately does not say
  "unpainted" — these cards have identified finishes and unnamed papers, and the difference is the
  point. `tmp/check-unnamed-finish.ts` re-runs the sweep and fails when a card enters or leaves the
  bucket, when a record loses its known/needs/source text, or when a family has no entry.
  The 316-card Shiny Vault family is **refused** rather than painted: the only name offered for its
  finish, "Galaxy holo", is documented as another name for Cosmos by Bulbapedia's Cosmos page and
  folio.fyi's pattern guide, which also files "textured or etched" as relief rather than a printed
  pattern. A source naming a distinct foil stock is what would reopen it. The finish itself **is**
  drawn: `surface-textures.ts` routes the three Shiny Vault rarities to a granular `sparkle` normal
  map, so those 316 cards render embossed over their illustration-window foil while borrowing no
  sheet — a surface is not a paper, and the pattern stays `special-treatment`. The grain itself was then chosen by measurement: macro photographs of the English SV107 and its
  Shiny Star V print (`reports/shiny-etch-photos.md`) recover a drawn 20px lattice to 0.03px, but no
  card patch clears the repeat bar — not even at a 2700 px card width, where the old lattice's
  pitch would span ~105 px — and the flat catalogue scan returns peaks of the same strength. No
  repeat is attributable, so the cards wear a grain rather than the lattice. Its scale was tested the same way
  (`reports/shiny-grain.md`): the correlation length reads 0.67% of card width on the photographs and
  0.78% on the flat scan, and a resolution ladder shows why the figure cannot be trusted: rendering the
  same still down to the scan's width raises its correlation length from 0.36% to 0.97%, while the
  scan reads 0.71%, so the length tracks pixel size rather than the card. Extrapolating that ladder to zero pixel size looked like it put the true length near 0.16%, but two
  more independent stills intercept at -0.29% and 0.53%, so the extrapolation is not stable across
  sources. A squared blur model that cannot produce a negative length does not converge either
  (0.37%, 0.28%, 0.00%, 0.71%). Restricting the measurement to each still's flattest 16%-of-card
  patches narrows the spread but leaves two negative intercepts (-0.25% and -0.01%), so artwork edges
  were not the whole story: nothing follows about the card, so the density stays modelled — accepted as
  final in that report on 2026-11-07, with the four tests and the drawn periods recorded, so it is a
  decision rather than an open question.

- `scripts/unpainted-report.ts` sweeps every card through `holoFor` and `printingFor` and writes
  `reports/unpainted-papers.{json,md}`: which identified papers still ship no sheet, how many cards
  each affects, and why the sheet-less rows that are NOT gaps are not. It fails when the registry and
  the roadmap's "Papers still unpainted" line disagree, so a paper cannot be painted (or a pattern
  added) without the audit moving with it.

- `scripts/open-holo-questions.ts` writes `reports/open-holo-questions.{json,md}`: every open foil question and refusal in one place — the families whose finish is documented but whose paper no source names, the claims this build refuses, the evidence the painted sheets still lack, the roadmap's open bugs and unstarted phases — each with what would close it. It reads the other reports and `HOLOFOIL_ROADMAP.md` instead of restating them, and fails when an open bug or phase has no evidence sentence (or one is left behind after it closes). `tmp/check-open-holo-questions.ts` re-runs the build and fails when the committed file is stale, so the list cannot drift from the sources.

- A new set's cards need a `pack_product_cards` pull table before they can be opened; the loader builds it once per release rather than on every boot.

- Before/after screenshots for screen overhauls go in `screenshots/`.
- Saves live in `data/tcglife.db`; restore any test state you perturb.
- One-off patch/verification scripts belong in `tmp/`, not in `server/`.

## A release can ship before the catalog does

`server/catalog/local-releases.json` carries releases pokemontcg.io has not
published yet: Delta Reign (`me6`, 141 cards, 2026-11-06) and the 30th
Celebration Wave 4 products. `server/services/localcatalog.ts` upserts its sets,
cards, prices and sealed products through the same tables the sync writes, then
builds the set's pull table once per release; `server/index.ts` calls it at boot.
It is additive and idempotent, and the API wins later because its rows arrive
with a later `retrieved_at` — so a row added here is a head start, never an
override.

The file is GENERATED by `tmp/dlr/emit.mjs` from the published card lists
(Serebii for supertype, type and HP; YesTCG for number, rarity and TCGplayer
market). Two absences are deliberate, not oversights: Pokémon stage subtypes are
not stated in the lists read here, so `subtypes` stays null; and no source names
Delta Reign's holo paper, so the set makes no foil claim — the only Delta Reign
cards any source calls Cosmos are the store promos, which are a different thing.

## Holofoil reference sources

Use these when identifying or rebuilding a foil pattern; do not invent one.

- TCGplayer card-identification help: https://help.tcgplayer.com/hc/en-us/articles/360025905754
- folio.fyi holo patterns: https://folio.fyi/blog/pokemon-holo-patterns
- Bulbapedia Holofoil (per-print pattern names and descriptions): https://bulbapedia.bulbagarden.net/wiki/Holofoil
- Cardveil holo patterns: https://www.cardveil.com/resources/pokemon-holo-patterns

Card scans live at `https://images.pokemontcg.io/<setId>/<number>_hires.png`
(`_hires` for 734x1024). Flat scans do **not** contain the foil, so ask for a
tilted photo or video before claiming a stamp is accurate.

## The RC6 foil sheet is the layer contract

The Radiant Collection asset sheet (Flareon-EX RC6/RC32, "Radiant Collection
Foil Pattern Assets") defines six layers. That decomposition — not any single
look — is what the foil system has to reproduce, in this order:

1. **Base Card (Artwork).** The scan, pixel for pixel. No filter, blend mode,
   brightness, contrast or saturation change may touch it.
2. **Foil Coverage Mask.** Card-shaped, white = holo, black = non-holo. Lives in
   `src/foil/mask.ts` and is the only thing allowed to decide *where* foil goes.
   For Radiant Collection printings the researched rules live in
   `src/foil/radiant-masks.ts`: RC6 full-bleed is edge to edge, a regular RC card
   is the illustration window, a reverse holo is everything but the window, and a
   Generations RC common has no foil at all.
3. **Pattern Texture.** For a Radiant Collection card this is that card's own
   motif from the concept pack (see below); for every other printing with no
   shipped texture it is PLAIN foil — uniform light, no marks. `src/foil/pattern.ts`
   samples the RC6 sheet for the reference lab and its own suite; it is never
   handed to a card that has a different pattern. Either way the coverage mask cuts it —
   the texture never decides *where* foil goes.
4. **Alpha Pattern.** The same marks in grayscale, used to modulate the
   reflection instead of drawing anything itself. The pack's separate
   `pattern_alpha.png` is byte-identical to the RGBA file's alpha channel on all
   57 cards, so opacity is read from the RGBA alpha.
5. **Holo Reflection (Angle-Dependent).** The iridescent sweep, and the only
   layer permitted to add colour. It moves with tilt: near-neutral face-on,
   sweeping and hue-shifting by ~30° and ~60°, which is what makes the foil read
   as a surface rather than a sticker.
6. **Final Composite.** Base + masked pattern + reflection.

Two rules follow and must not be broken: appearance never writes to the base
pixels, and the mask decides *where*, the tile decides *what*, the tilt decides
*how bright and what hue*.

### Radiant Collection: each card wears its own motif

The pack in `Radiant_Collection_57_Card_Foil_Concept_Pack` is the source for
Radiant Collection patterns. `scripts/radiant-foil.ts` turns it into shipped
textures under `public/foil/radiant/<setId>/` plus `src/foil/radiant-index.ts`
(GENERATED — rerun the script, never hand-edit). Every one of the 57 RC cards maps
to its own 768x768 texture by **set id + collector number**, because Legendary
Treasures RC6 is Piplup and Generations RC6 is Flareon-EX: a name-first or
number-only lookup silently hands one card the other's pattern.

Two facts about the pack, both load-bearing:

- Its motifs are RECONSTRUCTED CONCEPT ART, not scanned factory stamps; every
  card's README says so. Never describe them as authentic.
- `pattern_alpha.png` duplicates the RGBA file's alpha channel for all 57 cards,
  and the generator verifies that rather than assuming it.

The motif's pastel colour never reaches the card. `src/foil/radiant.ts` reduces
each texture to luminance x opacity, so a bow decides *where* light lands and
nothing else; hue still comes from the iridescence layer alone.

The tile sampled from the RC6 asset sheet (`tile-data.ts`) is no longer wired into
the renderer at all: a printing with no texture renders plain foil rather than
borrowing RC6's hearts. It survives for the reference lab and its own suite.

The floor (0.18) and gamma (0.85) are still load-bearing on both paths: the bare
field between marks must stay quiet or a mark reads as mottle, and the suite
asserts a mark body holds at least 1.7x the light of the field beside it.

### Radiant coverage is researched, and one answer is "no foil"

The pack ships no masks and says so, so coverage is researched separately in
`src/foil/radiant-masks.ts` — kept apart from the textures on purpose, because
"this motif is a concept" and "foil exists here" are two claims with two different
kinds of evidence. There, `verified` means a source described the real foil area:

- Legendary Treasures (bw11) RC cards are holo across the whole face — Bulbapedia's
  "special coating and foil patterns" plus an owner describing RC7 in hand as
  "holo on the entire card".
- **Generations RC commons are NOT foil.** Thirteen of the 32 g1 RC cards were
  being foiled by a blanket "every RC card is holo" rule; they now render plain,
  which is what the sources and the two RC print sheets (SPa uncommons/ultra rares,
  SPb commons) say.
- Generations foil geometry is undocumented except RC6 (photographs: edge to edge)
  and RC16 (scan: art window). Everything else is modelled and labelled unverified
  in the dev inspector rather than presented as fact.

The reverse-holo flag is ignored for RC cards: the subset was never printed
reverse-holo, so a marketplace flag must not invent a foil variant.

### A foil mark must never duplicate printed decoration

Many RC cards already print hearts, bows and sparkles. The composer
(`src/foil/stages.ts`) fades a mark out where the print beneath it is already near
white, so a bright printed decoration cannot gain a second copy of itself; the
suite asserts that a mark over pure white adds nothing. Marks are light and only
light: the pattern layer writes no colour and no shape of its own.

### The dev holofoil inspector

**Card foil is always on, and there is no advanced treatment.** Every resolved
paper computes its mask and renders at a fixed neutral tilt at rest. The pointer
tilt, iridescence and embossed relief that Settings → Appearance used to switch on
were removed in 0.94.4 along with the `tcglife.foil` flag, so nothing in
`FoilOverlay` animates and nothing in the store decides how a card is lit. Ask
`holoFor` / `printingFor` what a card's foil is; there is no flag to ask.

Dev builds mount `src/foil/HoloDebug.tsx`; **Shift+H** opens it. It draws the same
`src/foil/stages.ts` composite one stage at a time — base, pattern, pattern alpha,
coverage mask, reflection, final — plus, for textured printings, the relief alone, the normal map itself, a pixel diff against the scan and a reference side-by-side pane — with sliders for reflection intensity, pattern
opacity, iridescence strength, texture scale and light angle, and it prints the
card's mask kind, whether that mask is verified, and the motif's pack folder. A
packaged build has no inspector and no way to open one.

### Phase 5: iridescence is the only layer that may add colour

`src/foil/iridescence.ts` is layer 5, and the only module in `src/foil/` allowed
to write a colour. It rides the band the reflection already defines (it imports
`bandPosition`), so the colour travels with the light rather than drifting across
it: face-on is white light and exactly zero chroma, ~30° is a pastel (~0.25), ~60°
is a full tint (~0.65), and the hue slides about 100° between those angles.

Two invariants keep it honest. Every tint is renormalised to unit luminance, so
colour changes what the light is and never how much of it there is — a pink
highlight measures as bright as the white one it replaced. And because a
saturated highlight needs more of one channel than a white one, the whole tint is
scaled back where the print has no room, capped at the neutral layer's own
headroom: colour never brightens a pixel the neutral reflection left alone, and
clipping never skews the hue toward whichever channel hit the wall first.

## Cosmos is a sheet of circles, not a sparkle

Cosmos was the default English holo paper from Base Set 2 (2000) to Call of
Legends (2011), and it is a printed field of round marks — large planets, medium
orbs, fine speckle, small four-point stars on the vintage paper — not noise.
`src/foil/cosmos.ts` samples the pack sheet; `src/foil/cosmos-masks.ts` decides
where that sheet is allowed to appear. The texture never decides location.

The pack (`Cosmos_Galaxy_Foil_Concept_Pack`) is four PROCEDURAL textures, not
scans, and `scripts/cosmos-foil.ts` records `concept: true` for every one. Its
example masks are schematic rectangles and are never copied. As with the Radiant
pack, `pattern_alpha.png`'s luminance is byte-identical to the RGBA alpha on all
four variants, so one file ships per variant and opacity is read from the RGBA
alpha.

Two measurements decide the sampler and must not be casually changed:

- the four textures are NOT tileable (seam difference 0.003–0.025 against
  0.0002–0.0020 inside the tile), so a card samples ONE window of the sheet and
  nothing wraps;
- the marks cover 4.5–6.9% of a sheet at peak ~0.68, so the field is sparse and
  the `ALPHA_FLOOR`/`PATTERN_GAMMA` curve stays load-bearing exactly as it is for
  Radiant.

Copy-to-copy variation is a CROP, not a re-seed: each card id derives its own
offset and slight zoom (`cosmosCopyFor`), while the sheet's 90° orientation is
seeded from the SET id, because a set was cut in one orientation. A save does not
distinguish physical copies, so two copies of one card id share a cut — the
variation is between cards. Do not "fix" that by randomising per frame: the
pattern must not move under tilt.

Coverage research, and what is verified:

- a standard Cosmos holo rare foils the illustration window (verified);
- Pokémon-ex foils the window AND the border (`artBorder`, verified);
- LEGEND is foiled edge to edge (verified) — which is why `holoFor` counts a
  `LEGEND` rarity as foil and `chasePattern` no longer claims it;
- reverse printings are NOT Cosmos: they carry their set's reverse paper
  (`reverse-flat`, `reverse-fireworks`, `reverse-type-symbol`, …). Base Set 2 and
  Team Rocket predate reverse holos, so a marketplace flag cannot invent one;
- promotional Cosmos needs a named entry in the printing database. Promo sets are
  never blanket-assigned; the ones no source names stay in the unresolved bucket.
  POP Series is resolved the other way: its base printings are verified NON-HOLO and
  its holographic versions are separate named printings (see the POP/Dragon Vault
  section below), and Dragon Vault is Tinsel;
- EX Delta Species δ holo rares were plain foil, not Cosmos. The marker is printed on the
  card and the catalogue carries it in the card's name, so `src/foil/delta-species-index.ts`
  (GENERATED by `scripts/delta-species-index.ts`) lists the 50 δ holo rares and
  `printing-db.ts` resolves them to the `plain-holo` paper — a registered paper with no
  sheet, because uniform light is what it prints. Rare Holo EX and Gold Star δ cards are
  different treatments and are not indexed, and POP4's Deoxys δ keeps its own Cosmos row
  (the one δ card Bulbapedia gives the cosmic design). `tmp/check-delta-species.ts` pins
  the index against the catalogue and proves the neighbours keep their papers.

### Printings decide the foil, not the era heuristic

`src/foil/printing-db.ts` answers "what foil is on THIS physical card?". It
resolves a card to a pattern, a coverage mask, a product, a language, a source URL
and a status, and `holoFor`, `mask.ts` and `mark-field.ts` read it first.
`src/foil/patterns.ts` is the registry every other pattern joins: adding Tinsel or
Crosshatch is a row there, not a branch in the renderer. Its `implemented` flag has
to match what ships, in both directions — a `true` with a texture names a file that
must exist, and every texture a generator registry hands the renderer belongs to a
pattern that claims to be implemented. `tmp/check-pattern-registry.ts` enforces
that, because the flag had drifted on four reverse papers whose sheets shipped while
their rows still said no. It also holds the roadmap to the registry: Phase 8 went on
calling Crosshatch and Sheen unpainted long after both shipped (Crosshatch in 0.45.0,
Sheen under the Mirror row in 0.44.0), so `HOLOFOIL_ROADMAP.md` now states the
remaining papers in one machine-readable line — `Papers still unpainted: A, B and C`
— and the suite parses it, checks each name against `PATTERNS`, and checks every
unpainted era paper is named. Prose drifts where a flag cannot.

Four statuses, and the difference matters:

- `verified` — a source names the printing, or states the set rule it falls under;
- `inferred` — a verified set rule extended to a card the source did not name;
- `modelled` — this build's own choice with no external source, disclosed as such
  (no printing uses it any more: the 2026 Classic Collection rows moved onto a source);
- `unresolved` — genuinely unknown here, and NO Cosmos is applied. LV.X, Gold
  Star and every unnamed promo set land here rather than being guessed.

`maskVerified` is separate from `status` on purpose: a promo can be verified as a
Cosmos printing while its foil AREA stays undocumented.

The era rule is one retro paper. Cosmos ran from Base Set 2 (2000) to Call of
Legends (2011) on `classic_dense`; the HD paper arrives around 2013 with
promotional printings and uses `modern_fine`. `classic_sparse` is a pack variant
no printing is assigned to. The dense/sparse split inside the era had no source
and is gone.

Languages are a separate axis. Only `en` is catalogued, so a Japanese or Korean
card resolves to no claim rather than borrowing the English one.
`scripts/cosmos-report.ts` writes `reports/cosmos-printings.{json,md}` — the six
numbers the brief asks for, including the unresolved bucket, plus an explicit
statement that the catalogue is not exhaustive.

## Reverse holos are a printing of their own

`src/foil/reverse-db.ts` is the reverse-holo table: expansion, year, pattern,
mask, eligibility, exceptions and source. `src/foil/reverse.ts` samples the
pattern, and `src/foil/reverse-index.ts` (GENERATED by
`scripts/reverse-foil.ts`) lists the textures that actually exist. The printing
database reads the table, so the overlay, the mask and the inspector cannot
disagree about a reverse card.

Two rules were wrong before and must not come back:

- the mask is NOT always "everything but the art". Legendary Collection and the
  Expedition/D&P runs foil the body, but EX Hidden Legends through EX Power
  Keepers put the pattern INSIDE the picture window (energy symbols, pinwheel,
  Poké Balls), and Delta Species through Power Keepers keep it in the artwork
  background. `ReverseConfig.mask` decides per set; the artwork-background
  masks are marked `approximated` because the printed pattern also excludes the
  Pokémon itself and this build cannot segment the subject.
- a reverse flag cannot invent a printing. Base Set 2 and Team Rocket predate
  reverse holos; Aquapolis and Skyridge holos were renumbered H1… and skip them;
  ultra/secret/LV.X/LEGEND/Prime/Gold Star cards never got one. `reverseEligible`
  answers that and `holoFor` refuses the flag when the answer is no.

The plain reverse finish is a `plain` MarkField: `mark = 1` everywhere, which
makes the reflection uniform and skips the duplicate-decoration guard. Do not
replace it with a dot texture — a plain foil has no marks.

Every reverse texture is a PROCEDURAL reconstruction. No factory scan or angled
photograph was available, so `approximation: true` is written into every
metadata file and the report says which expansions are still unpainted
(`reversePending()`). `scripts/reverse-report.ts` writes
`reports/reverse-printings.{json,md}`: one row per expansion, with its pattern,
mask, status, eligible and excluded counts, and whether it has been validated
end to end: Legendary Collection, Expedition, EX Emerald, EX Unseen Forces, EX Deoxys,
the whole Diamond & Pearl run (DP1–7), Platinum 1–4, HGSS 1–4, Call of Legends and
Black & White 1 — 22 expansions. The rest share papers but await their own check, and
the BW type-symbol paper (BW2–11) is not painted at all.

### Starlight is a drawing, and the drawing is not the claim

Base, Jungle and Fossil Holo rares resolve to `pattern: starlight` with the verified
illustration-window mask (`printing-db.ts`), and they now sample a starfield:
`src/foil/starlight-sheet.ts` draws it, `src/foil/starlight.ts` cuts one window per
card, and `scripts/starlight-foil.ts` writes `public/foil/starlight/sheet.png` plus
the GENERATED `starlight-index.ts`.

Two claims travel together and must not be merged:

- **Identified and verified:** Bulbapedia names Starlight for Holo cards in Base,
  Jungle and Fossil, and Fossil is the last set to use it. All 47 holo rares resolve,
  with the illustration window as the mask.
- **Painted, not verified:** the texture is a PROCEDURAL RECONSTRUCTION drawn from
  Bulbapedia's sentence ("starbursts of different sizes spread across the image, with a
  slightly blurry appearance"). No scan or photograph of the sheet exists here, so
  `STARLIGHT_SHEET.textureVerified` is false and every field carries
  `verified: false`. Never describe it as a scan.

The generator is seeded (`STARLIGHT_SEED`) and placement is stratified, so stars are
evenly spread rather than clumped; ink is four-point `starInk` arms plus a soft core,
not noise, and the whole alpha gets a light blur for the slightly soft edge. The sheet
does not tile (measured 5.5% wrap mismatch), so a card samples one window exactly as
Cosmos does; orientation is seeded from the set id, the crop from the card id.

`scripts/starlight-report.ts` writes `reports/starlight-printings.{json,md}`. Keep
these facts in it: Base Set 1st Edition and Unlimited share the foil; Base Set 2 is
Cosmos; some Base Set Machamp cards were printed with Cosmos instead of Starlight
(Bulbapedia Error cards) and the card row cannot detect them. Three representative
cards are render-validated (Base Charizard, Jungle Clefable, Fossil Aerodactyl) by
`tmp/check-starlight.ts`; fidelity against a real card is still unverified.

### Tinsel is drawn from one sentence, and the 2025 return is refused

Bulbapedia's Rarity page names the Generation V paper for every set in the era:
"For all sets in Generation V (from Black and White to Legendary Treasures), the
holofoil pattern is named 'Tinsel Holofoil', and consists of horizontal stripes
across the image." `src/foil/tinsel-lines.ts` draws one line, `tinsel-sheet.ts`
draws the field, `scripts/tinsel-foil.ts` writes `public/foil/tinsel/sheet.png`
plus the GENERATED `tinsel-index.ts`, and `src/foil/tinsel.ts` cuts one phase per
card.

- **Identified and verified:** all 152 `Rare Holo` cards across bw1–bw11 resolve to
  `tinsel` at the `era` level, with the illustration-window mask.
- **Painted, not verified:** the sheet is a PROCEDURAL RECONSTRUCTION and
  `TINSEL_SHEET.textureVerified` is false. The source gives the pattern and its
  orientation, not a line count, so the 16px pitch is this build's choice. The
  stripes TILE (measured seam ~0.1%); whether the real paper repeated is unknown,
  so tiling is the disclosed choice, as it is for Cracked Ice.
- **Refused:** Black Bolt & White Flare are NOT painted. Bulbapedia's Rarity page
  says Tinsel "returned as a once-off" there "with holofoil rare cards in these
  sets also having Tinsel Holofoil borders", while its own set page marks three
  poster-collection exclusives (001, 011, 021) and TCGdex registers exactly those
  three as tinsel. The sources disagree about which cards, the covered printings are
  promos this catalogue does not carry, and the one sentence about the holo rares
  describes a BORDER — a different foil area from the striped image drawn here.
  Those 22 rows make no claim until the sources agree; do not "finish" them by
  painting every holo rare.
- **Excluded:** `Rare Holo EX` is a different treatment and stays unclaimed, and
  promos are unnamed, so none is painted. Japanese printings also foil the border;
  that is not modelled here.

`tmp/check-tinsel.ts` proves the sheet's orientation and tiling, the per-set counts,
both refusals, at-rest identity and tilt containment; `scripts/tinsel-report.ts`
writes `reports/tinsel-printings.{json,md}`, whose refused section quotes both
conflicting sources.

### POP Series printings are non-holo, and Dragon Vault is Tinsel

Two promo buckets used to sit in `UNRESOLVED_SETS`; both now make an evidenced
claim, and the difference between them is the point.

- **POP Series 1–9 (153 rows) are NON-HOLO.** Every POP page names the holographic
  versions as separate products — "All of the rare cards have holographic versions
  and were available through several waves of promotional items, such as Value Packs
  and Collector's Tins" — and an Additional cards table gives each one's carrier.
  The card in the POP booster is the non-holo one, so `nonHoloFor()` answers with a
  verified `NonHoloPrinting` (no pattern, no mask, `matchedRule: 'expansion'`), and
  `holoFor` refuses a marketplace "holofoil" flag on it. A non-holo record is its
  own type on purpose: an empty pattern would be a lie about a claim that exists.
- **The named holo versions are separate printings.** `POP_HOLO_PRINTINGS` holds the
  38 a source names card by card — Cosmos Holo gift packs, blisters and tins, plus
  POP8's Cracked Ice **Reverse** Holo and POP9's Cracked Ice Rotom. They resolve only
  when the caller says the copy is that version (`holofoil` / `reverseHolofoil`),
  because the card row cannot distinguish them. `POP_HOLO_UNDOCUMENTED` records the
  three whose holo exists but whose paper the source never states — POP9 Manaphy,
  Regigigas and Raichu's reverse — and they make no foil claim rather than a guessed
  one. The table is named variants only, not every holo the trivia implies.
- **Dragon Vault (dv1, 21 rows) is Tinsel.** The set page says "ALL of them foil!"
  and "Each booster pack contained 5 Holofoil cards", and the set is Generation V,
  whose paper Bulbapedia's Rarity page names for every set in the era. The pattern is
  therefore `inferred` (an era rule extended to a mini-set), mask `art`, with
  `maskVerified` false because the set page never states the foil area.

`tmp/check-pop-dragonvault.ts` proves the per-set non-holo counts, that no token
invents a POP foil except the named versions, that every named version resolves to
its own paper and names a real card, the three documented gaps, and 21/21 Tinsel in
Dragon Vault. `scripts/cosmos-report.ts` reports the buckets and exits non-zero if a
named version stops resolving.

### The four pre-2012 promo programmes are classified card by card

Wizards (basep), Nintendo (np), DP (dpp) and HGSS (hsp) promos are not a set rule and
never were: `src/foil/promo-db.ts` is GENERATED (by the one-off crawl in `tmp/`) from
Pokumon's two published treatment catalogues,
`https://pokumon.com/holofoil/cosmos/` and `.../non-holo/`, which assign a treatment to
every card they list. That is the whole reason a per-card claim is possible: Bulbapedia's
promo set pages tag only the exceptional printings — `[Cosmos Holo]`, `[Non Holofoil]`,
`[Cracked Ice Holo]` — so they cannot answer "what foil is on THIS promo?" for a set.

Of the 174 catalogue rows, 101 are catalogued on Cosmos, 64 as non-holo, 4 are named by
their own card pages as Cracked Ice Holofoil prints, 2 by their own pages as French-only
Cosmos promos, and the last 3 are reverse holos — so every row now answers, each with its
own evidence. The answers are different claims and must stay that way:

- **Cosmos** resolves to `cosmos-retro` (every one of these programmes predates the 2013
  HD sheet) with `status: verified`, `matchedRule: 'explicit'`, and `maskVerified: false`
  — no source read here states the foil AREA, so the illustration window is the default.
- **Non-holo** resolves through `nonHoloFor()`, which now covers both the POP base
  printings and these promos, so a marketplace "holofoil" flag cannot conjure a foil.
- **Cracked Ice** is the fourth answer, and it comes from the cards themselves: HGSS16
  Plusle, HGSS17 Minun, HGSS24 Hitmonchan and HGSS25 Hitmonlee each have a page naming a
  "Cracked Ice Holofoil HGSS Black Star Promo print". They resolve through
  `CRACKED_ICE_ENTRIES` in `printing-db.ts` with the pattern verified and
  `maskVerified: false`, because no source states their foil area.
- **Bulbapedia's card pages answer two more.** DP54 Beginning Door and DP55 Ultimate
  Zone are French-only promos whose own pages say a Cosmos Holofoil version "was also
  later released as one of the DP Black Star Promos, exclusively in French". They resolve
  through `PROMO_ENTRIES` at `matchedRule: 'explicit'` on `cosmos-retro`. Pokumon tags
  both non-holo, so the sources disagree: the entries follow the source that names the
  paper and record the disagreement in their note rather than hiding it.
- **Three are reverse holos, and only reverse holos.** np 3/8/10 (Treecko, Torchic,
  Mudkip) exist in one finish: TCGplayer lists Treecko 003 only as Reverse Holofoil,
  PokemonPrice files Torchic 008 as [Reverse Holo], TCGdex reports holo and normal both
  false with reverse true, and the scans show a dotted foil field across the body and
  text box with a flat illustration window. They resolve through
  `REVERSE_PROMO_ENTRIES` to `reverse-flat` with `variant: 'reverse'`, `status:
  'inferred'` (the paper is the EX-era reverse finish, not a pattern a source names for
  these cards) and `maskVerified: false` (the area comes from a scan). Because there is
  no plain printing, the card row resolves with no variant token.

Ten cards are catalogued in BOTH treatments (basep-24, np 1/12/16/17/18/19/35,
DP24/DP40 and their holo partners). The card row resolves as Cosmos because that is the
foil a player sees, and `nonHoloFor()` still answers for the non-holo copy — the
`alsoNonHolo` flag is what records that two physical printings exist.

`tmp/check-promo-buckets.ts` pins the per-programme counts, that every Cosmos claim
resolves to Cosmos and is verified, that every non-holo claim resolves, that each
unlisted card makes no claim, that the table's names still match the catalogue, and that
no promo resolves to a reverse printing. `scripts/cosmos-report.ts` prints the three
buckets and exits non-zero if any claim drifts.

### The last four promo buckets are classified card by card too

`src/foil/promo-buckets-db.ts` is GENERATED by `tmp/emit-promo-buckets.mjs` and holds
the rows that used to be the whole unresolved bucket: BW Black Star Promos (101),
Southern Islands (18), Pokémon Rumble (16) and Best of Game (9). 143 of the 144 make a
claim; BW32 Victini is in neither source and makes none, with the reason recorded.

A **treatment** names the foil and never borrows a sheet this build has not drawn:

- **BW Black Star Promos change paper card by card**, which is why the set was never a
  rule: 51 Cosmos, 15 Tinsel, 9 Mirror, 3 Cracked Ice, 3 Crosshatch, 3 textured, one
  Poké Ball reverse (BW39 Battle City) and 15 non-holo. Pokumon's holofoil taxonomy
  supplies one class per card through its REST API (`/wp-json/wp/v2/card?promo_set=bw`),
  and Bulbapedia's set page tags the same variant printings — Minccino/Scraggy/Luxio
  Cosmos + Cracked Ice, Riolu Cosmos + Non Holo, Keldeo Tinsel + Non Holo, Druddigon
  Cosmos + Tinsel, N Mirror + Non Holo — so each answer has two agreeing sources. A
  card the pair also printed plain keeps its foil row and its non-holo printing: the
  `alsoOn` flag is what makes `nonHoloFor()` answer for that copy, exactly as
  `alsoNonHolo` does for the pre-2012 programmes. Pokumon does not date the retro-to-HD
  switch per card, so every Cosmos claim uses the retro sheet the programme opened on
  and the table says that is this build's choice.
- **Southern Islands is six reverse holos and twelve plain cards** (1, 4, 7, 11, 14,
  17). Three checklists agree number for number and the product explains it: six
  three-card island scenes, each pairing one holographic card with two plain ones. The
  FINISH is verified; the starry paper is read from the Mew scan and named by no
  checklist, so the pattern is `inferred` and the mask is modelled.
- **Pokémon Rumble is three all-foil cards and thirteen that carry only a foil logo.**
  The product copy says "16 exclusive Pokémon TCG cards with foil Rumble logos,
  including 3 all-foil cards" and does not name them; two price catalogues name the
  same three (Venusaur 1, Pikachu 7, Mewtwo 9). The paper is modelled as the era's
  Cosmos, so the pattern is `inferred`; "all-foil" is the product copy's own phrase for
  the area, and `maskVerified` stays false because it is a phrase, not a measurement.
- **Best of Game is five reverse holos and four plain cards.** Bulbapedia: "While these
  cards remained plain, the other cards received a special reverse-holographic
  treatment", naming Rocket's Scizor, Rocket's Sneasel, Dark Ivysaur and Dark Venusaur
  as the four new cards. Pokumon classifies the same five as Cosmos + reverse and the
  same four as non-holo, so the two agree card for card.

Three rules follow. **No bucket claims a researched foil area** — no source states one,
so `maskVerified` is false throughout and the illustration window is the default
(whole-card only for Rumble's three, where "all-foil" is the source's word). **A
treatment with no shipped sheet renders plain foil** rather than borrowing another
paper: `crosshatch`, `mirror` (a registry row added for the BW programme's plain
mirror-bright foil) and `textured-full-art` are named but unpainted, and the Poké Ball
reverse resolves to `special-treatment` rather than the EX-era ball paper. And **a
resolved printing is foil even when its rarity label says nothing** — these rows carry
`rarity: null` or `Promo`, so `holoFor` now returns the database's pattern instead of
falling through to the old rarity heuristic and handing a foil card back as "not foil".

`tmp/check-promo-buckets.ts` pins the per-bucket counts, that every treatment resolves
to its named pattern, that every non-holo claim resolves and every reverse-only card
answers with or without a token, that a non-reverse bucket card invents no reverse
printing, that the unlisted row makes no claim at all, and that the table's names still
match the catalog (2361 checks). `scripts/cosmos-report.ts` section 4e prints the four
buckets and exits non-zero if any claim drifts.

### Mirror is a mirror, not a pattern

`mirror` is the smooth, mark-free foil Bulbapedia files under **Sheen** — its
Holofoil page opens that section "Sheen or Mirror Holofoil" — and the BW-era promos
wear it under the Mirror name, which is why the Mega Evolution set page describes the
finish as "reintroduc[ing] Mirror Holofoil variants of cards, last seen during the
Black & White Series". One paper, one texture, one registry row: nine BW Black Star
Promos resolve to it (BW41, BW42, BW45, BW46, BW47, BW52, BW99, BW100, BW101).

- **Identified and verified:** Pokumon classifies all nine as Mirror, and Bulbapedia's
  promo listings tag the same variant printings ("N [Mirror Holofoil]"). Four of the
  nine exist only as reverse printings, so they answer with or without the token;
  N was also printed plain, so `nonHoloFor()` still answers for that copy.
- **Painted, not verified:** `src/foil/mirror-sheen.ts` holds the profile,
  `mirror-sheet.ts` draws it, `scripts/mirror-foil.ts` writes
  `public/foil/mirror/sheet.png` plus the GENERATED `src/foil/mirror-index.ts`, and
  `src/foil/mirror.ts` samples one cut per card. The only appearance sentence in the
  sources is a direction — international printings "refract light in a diagonal
  direction … from bottom right to top left" — so the sheet is a UNIFORM mirror
  modulated along that diagonal: no dots, stars or stripes, because the paper prints
  none. Contrast, band count, and reproducing an angle-dependent glare as a fixed
  anisotropic ramp are this build's choices, and `textureVerified` is false.
- **Never dark:** ink stays between 0.55 and 0.95. A marked foil's bare field falls
  toward zero, which is what makes a mark read as a mark; a mirror has no bare field,
  so its floor is load-bearing. The sheet tiles (measured seam 0.29%) because every
  value depends on (x − y) mod size, and a card samples any window.
- **The direction is a language axis,** not a per-card one: Japanese cards run bottom
  left to top right across the whole face, Korean the same over the image only,
  international the other diagonal over the image. This catalogue holds English
  printings, so only that direction is modelled.

`tmp/check-mirror.ts` proves the diagonal, the floor, tiling, determinism, the nine
claims with their tokens, BW32 making no claim, the neighbouring treatments keeping
their own paper, at-rest identity and tilt containment. `scripts/mirror-report.ts`
writes `reports/mirror-printings.{json,md}`. The three textured BW promos are not
painted with this sheet either: their paper prints no marks, so they wear a relief
(see "A textured paper is relief, not marks" below). Crosshatch has its own sheet
too.

### Crosshatch is a lattice over the body

`crosshatch` is the Play! Pokémon award paper. Bulbapedia's Holofoil page names it:
"Crosshatch Holofoil is generally used only for cards awarded at Play! Pokémon events.
The pattern consists of intersecting diagonal lines that form a reflective grid across
the card. The crosshatch effect is often applied to the background of the card, as in
a Reverse Holo card." Three BW Victory Cup promos carry it here (BW29, BW30, BW31).

- **Identified and verified:** Pokumon files all three as Crosshatch and the treatment
  is a documented award paper, so every row resolves at `explicit`.
- **Painted, not verified:** `src/foil/crosshatch-sheet.ts` draws two line families at
  right angles, `crosshatch.ts` crops one window per card, and
  `scripts/crosshatch-foil.ts` writes `public/foil/crosshatch/sheet.png` plus the
  GENERATED `crosshatch-index.ts`. The pitch (32px), the line width, the per-line
  intensity and the breaks are this build's drawings; `textureVerified` is false.
- **The field between the lines is dark on purpose** (measured ~0.03). Unlike Mirror,
  this is a MARKED paper: a bright field would stop the lattice reading as a lattice.
- **The sheet tiles, and the repeat is measured.** The lattice repeats every 64px
  and sixteen cells fit the 1024px sheet exactly, so the line at the last column
  continues at the first; the residual wrap step (2.5%) is one pixel of the lattice's
  own gradient rather than a phase jump. A card may sample any window, as with Tinsel
  and Mirror. The pitch itself is this build's choice: the source names the two
  families and the grid, not a count.
- **The area is the body, not the window.** Branch 1f gives these rows `outside-art`
  on the strength of "often applied to the background of the card", with
  `maskVerified` false because "often" is not "always" and no photograph is here.
- **The treatment stopped.** Bulbapedia: "no longer used on cards starting with the
  2015-2016 season", replaced by Mirror and then the standard parallel paper — so no
  later Play! Pokémon award is painted by habit. "An award card" is not evidence of a
  paper.`tmp/check-crosshatch.ts` proves the two families, the dark field, determinism, the
measured repeat and the wrapping read, the three claims with the body mask, at-rest
identity and tilt containment. `scripts/crosshatch-report.ts` writes
`reports/crosshatch-printings.{json,md}`. The three textured BW promos never borrow
this sheet: their paper has no marks at all, so they are painted as relief.

### Confetti is drawn flakes, not a borrowed paper

Pixel / Confetti is "used primarily for cards in the McDonald's Collection sets, but was also
featured on the Celebrations Classic Collection", and "consists of small, blocky reflective
shapes scattered across the image, resembling pieces of confetti" (Bulbapedia, Holofoil). The
Celebrations page adds that the 25-card subset cards "feature etching and a Confetti Holofoil
pattern", and the 2026 Classic Collection is resolved from the same set sentence. One texture
serves all three products: `src/foil/confetti-sheet.ts` draws it, `scripts/confetti-foil.ts`
writes `public/foil/confetti/sheet.png` plus the GENERATED `src/foil/confetti-index.ts`, and
`src/foil/confetti.ts` cuts one window per card.

Measured, and load-bearing:

- **the field between flakes is DARK** (floor 0.035). This is a marked paper like Crosshatch,
  not a mirror: a bright field would stop the blocks reading as blocks — the opposite of
  Mirror, whose floor is what keeps the foil from going black. Coverage is 10.9%, contrast
  27.4x, peak 0.96.
- **the flakes are RECTANGLES**, 9–28px wide and 7–22px tall on a 64px cell grid, each with a
  1.2px soft rim so a flake is a reflective chip rather than a clipped square. The suite
  asserts a flake's interior is flat and the pixel just outside it is bare.
- **the sheet WRAPS** (measured seam 0.00%): blocks are stamped with wrap-around coordinates,
  so a card may sample any window. Whether the real paper repeated is undocumented, so the
  wrap is this build's disclosed choice.
- **it is a DRAWING.** `CONFETTI_SHEET.textureVerified` is false and every field says so. The
  sizes, density and brightness are this build's reading of a sentence; the source names the
  look and the products, not a count, a repeat or a relief. The "textured" in the name is not
  modelled as emboss: depth would be a second, unmeasured claim.

Copy variation is a CROP from the card id, never a per-frame re-seed. 191 rows resolve to the
paper: 30 from the 2026 Classic Collection, 25 from Celebrations, 136 from the McDonald's
Collections. The McDonald's rows carry a limitation the report states rather than hides — each
of those cards exists in both a Non Holofoil and a Confetti Holofoil printing and the catalogue
holds one row, so every McDonald's row paints the foil.

One row in these products is NOT confetti: `cel25c-66_A` (Shining Magikarp). Bulbapedia says that
reprint carries "special textured foil treatment", a different finish; the per-card claim in
`shiny-db.ts` outranks the subset's set rule, and its paper is unnamed, so it draws plain. The
exception lives in `CONFETTI_EXCEPTIONS` rather than being filtered silently.

`tmp/check-confetti.ts` proves the field, the blocky shape, the wrap, determinism, neutrality,
the per-card cuts, the three products resolving here and a Scarlet & Violet card not doing so,
the exception, the render contract (at rest byte-identical, tilt inside the mask), and that the
report has no unresolved row. `scripts/confetti-report.ts` writes
`reports/confetti-printings.{json,md}`.

### Sequin is drawn polygons, and nineteen promos wear it

`sequin` is the General Mills promo paper: "The Sequin holofoil was first introduced in August,
2017, and is exclusively used for General Mills promotional cards ... The pattern consists of many
small reflective geometric shapes scattered across the image, giving it a sequined appearance."
`src/foil/sequin-sheet.ts` draws it, `scripts/sequin-foil.ts` writes `public/foil/sequin/sheet.png`
plus the GENERATED `src/foil/sequin-index.ts`, and `src/foil/sequin.ts` cuts one window per card.

- **Identified and verified:** the paper, its products and its month are Bulbapedia's words, and
  the registry row carries them. It is the last paper Phase 8 listed as unpainted.
- **Painted, not verified:** 2,430 regular polygons of three to six sides, circumradius 4.2–9.6px
  on a 1,024px sheet over a dark field (floor 0.045), giving 21.0% coverage and 21.3x contrast. The
  side count, size, density and brightness are this build's reading of "many small ... shapes";
  `textureVerified` is false. The polygons are what separate the paper from Pixel / Confetti, whose
  flakes are axis-aligned rectangles: at 0.8 of the circumradius a corner is a mark while the middle
  of an edge is bare, and the suite measures that.
- **The sheet wraps, and the wrap is judged against the field itself.** The seam step is 3.6%
  against 3.3% between neighbouring pixels inside the sheet: on a field this dense two unrelated
  columns differ about as much as any neighbours, so a near-zero seam is impossible and continuity
  means "no larger than the internal step". Whether the real paper repeated is undocumented, so the
  wrap is this build's disclosed choice.
- **Nineteen cards wear it, resolved card by card.** Bulbapedia's Holofoil page carries a Sequin
  table per series — Sun & Moon promos SM01, SM02, SM03, SM04, SM06, SM40, SM42 and SM86; the
  Let's Go, Kanto! reprints Eevee `sm1-101`, Charmander `sm3-18a`, Cubone `sm6-57`, Bulbasaur
  `sm35-1` and Pikachu `sm35-28`; and 25th Anniversary promos SWSH010–013, SWSH039 and SWSH040 —
  and `SEQUIN_PRINTINGS` in `printing-db.ts` resolves exactly those 19 ids at `explicit`, with the
  illustration window as a modelled mask (`maskVerified` false, because no source states the area).
  Every promo set holds plain cards too, which is why this is a per-card table and not a set rule.
- **A separate printing gets a separate variant.** None of those numbers was printed sequin-only:
  each also shipped as a promo, a blister card or a set card. That plain copy is a different physical
  printing, so it makes no foil claim; the General Mills copy carries the explicit inventory variant
  `sequinHolofoil`, and `printing-db.ts` answers for Sequin only when the caller passes it — the same
  rule POP's named holo versions follow. A save can hold both as separate rows, the binder labels the
  sequin one "Sequin Holofoil", and it is valued at the same card's ordinary anchor because no source
  read here measures a premium. `reports/sequin-printings.md` states all of that per card and
  `tmp/check-sequin.ts` pins the 19 so a card cannot enter or leave the list silently.

- **The three mini packs are sealed products, and the only route to a sequin copy.**
  `server/catalog/general-mills.ts` holds the researched composition and `server/services/gmpacks.ts`
  seeds, rolls and estimates it. `gm-sunmoon-mini`, `gm-letsgo-mini` and `gm-25th-mini` are
  `kind: 'special'`, one pack of three cards, with their own ids — two of the three host on `sm1`, so
  the `${setId}-${kind}` id would collide. The composition is 1 Sequin card + the pack's reprints
  (two for the Sun & Moon era, two draws from the promotion's own pool for the 25th, where SWSH039
  is guaranteed in every pack).

  The pools live in code, not in `pack_product_cards`: that table has no variant column, and the pack
  must hand out the Sequin printing rather than the plain promo of the same number. `rollPack` deals a
  ten-card booster, so `openSealed`/`ripNextPack` call `rollMiniPack` first and fall through to it
  only when the product is not a mini pack. The sources name the Sequin cards and say two cards were
  reprints but never which, so those slots are the host expansion's own commons/uncommons; the 25th
  promotion's two Rebel Clash reprints are `absent` (that set is not in this catalogue) and are
  declared, not silently dropped. `sealed.priceDetail` prices a mini pack at its own shelf price:
  `derivedPrice` is display maths (36 packs) and would list a cereal promo near $90, so it is never
  applied, and a PriceCharting lookup is skipped because set name + kind would match another product.
  The price itself is this build's choice — a cereal promo never had a retail one.

  `tmp/check-gmpacks.ts` pins the partition (all 19 Sequin printings dispensed, each by exactly one
  product), that every roll is three cards with a Sequin one, that a booster id gets no Sequin roll,
  and that each product is priced at its shelf price. It runs against a copy of the save under
  `tmp/gm-home` so the roll may write `pull_history`.
  `scripts/unpainted-report.ts` therefore reports **no** identified paper without a sheet, and the
  roadmap's line reads "none".

### Line is a ruled foil, not a marked paper

"Line Holofoil was used for standard Holo cards from Sword & Shield through Crown Zenith.
The pattern consists of thin vertical lines that refract light from the top to the bottom of
the Pokémon's image. Japanese cards using the pattern also have Holofoil borders, while
international releases retained their yellow borders." (Bulbapedia, Holofoil.) PokéBeach's
January 2020 report, the wiki's own citation, called it "a vertical 'line' pattern like in
Japan", and the Rarity page describes "a series of thin vertical stripes".

`src/foil/line-sheet.ts` draws the sheet, `scripts/line-foil.ts` writes
`public/foil/line/sheet.png` plus the GENERATED `src/foil/line-index.ts`, and `src/foil/line.ts`
cuts one window per card. `mark-field.ts` routes the era STYLE `line`: no printing record
claims a Line card, so the identification is set-level, not per-card.

Measured, and load-bearing:

- **the field is BRIGHT on purpose** (valley 0.340, ridge 0.969, contrast 2.85×). A Line card
  reads as a vertical sheen, not as bright marks on a black field, so the ridge is what
  catches light and the foil between ridges still reflects — the opposite of Crosshatch's
  dark field, and the same reasoning as Mirror's floor.
- **the ridges are centred on multiples of the pitch.** That is what makes x = 0 the same
  ridge as x = 1024. Offsetting the centres by half a pitch left a valley at one edge and a
  flank at the other, which measured as a 2.1% wrap step.
- **the wrap step is judged against `lineInternalStep`**, the mean step between two
  neighbouring columns inside the sheet. A ridge's own slope is not a stitching error, so
  the sheet is continuous when the seam step is no larger than that; the measured 2.00% is
  one pixel of the gradient.
- **it is a DRAWING.** `LINE_SHEET.textureVerified` is false: the pitch (8px, 128 lines),
  the ridge width and the depth of the top-to-bottom drift are this build's choices, because
  the source names the orientation and the fineness of the lines, not a count.

Scope: 541 cards across 22 sets — the 21 Sword & Shield sets plus Pokémon GO — all from
`holo.ts`'s era rule. The mask is the ordinary illustration window, verified as a mask but
not as a per-card statement about this paper, and the report says which of the two claims it
is making. A reverse printing of these cards keeps its reverse paper (`reverse-tile` and its
relatives), which `mark-field.ts` answers before the era style, so a reverse never borrows
Line.

`tmp/check-line.ts` proves the vertical orientation (a row varies far more than a column),
the ruled grid, the bright valley, seam continuity against the internal step, determinism,
neutrality, per-card cuts, era routing (SWSH and Pokémon GO → Line, Scarlet & Violet →
Mirage, Sun & Moon → Water Web) and the render contract. `scripts/line-report.ts` writes
`reports/line-printings.{json,md}`.

### Water Web is a wave, not a lattice

"Water Web Holofoil is the standard Holofoil pattern used for cards from Sun & Moon expansion
to Cosmic Eclipse. It consists of a wavy pattern similar to flowing water." (Bulbapedia,
Holofoil.) Its Rarity page adds: "These cards refract light in a wave-like pattern in all
releases. However, only the Japanese releases cover the border with the pattern." Bleeding
Cool's 2021 history describes "a series of wavey lines that almost look like psychedelic
water stains" that move "like waves crashing on a beach shore" as the card tilts.

`src/foil/waterweb-sheet.ts` draws the sheet, `scripts/waterweb-foil.ts` writes
`public/foil/waterweb/sheet.png` plus the GENERATED `src/foil/waterweb-index.ts`, and
`src/foil/waterweb.ts` cuts one window per card. `mark-field.ts` routes the era STYLE
`waterweb`: no printing record claims a Water Web card, so the identification is set-level.

Measured, and load-bearing:

- **the bands are WAVY, and that is tested.** At a crest column the ink swings by more than a
  quarter of its range down the sheet, because the band moves away and back; Line's ruled
  field moves only by its slow drift. A sheet whose crest sat at the same column on every row
  would be the wrong paper.
- **the field stays bright** (valley 0.300, crest 0.960, contrast 3.20×). Water Web is a
  continuous foil with waves in it, not bright ribbons on a black field.
- **the phase is a whole number of turns in both axes**, which is what lets the sheet wrap;
  the measured step across the seam (0.49%) is below one pixel of a band's own slope inside
  the sheet (0.88%), so the edges are continuous rather than merely close.
- **it is a DRAWING.** `WATERWEB_SHEET.textureVerified` is false: the eight bands, the 0.55-band
  sideways amplitude, the two undulations down the sheet and the slow swell are this build's
  choices, because the sources name the era and the look and never a repeat.

Scope: 400 cards across 15 sets of the Sun & Moon era (the `sm` block, its promo and sub-sets
included) — all from `holo.ts`'s era rule. Detective Pikachu shares the set prefix but carries no
Water Web card: its rarities stop at Rare Ultra, so it is not claimed. The mask is the ordinary
illustration window, verified as a mask but not as a per-card statement about this paper. A reverse printing of these cards keeps its reverse
paper (`reverse-type-symbol-large` for the era), which `mark-field.ts` answers before the era
style, so a reverse never borrows Water Web.

`tmp/check-waterweb.ts` proves the waviness, the eight crests, the whole-turn phase, the wrap
against the internal step, the bright valley, determinism, neutrality, per-card cuts, era
routing (Sun & Moon → Water Web, Sword & Shield → Line, Scarlet & Violet → Mirage) and the
render contract. `scripts/waterweb-report.ts` writes
`reports/waterweb-printings.{json,md}`.

### Water Web and Line were measured on real cards, and the footage settled neither

A frame of a real card can answer "how far apart are the printed bands?" in a way a frame ratio
cannot: a ratio of two tilts divides one reflection by another and, under a separable foil model,
divides the printed pattern out along with the artwork. `tmp/measure-papers.py` therefore works on
ONE 1080p frame — card edges from edge energy (brightness fails, because the sheen's own valleys
are as dark as the desk), the art window, each row's cubic detrended, then the mean row
autocorrelation in luminance and in both colour-opponent channels. Autocorrelation is phase-blind,
which is what a wavy band needs: the crest may sit anywhere along a row, the distance to the next
one does not move.

Its controls are our own patterns over textured artwork: the eight-band Water Web reads 0.1718 card
widths against the sheet's 0.1743, the 8px Line pitch reads 0.0105 against 0.0109, and artwork with
no foil produces no peak in either band.

The real footage does not confirm either paper. Across five frames of a Sun & Moon Rhyperior the
strongest autocorrelation inside Water Web's expected band is r = 0.04–0.14 at 0.26–0.30 card
widths — noise, and outside the band — so the eight bands stay a drawing. Across five frames of a
Sword & Shield Supporter, four give nothing and the fifth (796px card) gives a clean 7px lag,
0.0088 card widths or ~113 lines against the 92 drawn, which is one frame at a 7px period: the
resolution limit of the video, not a retune. **Neither result moves a constant**, and both reports
now say the numbers were tested and not confirmed.

### Mirage is the sheen, turned sideways

"Mirage Holofoil was introduced with the Scarlet & Violet Series. It is visually similar to the
Sheen Holofoil used during the XY Series, but refracts light horizontally rather than diagonally.
Standard Holo cards also have Holofoil silver borders. The effect can be difficult to see clearly in
photographs because its appearance depends on reflected light." (Bulbapedia, Holofoil.) PokéBeach's
Scarlet & Violet set guide, the wiki's own citation, called it a "horizontal sheen".

`src/foil/mirage-sheet.ts` draws the sheet, `scripts/mirage-foil.ts` writes
`public/foil/mirage/sheet.png` plus the GENERATED `src/foil/mirage-index.ts`, and
`src/foil/mirage.ts` cuts one window per card. `mark-field.ts` routes the era STYLE `mirage`: no
printing record claims a Mirage card, so the identification is set-level, as it is for Line and
Water Web.

Measured, and load-bearing:

- **the bands run VERTICALLY, and that is tested.** The field depends only on x: a column of the
  sheet is constant while a row swings the whole band (0.550 → 0.950). "Refracts light horizontally"
  is read literally as the AXIS the field varies on, so a band crosses the card from top to bottom,
  and the suite asserts a card point's ink does not change from the top of the card to the bottom.
  Which way the band TRAVELS is NOT claimed — the clips rock the card (see below).
- **the field never goes dark** (floor 0.550, peak 0.950, contrast 1.73×). A sheen has no bare
  field, so its floor is load-bearing like Mirror's — the opposite of Confetti's and Crosshatch's
  dark field, where a bright background would stop the marks reading as marks.
- **the secondary bend is windowed.** A slow second wave stops the sweep looking like a
  machine-straight gradient, and is multiplied by `sin(π · primary)`, which is zero at both ends of
  the band, so the middle bends while the floor and peak stay exactly where they are declared.
- **the sheet tiles** (0.00% wrap step, against 0.23% for one pixel of the sweep's own slope):
  every value depends on x mod the sheet size, so a card may sample any window. Whether the real
  paper repeated is undocumented, so the wrap is this build's disclosed choice.
- **it is a DRAWING, but its spacing is measured.** `MIRAGE_SHEET.textureVerified` is false:
  the source names the direction the light travels rather than the geometry. The first drawing
  put three bands across the sheet; three tilt-run clips of the real Scarlet & Violet promos
  put the band spacing at 0.656 card widths, and the drawing was retuned to two bands (0.69)
  rather than left a third too tight. The contrast needed no change.
- **the silver border is NOT modelled.** Bulbapedia states that standard Holo cards also have
  "Holofoil silver borders"; the mask stays the illustration window, so that border renders flat.
  `borderModelled: false` is in the generated index and the report says so, rather than implying
  the card is complete.

Scope: 338 cards across 21 sets — every standard holo `holo.ts`'s era rule puts on Mirage: 247 cards
across 14 `sv` sets and 91 across the seven Mega Evolution sets. The mask is the ordinary illustration
window, verified as a mask but not as a per-card statement about this paper. A reverse printing of
these cards keeps its own reverse paper (`reverse-tile-intricate`), which `mark-field.ts` answers
before the era style, so a reverse never borrows Mirage, and the Confetti-routed 30th Celebration
Classic Collection keeps Confetti despite sharing a set prefix with the Mega Evolution sets.

### The Mirage measurement, and why it can be trusted

`tmp/measure-mirage-ratio.py` divides two frames of the SAME card, which cancels the artwork and
leaves only the sheen — the only way to separate a reflection from the print beneath it. Before
any of its readings are used it runs on a synthetic tilt of this build's own sheet, whose answers
are known (period 0.46 card widths, contrast 1.73×): the control recovers the period to 0% and
the contrast to 7%, and reads the band as a column (row correlation 1.00). Only then are the
clips read — three tilt runs of the Scarlet & Violet promos 013/198, 036/198 and 052/198 published
with PokéBeach's December 2022 reveal. They give a median period of 0.656 card widths (0.721,
0.516, 0.656 per clip), a contrast of 1.60–1.66× against the control's own 7% under-read, and a
row correlation of 0.63–0.77 — the bands are columns, with hand motion and JPEG noise keeping it
short of the control's 1.00. `MIRAGE_MEASURED` in `mirage-sheet.ts` records all three clips, and
`tmp/check-mirage.ts` fails if the drawn spacing stops agreeing with the median, so changing the
band count again means revisiting the measurement rather than picking a nicer number.

A single frame cannot check that number, and the check is recorded as an attempt, not a
confirmation. `tmp/measure-mirage-single.py` fits one band to every row of a still, and two
instruments were thrown out first: row autocorrelation wants several periods and at ~1.1 across the
face locked onto the window edge (0.844 card widths) for the foil control and the artwork-only
control alike; a cubic detrend has the same single dip as one band, fitted the control's band
almost exactly (residual std 4.8 of a 14.5 signal) and left a two-hump residual that read as half a
period. The surviving mean-removed, undetrended fit recovers the drawn control at 0.694 — but as a
plateau, 0.654–0.746. The promo stills report plateaus 0.55–1.0 wide: enough to confirm one broad
sweep and to exclude the rejected three-band drawing (0.46), not enough to separate 0.656 from the
drawn 0.687, which differ by 4.7%. So `MIRAGE_MEASURED.period` is a ratio measurement of the
reflection, not evidence about a printed repeat, and the changelog and report say exactly that.

The same footage cannot settle *which way* the band travels, and `tmp/measure-mirage-direction.py`
records why it was worth asking. Three traps, each found by a failing control: a column profile in
frame coordinates reads the HAND moving the card as the sheen moving; chained frame-to-frame
registration turns a few tenths of a pixel of error into a 3000px random walk; and a control band
drawn moving left came back right until its frequency was matched to the profile's own units. What
works is to register every frame against the FIRST on the card's printed detail (high-passed luma,
normalized cross-correlation, ±25px search) and then track the band's phase in card coordinates.
Its controls read right for a band drawn right, left for one drawn left, and +0.27 per 1000 frames
for a still band under a rocking card — the leak, and the floor below which a reading is silence.
The clips give −5.35, −0.09 and +2.71 per 1000 frames, and Sprigatito's own halves disagree by 8×,
so they are rocks rather than sweeps. `MIRAGE_MEASURED.direction` therefore says
`claim: 'not established'`, and no meta, index, report or changelog claims a left-to-right sweep.

`tmp/check-mirage.ts` proves the column-constant field and the full row swing, the bright floor,
neutrality, determinism, per-card cuts, the measured spacing, era routing (Scarlet & Violet →
Mirage, Sword & Shield → Line, Sun & Moon → Water Web, a reverse → its own paper) and the render
contract. `scripts/mirage-report.ts` writes `reports/mirage-printings.{json,md}`.

### A textured paper is relief, not marks

Three BW Black Star Promos — BW43 Landorus, BW73 Darkrai, BW74 Giratina — are
catalogued as Textured by Pokumon's treatment taxonomy, and `promo-buckets-db.ts`
carries them into the printing database at `pattern: textured-full-art`. A textured
card prints no dots, stars, lines or symbols: its structure is EMBOSSING, so its
texture is a **normal map**, not a mark sheet. The mark layer stays plain and the
surface layer supplies the structure, which is why `patterns.ts` points this row's
`texture` at `/foil/surface/etched-deep.png` rather than at a mark sheet.

`surfaceFor()` now answers two ways, and the second exists for these rows: a tier
the sources call textured answers by RARITY (illustration rare and above, never
shiny), while a paper the database identifies as `textured-full-art` answers by its
PRINTING. That matters because these three cards carry the rarity label `Promo`, so
a rarity rule left them flat. Both paths choose the era's relief from the set id,
and `bwp` is Black & White, so they get the deep etched relief the deep-etch
description belongs to. A reverse is still never routed this way: the ball and Energy
papers carry their own full-card etch, and a marketplace flag must not imply one.

The relief is MODELLED, and the photographs now come in two passes with two
different answers. `tmp/fetch-textured-photos.mjs` pulls Western shop photographs
and `tmp/measure-textured.ts` measures them into `reports/textured-photos.{json,md}`:
two independent sellers' photographs of a **slabbed BW73**, with the card's **BACK
in the same photograph** as the control (same lens, light, distance and JPEG, no
emboss). Front-lit, they do not resolve the emboss — diagonal share 0.27–0.30 against
0.20 on the back, anisotropy under 0.31, autocorrelation peaks short of the 0.25 bar.

`tmp/fetch-jp-photos.mjs` and `tmp/fetch-jp-hires.mjs` then hunt the Japanese market,
where sellers routinely photograph holo cards tilted: 58 downloads across ten
listings of プラズマ団ギフトセット 005/016 — the same paper in Japanese, so evidence about
the PAPER and not about the English printing. Four oblique frames from three listings
(`t1249971628` ×2, `t1165449779`, `x1238905421`) **do show the weave**: a fine
diagonal lattice of ridges across the whole printed face, plain at high zoom, which
no front-lit slab photograph showed.

A video pass closed the same question the other way, and it is the best instrument
this paper has had. `tmp/fetch-video-frames.mjs` downloads a YouTube video with
yt-dlp and its bundled ffmpeg (in a throwaway `tmp/.venv`; nothing is installed
system-wide) and cuts frames from a tilt run. `dFI0NbvBygY` shows the **English**
BW73 flat on a desk under one lamp — one lens, one light, one card, 28 frames at
4 fps — which is exactly what a tilted still cannot offer. Two flat-on frames are
measured and, at 720p, the answer is still no: the patch crops are soft enough that
the ridges blur into the artwork, and on the achromatic band the frames read 4.19%
while the **smooth** control reads 6.68% and the **same** card's own catalogue scan
reads 8.58%. An estimator that returns 4% and 8% for one card is not tracking one
stable property of its surface, so the video is recorded as searched and measured,
not as evidence for a pitch.

A final sweep for something sharper found nothing: BW73 queries for 4K return no
results at all, the only 1080p master of a Team Plasma opening shows the card
hand-held at about 350 px behind a sleeve, the 4K holo showcases that do exist cover
modern sets, and Nicovideo's search 404s. Resolution, not search coverage, is now
the binding limit on this paper.

That is appearance, not a measurement, and the two are kept apart. The estimator
also reads an ACHROMATIC band — the band-passed log-brightness all three channels
share, which is what a surface does and ink does not — and there the four oblique
frames average 4.4% of card width while the **smooth** BW75 control reads 6.7%. A
period a smooth card produces as readily cannot be attributed to the emboss, so
ridge pitch, depth, strength and direction stay this build's and `verified` is false;
agreement between four photographs of one card is not separation from a control. The
tuning stays derived rather than guessed — N = 1/(p√2) — and `verdict.tuning` remains
null. **No photograph of BW43 or BW74 could be found at all**, which the report
states per card.

What the photographs DO settle is the LAYOUT, and it changed a mask. All three are
full-art printings: the illustration runs under the text wash to the frame on BW73
in both seller photographs and on BW43 and BW74 in the catalogue scans, and Bleeding
Cool calls BW43 "This textured, Full Art card". The standard illustration window —
a band covering ~37.5% of the card height — would have put the relief on a strip of
a face that is entirely art, so `printing-db.ts` gives these rows `mask:
'full-art'`; `maskVerified` stays false because no source says which cells of that
face carry the emboss. The oblique Japanese frames agree with the mask from the
other side: the lattice runs across the full-art field rather than sitting in a
window. A front-lit phone photograph of a slab is not the instrument for an emboss,
and a tilted one shows the weave without measuring it; a raking-light photograph or
video would measure it, and the report records the search for one (eBay, Cardmarket
and CardTrader pages, Reddit's JSON search, DuckDuckGo, YouTube search, Shopify
product APIs, Yahoo!オークション, Mercari) and that none was found. The measurement
script still derives the tuning such a photo would imply — for the sheet's
`cos(2πN(u±v))`, a measured pitch p means N = 1/(p√2) — so tuning the paper stays a
one-line change in `surface-map.ts` once one exists.

One catalogue disagrees about WHICH cards: Collexy's Black & White era overview
counts two BW promo masters on Textured Holofoil, while Pokumon files three and
Bleeding Cool names BW43 as textured. The three-row claim follows the two sources
that name the card, and the disagreement is recorded rather than averaged away.

Two rules keep the relief honest: it fades in with tilt
(`min(1, |deg| / 25)`), so a frame at rest is the scan byte for byte; and it shades
with ONE delta for R, G and B clamped by the pixel's own headroom, so an emboss
never shifts hue. `tmp/check-textured.ts` proves the three claims, the print-routed
relief, its determinism and depth, at-rest identity, containment in the foil mask,
neutral shading and that it redistributes light rather than brightening the card,
and it pins the photograph report's verdict so a later change cannot quietly
promote the relief to verified. `scripts/textured-report.ts` writes
`reports/textured-printings.{json,md}`, which records the full-art mask and that the
foil AREA stays unclaimed.

`stages.ts` takes the pattern through a `MarkField` (`src/foil/mark-field.ts`)
with optional `mark`/`opacity`/metadata. The Radiant path is unchanged and its
suite must keep passing byte-for-byte; `field` is additive. The dev inspector
(Shift+H) lists the Radiant, Cosmos, reverse and Starlight cards and prints the
sheet, cut and verification state.

### Phase 12 identification: the shiny tier is four papers

`src/foil/shiny-db.ts` names the paper behind Shining, Gold Star, Radiant Pokémon and the
Shiny Vault, and `printing-db.ts` reads it at branch 1g — before the modelled sets and the era
heuristics, because a per-card source outranks a disclosed guess. `scripts/shiny-report.ts`
writes `reports/shiny-printings.{json,md}` and `tmp/check-shiny.ts` proves the counts and the
resolution. A claim with a `pattern` resolves to it, a verified claim whose paper no source
names resolves to `special-treatment`, and an unresolved one to `unresolved`; both of the last
two ship no texture, so those papers draw plain foil rather than a borrowed sheet, while
Radiant Pokémon samples the sheet below. The name-selected claims also carry explicit
`cardIds`, because `mask.ts` and `holo.ts` call the database without a card name.

- **Shining is not one paper.** Neo Revelation's two English cards are Cosmos holofoils
  (`cosmos-retro`, illustration window). Neo Destiny put "a reflective foil treatment on the
  Pokémon itself", a metallic sheen whose sheet no source names, and Shining Legends repeated
  that look. The area `pokemon-only` is documented and this build cannot cut it: it needs
  subject segmentation, like the EX-era reverse backgrounds.
- **Pokémon ★** is gold-tinted: "golden tinges and holographic shadows are added to various
  parts of the card". "Various parts" is not a rectangle, so no mask is claimed and the art
  window must not be assumed. Its 25 rows use `special-treatment`, which ships no texture.
- **Radiant Pokémon (2022) is not Radiant Collection (2013).** RC is `radiant`, one concept
  motif per card. Radiant Pokémon is `radiant-etched`: etched, embossed silver across the whole
  card, so its area is `whole-card`, and the two must never share a lookup.

Radiant Pokémon is painted: `src/foil/radiant-etched-sheet.ts` draws it, `scripts/radiant-etched-foil.ts`
writes `public/foil/radiant-etched/sheet.png` plus the GENERATED `radiant-etched-index.ts`, and
`src/foil/radiant-etched.ts` cuts one window per card. The lattice is a 16px etch inside a
128px diamond grid — measured at ~36% coverage, floor 0.36 and a 1.7% wrap step, so the silver
never goes dark and the sheet TILES (a disclosed choice, like Crosshatch). It is a DRAWING:
`textureVerified` is false, and no relief is modelled, because depth would be a second,
unmeasured claim. `tmp/check-radiant-etched.ts` and `reports/radiant-etched-printings.{json,md}`
carry the proofs; copy variation is a crop from the card id, never a per-frame re-seed.

Classic Collection reprints are `confetti`, and that is now a source's answer. Bulbapedia:
"Classic Collection cards have a textured confetti holofoil pattern", and in the Mega Evolution
Series "all Classic Collection cards have a golden card border". The 2026 30th Celebration Shining
Celebi resolves to the registry's `confetti` row at `verified` / `explicit`; its area stays
unclaimed and the row samples the confetti sheet below rather than borrowing an era paper. The `me55c` set rule follows the same source at `verified` / `expansion`, so the HD Cosmos
`MODELLED_SETS` entry is gone — and with it the only `modelled` printing in the database.
- **Shiny Vault / Shiny Rare** (Hidden Fates, Shining Fates, Paldean Fates; 316 rows) has a
  documented FINISH and no documented repeat. Bulbapedia says the Hidden Fates subset's cards
  "All have a special embossed Holofoil treatment", that Shining Fates' Shiny Pokémon share it
  while the product copy promises "beautiful etched cards", and Bleeding Cool reports the Paldean
  Fates "Baby Shinies" carry a "holographic, silver, textured foil border" Japan did not get
  (PokéBeach: "holo borders ... Both feature textured artwork"). All three resolve to
  `special-treatment` at `verified` / `explicit`, and none claims an area — border plus textured
  artwork is not a mask this build can cut.
  Two papers must never answer for them: `starlight` (the 1999 Base/Jungle/Fossil sheet, not
  evidence for a star-like look) and `cosmos-retro` — and that second one arrives disguised, as
  "Galaxy holo", the label two collector guides use for these cards while CardVeil documents
  Galaxy as collectors' other name for Cosmos. Adopting it would put a 2011 sheet on a 2019
  card.

`maskVerified` follows the MASK, not the claim's `areaVerified`: `pokemon-only` (Neo Destiny,
Shining Legends) and `various-parts` (Gold Star) keep the illustration window as an
approximation and mark it unverified, with the record's note saying so. A reverse flag resolves
nothing for any of these families — none of them was printed reverse, so the flag cannot borrow
the set's reverse paper.

### The engine composes frames, not one foil

`src/foil/engine.ts` is the entry point every caller should use: a frame is a tilt
plus a list of `FoilLayer`s, each with its own coverage spec, mark field, settings,
per-region `reflectivity` and optional `surface`. `composeFrameInto` starts from the
scan, so a frame at rest is the scan byte for byte. Disjoint regions compose in
either order; overlapping ones stack light in array order. `stages.applyFoilLayer`
is the single-layer tail both paths share, so the engine cannot drift from the
stage pipeline.

`src/foil/surface.ts` is the only layer allowed to shade DOWN, and only when a
normal map is supplied for the printing. It is gated by the same coverage mask,
writes one equal delta to R, G and B clamped by the pixel's own headroom, and never
touches alpha. Since Phase 11 one surface ships: `src/foil/surface-textures.ts`routes modern textured rarities (illustration rare and above, never reverse) to a procedural etched normal map, plus the four Shiny Vault rarities, whose own sources call the finish embossed/etched, and any paper the printing database identifies as `textured-full-art` with it — the route a promo row needs, since its rarity label alone reaches no etched tier, and the engine fades the relief in with
tilt so a frame at rest is still the scan. The relief is MODELLED — no scan or
photograph exists here — and every surface records `verified: false`.

### The printing record names its rule

A `FoilPrinting` carries `matchedRule`, the hierarchy level that answered:
`explicit` (a named printing or promo), `expansion` (a per-set reverse paper),
`era` (the Cosmos/Starlight era rule), `modelled` (this build's disclosed choice),
or `unresolved`. Adding a resolution path without choosing a rule is a type error,
so precedence cannot drift silently.

`surfaceTexture` stays null on every printing the database resolves: those are the
2000–2011 era printings, which are smooth. Modern textured tiers are resolved at
render time by `surfaceFor()`, which returns the shipped surface id or null and
records the modelled disclosure in `reports/surface-printings.md`. `name` is
carried only from the caller's card row and `year` only from a catalogue in this
repo — both stay undefined rather than being inferred from an id or a range.
Promotional printings use `variant: promo`; them being a different product is
independent of the foil they carry.
### Radiant validation is per card, and 17 configurations are modelled

`scripts/radiant-report.ts` writes `reports/radiant-printings.{json,md}`: one row
per RC card with its motif, coverage, evidence and status. The split is load-bearing
and pinned by `tmp/check-radiant.ts`: 13 verified non-foil (Generations commons),
27 verified foil (25 Legendary Treasures full-face + Generations RC6 full-bleed +
RC16 art window), and 17 MODELLED foil configurations (11 art-window guesses and 6
full-art guesses) whose boundary no source in this repo documents. Do not move a
card between those groups without new evidence; the suite fails if the counts move.
### Cracked Ice is one named printing, not a prefix

Bulbapedia calls Cracked Ice the foil of the featured card in Platinum-series
theme decks, made of "irregular reflective shapes resembling pieces of cracked or
shattered glass". This catalogue holds none of those theme-deck sets, so the only
wired printing is the one the source describes by name: **Frost Rotom (pl2-RT2)**,
foiled "over everything but the image of the Pokémon" — hence `outside-art`,
verified for both the pattern and the area.

Two rules must not come back:

- `tk1a`/`tk1b`/`tk2a`/`tk2b` are EX Trainer Kits from 2004–2005, before the
  pattern existed. A `tk1`/`tk2` prefix rule used to paint all 44 cards Cracked
  Ice; it is removed and those rows make no foil claim.
- The other Rotom printings (RT1, RT3–RT5) are not named by the source read
  here, so they stay unpainted. A pattern being common on a product line is not
  evidence for an individual card.

`src/foil/crackedice-sheet.ts` draws a Voronoi fracture — flat facets of differing
reflectivity separated by thin bright cracks — and cuts it with toroidal distances
so the sheet tiles (measured seam ratio 0.965). The texture is a PROCEDURAL
RECONSTRUCTION: `CRACKEDICE_SHEET.textureVerified` is false and every field says
`verified: false`. `scripts/crackedice-report.ts` writes
`reports/crackedice-printings.{json,md}` with the printing, the area and the
correction. Whether real Cracked Ice repeated is undocumented; tiling is this
build's disclosed choice.
### Type-symbol reverses name the card, not the paper

The BW2–11 and XY reverse paper repeats the card’s own type symbol over the
card body (a Poké Ball for Trainers). `src/foil/type-glyph.ts` draws twelve
stylised glyphs, `scripts/type-symbol-foil.ts` writes one tileable sheet per
glyph into `public/foil/type-symbol/` plus the GENERATED
`src/foil/type-symbol-index.ts`, and `src/foil/type-symbol.ts` chooses the
glyph from the card.

Three rules:

- **The type comes from the card, never from the set.** Trainers resolve to the
  Poké Ball; Pokémon resolve through their `types`; an unknown type returns
  null and the renderer draws plain foil. A wrong symbol is worse than none.
- **The glyphs are drawings.** They are geometric approximations, not the
  official icons, and `TYPE_SYMBOL_TEXTURE_VERIFIED` is false. The pattern’s
  identity is documented; the artwork is a reconstruction.
- **The sheets tile.** Glyphs are stamped with wrap-around, so a card samples
  any window. `reports/type-symbol-printings.md` states this as this build’s
  disclosed choice, not a fact about the print.

All 24 expansions on the paper are validated by `tmp/check-type-symbol.ts`:
glyph silhouettes, tile seams, index agreement, per-card type routing, the
outside-art mask, at-rest identity and tilt containment. The later papers —
the Sun & Moon large symbol, Sword & Shield tiles and Scarlet & Violet
intricate tiles — remain recorded but unpainted.
### The Sun & Moon paper is one large symbol, not a field

The Sun & Moon run (SM1–12 and Detective Pikachu) puts ONE large type symbol on the
left of the card body, with a Poké Ball for Trainers. `src/foil/type-symbol-large.ts`
samples an aspect-correct window around that mark and clamps, because there is
nothing to tile; `scripts/type-symbol-large-foil.ts` writes one sheet per glyph into
`public/foil/type-symbol/large-*.png` and the GENERATED
`src/foil/type-symbol-large-index.ts`.

The glyphs are the same stylised drawings as the BW/XY paper: not official icons,
`LARGE_TYPE_SYMBOL_TEXTURE_VERIFIED` false, and an unknown type still renders plain
foil rather than a wrong symbol. The pattern identity is documented; the artwork is
a reconstruction. All 13 expansions are validated by
`tmp/check-type-symbol-large.ts` (placement at the left, one-mark coverage, mask,
at-rest identity, tilt containment).
### Sword & Shield sets its symbols in tiles

The Sword & Shield reverse paper (SWSH1–12, Crown Zenith, Pokémon GO, the Futsal
promo) is described as tiles each containing the card’s type symbol, or a Poké Ball
for Trainers. `src/foil/reverse-tile.ts` draws a staggered lattice of rounded tiles
and stamps one glyph inside each; `scripts/reverse-tile-foil.ts` writes twelve
tileable sheets into `public/foil/reverse/tile/` plus the GENERATED
`src/foil/reverse-tile-index.ts`.

The type is still the card’s, not the set’s: an unknown type returns null and the
renderer draws plain foil. The lattice and glyphs are PROCEDURAL RECONSTRUCTIONS
(`REVERSE_TILE_TEXTURE_VERIFIED` false); the paper’s identity is the documented
part, and whether the real print repeated exactly is unknown — tiling is this
build’s disclosed choice. All 15 expansions are validated by
`tmp/check-reverse-tile.ts` (seams, per-type routing, mask, at-rest identity, tilt
containment).
### Scarlet & Violet nests its tiles

The Scarlet & Violet reverse paper (SV1–10, Prismatic Evolutions, Journey Together,
Destined Rivals, White Flare, Black Bolt) nests rounded tiles and repeats the card’s
type symbol at more than one size. `src/foil/reverse-tile-intricate.ts` samples the
sheets; `scripts/reverse-tile-intricate-foil.ts` writes twelve tileable sheets into
`public/foil/reverse/tile-intricate/` plus the GENERATED
`src/foil/reverse-tile-intricate-index.ts`.

The type is the card’s, not the set’s; an unknown type returns null and the renderer
draws plain foil. The nesting and glyphs are PROCEDURAL RECONSTRUCTIONS
(`REVERSE_TILE_INTRICATE_TEXTURE_VERIFIED` false) and tiling is this build’s
disclosed choice. All 16 expansions are validated by
`tmp/check-reverse-tile-intricate.ts`.
### The last families are validated one set at a time

Three small papers closed the reverse catalogue. The plain body paper
(`reverse-flat`, Aquapolis/Skyridge, EX Ruby & Sapphire–Team Magma vs Team Aqua,
Mega Evolution) has no marks at all, so `reverse.ts` gives it a `plain` field and
the reflection is uniform. EX Hidden Legends–Team Rocket Returns repeat the card’s
own energy symbol behind the Pokémon; `src/foil/reverse-energy.ts` samples the
stylised type-symbol sheets at a tighter repeat, so the glyph is still chosen from
the card and an unknown type renders plain foil. EX Delta Species–Power Keepers
put a plain foil in the artwork background only;
`src/foil/reverse-flat-background.ts` is uniform light and the window mask decides
where it lands.

The background area is `approximated`, not verified: the printed pattern also
excludes the Pokémon itself and this build cannot segment the subject. The energy
symbols are the same drawn glyphs as the BW/XY paper, so they are reconstructions
too. All 22 expansions are proved individually by
`tmp/check-reverse-remaining.ts` (config, eligibility, at-rest identity, mask
containment, lift).

### Special reverses name the ball, and the set names the layout

Poké Ball and Master Ball reverses are ordinary reverse printings — foil on the frame
and text box, no ball foil inside the artwork — with a different stamp. The print's
fine etched field crosses the artwork and body. It is modelled separately as a
full-card relief in `src/foil/reverse-etch.ts`: the engine takes the etch's own
full-card mask (`surfaceSpec`) while the ball keeps `outsideArt`, so the etch can
cross the illustration without the ball following it. The relief reuses the fine
`etched` normal map, fades in with tilt and stays neutral; its spacing remains a
drawing, not a scan. `src/foil/reverse-special.ts` holds the printing table;
`scripts/reverse-special-foil.ts` writes four sheets into `public/foil/reverse/special/`
and the GENERATED `reverse-special-index.ts`.

Two layouts are documented and both ship: ONE large ball behind the attack text
(Prismatic Evolutions, Ascended Heroes) and ROWS of balls (Black Bolt, White Flare).
Master Ball carries an M on the upper half. Two real Prismatic Evolutions photographs
— a Sylveon Poké Ball reverse (PSA 9, cert 108712104) and an Umbreon Master Ball
reverse — plus published Terastal Festival ex / Black Bolt / White Flare renders
confirm the layouts, the M, the etched field and the alternating large/small rows.
The Sylveon photo measures the large ball at about 0.52 card widths across, centred
about 0.675 down the card, and the Terastal render agrees; the large sampler uses
that geometry rather than the earlier ~0.63-wide stamp at v = 0.62.

The sheets remain drawings: the glyphs, facet spacing, exact row count and
registration are modelled, with `approximation: true` on every asset. The photo is
angled and slabbed under glare, so it verifies the silhouette, size and placement,
not the exact glyph strokes. The Black Bolt Poké Ball and White Flare Master Ball
images show five columns of large and small balls alternating in staggered rows.
On the 335px-wide reference cards the outer rings measure about 56px (large) and
32px (small), with about 67.5px column pitch and 69px row pitch; the shipped sheet
uses those measured sizes and pitch. Its sampler corrects for the card aspect so
the balls stay round. The glyph, facet spacing and exact row registration remain
modelled.

References: [the real Poké Ball photo](https://i.ebayimg.com/images/g/0rQAAeSwoZRoK8jv/s-l1600.jpg),
[the real Master Ball photo](https://folio.fyi/blog/pokemon-holo-patterns),
[the Terastal render](https://www.pokebeach.com/2024/11/terastal-festival-ex-reverse-holos-will-feature-textured-etching-master-ball-pattern),
and [the Black Bolt / White Flare row images](https://www.codedyellow.com/reverse-holo-patterns).

The variant must be explicit: `reverseHolofoilPokeBall` or
`reverseHolofoilMasterBall`. A plain `reverseHolofoil` keeps the set's ordinary paper,
and a card row on its own never implies a ball. Ascended Heroes adds a third explicit
token, `reverseHolofoilEnergy`, for its separate Energy-pattern paper. `scripts/special-reverse-report.ts`
checks eligibility against the source's own counts — on Prismatic Evolutions the rule
reproduces the published 100 Poké Ball and 67 Master Ball exactly.

The game rolls them in `server/services/special-reverse.ts`, which mirrors this
registry and is compared with it by `tmp/check-special-pulls.ts`. Prismatic
Evolutions models its two real reverse slots: Poké Ball first at 33.10%, Master
Ball second at 5%, so a pack can hold both. Black Bolt/White Flare's single slot
rolls Master Ball first (5.14%), then Poké Ball (30.56%), else the set's ordinary
reverse paper. Ascended Heroes is not a ball roll at all: its second slot carries
the drawn card's own assigned paper at **87.31%**, DERIVED from TCGplayer's 2,000+
pack study rather than directly counted — the slot measured 11.25% ± 1.33%
Illustration Rare and 1.44% ± 0.50% Special Illustration Rare, so an assigned stamp
fills the remaining 87.31%.

Ascended Heroes prints two reverse slots — the Energy-pattern card first, the
card's assigned paper second — and the game models both: `me2pt5` is four
commons, three uncommons, those two reverse slots and one rare-or-hit card. The
first slot uses `reverseHolofoilEnergy` for a regular Pokémon; the second stores the
drawn card's own stamp or draws the measured IR/SIR replacement (11.25% / 1.44%)
from the hit pool. Black Bolt and White Flare keep one game slot, so every special
pack holds at most one ball except the two-slot Prismatic and Ascended packs. Stamps
price at a labelled premium over the same card's reverse — 1.5× for Poké Ball and
the four other assigned papers, 8× Master Ball — a flat model that understates
popular Pokémon and overstates bulk.

### Ascended Heroes assigns one stamp per card

`src/foil/ball-stamps.ts` is the assignment: every regular Pokémon in `me2pt5`
carries exactly one paper, keyed by collector number and read from the set's
checklist rows. The papers are Poké Ball, Love Ball, Friend Ball, Quick Ball and
Dusk Ball, and Team Rocket's Pokémon carry an `R` where the ball would sit — that
mark is not a ball and is never modelled as one.

Four rules:

- **The card decides, not the slot.** The second reverse slot draws a card that was
  assigned a stamp and stores that card's own token, so the game never rolls
  “Poké Ball” in a set where Misdreavus wears Dusk. The fixed-stamp sets
  (Prismatic Evolutions, Black Bolt, White Flare) still roll their ball first,
  because that is what their published per-pack rates describe.
- **The table is the published breakdown.** 34 Poké Ball, 25 Love Ball, 23 Friend
  Ball, 22 Quick Ball, 26 Dusk Ball and 10 Team Rocket across 140 cards. A moved
  row fails `tmp/check-ascended-balls.ts` instead of quietly repainting a card, and
  Master Ball has no row at all, so a marketplace flag cannot invent one.
- **A stamp is explicit.** `reverseHolofoilLoveBall`, `…FriendBall`, `…QuickBall`,
  `…DuskBall` and `…TeamRocket` join the two ball tokens. A plain
  `reverseHolofoil` still keeps the set's ordinary paper; `holoFor` resolves a
  mismatched token to the card's own paper, because the printing decides and not
  the token.
- **The artwork is drawn.** The five papers and the R are documented and
  `verified`; the ball glyphs, the heart, flower, bolt, crescent and R inside them,
  and the facet spacing are procedural drawings (`approximation: true`), because no
  scan or angled photograph of these sheets exists here.
  `scripts/reverse-special-foil.ts` writes them and
  `reports/special-reverse-printings.md` records each one with its evidence.

The assigned papers use the Ascended Heroes window (`ASCENDED_ART_RECT`, measured
from the set's scan), so the mask cuts them at this set's printing rather than the
shared base-set window.

### The Ascended ball is measured, and its Poké Ball is its own sheet

A real Snorunt Poké Ball reverse from the set guide — the same card the Energy paper
was established from — fixes the one-large stamp. Fitting the ring on a high-pass
image puts the outer circle at **0.434 card widths** across, centred about
(0.5, 0.675), which is the placement the Prismatic photograph already gave, so that
stays; the button sits about a third of the way out, as the sheet draws it. The
measurement lives in `tmp/measure-ascended-geometry.ts` and the numbers in
`ASCENDED_BALL_GEOMETRY`.

The geometry the papers had inherited drew the ring 0.410 across — about 6% small —
so the six Ascended sheets are now drawn at the measured size. That also made
Ascended's Poké Ball a pattern of its own (`reverse-pokeball-assigned-large`) rather
than Prismatic's (`reverse-pokeball-large`): same design, different printing, each
with the geometry its own reference gave, so correcting one cannot silently resize
the other. Both record their own evidence, and the report lists both.

What the photograph cannot settle: it is a plain Poké Ball card, so the heart,
flower, bolt and crescent inside the other four papers and the R on Team Rocket's
stay this build's drawings, as do the ball glyph and the facet spacing. The etch
remains a separate modelled relief.

Both pack-value estimates read the same probabilities. `specialSlotChancesFor`
exposes the slot's ball, upgrade and ordinary-reverse chances without consuming
randomness; `expectedPackValue` (the sealed anchor) and `estimatePackValue` (the
shop's ESTIMATE line) use them to price the ball variant and draw the IR/SIR from
the hit pool. An ordinary reverse slot is valued at `reverseHolofoil`, not at the
normal-card price, because that is the printing the roller actually puts there.
Changing a ball's odds or an upgrade's rarity in `special-reverse.ts` therefore
moves the pack estimate without a second table.

### Ascended Heroes' Energy reverse is one large type stamp

`reverseHolofoilEnergy` is Ascended Heroes' first reverse paper: foil on the card
body, the illustration matte, and ONE large Energy symbol for the card's own type
behind the attack text. It is not the EX-era field inside the artwork window and it
is not a ball. `src/foil/reverse-energy-large-db.ts` holds the printing identity,
`src/foil/reverse-energy-large-sheet.ts` draws one glyph per type,
`scripts/reverse-energy-large-foil.ts` writes eleven sheets into
`public/foil/reverse/energy/` plus the GENERATED
`src/foil/reverse-energy-large-index.ts`, and
`src/foil/reverse-energy-large.ts` samples the single stamp at the measured
0.5/0.675 placement with a 0.95 window. The same outside-art mask as the set's
reverse paper decides where it lands, but this printing carries the modern art
rectangle measured from the Ascended Heroes scan (x 0.083, y 0.094, w 0.838,
h 0.375) instead of the shared base-set window. That keeps the top of the stamp
from being cut off.

Three rules: the glyph comes from the card, never the set, and Trainers, Energy
cards, Pokémon ex, ACE SPEC and unknown types render plain foil; a plain
`reverseHolofoil` still resolves to the set's ordinary paper; and the artwork is a
drawing. The real Snorunt Energy reverse fixes the single-stamp layout, the body
area and an approximate 0.45-card-width size, not the strokes. The glyphs are the
stylised type drawings, `ENERGY_REVERSE_TEXTURE_VERIFIED` is false, and normalising
every type into the same 0.45 x 0.43 stamp box is this build's disclosed choice. `scripts/reverse-energy-large-report.ts`
writes `reports/reverse-energy-large-printings.{json,md}`; `tmp/check-energy-reverse.ts`
proves routing, type refusal, the mask, at-rest identity and tilt lift.

The game mirrors the set list in `server/services/special-reverse.ts` and
`tmp/check-special-pulls.ts` compares them. The first reverse slot draws only an
eligible regular Pokémon when the Energy paper is active; its price is the same
card's ordinary reverse anchor with no researched premium, because no ball-style
market multiplier was measured for this paper.

### Textured printings are modelled, fade in with tilt, and differ by era

`src/foil/surface-textures.ts` owns two surfaces. `etched-deep` is a coarser, deeper
diagonal lattice for Black & White and XY full arts, which the sources describe as
heavy with deeply etched texture; `etched` is the finer lattice for Sun & Moon,
Sword & Shield, Scarlet & Violet and anything unnamed, described as lighter and
"finer, wavier". `scripts/surface-foil.ts` writes both normal maps into
`public/foil/surface/`, and routing is by rarity (special illustration rare,
illustration rare, ultra rare, rare ultra, hyper rare, rare secret, rare rainbow,
full art, trainer gallery) plus set era, never to reverse printings and never to shiny
tiers, whose treatment is its own unresearched paper.

Three rules keep it honest. The weight is sourced; the spacing and depth are not, so
every surface is a drawing and `verified` is false everywhere. Scarlet & Violet
textures are art-specific in print, so one fine relief across that era is a disclosed
simplification. And the surface is gated twice: its own coverage mask decides which pixels it may
touch, and the engine scales it by tilt (`|deg| / 25`), because a raking light is the
only thing that makes a groove visible. That is what preserves the oldest rule — a
frame at rest is the scan, byte for byte — even on a textured card. The one
deliberate exception is the modern ball reverse: its relief uses a full-card etch
mask while the ball foil stays outside the art, so the etch can cross the artwork
without the stamp entering it.
