# Sealed products, every product

Swept 535 sealed products across 132 sets; 529 offered for sale, 3 hidden pull-table hosts, 3 mini packs with their own composition. Each set is dealt 40 packs.

## Summary

| | Products |
|---|---:|
| Offered for sale | 529 |
| Hidden (pull-table hosts) | 3 |
| Mini packs (own composition) | 3 |
| Failures | 0 |

## Failures

None: every offered product deals its declared pack and clears its expected-value floor.

## Rip-positive products (pricing failures)

None: no offered product has an expected value more than 1.25× its shelf price.

## Pull-table hosts (not sold)

These rows are kept only as internal pull-table hosts: the real products for those sets read the booster table, so deleting the host would break them. They are not offered in the shop, pack battles or live shows.

| Set | Products |
|---|---:|
| dc1 | 1 |
| dv1 | 1 |
| g1 | 1 |

## Mini packs

These roll their own researched composition (one Sequin card plus reprints) rather than a set pull table, so their three-card shape is checked separately.

| Product | Set | Cards |
|---|---|---:|
| gm-25th-mini | Sword & Shield | 3 |
| gm-letsgo-mini | Sun & Moon | 3 |
| gm-sunmoon-mini | Sun & Moon | 3 |

## Method

Each set is dealt 40 packs through the same roller the shop uses; the blueprint is the source of truth, so a four-card Celebrations pack is judged as four. A product fails when its set has no booster pool, the pack deals fewer cards than the blueprint, it deals one card or fewer, the product advertises a different card count, a box has no pack count, or a subset-only set is somehow still offered. Every sold product's shelf price is floored at the realized value of its pulls (92%, the best any sell route pays) for its real pack count; a rip-positive product is a pricing failure and makes the audit exit non-zero. Boxes reuse the set's per-pack roll, so the check covers them through their set.

## Every sold product

| Product | Set | Kind | Cards | Dealt | Pool |
|---|---|---|---:|---:|---:|
| me6-booster | Delta Reign | booster | 10 | 10 (avg 10.00) | 141 |
| me6-build-battle | Delta Reign | special | 10 | 10 (avg 10.00) | 141 |
| me6-bundle | Delta Reign | bundle | 10 | 10 (avg 10.00) | 141 |
| me6-display | Delta Reign | display | 10 | 10 (avg 10.00) | 141 |
| me6-etb | Delta Reign | etb | 10 | 10 (avg 10.00) | 141 |
| me6-etb-pc | Delta Reign | etb | 10 | 10 (avg 10.00) | 141 |
| me6-single-blister | Delta Reign | special | 10 | 10 (avg 10.00) | 141 |
| me6-triple-blister | Delta Reign | special | 10 | 10 (avg 10.00) | 141 |
| me55-2pack-blister | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-binder | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-booster | 30th Celebration | booster | 10 | 10 (avg 10.00) | 161 |
| me55-bundle | 30th Celebration | bundle | 10 | 10 (avg 10.00) | 161 |
| me55-ditto-premium | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-etb | 30th Celebration | etb | 10 | 10 (avg 10.00) | 161 |
| me55-etb-pc | 30th Celebration | etb | 10 | 10 (avg 10.00) | 161 |
| me55-figure-mew | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-figure-mewtwo | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-greninja-ex-box | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-knockout | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-mini-tin | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-poster | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-sylveon-ex-box | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-tech-sticker | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-upc-day | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me55-upc-night | 30th Celebration | special | 10 | 10 (avg 10.00) | 161 |
| me5-booster | Pitch Black | booster | 10 | 10 (avg 10.00) | 120 |
| me5-build-battle | Pitch Black | special | 10 | 10 (avg 10.00) | 120 |
| me5-bundle | Pitch Black | bundle | 10 | 10 (avg 10.00) | 120 |
| me5-display | Pitch Black | display | 10 | 10 (avg 10.00) | 120 |
| me5-etb | Pitch Black | etb | 10 | 10 (avg 10.00) | 120 |
| me5-etb-pc | Pitch Black | etb | 10 | 10 (avg 10.00) | 120 |
| me4-booster | Chaos Rising | booster | 10 | 10 (avg 10.00) | 122 |
| me4-build-battle | Chaos Rising | special | 10 | 10 (avg 10.00) | 122 |
| me4-bundle | Chaos Rising | bundle | 10 | 10 (avg 10.00) | 122 |
| me4-display | Chaos Rising | display | 10 | 10 (avg 10.00) | 122 |
| me4-etb | Chaos Rising | etb | 10 | 10 (avg 10.00) | 122 |
| me4-etb-pc | Chaos Rising | etb | 10 | 10 (avg 10.00) | 122 |
| me4-single-blister | Chaos Rising | special | 10 | 10 (avg 10.00) | 122 |
| me4-triple-blister | Chaos Rising | special | 10 | 10 (avg 10.00) | 122 |
| me3-booster | Perfect Order | booster | 10 | 10 (avg 10.00) | 124 |
| me3-build-battle | Perfect Order | special | 10 | 10 (avg 10.00) | 124 |
| me3-bundle | Perfect Order | bundle | 10 | 10 (avg 10.00) | 124 |
| me3-display | Perfect Order | display | 10 | 10 (avg 10.00) | 124 |
| me3-etb | Perfect Order | etb | 10 | 10 (avg 10.00) | 124 |
| me3-etb-pc | Perfect Order | etb | 10 | 10 (avg 10.00) | 124 |
| me2pt5-2pack-blister | Ascended Heroes | special | 10 | 10 (avg 10.00) | 295 |
| me2pt5-booster | Ascended Heroes | booster | 10 | 10 (avg 10.00) | 295 |
| me2pt5-bundle | Ascended Heroes | bundle | 10 | 10 (avg 10.00) | 295 |
| me2pt5-etb | Ascended Heroes | etb | 10 | 10 (avg 10.00) | 295 |
| me2pt5-etb-pc | Ascended Heroes | etb | 10 | 10 (avg 10.00) | 295 |
| me2pt5-first-partners-pin | Ascended Heroes | special | 10 | 10 (avg 10.00) | 295 |
| me2pt5-mega-emboar-box | Ascended Heroes | special | 10 | 10 (avg 10.00) | 295 |
| me2pt5-mega-feraligatr-box | Ascended Heroes | special | 10 | 10 (avg 10.00) | 295 |
| me2pt5-mega-meganium-box | Ascended Heroes | special | 10 | 10 (avg 10.00) | 295 |
| me2pt5-mini-tin | Ascended Heroes | special | 10 | 10 (avg 10.00) | 295 |
| me2pt5-premium-poster | Ascended Heroes | special | 10 | 10 (avg 10.00) | 295 |
| me2pt5-tech-sticker | Ascended Heroes | special | 10 | 10 (avg 10.00) | 295 |
| me2-booster | Phantasmal Flames | booster | 10 | 10 (avg 10.00) | 130 |
| me2-build-battle | Phantasmal Flames | special | 10 | 10 (avg 10.00) | 130 |
| me2-bundle | Phantasmal Flames | bundle | 10 | 10 (avg 10.00) | 130 |
| me2-display | Phantasmal Flames | display | 10 | 10 (avg 10.00) | 130 |
| me2-etb | Phantasmal Flames | etb | 10 | 10 (avg 10.00) | 130 |
| me2-etb-pc | Phantasmal Flames | etb | 10 | 10 (avg 10.00) | 130 |
| me2-single-blister | Phantasmal Flames | special | 10 | 10 (avg 10.00) | 130 |
| me2-triple-blister | Phantasmal Flames | special | 10 | 10 (avg 10.00) | 130 |
| me2-upc-mega-charizard-x | Phantasmal Flames | special | 10 | 10 (avg 10.00) | 130 |
| me1-booster | Mega Evolution | booster | 10 | 10 (avg 10.00) | 188 |
| me1-build-battle | Mega Evolution | special | 10 | 10 (avg 10.00) | 188 |
| me1-bundle | Mega Evolution | bundle | 10 | 10 (avg 10.00) | 188 |
| me1-display | Mega Evolution | display | 10 | 10 (avg 10.00) | 188 |
| me1-etb | Mega Evolution | etb | 10 | 10 (avg 10.00) | 188 |
| me1-etb-gardevoir | Mega Evolution | etb | 10 | 10 (avg 10.00) | 188 |
| me1-etb-pc | Mega Evolution | etb | 10 | 10 (avg 10.00) | 188 |
| me1-etb-pc-lucario | Mega Evolution | etb | 10 | 10 (avg 10.00) | 188 |
| me1-single-blister | Mega Evolution | special | 10 | 10 (avg 10.00) | 188 |
| me1-triple-blister | Mega Evolution | special | 10 | 10 (avg 10.00) | 188 |
| rsv10pt5-booster | White Flare | booster | 10 | 10 (avg 10.00) | 173 |
| rsv10pt5-bundle | White Flare | bundle | 10 | 10 (avg 10.00) | 173 |
| rsv10pt5-etb | White Flare | etb | 10 | 10 (avg 10.00) | 173 |
| rsv10pt5-etb-pc | White Flare | etb | 10 | 10 (avg 10.00) | 173 |
| zsv10pt5-booster | Black Bolt | booster | 10 | 10 (avg 10.00) | 172 |
| zsv10pt5-bundle | Black Bolt | bundle | 10 | 10 (avg 10.00) | 172 |
| zsv10pt5-etb | Black Bolt | etb | 10 | 10 (avg 10.00) | 172 |
| zsv10pt5-etb-pc | Black Bolt | etb | 10 | 10 (avg 10.00) | 172 |
| sv10-booster | Destined Rivals | booster | 10 | 10 (avg 10.00) | 244 |
| sv10-build-battle | Destined Rivals | special | 10 | 10 (avg 10.00) | 244 |
| sv10-bundle | Destined Rivals | bundle | 10 | 10 (avg 10.00) | 244 |
| sv10-display | Destined Rivals | display | 10 | 10 (avg 10.00) | 244 |
| sv10-etb | Destined Rivals | etb | 10 | 10 (avg 10.00) | 244 |
| sv10-etb-pc | Destined Rivals | etb | 10 | 10 (avg 10.00) | 244 |
| sv10-half-display | Destined Rivals | display | 10 | 10 (avg 10.00) | 244 |
| sv10-single-blister | Destined Rivals | special | 10 | 10 (avg 10.00) | 244 |
| sv10-triple-blister | Destined Rivals | special | 10 | 10 (avg 10.00) | 244 |
| sv10-upc-moltres | Destined Rivals | special | 10 | 10 (avg 10.00) | 244 |
| sv9-booster | Journey Together | booster | 10 | 10 (avg 10.00) | 190 |
| sv9-build-battle | Journey Together | special | 10 | 10 (avg 10.00) | 190 |
| sv9-bundle | Journey Together | bundle | 10 | 10 (avg 10.00) | 190 |
| sv9-display | Journey Together | display | 10 | 10 (avg 10.00) | 190 |
| sv9-display-enhanced | Journey Together | display | 10 | 10 (avg 10.00) | 190 |
| sv9-etb | Journey Together | etb | 10 | 10 (avg 10.00) | 190 |
| sv9-etb-pc | Journey Together | etb | 10 | 10 (avg 10.00) | 190 |
| sv9-half-display | Journey Together | display | 10 | 10 (avg 10.00) | 190 |
| sv8pt5-2pack-blister | Prismatic Evolutions | special | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-accessory-pouch | Prismatic Evolutions | special | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-binder-collection | Prismatic Evolutions | special | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-booster | Prismatic Evolutions | booster | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-bundle | Prismatic Evolutions | bundle | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-etb | Prismatic Evolutions | etb | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-etb-pc | Prismatic Evolutions | etb | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-figure-collection | Prismatic Evolutions | special | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-poster-collection | Prismatic Evolutions | special | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-spc | Prismatic Evolutions | special | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-surprise-box | Prismatic Evolutions | special | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-tech-sticker-glaceon | Prismatic Evolutions | special | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-tech-sticker-leafeon | Prismatic Evolutions | special | 10 | 10 (avg 10.00) | 180 |
| sv8pt5-tech-sticker-sylveon | Prismatic Evolutions | special | 10 | 10 (avg 10.00) | 180 |
| sv8-booster | Surging Sparks | booster | 10 | 10 (avg 10.00) | 252 |
| sv8-build-battle | Surging Sparks | special | 10 | 10 (avg 10.00) | 252 |
| sv8-bundle | Surging Sparks | bundle | 10 | 10 (avg 10.00) | 252 |
| sv8-display | Surging Sparks | display | 10 | 10 (avg 10.00) | 252 |
| sv8-etb | Surging Sparks | etb | 10 | 10 (avg 10.00) | 252 |
| sv8-etb-pc | Surging Sparks | etb | 10 | 10 (avg 10.00) | 252 |
| sv8-half-display | Surging Sparks | display | 10 | 10 (avg 10.00) | 252 |
| sv8-single-blister | Surging Sparks | special | 10 | 10 (avg 10.00) | 252 |
| sv8-triple-blister | Surging Sparks | special | 10 | 10 (avg 10.00) | 252 |
| sv7-booster | Stellar Crown | booster | 10 | 10 (avg 10.00) | 175 |
| sv7-build-battle | Stellar Crown | special | 10 | 10 (avg 10.00) | 175 |
| sv7-bundle | Stellar Crown | bundle | 10 | 10 (avg 10.00) | 175 |
| sv7-display | Stellar Crown | display | 10 | 10 (avg 10.00) | 175 |
| sv7-etb | Stellar Crown | etb | 10 | 10 (avg 10.00) | 175 |
| sv7-etb-pc | Stellar Crown | etb | 10 | 10 (avg 10.00) | 175 |
| sv7-half-display | Stellar Crown | display | 10 | 10 (avg 10.00) | 175 |
| sv7-single-blister | Stellar Crown | special | 10 | 10 (avg 10.00) | 175 |
| sv7-triple-blister | Stellar Crown | special | 10 | 10 (avg 10.00) | 175 |
| sv7-upc-terapagos | Stellar Crown | special | 10 | 10 (avg 10.00) | 175 |
| sv6pt5-booster | Shrouded Fable | booster | 10 | 10 (avg 10.00) | 99 |
| sv6pt5-bundle | Shrouded Fable | bundle | 10 | 10 (avg 10.00) | 99 |
| sv6pt5-etb | Shrouded Fable | etb | 10 | 10 (avg 10.00) | 99 |
| sv6pt5-etb-pc | Shrouded Fable | etb | 10 | 10 (avg 10.00) | 99 |
| sv6pt5-greninja-collection | Shrouded Fable | special | 10 | 10 (avg 10.00) | 99 |
| sv6pt5-kingambit-collection | Shrouded Fable | special | 10 | 10 (avg 10.00) | 99 |
| sv6pt5-kingdra-collection | Shrouded Fable | special | 10 | 10 (avg 10.00) | 99 |
| sv6-booster | Twilight Masquerade | booster | 10 | 10 (avg 10.00) | 226 |
| sv6-build-battle | Twilight Masquerade | special | 10 | 10 (avg 10.00) | 226 |
| sv6-bundle | Twilight Masquerade | bundle | 10 | 10 (avg 10.00) | 226 |
| sv6-display | Twilight Masquerade | display | 10 | 10 (avg 10.00) | 226 |
| sv6-etb | Twilight Masquerade | etb | 10 | 10 (avg 10.00) | 226 |
| sv6-etb-pc | Twilight Masquerade | etb | 10 | 10 (avg 10.00) | 226 |
| sv6-half-display | Twilight Masquerade | display | 10 | 10 (avg 10.00) | 226 |
| sv6-single-blister | Twilight Masquerade | special | 10 | 10 (avg 10.00) | 226 |
| sv6-triple-blister | Twilight Masquerade | special | 10 | 10 (avg 10.00) | 226 |
| sv6-upc-greninja | Twilight Masquerade | special | 10 | 10 (avg 10.00) | 226 |
| sv5-booster | Temporal Forces | booster | 10 | 10 (avg 10.00) | 218 |
| sv5-build-battle | Temporal Forces | special | 10 | 10 (avg 10.00) | 218 |
| sv5-bundle | Temporal Forces | bundle | 10 | 10 (avg 10.00) | 218 |
| sv5-display | Temporal Forces | display | 10 | 10 (avg 10.00) | 218 |
| sv5-etb | Temporal Forces | etb | 10 | 10 (avg 10.00) | 218 |
| sv5-etb-iron-leaves | Temporal Forces | etb | 10 | 10 (avg 10.00) | 218 |
| sv5-etb-pc | Temporal Forces | etb | 10 | 10 (avg 10.00) | 218 |
| sv5-etb-pc-walking-wake | Temporal Forces | etb | 10 | 10 (avg 10.00) | 218 |
| sv5-single-blister | Temporal Forces | special | 10 | 10 (avg 10.00) | 218 |
| sv5-triple-blister | Temporal Forces | special | 10 | 10 (avg 10.00) | 218 |
| sv4pt5-booster | Paldean Fates | booster | 10 | 10 (avg 10.00) | 245 |
| sv4pt5-bundle | Paldean Fates | bundle | 10 | 10 (avg 10.00) | 245 |
| sv4pt5-etb | Paldean Fates | etb | 10 | 10 (avg 10.00) | 245 |
| sv4pt5-etb-pc | Paldean Fates | etb | 10 | 10 (avg 10.00) | 245 |
| sv4pt5-premium-meowscarada | Paldean Fates | special | 10 | 10 (avg 10.00) | 245 |
| sv4pt5-premium-quaquaval | Paldean Fates | special | 10 | 10 (avg 10.00) | 245 |
| sv4pt5-premium-skeledirge | Paldean Fates | special | 10 | 10 (avg 10.00) | 245 |
| sv4pt5-tech-sticker-fidough | Paldean Fates | special | 10 | 10 (avg 10.00) | 245 |
| sv4pt5-tech-sticker-greavard | Paldean Fates | special | 10 | 10 (avg 10.00) | 245 |
| sv4pt5-tech-sticker-maschiff | Paldean Fates | special | 10 | 10 (avg 10.00) | 245 |
| sv4pt5-tusk-treads-premium | Paldean Fates | special | 10 | 10 (avg 10.00) | 245 |
| sv4-booster | Paradox Rift | booster | 10 | 10 (avg 10.00) | 266 |
| sv4-build-battle | Paradox Rift | special | 10 | 10 (avg 10.00) | 266 |
| sv4-bundle | Paradox Rift | bundle | 10 | 10 (avg 10.00) | 266 |
| sv4-display | Paradox Rift | display | 10 | 10 (avg 10.00) | 266 |
| sv4-etb | Paradox Rift | etb | 10 | 10 (avg 10.00) | 266 |
| sv4-etb-pc | Paradox Rift | etb | 10 | 10 (avg 10.00) | 266 |
| sv4-etb-pc-roaring-moon | Paradox Rift | etb | 10 | 10 (avg 10.00) | 266 |
| sv4-etb-roaring-moon | Paradox Rift | etb | 10 | 10 (avg 10.00) | 266 |
| sv4-single-blister | Paradox Rift | special | 10 | 10 (avg 10.00) | 266 |
| sv4-triple-blister | Paradox Rift | special | 10 | 10 (avg 10.00) | 266 |
| sv3pt5-alakazam-ex-collection | 151 | special | 10 | 10 (avg 10.00) | 207 |
| sv3pt5-binder-collection | 151 | special | 10 | 10 (avg 10.00) | 207 |
| sv3pt5-blooming-waters | 151 | special | 10 | 10 (avg 10.00) | 207 |
| sv3pt5-booster | 151 | booster | 10 | 10 (avg 10.00) | 207 |
| sv3pt5-bundle | 151 | bundle | 10 | 10 (avg 10.00) | 207 |
| sv3pt5-etb | 151 | etb | 10 | 10 (avg 10.00) | 207 |
| sv3pt5-etb-pc | 151 | etb | 10 | 10 (avg 10.00) | 207 |
| sv3pt5-poster-collection | 151 | special | 10 | 10 (avg 10.00) | 207 |
| sv3pt5-upc | 151 | special | 10 | 10 (avg 10.00) | 207 |
| sv3pt5-zapdos-ex-collection | 151 | special | 10 | 10 (avg 10.00) | 207 |
| sv3-booster | Obsidian Flames | booster | 10 | 10 (avg 10.00) | 230 |
| sv3-build-battle | Obsidian Flames | special | 10 | 10 (avg 10.00) | 230 |
| sv3-bundle | Obsidian Flames | bundle | 10 | 10 (avg 10.00) | 230 |
| sv3-display | Obsidian Flames | display | 10 | 10 (avg 10.00) | 230 |
| sv3-etb | Obsidian Flames | etb | 10 | 10 (avg 10.00) | 230 |
| sv3-etb-pc | Obsidian Flames | etb | 10 | 10 (avg 10.00) | 230 |
| sv3-single-blister | Obsidian Flames | special | 10 | 10 (avg 10.00) | 230 |
| sv3-triple-blister | Obsidian Flames | special | 10 | 10 (avg 10.00) | 230 |
| sv2-booster | Paldea Evolved | booster | 10 | 10 (avg 10.00) | 250 |
| sv2-build-battle | Paldea Evolved | special | 10 | 10 (avg 10.00) | 250 |
| sv2-bundle | Paldea Evolved | bundle | 10 | 10 (avg 10.00) | 250 |
| sv2-display | Paldea Evolved | display | 10 | 10 (avg 10.00) | 250 |
| sv2-etb | Paldea Evolved | etb | 10 | 10 (avg 10.00) | 250 |
| sv2-etb-pc | Paldea Evolved | etb | 10 | 10 (avg 10.00) | 250 |
| sv2-single-blister | Paldea Evolved | special | 10 | 10 (avg 10.00) | 250 |
| sv2-triple-blister | Paldea Evolved | special | 10 | 10 (avg 10.00) | 250 |
| sv1-booster | Scarlet & Violet | booster | 10 | 10 (avg 10.00) | 258 |
| sv1-build-battle | Scarlet & Violet | special | 10 | 10 (avg 10.00) | 258 |
| sv1-bundle | Scarlet & Violet | bundle | 10 | 10 (avg 10.00) | 258 |
| sv1-display | Scarlet & Violet | display | 10 | 10 (avg 10.00) | 258 |
| sv1-etb | Scarlet & Violet | etb | 10 | 10 (avg 10.00) | 258 |
| sv1-etb-miraidon | Scarlet & Violet | etb | 10 | 10 (avg 10.00) | 258 |
| sv1-etb-pc | Scarlet & Violet | etb | 10 | 10 (avg 10.00) | 258 |
| sv1-etb-pc-miraidon | Scarlet & Violet | etb | 10 | 10 (avg 10.00) | 258 |
| sv1-single-blister | Scarlet & Violet | special | 10 | 10 (avg 10.00) | 258 |
| sv1-triple-blister | Scarlet & Violet | special | 10 | 10 (avg 10.00) | 258 |
| swsh12pt5-booster | Crown Zenith | booster | 10 | 10 (avg 10.00) | 230 |
| swsh12pt5-bundle | Crown Zenith | bundle | 10 | 10 (avg 10.00) | 230 |
| swsh12pt5-etb | Crown Zenith | etb | 10 | 10 (avg 10.00) | 230 |
| swsh12pt5-etb-pc | Crown Zenith | etb | 10 | 10 (avg 10.00) | 230 |
| swsh12-booster | Silver Tempest | booster | 10 | 10 (avg 10.00) | 245 |
| swsh12-build-battle | Silver Tempest | special | 10 | 10 (avg 10.00) | 245 |
| swsh12-bundle | Silver Tempest | bundle | 10 | 10 (avg 10.00) | 245 |
| swsh12-display | Silver Tempest | display | 10 | 10 (avg 10.00) | 245 |
| swsh12-etb | Silver Tempest | etb | 10 | 10 (avg 10.00) | 245 |
| swsh12-etb-pc | Silver Tempest | etb | 10 | 10 (avg 10.00) | 245 |
| swsh11-booster | Lost Origin | booster | 10 | 10 (avg 10.00) | 247 |
| swsh11-build-battle | Lost Origin | special | 10 | 10 (avg 10.00) | 247 |
| swsh11-bundle | Lost Origin | bundle | 10 | 10 (avg 10.00) | 247 |
| swsh11-display | Lost Origin | display | 10 | 10 (avg 10.00) | 247 |
| swsh11-etb | Lost Origin | etb | 10 | 10 (avg 10.00) | 247 |
| swsh11-etb-pc | Lost Origin | etb | 10 | 10 (avg 10.00) | 247 |
| swsh11-upc-arceus | Lost Origin | special | 10 | 10 (avg 10.00) | 247 |
| swsh11-upc-charizard | Lost Origin | special | 10 | 10 (avg 10.00) | 247 |
| mcd22-booster | McDonald's Collection 2022 | booster | 4 | 4 (avg 4.00) | 15 |
| pgo-booster | Pokémon GO | booster | 10 | 10 (avg 10.00) | 88 |
| pgo-etb | Pokémon GO | etb | 10 | 10 (avg 10.00) | 88 |
| swsh10-booster | Astral Radiance | booster | 10 | 10 (avg 10.00) | 246 |
| swsh10-build-battle | Astral Radiance | special | 10 | 10 (avg 10.00) | 246 |
| swsh10-display | Astral Radiance | display | 10 | 10 (avg 10.00) | 246 |
| swsh10-etb | Astral Radiance | etb | 10 | 10 (avg 10.00) | 246 |
| swsh10-etb-pc | Astral Radiance | etb | 10 | 10 (avg 10.00) | 246 |
| swsh10-half-display | Astral Radiance | display | 10 | 10 (avg 10.00) | 246 |
| swsh9-booster | Brilliant Stars | booster | 10 | 10 (avg 10.00) | 216 |
| swsh9-build-battle | Brilliant Stars | special | 10 | 10 (avg 10.00) | 216 |
| swsh9-display | Brilliant Stars | display | 10 | 10 (avg 10.00) | 216 |
| swsh9-etb | Brilliant Stars | etb | 10 | 10 (avg 10.00) | 216 |
| swsh9-etb-pc | Brilliant Stars | etb | 10 | 10 (avg 10.00) | 216 |
| swsh8-booster | Fusion Strike | booster | 10 | 10 (avg 10.00) | 284 |
| swsh8-build-battle | Fusion Strike | special | 10 | 10 (avg 10.00) | 284 |
| swsh8-display | Fusion Strike | display | 10 | 10 (avg 10.00) | 284 |
| swsh8-etb | Fusion Strike | etb | 10 | 10 (avg 10.00) | 284 |
| swsh8-etb-pc | Fusion Strike | etb | 10 | 10 (avg 10.00) | 284 |
| cel25-booster | Celebrations | booster | 4 | 4 (avg 4.00) | 25 |
| cel25-deluxe-pin | Celebrations | special | 4 | 4 (avg 4.00) | 25 |
| cel25-dragapult-prime | Celebrations | special | 4 | 4 (avg 4.00) | 25 |
| cel25-etb | Celebrations | etb | 4 | 4 (avg 4.00) | 25 |
| cel25-pikachu-v-union | Celebrations | special | 4 | 4 (avg 4.00) | 25 |
| cel25-premium-figure | Celebrations | special | 4 | 4 (avg 4.00) | 25 |
| cel25-upc | Celebrations | special | 4 | 4 (avg 4.00) | 25 |
| cel25-v-memories | Celebrations | special | 4 | 4 (avg 4.00) | 25 |
| swsh7-booster | Evolving Skies | booster | 10 | 10 (avg 10.00) | 237 |
| swsh7-build-battle | Evolving Skies | special | 10 | 10 (avg 10.00) | 237 |
| swsh7-display | Evolving Skies | display | 10 | 10 (avg 10.00) | 237 |
| swsh7-etb | Evolving Skies | etb | 10 | 10 (avg 10.00) | 237 |
| swsh7-etb-glaceon | Evolving Skies | etb | 10 | 10 (avg 10.00) | 237 |
| swsh7-etb-pc | Evolving Skies | etb | 10 | 10 (avg 10.00) | 237 |
| swsh7-etb-pc-glaceon | Evolving Skies | etb | 10 | 10 (avg 10.00) | 237 |
| swsh7-half-display | Evolving Skies | display | 10 | 10 (avg 10.00) | 237 |
| swsh6-booster | Chilling Reign | booster | 10 | 10 (avg 10.00) | 233 |
| swsh6-build-battle | Chilling Reign | special | 10 | 10 (avg 10.00) | 233 |
| swsh6-display | Chilling Reign | display | 10 | 10 (avg 10.00) | 233 |
| swsh6-etb | Chilling Reign | etb | 10 | 10 (avg 10.00) | 233 |
| swsh6-etb-pc | Chilling Reign | etb | 10 | 10 (avg 10.00) | 233 |
| swsh6-etb-pc-shadow | Chilling Reign | etb | 10 | 10 (avg 10.00) | 233 |
| swsh6-etb-shadow-rider | Chilling Reign | etb | 10 | 10 (avg 10.00) | 233 |
| swsh5-booster | Battle Styles | booster | 10 | 10 (avg 10.00) | 183 |
| swsh5-build-battle | Battle Styles | special | 10 | 10 (avg 10.00) | 183 |
| swsh5-display | Battle Styles | display | 10 | 10 (avg 10.00) | 183 |
| swsh5-etb | Battle Styles | etb | 10 | 10 (avg 10.00) | 183 |
| swsh5-etb-rapid-strike | Battle Styles | etb | 10 | 10 (avg 10.00) | 183 |
| swsh45-booster | Shining Fates | booster | 10 | 10 (avg 10.00) | 195 |
| swsh45-etb | Shining Fates | etb | 10 | 10 (avg 10.00) | 195 |
| mcd21-booster | McDonald's Collection 2021 | booster | 4 | 4 (avg 4.00) | 25 |
| swsh4-booster | Vivid Voltage | booster | 10 | 10 (avg 10.00) | 203 |
| swsh4-build-battle | Vivid Voltage | special | 10 | 10 (avg 10.00) | 203 |
| swsh4-display | Vivid Voltage | display | 10 | 10 (avg 10.00) | 203 |
| swsh4-etb | Vivid Voltage | etb | 10 | 10 (avg 10.00) | 203 |
| swsh35-booster | Champion's Path | booster | 10 | 10 (avg 10.00) | 80 |
| swsh35-etb | Champion's Path | etb | 10 | 10 (avg 10.00) | 80 |
| swsh3-booster | Darkness Ablaze | booster | 10 | 10 (avg 10.00) | 201 |
| swsh3-build-battle | Darkness Ablaze | special | 10 | 10 (avg 10.00) | 201 |
| swsh3-display | Darkness Ablaze | display | 10 | 10 (avg 10.00) | 201 |
| swsh3-etb | Darkness Ablaze | etb | 10 | 10 (avg 10.00) | 201 |
| swsh2-booster | Rebel Clash | booster | 10 | 10 (avg 10.00) | 209 |
| swsh2-build-battle | Rebel Clash | special | 10 | 10 (avg 10.00) | 209 |
| swsh2-display | Rebel Clash | display | 10 | 10 (avg 10.00) | 209 |
| swsh2-etb | Rebel Clash | etb | 10 | 10 (avg 10.00) | 209 |
| swsh1-booster | Sword & Shield | booster | 10 | 10 (avg 10.00) | 216 |
| swsh1-build-battle | Sword & Shield | special | 10 | 10 (avg 10.00) | 216 |
| swsh1-display | Sword & Shield | display | 10 | 10 (avg 10.00) | 216 |
| swsh1-etb | Sword & Shield | etb | 10 | 10 (avg 10.00) | 216 |
| swsh1-etb-plus | Sword & Shield | etb | 10 | 10 (avg 10.00) | 216 |
| swsh1-etb-plus-zamazenta | Sword & Shield | etb | 10 | 10 (avg 10.00) | 216 |
| swsh1-etb-zamazenta | Sword & Shield | etb | 10 | 10 (avg 10.00) | 216 |
| swsh1-upc-zacian-zamazenta | Sword & Shield | special | 10 | 10 (avg 10.00) | 216 |
| sm12-booster | Cosmic Eclipse | booster | 10 | 10 (avg 10.00) | 272 |
| sm12-build-battle | Cosmic Eclipse | special | 10 | 10 (avg 10.00) | 272 |
| sm12-display | Cosmic Eclipse | display | 10 | 10 (avg 10.00) | 272 |
| sm12-etb | Cosmic Eclipse | etb | 10 | 10 (avg 10.00) | 272 |
| sm115-booster | Hidden Fates | booster | 10 | 10 (avg 10.00) | 163 |
| sm115-etb | Hidden Fates | etb | 10 | 10 (avg 10.00) | 163 |
| sm11-booster | Unified Minds | booster | 10 | 10 (avg 10.00) | 261 |
| sm11-build-battle | Unified Minds | special | 10 | 10 (avg 10.00) | 261 |
| sm11-display | Unified Minds | display | 10 | 10 (avg 10.00) | 261 |
| sm11-etb | Unified Minds | etb | 10 | 10 (avg 10.00) | 261 |
| sm10-booster | Unbroken Bonds | booster | 10 | 10 (avg 10.00) | 238 |
| sm10-build-battle | Unbroken Bonds | special | 10 | 10 (avg 10.00) | 238 |
| sm10-display | Unbroken Bonds | display | 10 | 10 (avg 10.00) | 238 |
| sm10-etb | Unbroken Bonds | etb | 10 | 10 (avg 10.00) | 238 |
| det1-booster | Detective Pikachu | booster | 4 | 4 (avg 4.00) | 18 |
| sm9-booster | Team Up | booster | 10 | 10 (avg 10.00) | 198 |
| sm9-build-battle | Team Up | special | 10 | 10 (avg 10.00) | 198 |
| sm9-display | Team Up | display | 10 | 10 (avg 10.00) | 198 |
| sm9-etb | Team Up | etb | 10 | 10 (avg 10.00) | 198 |
| sm8-booster | Lost Thunder | booster | 10 | 10 (avg 10.00) | 240 |
| sm8-build-battle | Lost Thunder | special | 10 | 10 (avg 10.00) | 240 |
| sm8-display | Lost Thunder | display | 10 | 10 (avg 10.00) | 240 |
| sm8-etb | Lost Thunder | etb | 10 | 10 (avg 10.00) | 240 |
| sm75-booster | Dragon Majesty | booster | 10 | 10 (avg 10.00) | 80 |
| sm75-etb | Dragon Majesty | etb | 10 | 10 (avg 10.00) | 80 |
| sm7-booster | Celestial Storm | booster | 10 | 10 (avg 10.00) | 187 |
| sm7-build-battle | Celestial Storm | special | 10 | 10 (avg 10.00) | 187 |
| sm7-display | Celestial Storm | display | 10 | 10 (avg 10.00) | 187 |
| sm7-etb | Celestial Storm | etb | 10 | 10 (avg 10.00) | 187 |
| sm6-booster | Forbidden Light | booster | 10 | 10 (avg 10.00) | 150 |
| sm6-build-battle | Forbidden Light | special | 10 | 10 (avg 10.00) | 150 |
| sm6-display | Forbidden Light | display | 10 | 10 (avg 10.00) | 150 |
| sm6-etb | Forbidden Light | etb | 10 | 10 (avg 10.00) | 150 |
| sm5-booster | Ultra Prism | booster | 10 | 10 (avg 10.00) | 178 |
| sm5-build-battle | Ultra Prism | special | 10 | 10 (avg 10.00) | 178 |
| sm5-display | Ultra Prism | display | 10 | 10 (avg 10.00) | 178 |
| sm5-etb | Ultra Prism | etb | 10 | 10 (avg 10.00) | 178 |
| sm5-etb-dusk-mane | Ultra Prism | etb | 10 | 10 (avg 10.00) | 178 |
| sm4-booster | Crimson Invasion | booster | 10 | 10 (avg 10.00) | 126 |
| sm4-build-battle | Crimson Invasion | special | 10 | 10 (avg 10.00) | 126 |
| sm4-display | Crimson Invasion | display | 10 | 10 (avg 10.00) | 126 |
| sm4-etb | Crimson Invasion | etb | 10 | 10 (avg 10.00) | 126 |
| sm35-booster | Shining Legends | booster | 10 | 10 (avg 10.00) | 81 |
| sm35-etb | Shining Legends | etb | 10 | 10 (avg 10.00) | 81 |
| sm3-booster | Burning Shadows | booster | 10 | 10 (avg 10.00) | 177 |
| sm3-build-battle | Burning Shadows | special | 10 | 10 (avg 10.00) | 177 |
| sm3-display | Burning Shadows | display | 10 | 10 (avg 10.00) | 177 |
| sm3-etb | Burning Shadows | etb | 10 | 10 (avg 10.00) | 177 |
| sm2-booster | Guardians Rising | booster | 10 | 10 (avg 10.00) | 180 |
| sm2-build-battle | Guardians Rising | special | 10 | 10 (avg 10.00) | 180 |
| sm2-display | Guardians Rising | display | 10 | 10 (avg 10.00) | 180 |
| sm2-etb | Guardians Rising | etb | 10 | 10 (avg 10.00) | 180 |
| sm1-booster | Sun & Moon | booster | 10 | 10 (avg 10.00) | 173 |
| sm1-build-battle | Sun & Moon | special | 10 | 10 (avg 10.00) | 173 |
| sm1-display | Sun & Moon | display | 10 | 10 (avg 10.00) | 173 |
| sm1-etb | Sun & Moon | etb | 10 | 10 (avg 10.00) | 173 |
| sm1-etb-lunala | Sun & Moon | etb | 10 | 10 (avg 10.00) | 173 |
| xy12-booster | Evolutions | booster | 10 | 10 (avg 10.00) | 113 |
| xy12-build-battle | Evolutions | special | 10 | 10 (avg 10.00) | 113 |
| xy12-display | Evolutions | display | 10 | 10 (avg 10.00) | 113 |
| xy12-etb | Evolutions | etb | 10 | 10 (avg 10.00) | 113 |
| xy12-etb-blastoise | Evolutions | etb | 10 | 10 (avg 10.00) | 113 |
| xy11-booster | Steam Siege | booster | 10 | 10 (avg 10.00) | 116 |
| xy11-build-battle | Steam Siege | special | 10 | 10 (avg 10.00) | 116 |
| xy11-display | Steam Siege | display | 10 | 10 (avg 10.00) | 116 |
| xy11-etb | Steam Siege | etb | 10 | 10 (avg 10.00) | 116 |
| xy10-booster | Fates Collide | booster | 10 | 10 (avg 10.00) | 129 |
| xy10-build-battle | Fates Collide | special | 10 | 10 (avg 10.00) | 129 |
| xy10-display | Fates Collide | display | 10 | 10 (avg 10.00) | 129 |
| xy10-etb | Fates Collide | etb | 10 | 10 (avg 10.00) | 129 |
| g1-etb | Generations | etb | 10 | 10 (avg 10.00) | 117 |
| xy9-booster | BREAKpoint | booster | 10 | 10 (avg 10.00) | 126 |
| xy9-display | BREAKpoint | display | 10 | 10 (avg 10.00) | 126 |
| xy9-etb | BREAKpoint | etb | 10 | 10 (avg 10.00) | 126 |
| xy8-booster | BREAKthrough | booster | 10 | 10 (avg 10.00) | 165 |
| xy8-display | BREAKthrough | display | 10 | 10 (avg 10.00) | 165 |
| xy8-etb | BREAKthrough | etb | 10 | 10 (avg 10.00) | 165 |
| xy8-etb-mewtwo-y | BREAKthrough | etb | 10 | 10 (avg 10.00) | 165 |
| xy7-booster | Ancient Origins | booster | 10 | 10 (avg 10.00) | 101 |
| xy7-display | Ancient Origins | display | 10 | 10 (avg 10.00) | 101 |
| xy7-etb | Ancient Origins | etb | 10 | 10 (avg 10.00) | 101 |
| xy6-booster | Roaring Skies | booster | 10 | 10 (avg 10.00) | 112 |
| xy6-display | Roaring Skies | display | 10 | 10 (avg 10.00) | 112 |
| xy6-etb | Roaring Skies | etb | 10 | 10 (avg 10.00) | 112 |
| dc1-blister | Double Crisis | special | 7 | 10 (avg 10.00) | 34 |
| xy5-booster | Primal Clash | booster | 10 | 10 (avg 10.00) | 164 |
| xy5-display | Primal Clash | display | 10 | 10 (avg 10.00) | 164 |
| xy5-etb | Primal Clash | etb | 10 | 10 (avg 10.00) | 164 |
| xy5-etb-kyogre | Primal Clash | etb | 10 | 10 (avg 10.00) | 164 |
| xy4-booster | Phantom Forces | booster | 10 | 10 (avg 10.00) | 124 |
| xy4-display | Phantom Forces | display | 10 | 10 (avg 10.00) | 124 |
| xy4-etb | Phantom Forces | etb | 10 | 10 (avg 10.00) | 124 |
| xy3-booster | Furious Fists | booster | 10 | 10 (avg 10.00) | 114 |
| xy3-display | Furious Fists | display | 10 | 10 (avg 10.00) | 114 |
| xy3-etb | Furious Fists | etb | 10 | 10 (avg 10.00) | 114 |
| xy2-booster | Flashfire | booster | 10 | 10 (avg 10.00) | 110 |
| xy2-display | Flashfire | display | 10 | 10 (avg 10.00) | 110 |
| xy1-booster | XY | booster | 10 | 10 (avg 10.00) | 146 |
| xy1-display | XY | display | 10 | 10 (avg 10.00) | 146 |
| xy1-etb | XY | etb | 10 | 10 (avg 10.00) | 146 |
| xy1-etb-yveltal | XY | etb | 10 | 10 (avg 10.00) | 146 |
| bw11-booster | Legendary Treasures | booster | 10 | 10 (avg 10.00) | 140 |
| bw11-display | Legendary Treasures | display | 10 | 10 (avg 10.00) | 140 |
| bw10-booster | Plasma Blast | booster | 10 | 10 (avg 10.00) | 105 |
| bw10-display | Plasma Blast | display | 10 | 10 (avg 10.00) | 105 |
| bw10-etb | Plasma Blast | etb | 10 | 10 (avg 10.00) | 105 |
| bw9-booster | Plasma Freeze | booster | 10 | 10 (avg 10.00) | 122 |
| bw9-display | Plasma Freeze | display | 10 | 10 (avg 10.00) | 122 |
| bw8-booster | Plasma Storm | booster | 10 | 10 (avg 10.00) | 138 |
| bw8-display | Plasma Storm | display | 10 | 10 (avg 10.00) | 138 |
| bw8-etb | Plasma Storm | etb | 10 | 10 (avg 10.00) | 138 |
| bw7-booster | Boundaries Crossed | booster | 10 | 10 (avg 10.00) | 153 |
| bw7-display | Boundaries Crossed | display | 10 | 10 (avg 10.00) | 153 |
| dv1-blister | Dragon Vault | special | 5 | 5 (avg 5.00) | 21 |
| bw6-booster | Dragons Exalted | booster | 10 | 10 (avg 10.00) | 128 |
| bw6-display | Dragons Exalted | display | 10 | 10 (avg 10.00) | 128 |
| bw5-booster | Dark Explorers | booster | 10 | 10 (avg 10.00) | 111 |
| bw5-display | Dark Explorers | display | 10 | 10 (avg 10.00) | 111 |
| bw4-booster | Next Destinies | booster | 10 | 10 (avg 10.00) | 103 |
| bw4-display | Next Destinies | display | 10 | 10 (avg 10.00) | 103 |
| bw3-booster | Noble Victories | booster | 10 | 10 (avg 10.00) | 102 |
| bw3-display | Noble Victories | display | 10 | 10 (avg 10.00) | 102 |
| bw2-booster | Emerging Powers | booster | 10 | 10 (avg 10.00) | 98 |
| bw2-display | Emerging Powers | display | 10 | 10 (avg 10.00) | 98 |
| bw1-booster | Black & White | booster | 10 | 10 (avg 10.00) | 115 |
| bw1-display | Black & White | display | 10 | 10 (avg 10.00) | 115 |
| col1-booster | Call of Legends | booster | 10 | 10 (avg 10.00) | 106 |
| col1-display | Call of Legends | display | 10 | 10 (avg 10.00) | 106 |
| hgss4-booster | HS—Triumphant | booster | 10 | 10 (avg 10.00) | 103 |
| hgss4-display | HS—Triumphant | display | 10 | 10 (avg 10.00) | 103 |
| hgss3-booster | HS—Undaunted | booster | 10 | 10 (avg 10.00) | 91 |
| hgss3-display | HS—Undaunted | display | 10 | 10 (avg 10.00) | 91 |
| hgss2-booster | HS—Unleashed | booster | 10 | 10 (avg 10.00) | 96 |
| hgss2-display | HS—Unleashed | display | 10 | 10 (avg 10.00) | 96 |
| hgss1-booster | HeartGold & SoulSilver | booster | 10 | 10 (avg 10.00) | 124 |
| hgss1-display | HeartGold & SoulSilver | display | 10 | 10 (avg 10.00) | 124 |
| pl4-booster | Arceus | booster | 10 | 10 (avg 10.00) | 111 |
| pl4-display | Arceus | display | 10 | 10 (avg 10.00) | 111 |
| pl3-booster | Supreme Victors | booster | 10 | 10 (avg 10.00) | 153 |
| pl3-display | Supreme Victors | display | 10 | 10 (avg 10.00) | 153 |
| pl2-booster | Rising Rivals | booster | 10 | 10 (avg 10.00) | 120 |
| pl2-display | Rising Rivals | display | 10 | 10 (avg 10.00) | 120 |
| pl1-booster | Platinum | booster | 10 | 10 (avg 10.00) | 133 |
| pl1-display | Platinum | display | 10 | 10 (avg 10.00) | 133 |
| dp7-booster | Stormfront | booster | 10 | 10 (avg 10.00) | 106 |
| dp7-display | Stormfront | display | 10 | 10 (avg 10.00) | 106 |
| dp6-booster | Legends Awakened | booster | 10 | 10 (avg 10.00) | 146 |
| dp6-display | Legends Awakened | display | 10 | 10 (avg 10.00) | 146 |
| dp5-booster | Majestic Dawn | booster | 10 | 10 (avg 10.00) | 100 |
| dp5-display | Majestic Dawn | display | 10 | 10 (avg 10.00) | 100 |
| dp4-booster | Great Encounters | booster | 10 | 10 (avg 10.00) | 106 |
| dp4-display | Great Encounters | display | 10 | 10 (avg 10.00) | 106 |
| dp3-booster | Secret Wonders | booster | 10 | 10 (avg 10.00) | 132 |
| dp3-display | Secret Wonders | display | 10 | 10 (avg 10.00) | 132 |
| dp2-booster | Mysterious Treasures | booster | 10 | 10 (avg 10.00) | 124 |
| dp2-display | Mysterious Treasures | display | 10 | 10 (avg 10.00) | 124 |
| dp1-booster | Diamond & Pearl | booster | 10 | 10 (avg 10.00) | 130 |
| dp1-display | Diamond & Pearl | display | 10 | 10 (avg 10.00) | 130 |
| ex16-booster | Power Keepers | booster | 10 | 10 (avg 10.00) | 108 |
| ex16-display | Power Keepers | display | 10 | 10 (avg 10.00) | 108 |
| ex15-booster | Dragon Frontiers | booster | 10 | 10 (avg 10.00) | 101 |
| ex15-display | Dragon Frontiers | display | 10 | 10 (avg 10.00) | 101 |
| ex14-booster | Crystal Guardians | booster | 10 | 10 (avg 10.00) | 100 |
| ex14-display | Crystal Guardians | display | 10 | 10 (avg 10.00) | 100 |
| ex13-booster | Holon Phantoms | booster | 10 | 10 (avg 10.00) | 111 |
| ex13-display | Holon Phantoms | display | 10 | 10 (avg 10.00) | 111 |
| ex12-booster | Legend Maker | booster | 10 | 10 (avg 10.00) | 93 |
| ex12-display | Legend Maker | display | 10 | 10 (avg 10.00) | 93 |
| ex11-booster | Delta Species | booster | 10 | 10 (avg 10.00) | 114 |
| ex11-display | Delta Species | display | 10 | 10 (avg 10.00) | 114 |
| ex10-booster | Unseen Forces | booster | 10 | 10 (avg 10.00) | 145 |
| ex10-display | Unseen Forces | display | 10 | 10 (avg 10.00) | 145 |
| ex9-booster | Emerald | booster | 10 | 10 (avg 10.00) | 107 |
| ex9-display | Emerald | display | 10 | 10 (avg 10.00) | 107 |
| ex8-booster | Deoxys | booster | 10 | 10 (avg 10.00) | 108 |
| ex8-display | Deoxys | display | 10 | 10 (avg 10.00) | 108 |
| ex7-booster | Team Rocket Returns | booster | 10 | 10 (avg 10.00) | 111 |
| ex7-display | Team Rocket Returns | display | 10 | 10 (avg 10.00) | 111 |
| ex6-booster | FireRed & LeafGreen | booster | 10 | 10 (avg 10.00) | 116 |
| ex6-display | FireRed & LeafGreen | display | 10 | 10 (avg 10.00) | 116 |
| ex5-booster | Hidden Legends | booster | 10 | 10 (avg 10.00) | 102 |
| ex5-display | Hidden Legends | display | 10 | 10 (avg 10.00) | 102 |
| ex4-booster | Team Magma vs Team Aqua | booster | 10 | 10 (avg 10.00) | 97 |
| ex4-display | Team Magma vs Team Aqua | display | 10 | 10 (avg 10.00) | 97 |
| ex3-booster | Dragon | booster | 10 | 10 (avg 10.00) | 100 |
| ex3-display | Dragon | display | 10 | 10 (avg 10.00) | 100 |
| ex2-booster | Sandstorm | booster | 10 | 10 (avg 10.00) | 100 |
| ex2-display | Sandstorm | display | 10 | 10 (avg 10.00) | 100 |
| ex1-booster | Ruby & Sapphire | booster | 10 | 10 (avg 10.00) | 109 |
| ex1-display | Ruby & Sapphire | display | 10 | 10 (avg 10.00) | 109 |
| ecard3-booster | Skyridge | booster | 10 | 10 (avg 10.00) | 182 |
| ecard3-display | Skyridge | display | 10 | 10 (avg 10.00) | 182 |
| ecard2-booster | Aquapolis | booster | 10 | 10 (avg 10.00) | 182 |
| ecard2-display | Aquapolis | display | 10 | 10 (avg 10.00) | 182 |
| ecard1-booster | Expedition Base Set | booster | 10 | 10 (avg 10.00) | 165 |
| ecard1-display | Expedition Base Set | display | 10 | 10 (avg 10.00) | 165 |
| base6-booster | Legendary Collection | booster | 10 | 10 (avg 10.00) | 110 |
| base6-display | Legendary Collection | display | 10 | 10 (avg 10.00) | 110 |
| neo4-booster | Neo Destiny | booster | 10 | 10 (avg 10.00) | 113 |
| neo4-display | Neo Destiny | display | 10 | 10 (avg 10.00) | 113 |
| neo3-booster | Neo Revelation | booster | 10 | 10 (avg 10.00) | 66 |
| neo3-display | Neo Revelation | display | 10 | 10 (avg 10.00) | 66 |
| neo2-booster | Neo Discovery | booster | 10 | 10 (avg 10.00) | 75 |
| neo2-display | Neo Discovery | display | 10 | 10 (avg 10.00) | 75 |
| neo1-booster | Neo Genesis | booster | 10 | 10 (avg 10.00) | 111 |
| neo1-display | Neo Genesis | display | 10 | 10 (avg 10.00) | 111 |
| gym2-booster | Gym Challenge | booster | 10 | 10 (avg 10.00) | 132 |
| gym2-display | Gym Challenge | display | 10 | 10 (avg 10.00) | 132 |
| gym1-booster | Gym Heroes | booster | 10 | 10 (avg 10.00) | 132 |
| gym1-display | Gym Heroes | display | 10 | 10 (avg 10.00) | 132 |
| base5-booster | Team Rocket | booster | 10 | 10 (avg 10.00) | 83 |
| base5-display | Team Rocket | display | 10 | 10 (avg 10.00) | 83 |
| base4-booster | Base Set 2 | booster | 10 | 10 (avg 10.00) | 130 |
| base4-display | Base Set 2 | display | 10 | 10 (avg 10.00) | 130 |
| base3-booster | Fossil | booster | 10 | 10 (avg 10.00) | 62 |
| base3-display | Fossil | display | 10 | 10 (avg 10.00) | 62 |
| base2-booster | Jungle | booster | 10 | 10 (avg 10.00) | 64 |
| base2-display | Jungle | display | 10 | 10 (avg 10.00) | 64 |
| base1-booster | Base | booster | 10 | 10 (avg 10.00) | 102 |
| base1-display | Base | display | 10 | 10 (avg 10.00) | 102 |
