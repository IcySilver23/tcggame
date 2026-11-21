# Hit-odds audit

118 sets carry a hit pool; 432 rarity rows sit in a hit slot. Every one is classified by where its odds come from: **set** (a measured row for that set), **era** (the era profile) or **table** (the legacy fallback table, which is real but not this set's own figure).

**No rarity falls through to the generic 1-in-50 weight**, which is the defect this check exists to catch: the Mega Hyper Rare tier had no row anywhere, so six sets dealt their gold cards at a flat 1 in 50 — 11x too often at Ascended Heroes, about 20-25x at the one-in-a-thousand sets, and 36x at Perfect Order.

- Sets with a measured per-set row: 25
- Sets relying on a fallback table row: 35
- Stored weights that disagree with the current code: 0

## What this found

The Mega Evolution line never had a Mega Hyper Rare tier in the era profile, and the legacy table did not carry one either, so me1 through me6 all dealt it at the 1-in-50 fallback. Each set now uses the TCGplayer Authentication Centre count for it: me1 1 in 1,260, me2 1 in 1,260, me2pt5 1 in 540, me3 1 in 1,786, me4 1 in 956, me5 1 in 1,081 and me6 1 in 1,000. Ascended Heroes also needed its own Mega Attack Rare (1 in 29) and the Ultra Rare rate that tier displaces (1 in 21).

Two older fallbacks were measured too and are pinned: Paldean Fates prints a Shiny Ultra Rare 1 in 13 packs (the 1-in-50 table value was 3.9x too rare) and a Shiny Rare 1 in 4, and Crown Zenith prints its secret rares 1 in 133 rather than 1 in 50.

## Every hit row

| Set | Released | Slot | Rarity | Cards | Stored | Code | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Team Rocket (base5) | 2000/04/24 | hit | Rare Secret | 1 | 0.012 | 0.012 | era |
| Neo Revelation (neo3) | 2001/09/21 | hit | Rare Shining | 2 | 0.03 | 0.03 | era |
| Neo Destiny (neo4) | 2002/02/28 | hit | Rare Shining | 8 | 0.03 | 0.03 | era |
| Aquapolis (ecard2) | 2003/01/15 | hit | Rare Secret | 3 | 0.012 | 0.012 | era |
| Skyridge (ecard3) | 2003/05/12 | hit | Rare Secret | 6 | 0.012 | 0.012 | era |
| Ruby & Sapphire (ex1) | 2003/07/01 | hit | Rare Holo EX | 8 | 0.06 | 0.06 | table |
| Sandstorm (ex2) | 2003/09/18 | hit | Rare Holo EX | 7 | 0.06 | 0.06 | table |
| Dragon (ex3) | 2003/11/24 | hit | Rare Holo EX | 9 | 0.06 | 0.06 | table |
| Dragon (ex3) | 2003/11/24 | hit | Rare Secret | 3 | 0.012 | 0.012 | era |
| Team Magma vs Team Aqua (ex4) | 2004/03/01 | hit | Rare Holo EX | 7 | 0.06 | 0.06 | table |
| Team Magma vs Team Aqua (ex4) | 2004/03/01 | hit | Rare Secret | 2 | 0.012 | 0.012 | era |
| Hidden Legends (ex5) | 2004/06/01 | hit | Rare Holo EX | 9 | 0.06 | 0.06 | table |
| Hidden Legends (ex5) | 2004/06/01 | hit | Rare Secret | 1 | 0.012 | 0.012 | era |
| FireRed & LeafGreen (ex6) | 2004/09/01 | hit | Rare Holo EX | 9 | 0.06 | 0.06 | table |
| FireRed & LeafGreen (ex6) | 2004/09/01 | hit | Rare Secret | 4 | 0.012 | 0.012 | era |
| Team Rocket Returns (ex7) | 2004/11/01 | hit | Rare Holo EX | 11 | 0.06 | 0.06 | table |
| Team Rocket Returns (ex7) | 2004/11/01 | hit | Rare Secret | 2 | 0.012 | 0.012 | era |
| Team Rocket Returns (ex7) | 2004/11/01 | hit | Rare Holo Star | 3 | 0.004 | 0.004 | era |
| Deoxys (ex8) | 2005/02/01 | hit | Rare Holo EX | 9 | 0.06 | 0.06 | table |
| Deoxys (ex8) | 2005/02/01 | hit | Rare Secret | 1 | 0.012 | 0.012 | era |
| Deoxys (ex8) | 2005/02/01 | hit | Rare Holo Star | 3 | 0.004 | 0.004 | era |
| Emerald (ex9) | 2005/05/01 | hit | Rare Holo EX | 11 | 0.06 | 0.06 | table |
| Emerald (ex9) | 2005/05/01 | hit | Rare Secret | 1 | 0.012 | 0.012 | era |
| Unseen Forces (ex10) | 2005/08/01 | hit | Rare Holo EX | 12 | 0.06 | 0.06 | table |
| Unseen Forces (ex10) | 2005/08/01 | hit | Rare Secret | 2 | 0.012 | 0.012 | era |
| Unseen Forces (ex10) | 2005/08/01 | hit | Rare Holo Star | 3 | 0.004 | 0.004 | era |
| Delta Species (ex11) | 2005/10/31 | hit | Rare Holo EX | 3 | 0.06 | 0.06 | table |
| Delta Species (ex11) | 2005/10/31 | hit | Rare Secret | 1 | 0.012 | 0.012 | era |
| Delta Species (ex11) | 2005/10/31 | hit | Rare Holo Star | 3 | 0.004 | 0.004 | era |
| Legend Maker (ex12) | 2006/02/01 | hit | Rare Holo EX | 7 | 0.06 | 0.06 | table |
| Legend Maker (ex12) | 2006/02/01 | hit | Rare Secret | 1 | 0.012 | 0.012 | era |
| Legend Maker (ex12) | 2006/02/01 | hit | Rare Holo Star | 3 | 0.004 | 0.004 | era |
| Holon Phantoms (ex13) | 2006/05/01 | hit | Rare Holo EX | 3 | 0.06 | 0.06 | table |
| Holon Phantoms (ex13) | 2006/05/01 | hit | Rare Secret | 1 | 0.012 | 0.012 | era |
| Holon Phantoms (ex13) | 2006/05/01 | hit | Rare Holo Star | 3 | 0.004 | 0.004 | era |
| Crystal Guardians (ex14) | 2006/08/01 | hit | Rare Holo EX | 10 | 0.06 | 0.06 | table |
| Crystal Guardians (ex14) | 2006/08/01 | hit | Rare Holo Star | 2 | 0.004 | 0.004 | era |
| Dragon Frontiers (ex15) | 2006/11/01 | hit | Rare Holo EX | 10 | 0.06 | 0.06 | table |
| Dragon Frontiers (ex15) | 2006/11/01 | hit | Rare Holo Star | 2 | 0.004 | 0.004 | era |
| Power Keepers (ex16) | 2007/02/02 | hit | Rare Holo EX | 8 | 0.06 | 0.06 | table |
| Power Keepers (ex16) | 2007/02/02 | hit | Rare Holo Star | 3 | 0.01 | 0.01 | table |
| Diamond & Pearl (dp1) | 2007/05/01 | hit | Rare Holo LV.X | 3 | 0.055 | 0.055 | era |
| Mysterious Treasures (dp2) | 2007/08/01 | hit | Rare Holo LV.X | 3 | 0.055 | 0.055 | era |
| Mysterious Treasures (dp2) | 2007/08/01 | hit | Rare Secret | 1 | 0.01 | 0.01 | era |
| Secret Wonders (dp3) | 2007/11/01 | hit | Rare Holo LV.X | 2 | 0.055 | 0.055 | era |
| Great Encounters (dp4) | 2008/02/01 | hit | Rare Holo LV.X | 4 | 0.055 | 0.055 | era |
| Majestic Dawn (dp5) | 2008/05/01 | hit | Rare Holo LV.X | 4 | 0.055 | 0.055 | era |
| Legends Awakened (dp6) | 2008/08/01 | hit | Rare Holo LV.X | 7 | 0.055 | 0.055 | era |
| Stormfront (dp7) | 2008/11/01 | hit | Rare Holo LV.X | 5 | 0.055 | 0.055 | era |
| Stormfront (dp7) | 2008/11/01 | hit | Rare Secret | 3 | 0.01 | 0.01 | era |
| Platinum (pl1) | 2009/02/11 | hit | Rare Holo LV.X | 6 | 0.055 | 0.055 | era |
| Platinum (pl1) | 2009/02/11 | hit | Rare Secret | 3 | 0.01 | 0.01 | era |
| Rising Rivals (pl2) | 2009/05/16 | hit | Rare Holo LV.X | 9 | 0.055 | 0.055 | era |
| Rising Rivals (pl2) | 2009/05/16 | hit | Rare Secret | 3 | 0.01 | 0.01 | era |
| Supreme Victors (pl3) | 2009/08/19 | hit | Rare Holo LV.X | 7 | 0.055 | 0.055 | era |
| Supreme Victors (pl3) | 2009/08/19 | hit | Rare Secret | 3 | 0.01 | 0.01 | era |
| Arceus (pl4) | 2009/11/04 | hit | Rare Holo LV.X | 6 | 0.055 | 0.055 | era |
| HeartGold & SoulSilver (hgss1) | 2010/02/10 | hit | Rare Prime | 6 | 0.055 | 0.055 | era |
| HeartGold & SoulSilver (hgss1) | 2010/02/10 | hit | LEGEND | 4 | 0.02 | 0.02 | era |
| HeartGold & SoulSilver (hgss1) | 2010/02/10 | hit | Rare Secret | 1 | 0.01 | 0.01 | era |
| HS—Unleashed (hgss2) | 2010/05/12 | hit | Rare Prime | 6 | 0.055 | 0.055 | era |
| HS—Unleashed (hgss2) | 2010/05/12 | hit | LEGEND | 6 | 0.02 | 0.02 | era |
| HS—Unleashed (hgss2) | 2010/05/12 | hit | Rare Secret | 1 | 0.01 | 0.01 | era |
| HS—Undaunted (hgss3) | 2010/08/18 | hit | Rare Prime | 6 | 0.055 | 0.055 | era |
| HS—Undaunted (hgss3) | 2010/08/18 | hit | LEGEND | 4 | 0.02 | 0.02 | era |
| HS—Undaunted (hgss3) | 2010/08/18 | hit | Rare Secret | 1 | 0.01 | 0.01 | era |
| HS—Triumphant (hgss4) | 2010/11/03 | hit | Rare Prime | 8 | 0.055 | 0.055 | era |
| HS—Triumphant (hgss4) | 2010/11/03 | hit | LEGEND | 4 | 0.02 | 0.02 | era |
| HS—Triumphant (hgss4) | 2010/11/03 | hit | Rare Secret | 1 | 0.01 | 0.01 | era |
| Black & White (bw1) | 2011/04/25 | hit | Rare Ultra | 2 | 0.03 | 0.03 | era |
| Black & White (bw1) | 2011/04/25 | hit | Rare Secret | 1 | 0.018 | 0.018 | era |
| Emerging Powers (bw2) | 2011/08/31 | hit | Rare Ultra | 2 | 0.03 | 0.03 | era |
| Noble Victories (bw3) | 2011/11/16 | hit | Rare Ultra | 5 | 0.03 | 0.03 | era |
| Noble Victories (bw3) | 2011/11/16 | hit | Rare Secret | 1 | 0.018 | 0.018 | era |
| Next Destinies (bw4) | 2012/02/08 | hit | Rare Holo EX | 6 | 0.055 | 0.055 | era |
| Next Destinies (bw4) | 2012/02/08 | hit | Rare Ultra | 6 | 0.03 | 0.03 | era |
| Next Destinies (bw4) | 2012/02/08 | hit | Rare Secret | 4 | 0.018 | 0.018 | era |
| Dark Explorers (bw5) | 2012/05/09 | hit | Rare Holo EX | 6 | 0.055 | 0.055 | era |
| Dark Explorers (bw5) | 2012/05/09 | hit | Rare Ultra | 6 | 0.03 | 0.03 | era |
| Dark Explorers (bw5) | 2012/05/09 | hit | Rare Secret | 3 | 0.018 | 0.018 | era |
| Dragons Exalted (bw6) | 2012/08/15 | hit | Rare Holo EX | 6 | 0.055 | 0.055 | era |
| Dragons Exalted (bw6) | 2012/08/15 | hit | Rare Ultra | 6 | 0.03 | 0.03 | era |
| Dragons Exalted (bw6) | 2012/08/15 | hit | Rare Secret | 4 | 0.018 | 0.018 | era |
| Boundaries Crossed (bw7) | 2012/11/07 | hit | Rare Holo EX | 6 | 0.055 | 0.055 | era |
| Boundaries Crossed (bw7) | 2012/11/07 | hit | Rare Ultra | 9 | 0.03 | 0.03 | era |
| Boundaries Crossed (bw7) | 2012/11/07 | hit | Rare ACE | 4 | 0.02 | 0.02 | table |
| Boundaries Crossed (bw7) | 2012/11/07 | hit | Rare Secret | 4 | 0.018 | 0.018 | era |
| Plasma Storm (bw8) | 2013/02/06 | hit | Rare Holo EX | 8 | 0.055 | 0.055 | era |
| Plasma Storm (bw8) | 2013/02/06 | hit | Rare Ultra | 5 | 0.03 | 0.03 | era |
| Plasma Storm (bw8) | 2013/02/06 | hit | Rare ACE | 3 | 0.02 | 0.02 | table |
| Plasma Storm (bw8) | 2013/02/06 | hit | Rare Secret | 3 | 0.018 | 0.018 | era |
| Plasma Freeze (bw9) | 2013/05/08 | hit | Rare Holo EX | 6 | 0.055 | 0.055 | era |
| Plasma Freeze (bw9) | 2013/05/08 | hit | Rare Ultra | 8 | 0.03 | 0.03 | era |
| Plasma Freeze (bw9) | 2013/05/08 | hit | Rare ACE | 2 | 0.02 | 0.02 | table |
| Plasma Freeze (bw9) | 2013/05/08 | hit | Rare Secret | 6 | 0.018 | 0.018 | era |
| Plasma Blast (bw10) | 2013/08/14 | hit | Rare Holo EX | 6 | 0.055 | 0.055 | era |
| Plasma Blast (bw10) | 2013/08/14 | hit | Rare Ultra | 6 | 0.03 | 0.03 | era |
| Plasma Blast (bw10) | 2013/08/14 | hit | Rare ACE | 4 | 0.02 | 0.02 | table |
| Plasma Blast (bw10) | 2013/08/14 | hit | Rare Secret | 4 | 0.018 | 0.018 | era |
| Legendary Treasures (bw11) | 2013/11/06 | hit | Rare Holo EX | 12 | 0.055 | 0.055 | era |
| Legendary Treasures (bw11) | 2013/11/06 | hit | Rare Ultra | 5 | 0.03 | 0.03 | era |
| Legendary Treasures (bw11) | 2013/11/06 | hit | Rare Secret | 2 | 0.018 | 0.018 | era |
| XY (xy1) | 2014/02/05 | hit | Rare Holo EX | 8 | 0.055 | 0.055 | era |
| XY (xy1) | 2014/02/05 | hit | Rare Ultra | 6 | 0.03 | 0.03 | era |
| Flashfire (xy2) | 2014/05/07 | hit | Rare Holo EX | 8 | 0.055 | 0.055 | era |
| Flashfire (xy2) | 2014/05/07 | hit | Rare Ultra | 8 | 0.03 | 0.03 | era |
| Flashfire (xy2) | 2014/05/07 | hit | Rare Secret | 3 | 0.018 | 0.018 | era |
| Furious Fists (xy3) | 2014/08/13 | hit | Rare Holo EX | 7 | 0.055 | 0.055 | era |
| Furious Fists (xy3) | 2014/08/13 | hit | Rare Ultra | 8 | 0.03 | 0.03 | era |
| Furious Fists (xy3) | 2014/08/13 | hit | Rare Secret | 2 | 0.018 | 0.018 | era |
| Phantom Forces (xy4) | 2014/11/05 | hit | Rare Holo EX | 8 | 0.055 | 0.055 | era |
| Phantom Forces (xy4) | 2014/11/05 | hit | Rare Ultra | 9 | 0.03 | 0.03 | era |
| Phantom Forces (xy4) | 2014/11/05 | hit | Rare Secret | 3 | 0.018 | 0.018 | era |
| Primal Clash (xy5) | 2015/02/04 | hit | Rare Holo EX | 12 | 0.055 | 0.055 | era |
| Primal Clash (xy5) | 2015/02/04 | hit | Rare Ultra | 16 | 0.03 | 0.03 | era |
| Primal Clash (xy5) | 2015/02/04 | hit | Rare Secret | 4 | 0.018 | 0.018 | era |
| Double Crisis (dc1) | 2015/03/25 | hit | Rare Ultra | 2 | 0.03 | 0.03 | era |
| Roaring Skies (xy6) | 2015/05/06 | hit | Rare Holo EX | 11 | 0.055 | 0.055 | era |
| Roaring Skies (xy6) | 2015/05/06 | hit | Rare Ultra | 12 | 0.03 | 0.03 | era |
| Roaring Skies (xy6) | 2015/05/06 | hit | Rare Secret | 2 | 0.018 | 0.018 | era |
| Ancient Origins (xy7) | 2015/08/12 | hit | Rare Holo EX | 11 | 0.055 | 0.055 | era |
| Ancient Origins (xy7) | 2015/08/12 | hit | Rare Ultra | 13 | 0.03 | 0.03 | era |
| Ancient Origins (xy7) | 2015/08/12 | hit | Rare Secret | 5 | 0.018 | 0.018 | era |
| BREAKthrough (xy8) | 2015/11/04 | hit | Rare Holo EX | 8 | 0.055 | 0.055 | era |
| BREAKthrough (xy8) | 2015/11/04 | hit | Rare BREAK | 6 | 0.03 | 0.03 | table |
| BREAKthrough (xy8) | 2015/11/04 | hit | Rare Ultra | 10 | 0.03 | 0.03 | era |
| BREAKthrough (xy8) | 2015/11/04 | hit | Rare Secret | 2 | 0.018 | 0.018 | era |
| BREAKpoint (xy9) | 2016/02/03 | hit | Rare Holo EX | 11 | 0.055 | 0.055 | era |
| BREAKpoint (xy9) | 2016/02/03 | hit | Rare BREAK | 5 | 0.03 | 0.03 | table |
| BREAKpoint (xy9) | 2016/02/03 | hit | Rare Ultra | 10 | 0.03 | 0.03 | era |
| BREAKpoint (xy9) | 2016/02/03 | hit | Rare Secret | 1 | 0.018 | 0.018 | era |
| Generations (g1) | 2016/02/22 | hit | Rare Holo EX | 14 | 0.055 | 0.055 | era |
| Generations (g1) | 2016/02/22 | hit | Rare Ultra | 7 | 0.03 | 0.03 | era |
| Fates Collide (xy10) | 2016/05/02 | hit | Rare Holo EX | 13 | 0.055 | 0.055 | era |
| Fates Collide (xy10) | 2016/05/02 | hit | Rare BREAK | 5 | 0.03 | 0.03 | table |
| Fates Collide (xy10) | 2016/05/02 | hit | Rare Ultra | 13 | 0.03 | 0.03 | era |
| Fates Collide (xy10) | 2016/05/02 | hit | Rare Secret | 1 | 0.018 | 0.018 | era |
| Steam Siege (xy11) | 2016/08/03 | hit | Rare Holo EX | 6 | 0.055 | 0.055 | era |
| Steam Siege (xy11) | 2016/08/03 | hit | Rare BREAK | 7 | 0.03 | 0.03 | table |
| Steam Siege (xy11) | 2016/08/03 | hit | Rare Ultra | 8 | 0.03 | 0.03 | era |
| Steam Siege (xy11) | 2016/08/03 | hit | Rare Secret | 2 | 0.018 | 0.018 | era |
| Evolutions (xy12) | 2016/11/02 | hit | Rare Holo EX | 12 | 0.055 | 0.055 | era |
| Evolutions (xy12) | 2016/11/02 | hit | Rare BREAK | 4 | 0.03 | 0.03 | table |
| Evolutions (xy12) | 2016/11/02 | hit | Rare Ultra | 9 | 0.03 | 0.03 | era |
| Evolutions (xy12) | 2016/11/02 | hit | Rare Secret | 5 | 0.018 | 0.018 | era |
| Sun & Moon (sm1) | 2017/02/03 | hit | Rare Holo GX | 11 | 0.111 | 0.111 | era |
| Sun & Moon (sm1) | 2017/02/03 | hit | Rare Ultra | 12 | 0.042 | 0.042 | era |
| Sun & Moon (sm1) | 2017/02/03 | hit | Rare Rainbow | 8 | 0.015 | 0.015 | era |
| Sun & Moon (sm1) | 2017/02/03 | hit | Rare Secret | 6 | 0.008 | 0.008 | era |
| Guardians Rising (sm2) | 2017/05/05 | hit | Rare Holo GX | 14 | 0.111 | 0.111 | era |
| Guardians Rising (sm2) | 2017/05/05 | hit | Rare Ultra | 16 | 0.042 | 0.042 | era |
| Guardians Rising (sm2) | 2017/05/05 | hit | Rare Rainbow | 15 | 0.015 | 0.015 | era |
| Guardians Rising (sm2) | 2017/05/05 | hit | Rare Secret | 9 | 0.008 | 0.008 | era |
| Burning Shadows (sm3) | 2017/08/05 | hit | Rare Holo GX | 14 | 0.111 | 0.111 | era |
| Burning Shadows (sm3) | 2017/08/05 | hit | Rare Ultra | 19 | 0.042 | 0.042 | era |
| Burning Shadows (sm3) | 2017/08/05 | hit | Rare Rainbow | 13 | 0.015 | 0.015 | era |
| Burning Shadows (sm3) | 2017/08/05 | hit | Rare Secret | 9 | 0.008 | 0.008 | era |
| Shining Legends (sm35) | 2017/10/06 | hit | Rare Holo GX | 5 | 0.111 | 0.111 | era |
| Shining Legends (sm35) | 2017/10/06 | hit | Rare Ultra | 4 | 0.042 | 0.042 | era |
| Shining Legends (sm35) | 2017/10/06 | hit | Rare Shining | 6 | 0.03 | 0.03 | table |
| Shining Legends (sm35) | 2017/10/06 | hit | Rare Rainbow | 4 | 0.015 | 0.015 | era |
| Shining Legends (sm35) | 2017/10/06 | hit | Rare Secret | 1 | 0.008 | 0.008 | era |
| Crimson Invasion (sm4) | 2017/11/03 | hit | Rare Holo GX | 9 | 0.111 | 0.111 | era |
| Crimson Invasion (sm4) | 2017/11/03 | hit | Rare Ultra | 11 | 0.042 | 0.042 | era |
| Crimson Invasion (sm4) | 2017/11/03 | hit | Rare Rainbow | 8 | 0.015 | 0.015 | era |
| Crimson Invasion (sm4) | 2017/11/03 | hit | Rare Secret | 5 | 0.008 | 0.008 | era |
| Ultra Prism (sm5) | 2018/02/02 | hit | Rare Holo GX | 7 | 0.111 | 0.111 | era |
| Ultra Prism (sm5) | 2018/02/02 | hit | Rare Prism Star | 6 | 0.07 | 0.07 | era |
| Ultra Prism (sm5) | 2018/02/02 | hit | Rare Ultra | 19 | 0.042 | 0.042 | era |
| Ultra Prism (sm5) | 2018/02/02 | hit | Rare Rainbow | 9 | 0.015 | 0.015 | era |
| Ultra Prism (sm5) | 2018/02/02 | hit | Rare Secret | 8 | 0.008 | 0.008 | era |
| Forbidden Light (sm6) | 2018/05/04 | hit | Rare Holo GX | 8 | 0.111 | 0.111 | era |
| Forbidden Light (sm6) | 2018/05/04 | hit | Rare Prism Star | 5 | 0.07 | 0.07 | era |
| Forbidden Light (sm6) | 2018/05/04 | hit | Rare Ultra | 13 | 0.042 | 0.042 | era |
| Forbidden Light (sm6) | 2018/05/04 | hit | Rare Rainbow | 9 | 0.015 | 0.015 | era |
| Forbidden Light (sm6) | 2018/05/04 | hit | Rare Secret | 6 | 0.008 | 0.008 | era |
| Celestial Storm (sm7) | 2018/08/03 | hit | Rare Holo GX | 11 | 0.111 | 0.111 | era |
| Celestial Storm (sm7) | 2018/08/03 | hit | Rare Prism Star | 3 | 0.07 | 0.07 | era |
| Celestial Storm (sm7) | 2018/08/03 | hit | Rare Ultra | 18 | 0.042 | 0.042 | era |
| Celestial Storm (sm7) | 2018/08/03 | hit | Rare Rainbow | 9 | 0.015 | 0.015 | era |
| Celestial Storm (sm7) | 2018/08/03 | hit | Rare Secret | 6 | 0.008 | 0.008 | era |
| Dragon Majesty (sm75) | 2018/09/07 | hit | Rare Holo GX | 6 | 0.111 | 0.111 | era |
| Dragon Majesty (sm75) | 2018/09/07 | hit | Rare Prism Star | 2 | 0.07 | 0.07 | era |
| Dragon Majesty (sm75) | 2018/09/07 | hit | Rare Ultra | 6 | 0.042 | 0.042 | era |
| Dragon Majesty (sm75) | 2018/09/07 | hit | Rare Rainbow | 4 | 0.015 | 0.015 | era |
| Dragon Majesty (sm75) | 2018/09/07 | hit | Rare Secret | 4 | 0.008 | 0.008 | era |
| Lost Thunder (sm8) | 2018/11/02 | hit | Rare Holo GX | 13 | 0.111 | 0.111 | era |
| Lost Thunder (sm8) | 2018/11/02 | hit | Rare Prism Star | 7 | 0.07 | 0.07 | era |
| Lost Thunder (sm8) | 2018/11/02 | hit | Rare Ultra | 20 | 0.042 | 0.042 | era |
| Lost Thunder (sm8) | 2018/11/02 | hit | Rare Rainbow | 13 | 0.015 | 0.015 | era |
| Lost Thunder (sm8) | 2018/11/02 | hit | Rare Secret | 9 | 0.008 | 0.008 | era |
| Team Up (sm9) | 2019/02/01 | hit | Rare Holo GX | 11 | 0.111 | 0.111 | era |
| Team Up (sm9) | 2019/02/01 | hit | Rare Prism Star | 4 | 0.07 | 0.07 | era |
| Team Up (sm9) | 2019/02/01 | hit | Rare Ultra | 23 | 0.042 | 0.042 | era |
| Team Up (sm9) | 2019/02/01 | hit | Rare Rainbow | 10 | 0.015 | 0.015 | era |
| Team Up (sm9) | 2019/02/01 | hit | Rare Secret | 5 | 0.008 | 0.008 | era |
| Detective Pikachu (det1) | 2019/04/05 | hit | Rare Ultra | 4 | 0.042 | 0.042 | era |
| Unbroken Bonds (sm10) | 2019/05/03 | hit | Rare Holo GX | 14 | 0.111 | 0.111 | era |
| Unbroken Bonds (sm10) | 2019/05/03 | hit | Rare Ultra | 25 | 0.042 | 0.042 | era |
| Unbroken Bonds (sm10) | 2019/05/03 | hit | Rare Rainbow | 14 | 0.015 | 0.015 | era |
| Unbroken Bonds (sm10) | 2019/05/03 | hit | Rare Secret | 6 | 0.008 | 0.008 | era |
| Unified Minds (sm11) | 2019/08/02 | hit | Rare Holo GX | 17 | 0.111 | 0.111 | era |
| Unified Minds (sm11) | 2019/08/02 | hit | Rare Ultra | 24 | 0.042 | 0.042 | era |
| Unified Minds (sm11) | 2019/08/02 | hit | Rare Rainbow | 13 | 0.015 | 0.015 | era |
| Unified Minds (sm11) | 2019/08/02 | hit | Rare Secret | 9 | 0.008 | 0.008 | era |
| Hidden Fates (sm115) | 2019/08/23 | hit | Rare Holo GX | 9 | 0.111 | 0.111 | era |
| Hidden Fates (sm115) | 2019/08/23 | hit | Rare Ultra | 3 | 0.042 | 0.042 | era |
| Hidden Fates (sm115) | 2019/08/23 | hit | Rare Rainbow | 1 | 0.015 | 0.015 | era |
| Cosmic Eclipse (sm12) | 2019/11/01 | hit | Rare Holo GX | 16 | 0.111 | 0.111 | era |
| Cosmic Eclipse (sm12) | 2019/11/01 | hit | Rare Ultra | 28 | 0.042 | 0.042 | era |
| Cosmic Eclipse (sm12) | 2019/11/01 | hit | Rare Rainbow | 14 | 0.015 | 0.015 | era |
| Cosmic Eclipse (sm12) | 2019/11/01 | hit | Rare Secret | 21 | 0.008 | 0.008 | era |
| Sword & Shield (swsh1) | 2020/02/07 | hit | Rare Holo V | 17 | 0.19 | 0.19 | era |
| Sword & Shield (swsh1) | 2020/02/07 | hit | Rare Holo VMAX | 4 | 0.055 | 0.055 | era |
| Sword & Shield (swsh1) | 2020/02/07 | hit | Rare Ultra | 16 | 0.03 | 0.03 | era |
| Sword & Shield (swsh1) | 2020/02/07 | hit | Rare Rainbow | 8 | 0.012 | 0.012 | era |
| Sword & Shield (swsh1) | 2020/02/07 | hit | Rare Secret | 6 | 0.009 | 0.009 | era |
| Rebel Clash (swsh2) | 2020/05/01 | hit | Rare Holo V | 16 | 0.19 | 0.19 | era |
| Rebel Clash (swsh2) | 2020/05/01 | hit | Rare Holo VMAX | 7 | 0.055 | 0.055 | era |
| Rebel Clash (swsh2) | 2020/05/01 | hit | Rare Ultra | 18 | 0.03 | 0.03 | era |
| Rebel Clash (swsh2) | 2020/05/01 | hit | Rare Rainbow | 11 | 0.012 | 0.012 | era |
| Rebel Clash (swsh2) | 2020/05/01 | hit | Rare Secret | 6 | 0.009 | 0.009 | era |
| Darkness Ablaze (swsh3) | 2020/08/14 | hit | Rare Holo V | 14 | 0.19 | 0.19 | era |
| Darkness Ablaze (swsh3) | 2020/08/14 | hit | Rare Holo VMAX | 7 | 0.055 | 0.055 | era |
| Darkness Ablaze (swsh3) | 2020/08/14 | hit | Rare Ultra | 13 | 0.03 | 0.03 | era |
| Darkness Ablaze (swsh3) | 2020/08/14 | hit | Rare Rainbow | 7 | 0.012 | 0.012 | era |
| Darkness Ablaze (swsh3) | 2020/08/14 | hit | Rare Secret | 5 | 0.009 | 0.009 | era |
| Champion's Path (swsh35) | 2020/09/25 | hit | Rare Holo V | 11 | 0.19 | 0.19 | era |
| Champion's Path (swsh35) | 2020/09/25 | hit | Rare Holo VMAX | 3 | 0.055 | 0.055 | era |
| Champion's Path (swsh35) | 2020/09/25 | hit | Rare Ultra | 5 | 0.03 | 0.03 | era |
| Champion's Path (swsh35) | 2020/09/25 | hit | Rare Rainbow | 5 | 0.012 | 0.012 | era |
| Champion's Path (swsh35) | 2020/09/25 | hit | Rare Secret | 2 | 0.009 | 0.009 | era |
| Vivid Voltage (swsh4) | 2020/11/13 | hit | Rare Holo V | 11 | 0.19 | 0.19 | era |
| Vivid Voltage (swsh4) | 2020/11/13 | hit | Rare Holo VMAX | 6 | 0.055 | 0.055 | era |
| Vivid Voltage (swsh4) | 2020/11/13 | hit | Amazing Rare | 6 | 0.05 | 0.05 | table |
| Vivid Voltage (swsh4) | 2020/11/13 | hit | Rare Ultra | 20 | 0.03 | 0.03 | era |
| Vivid Voltage (swsh4) | 2020/11/13 | hit | Rare Rainbow | 12 | 0.012 | 0.012 | era |
| Vivid Voltage (swsh4) | 2020/11/13 | hit | Rare Secret | 6 | 0.009 | 0.009 | era |
| Shining Fates (swsh45) | 2021/02/19 | hit | Rare Holo V | 8 | 0.19 | 0.19 | era |
| Shining Fates (swsh45) | 2021/02/19 | hit | Rare Holo VMAX | 6 | 0.055 | 0.055 | era |
| Shining Fates (swsh45) | 2021/02/19 | hit | Amazing Rare | 3 | 0.05 | 0.05 | table |
| Shining Fates (swsh45) | 2021/02/19 | hit | Rare Ultra | 9 | 0.03 | 0.03 | era |
| Shining Fates (swsh45) | 2021/02/19 | hit | Rare Rainbow | 1 | 0.012 | 0.012 | era |
| Battle Styles (swsh5) | 2021/03/19 | hit | Rare Holo V | 12 | 0.19 | 0.19 | era |
| Battle Styles (swsh5) | 2021/03/19 | hit | Rare Holo VMAX | 6 | 0.055 | 0.055 | era |
| Battle Styles (swsh5) | 2021/03/19 | hit | Rare Ultra | 22 | 0.03 | 0.03 | era |
| Battle Styles (swsh5) | 2021/03/19 | hit | Rare Rainbow | 14 | 0.012 | 0.012 | era |
| Battle Styles (swsh5) | 2021/03/19 | hit | Rare Secret | 6 | 0.009 | 0.009 | era |
| Chilling Reign (swsh6) | 2021/06/18 | hit | Rare Holo V | 15 | 0.19 | 0.19 | era |
| Chilling Reign (swsh6) | 2021/06/18 | hit | Rare Holo VMAX | 8 | 0.055 | 0.055 | era |
| Chilling Reign (swsh6) | 2021/06/18 | hit | Rare Ultra | 39 | 0.03 | 0.03 | era |
| Chilling Reign (swsh6) | 2021/06/18 | hit | Rare Rainbow | 23 | 0.012 | 0.012 | era |
| Chilling Reign (swsh6) | 2021/06/18 | hit | Rare Secret | 12 | 0.009 | 0.009 | era |
| Evolving Skies (swsh7) | 2021/08/27 | hit | Rare Holo V | 18 | 0.19 | 0.19 | era |
| Evolving Skies (swsh7) | 2021/08/27 | hit | Rare Holo VMAX | 15 | 0.055 | 0.055 | era |
| Evolving Skies (swsh7) | 2021/08/27 | hit | Rare Ultra | 38 | 0.03 | 0.03 | era |
| Evolving Skies (swsh7) | 2021/08/27 | hit | Rare Rainbow | 22 | 0.012 | 0.012 | era |
| Evolving Skies (swsh7) | 2021/08/27 | hit | Rare Secret | 12 | 0.009 | 0.009 | era |
| Celebrations (cel25) | 2021/10/08 | hit | Rare Holo V | 4 | 0.19 | 0.19 | era |
| Celebrations (cel25) | 2021/10/08 | hit | Rare Holo VMAX | 2 | 0.055 | 0.055 | era |
| Celebrations (cel25) | 2021/10/08 | hit | Rare Ultra | 1 | 0.03 | 0.03 | era |
| Fusion Strike (swsh8) | 2021/11/12 | hit | Rare Holo V | 19 | 0.19 | 0.19 | era |
| Fusion Strike (swsh8) | 2021/11/12 | hit | Rare Holo VMAX | 8 | 0.055 | 0.055 | era |
| Fusion Strike (swsh8) | 2021/11/12 | hit | Rare Ultra | 20 | 0.03 | 0.03 | era |
| Fusion Strike (swsh8) | 2021/11/12 | hit | Rare Rainbow | 15 | 0.012 | 0.012 | era |
| Fusion Strike (swsh8) | 2021/11/12 | hit | Rare Secret | 5 | 0.009 | 0.009 | era |
| Brilliant Stars (swsh9) | 2022/02/25 | hit | Rare Holo V | 20 | 0.19 | 0.19 | era |
| Brilliant Stars (swsh9) | 2022/02/25 | hit | Rare Holo VMAX | 3 | 0.055 | 0.055 | era |
| Brilliant Stars (swsh9) | 2022/02/25 | hit | Rare Holo VSTAR | 4 | 0.03 | 0.03 | era |
| Brilliant Stars (swsh9) | 2022/02/25 | hit | Rare Ultra | 21 | 0.03 | 0.03 | era |
| Brilliant Stars (swsh9) | 2022/02/25 | hit | Rare Rainbow | 8 | 0.012 | 0.012 | era |
| Brilliant Stars (swsh9) | 2022/02/25 | hit | Rare Secret | 6 | 0.009 | 0.009 | era |
| Astral Radiance (swsh10) | 2022/05/27 | hit | Rare Holo V | 19 | 0.19 | 0.19 | era |
| Astral Radiance (swsh10) | 2022/05/27 | hit | Rare Holo VMAX | 2 | 0.055 | 0.055 | era |
| Astral Radiance (swsh10) | 2022/05/27 | hit | Radiant Rare | 3 | 0.05 | 0.05 | table |
| Astral Radiance (swsh10) | 2022/05/27 | hit | Rare Holo VSTAR | 7 | 0.03 | 0.03 | era |
| Astral Radiance (swsh10) | 2022/05/27 | hit | Rare Ultra | 30 | 0.03 | 0.03 | era |
| Astral Radiance (swsh10) | 2022/05/27 | hit | Rare Rainbow | 18 | 0.012 | 0.012 | era |
| Astral Radiance (swsh10) | 2022/05/27 | hit | Rare Secret | 9 | 0.009 | 0.009 | era |
| Pokémon GO (pgo) | 2022/07/01 | hit | Rare Holo V | 6 | 0.19 | 0.19 | era |
| Pokémon GO (pgo) | 2022/07/01 | hit | Rare Holo VMAX | 1 | 0.055 | 0.055 | era |
| Pokémon GO (pgo) | 2022/07/01 | hit | Radiant Rare | 3 | 0.05 | 0.05 | table |
| Pokémon GO (pgo) | 2022/07/01 | hit | Rare Holo VSTAR | 2 | 0.03 | 0.03 | era |
| Pokémon GO (pgo) | 2022/07/01 | hit | Rare Ultra | 8 | 0.03 | 0.03 | era |
| Pokémon GO (pgo) | 2022/07/01 | hit | Rare Rainbow | 7 | 0.012 | 0.012 | era |
| Pokémon GO (pgo) | 2022/07/01 | hit | Rare Secret | 3 | 0.009 | 0.009 | era |
| Lost Origin (swsh11) | 2022/09/09 | hit | Rare Holo V | 12 | 0.19 | 0.19 | era |
| Lost Origin (swsh11) | 2022/09/09 | hit | Rare Holo VMAX | 1 | 0.055 | 0.055 | era |
| Lost Origin (swsh11) | 2022/09/09 | hit | Radiant Rare | 3 | 0.05 | 0.05 | table |
| Lost Origin (swsh11) | 2022/09/09 | hit | Rare Holo VSTAR | 6 | 0.03 | 0.03 | era |
| Lost Origin (swsh11) | 2022/09/09 | hit | Rare Ultra | 25 | 0.03 | 0.03 | era |
| Lost Origin (swsh11) | 2022/09/09 | hit | Rare Rainbow | 15 | 0.012 | 0.012 | era |
| Lost Origin (swsh11) | 2022/09/09 | hit | Rare Secret | 6 | 0.009 | 0.009 | era |
| Silver Tempest (swsh12) | 2022/11/11 | hit | Rare Holo V | 15 | 0.19 | 0.19 | era |
| Silver Tempest (swsh12) | 2022/11/11 | hit | Rare Holo VMAX | 1 | 0.055 | 0.055 | era |
| Silver Tempest (swsh12) | 2022/11/11 | hit | Radiant Rare | 3 | 0.05 | 0.05 | table |
| Silver Tempest (swsh12) | 2022/11/11 | hit | Rare Holo VSTAR | 6 | 0.03 | 0.03 | era |
| Silver Tempest (swsh12) | 2022/11/11 | hit | Rare Ultra | 26 | 0.03 | 0.03 | era |
| Silver Tempest (swsh12) | 2022/11/11 | hit | Rare Rainbow | 14 | 0.012 | 0.012 | era |
| Silver Tempest (swsh12) | 2022/11/11 | hit | Rare Secret | 6 | 0.009 | 0.009 | era |
| Crown Zenith (swsh12pt5) | 2023/01/20 | hit | Rare Holo V | 17 | 0.06 | 0.06 | table |
| Crown Zenith (swsh12pt5) | 2023/01/20 | hit | Radiant Rare | 3 | 0.05 | 0.05 | table |
| Crown Zenith (swsh12pt5) | 2023/01/20 | hit | Rare Ultra | 13 | 0.05 | 0.05 | table |
| Crown Zenith (swsh12pt5) | 2023/01/20 | hit | Rare Holo VMAX | 5 | 0.03 | 0.03 | table |
| Crown Zenith (swsh12pt5) | 2023/01/20 | hit | Rare Holo VSTAR | 8 | 0.03 | 0.03 | table |
| Crown Zenith (swsh12pt5) | 2023/01/20 | hit | Rare Secret | 1 | 0.0075 | 0.0075 | set |
| Scarlet & Violet (sv1) | 2023/03/31 | hit | Double Rare | 12 | 0.2 | 0.2 | era |
| Scarlet & Violet (sv1) | 2023/03/31 | hit | Ultra Rare | 20 | 0.11 | 0.11 | era |
| Scarlet & Violet (sv1) | 2023/03/31 | hit | Hyper Rare | 6 | 0.011 | 0.011 | era |
| Scarlet & Violet (sv1) | 2023/03/31 | reverse2hit | Illustration Rare | 24 | 0.09 | 0.09 | set |
| Scarlet & Violet (sv1) | 2023/03/31 | reverse2hit | Special Illustration Rare | 10 | 0.028 | 0.028 | set |
| Paldea Evolved (sv2) | 2023/06/09 | hit | Double Rare | 17 | 0.2 | 0.2 | era |
| Paldea Evolved (sv2) | 2023/06/09 | hit | Ultra Rare | 16 | 0.11 | 0.11 | era |
| Paldea Evolved (sv2) | 2023/06/09 | reverse2hit | Illustration Rare | 34 | 0.09 | 0.09 | set |
| Paldea Evolved (sv2) | 2023/06/09 | reverse2hit | Special Illustration Rare | 7 | 0.028 | 0.028 | set |
| Obsidian Flames (sv3) | 2023/08/11 | hit | Double Rare | 21 | 0.2 | 0.2 | era |
| Obsidian Flames (sv3) | 2023/08/11 | hit | Ultra Rare | 12 | 0.11 | 0.11 | era |
| Obsidian Flames (sv3) | 2023/08/11 | hit | Hyper Rare | 3 | 0.011 | 0.011 | era |
| Obsidian Flames (sv3) | 2023/08/11 | reverse2hit | Illustration Rare | 12 | 0.09 | 0.09 | set |
| Obsidian Flames (sv3) | 2023/08/11 | reverse2hit | Special Illustration Rare | 6 | 0.028 | 0.028 | set |
| 151 (sv3pt5) | 2023/09/22 | hit | Double Rare | 12 | 0.2 | 0.2 | era |
| 151 (sv3pt5) | 2023/09/22 | hit | Ultra Rare | 16 | 0.11 | 0.11 | era |
| 151 (sv3pt5) | 2023/09/22 | hit | Hyper Rare | 3 | 0.011 | 0.011 | era |
| 151 (sv3pt5) | 2023/09/22 | reverse2hit | Illustration Rare | 16 | 0.09 | 0.09 | set |
| 151 (sv3pt5) | 2023/09/22 | reverse2hit | Special Illustration Rare | 7 | 0.0313 | 0.0313 | set |
| Paradox Rift (sv4) | 2023/11/03 | hit | Double Rare | 20 | 0.2 | 0.2 | era |
| Paradox Rift (sv4) | 2023/11/03 | hit | Ultra Rare | 28 | 0.11 | 0.11 | era |
| Paradox Rift (sv4) | 2023/11/03 | hit | Hyper Rare | 7 | 0.011 | 0.011 | era |
| Paradox Rift (sv4) | 2023/11/03 | reverse2hit | Illustration Rare | 34 | 0.09 | 0.09 | set |
| Paradox Rift (sv4) | 2023/11/03 | reverse2hit | Special Illustration Rare | 15 | 0.028 | 0.028 | set |
| Paldean Fates (sv4pt5) | 2024/01/26 | hit | Shiny Rare | 120 | 0.2544 | 0.2544 | set |
| Paldean Fates (sv4pt5) | 2024/01/26 | hit | Double Rare | 10 | 0.1589 | 0.1589 | set |
| Paldean Fates (sv4pt5) | 2024/01/26 | hit | Shiny Ultra Rare | 12 | 0.0772 | 0.0772 | set |
| Paldean Fates (sv4pt5) | 2024/01/26 | hit | Ultra Rare | 5 | 0.0661 | 0.0661 | set |
| Paldean Fates (sv4pt5) | 2024/01/26 | hit | Hyper Rare | 6 | 0.0161 | 0.0161 | set |
| Paldean Fates (sv4pt5) | 2024/01/26 | reverse2hit | Illustration Rare | 3 | 0.0722 | 0.0722 | set |
| Paldean Fates (sv4pt5) | 2024/01/26 | reverse2hit | Special Illustration Rare | 8 | 0.025 | 0.025 | set |
| Temporal Forces (sv5) | 2024/03/22 | hit | Double Rare | 15 | 0.2 | 0.2 | era |
| Temporal Forces (sv5) | 2024/03/22 | hit | Ultra Rare | 18 | 0.11 | 0.11 | era |
| Temporal Forces (sv5) | 2024/03/22 | hit | ACE SPEC Rare | 7 | 0.05 | 0.05 | era |
| Temporal Forces (sv5) | 2024/03/22 | hit | Hyper Rare | 6 | 0.011 | 0.011 | era |
| Temporal Forces (sv5) | 2024/03/22 | reverse2hit | Illustration Rare | 22 | 0.09 | 0.09 | set |
| Temporal Forces (sv5) | 2024/03/22 | reverse2hit | Special Illustration Rare | 10 | 0.028 | 0.028 | set |
| Twilight Masquerade (sv6) | 2024/05/24 | hit | Double Rare | 14 | 0.2 | 0.2 | era |
| Twilight Masquerade (sv6) | 2024/05/24 | hit | Ultra Rare | 21 | 0.11 | 0.11 | era |
| Twilight Masquerade (sv6) | 2024/05/24 | hit | ACE SPEC Rare | 6 | 0.05 | 0.05 | era |
| Twilight Masquerade (sv6) | 2024/05/24 | hit | Hyper Rare | 6 | 0.011 | 0.011 | era |
| Twilight Masquerade (sv6) | 2024/05/24 | reverse2hit | Illustration Rare | 21 | 0.09 | 0.09 | set |
| Twilight Masquerade (sv6) | 2024/05/24 | reverse2hit | Special Illustration Rare | 11 | 0.028 | 0.028 | set |
| Shrouded Fable (sv6pt5) | 2024/08/02 | hit | Double Rare | 6 | 0.2 | 0.2 | era |
| Shrouded Fable (sv6pt5) | 2024/08/02 | hit | Ultra Rare | 10 | 0.11 | 0.11 | era |
| Shrouded Fable (sv6pt5) | 2024/08/02 | hit | ACE SPEC Rare | 3 | 0.05 | 0.05 | era |
| Shrouded Fable (sv6pt5) | 2024/08/02 | hit | Hyper Rare | 5 | 0.011 | 0.011 | era |
| Shrouded Fable (sv6pt5) | 2024/08/02 | reverse2hit | Illustration Rare | 15 | 0.09 | 0.09 | set |
| Shrouded Fable (sv6pt5) | 2024/08/02 | reverse2hit | Special Illustration Rare | 5 | 0.028 | 0.028 | set |
| Stellar Crown (sv7) | 2024/09/13 | hit | Double Rare | 14 | 0.2 | 0.2 | era |
| Stellar Crown (sv7) | 2024/09/13 | hit | Ultra Rare | 11 | 0.11 | 0.11 | era |
| Stellar Crown (sv7) | 2024/09/13 | hit | ACE SPEC Rare | 3 | 0.05 | 0.05 | era |
| Stellar Crown (sv7) | 2024/09/13 | hit | Hyper Rare | 3 | 0.011 | 0.011 | era |
| Stellar Crown (sv7) | 2024/09/13 | reverse2hit | Illustration Rare | 13 | 0.09 | 0.09 | set |
| Stellar Crown (sv7) | 2024/09/13 | reverse2hit | Special Illustration Rare | 6 | 0.028 | 0.028 | set |
| Surging Sparks (sv8) | 2024/11/08 | hit | Double Rare | 18 | 0.2 | 0.2 | era |
| Surging Sparks (sv8) | 2024/11/08 | hit | Ultra Rare | 21 | 0.11 | 0.11 | era |
| Surging Sparks (sv8) | 2024/11/08 | hit | ACE SPEC Rare | 8 | 0.05 | 0.05 | era |
| Surging Sparks (sv8) | 2024/11/08 | hit | Hyper Rare | 6 | 0.011 | 0.011 | era |
| Surging Sparks (sv8) | 2024/11/08 | reverse2hit | Illustration Rare | 23 | 0.09 | 0.09 | set |
| Surging Sparks (sv8) | 2024/11/08 | reverse2hit | Special Illustration Rare | 11 | 0.0118 | 0.0118 | set |
| Prismatic Evolutions (sv8pt5) | 2025/01/17 | hit | Double Rare | 25 | 0.1651 | 0.1651 | set |
| Prismatic Evolutions (sv8pt5) | 2025/01/17 | hit | Ultra Rare | 12 | 0.0746 | 0.0746 | set |
| Prismatic Evolutions (sv8pt5) | 2025/01/17 | hit | ACE SPEC Rare | 6 | 0.0468 | 0.0468 | set |
| Prismatic Evolutions (sv8pt5) | 2025/01/17 | hit | Hyper Rare | 5 | 0.0056 | 0.0056 | set |
| Prismatic Evolutions (sv8pt5) | 2025/01/17 | reverse2hit | Special Illustration Rare | 32 | 0.0222 | 0.0222 | set |
| Journey Together (sv9) | 2025/03/28 | hit | Double Rare | 16 | 0.2 | 0.2 | era |
| Journey Together (sv9) | 2025/03/28 | hit | Ultra Rare | 11 | 0.11 | 0.11 | era |
| Journey Together (sv9) | 2025/03/28 | hit | Hyper Rare | 3 | 0.011 | 0.011 | era |
| Journey Together (sv9) | 2025/03/28 | reverse2hit | Illustration Rare | 11 | 0.09 | 0.09 | set |
| Journey Together (sv9) | 2025/03/28 | reverse2hit | Special Illustration Rare | 6 | 0.028 | 0.028 | set |
| Destined Rivals (sv10) | 2025/05/30 | hit | Double Rare | 17 | 0.2 | 0.2 | era |
| Destined Rivals (sv10) | 2025/05/30 | hit | Ultra Rare | 22 | 0.11 | 0.11 | era |
| Destined Rivals (sv10) | 2025/05/30 | hit | Hyper Rare | 6 | 0.011 | 0.011 | era |
| Destined Rivals (sv10) | 2025/05/30 | reverse2hit | Illustration Rare | 23 | 0.09 | 0.09 | set |
| Destined Rivals (sv10) | 2025/05/30 | reverse2hit | Special Illustration Rare | 11 | 0.028 | 0.028 | set |
| White Flare (rsv10pt5) | 2025/07/18 | hit | Double Rare | 6 | 0.2111 | 0.2111 | set |
| White Flare (rsv10pt5) | 2025/07/18 | hit | Ultra Rare | 8 | 0.0583 | 0.0583 | set |
| White Flare (rsv10pt5) | 2025/07/18 | hit | Black White Rare | 2 | 0.002 | 0.002 | set |
| White Flare (rsv10pt5) | 2025/07/18 | reverse2hit | Illustration Rare | 69 | 0.1639 | 0.1639 | set |
| White Flare (rsv10pt5) | 2025/07/18 | reverse2hit | Special Illustration Rare | 7 | 0.0125 | 0.0125 | set |
| Black Bolt (zsv10pt5) | 2025/07/18 | hit | Double Rare | 6 | 0.2111 | 0.2111 | set |
| Black Bolt (zsv10pt5) | 2025/07/18 | hit | Ultra Rare | 8 | 0.0583 | 0.0583 | set |
| Black Bolt (zsv10pt5) | 2025/07/18 | hit | Black White Rare | 2 | 0.002 | 0.002 | set |
| Black Bolt (zsv10pt5) | 2025/07/18 | reverse2hit | Illustration Rare | 69 | 0.1639 | 0.1639 | set |
| Black Bolt (zsv10pt5) | 2025/07/18 | reverse2hit | Special Illustration Rare | 7 | 0.0125 | 0.0125 | set |
| Mega Evolution (me1) | 2025/09/26 | hit | Double Rare | 10 | 0.2 | 0.2 | era |
| Mega Evolution (me1) | 2025/09/26 | hit | Ultra Rare | 22 | 0.11 | 0.11 | era |
| Mega Evolution (me1) | 2025/09/26 | hit | Mega Hyper Rare | 2 | 0.0008 | 0.0008 | set |
| Mega Evolution (me1) | 2025/09/26 | reverse2hit | Illustration Rare | 22 | 0.09 | 0.09 | set |
| Mega Evolution (me1) | 2025/09/26 | reverse2hit | Special Illustration Rare | 10 | 0.028 | 0.028 | set |
| Phantasmal Flames (me2) | 2025/11/14 | hit | Double Rare | 10 | 0.2 | 0.2 | era |
| Phantasmal Flames (me2) | 2025/11/14 | hit | Ultra Rare | 17 | 0.11 | 0.11 | era |
| Phantasmal Flames (me2) | 2025/11/14 | hit | Mega Hyper Rare | 1 | 0.0008 | 0.0008 | set |
| Phantasmal Flames (me2) | 2025/11/14 | reverse2hit | Illustration Rare | 13 | 0.09 | 0.09 | set |
| Phantasmal Flames (me2) | 2025/11/14 | reverse2hit | Special Illustration Rare | 5 | 0.028 | 0.028 | set |
| Ascended Heroes (me2pt5) | 2026/01/30 | hit | Double Rare | 39 | 0.2 | 0.2 | era |
| Ascended Heroes (me2pt5) | 2026/01/30 | hit | Ultra Rare | 14 | 0.0481 | 0.0481 | set |
| Ascended Heroes (me2pt5) | 2026/01/30 | hit | MEGA_ATTACK_RARE | 7 | 0.02 | 0.02 | table |
| Ascended Heroes (me2pt5) | 2026/01/30 | hit | Mega Hyper Rare | 2 | 0.0019 | 0.0019 | set |
| Ascended Heroes (me2pt5) | 2026/01/30 | reverse2hit | Illustration Rare | 33 | 0.1125 | 0.1125 | set |
| Ascended Heroes (me2pt5) | 2026/01/30 | reverse2hit | Special Illustration Rare | 22 | 0.0144 | 0.0144 | set |
| Perfect Order (me3) | 2026/03/27 | hit | Double Rare | 9 | 0.2 | 0.2 | era |
| Perfect Order (me3) | 2026/03/27 | hit | Ultra Rare | 18 | 0.11 | 0.11 | era |
| Perfect Order (me3) | 2026/03/27 | hit | Mega Hyper Rare | 1 | 0.0006 | 0.0006 | set |
| Perfect Order (me3) | 2026/03/27 | reverse2hit | Illustration Rare | 11 | 0.09 | 0.09 | set |
| Perfect Order (me3) | 2026/03/27 | reverse2hit | Special Illustration Rare | 6 | 0.028 | 0.028 | set |
| Chaos Rising (me4) | 2026/05/22 | hit | Double Rare | 10 | 0.2 | 0.2 | era |
| Chaos Rising (me4) | 2026/05/22 | hit | Ultra Rare | 18 | 0.11 | 0.11 | era |
| Chaos Rising (me4) | 2026/05/22 | hit | Mega Hyper Rare | 1 | 0.001 | 0.001 | set |
| Chaos Rising (me4) | 2026/05/22 | reverse2hit | Illustration Rare | 11 | 0.09 | 0.09 | set |
| Chaos Rising (me4) | 2026/05/22 | reverse2hit | Special Illustration Rare | 6 | 0.028 | 0.028 | set |
| Pitch Black (me5) | 2026/07/17 | hit | Double Rare | 10 | 0.2 | 0.2 | era |
| Pitch Black (me5) | 2026/07/17 | hit | Ultra Rare | 18 | 0.11 | 0.11 | era |
| Pitch Black (me5) | 2026/07/17 | hit | Mega Hyper Rare | 1 | 0.0009 | 0.0009 | set |
| Pitch Black (me5) | 2026/07/17 | reverse2hit | Illustration Rare | 11 | 0.09 | 0.09 | set |
| Pitch Black (me5) | 2026/07/17 | reverse2hit | Special Illustration Rare | 6 | 0.028 | 0.028 | set |
| 30th Celebration (me55) | 2026/09/16 | hit | Double Rare | 12 | 0.2 | 0.2 | era |
| 30th Celebration (me55) | 2026/09/16 | hit | Futuristic Rare | 2 | 0.008 | 0.008 | table |
| 30th Celebration (me55) | 2026/09/16 | reverse2hit | Illustration Rare | 18 | 0.09 | 0.09 | set |
| 30th Celebration (me55) | 2026/09/16 | reverse2hit | Special Illustration Rare | 10 | 0.028 | 0.028 | set |
| Delta Reign (me6) | 2026/11/06 | hit | Double Rare | 10 | 0.2 | 0.2 | set |
| Delta Reign (me6) | 2026/11/06 | hit | Ultra Rare | 17 | 0.0833 | 0.0833 | set |
| Delta Reign (me6) | 2026/11/06 | hit | Mega Hyper Rare | 1 | 0.001 | 0.001 | set |
| Delta Reign (me6) | 2026/11/06 | reverse2hit | Illustration Rare | 14 | 0.1111 | 0.1111 | set |
| Delta Reign (me6) | 2026/11/06 | reverse2hit | Special Illustration Rare | 6 | 0.0125 | 0.0125 | set |
