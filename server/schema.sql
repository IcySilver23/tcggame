-- TCG Life database schema (better-sqlite3, WAL)

-- =====================================================================
-- DATA LAYER (populated only from the official Pokémon TCG API v2)
-- =====================================================================

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sets (
  id TEXT PRIMARY KEY,                -- API set id, e.g. 'sv3pt5'
  name TEXT NOT NULL,
  series TEXT NOT NULL,
  printed_total INTEGER,
  total INTEGER,
  ptcgo_code TEXT,
  release_date TEXT,
  symbol_url TEXT,
  logo_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_sets_release ON sets (release_date DESC);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,                -- API card id, e.g. 'sv3pt5-199'
  set_id TEXT NOT NULL REFERENCES sets(id),
  name TEXT NOT NULL,
  supertype TEXT,
  subtypes TEXT,                      -- JSON array
  number TEXT NOT NULL,
  position INTEGER,                   -- numeric card number for sorting
  rarity TEXT,
  types TEXT,                         -- JSON array
  hp INTEGER,
  artist TEXT,
  dex_numbers TEXT,                   -- JSON array of ints
  image_small TEXT,
  image_large TEXT,
  regulation_mark TEXT,
  updated_at TEXT                     -- API updatedAt for card data
);
CREATE INDEX IF NOT EXISTS idx_cards_set ON cards (set_id);
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_cards_rarity ON cards (rarity);

-- Every synced price is stored with its source and retrieval time.
CREATE TABLE IF NOT EXISTS price_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id),
  kind TEXT NOT NULL,                 -- 'tcgplayer' | 'cardmarket'
  variant TEXT NOT NULL,              -- 'normal' | 'holofoil' | 'reverseHolofoil' | 'reverseHolofoilPokeBall' | 'reverseHolofoilMasterBall' | '1stEditionNormal' | '1stEditionHolofoil'
  low REAL, mid REAL, high REAL,
  market REAL,
  direct_low REAL,
  avg1 REAL, avg7 REAL, avg30 REAL,   -- cardmarket only
  retrieved_at TEXT NOT NULL          -- ISO timestamp when WE retrieved it
);
CREATE INDEX IF NOT EXISTS idx_prices_lookup
  ON price_records (card_id, kind, variant, retrieved_at DESC);
-- Latest-price lookups pin card_id+kind and need rows newest-first
-- (cards search price sort, auction lot spawning). idx_prices_lookup has
-- variant between kind and retrieved_at, so those queries paid a per-card
-- temp sort across millions of rows — minutes of CPU on a big save. This
-- covering index keeps them index-ordered end to end.
CREATE INDEX IF NOT EXISTS idx_prices_latest
  ON price_records (card_id, kind, retrieved_at DESC, market);

-- =====================================================================
-- BENCHMARK CACHE (S&P 500 closes for the portfolio's real index line)
-- =====================================================================

CREATE TABLE IF NOT EXISTS benchmark_cache (
  day TEXT PRIMARY KEY,               -- close date, 'YYYY-MM-DD' UTC
  close REAL NOT NULL                 -- ^GSPC level at that close
);

-- =====================================================================
-- GAME LAYER
-- =====================================================================

CREATE TABLE IF NOT EXISTS game_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cash REAL NOT NULL DEFAULT 1000,
  created_at TEXT NOT NULL,
  last_tick_at TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  quantity INTEGER NOT NULL DEFAULT 1,
  graded_grade TEXT,
  status TEXT NOT NULL DEFAULT 'collection',
                -- collection | listed | grading | sold
  listing_price REAL,
  listed_at TEXT,
  acquired_via TEXT NOT NULL DEFAULT 'pack',
                -- pack | market | shop | convention | estate_lot | trade | grading | starter
  acquired_ref TEXT,
                -- acquisition context, e.g. convention id for convention/estate_lot buys
  cost_basis REAL NOT NULL DEFAULT 0,   -- per-unit cost
  acquired_at TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0,
  protection TEXT,                    -- NULL (bare) | 'sleeve' | 'toploader'
  protected_at TEXT,                  -- when protection was applied (wear clock baseline)
  worn_at TEXT,                       -- last time condition wore down a step (NULL = never)
  is_fake INTEGER NOT NULL DEFAULT 0  -- 1 = detected/known counterfeit (local.ts)
);

-- Facebook Marketplace & Craigslist: the wild west. Asks are vibes, meetups
-- ghost you, and the too-good deals bite (counterfeits, local.ts).
CREATE TABLE IF NOT EXISTS local_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT REFERENCES cards(id),        -- NULL for non-card items (sealed, bundle, mystery)
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  ask REAL NOT NULL,
  anchor_at_spawn REAL NOT NULL,      -- real market at post time (UI delta + tells)
  seller TEXT NOT NULL,
  source TEXT NOT NULL,               -- facebook | craigslist | mine
  inventory_id INTEGER,               -- set when source = 'mine'
  posted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  counter_offer REAL,                 -- seller's counter after a lowball meet
  counter_of REAL,                    -- the offer that drew the counter
  ghosted INTEGER NOT NULL DEFAULT 0,
  is_fake INTEGER NOT NULL DEFAULT 0, -- rolled at spawn, hidden until inspected
  sold INTEGER NOT NULL DEFAULT 0,
  sold_at TEXT,
  -- A listing is any sellable thing, not just raw cardboard:
  --   card         → card_id + variant + condition
  --   sealed       → item_ref = pack_products.id (pack / bundle / ETB / box)
  --   bundle       → item_json = [{card_id, condition}] the lot you get
  --   mystery_slab → item_json = the rolled slab, hidden until the meet
  --   mystery_box  → item_json = the rolled contents, hidden until the meet
  -- The contents of a mystery are rolled AT POST TIME and stored — the anchor
  -- is then the real value of what is inside, so a too-good ask is honestly
  -- detectable while the contents stay undisclosed.
  kind TEXT NOT NULL DEFAULT 'card',
  item_ref TEXT,
  item_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_local_live ON local_listings (sold, expires_at);
CREATE INDEX IF NOT EXISTS idx_inv_card ON inventory (card_id);
CREATE INDEX IF NOT EXISTS idx_inv_status ON inventory (status);

CREATE TABLE IF NOT EXISTS sale_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER,
  card_id TEXT NOT NULL,
  variant TEXT,
  condition TEXT,
  quantity INTEGER NOT NULL,
  sale_price REAL NOT NULL,           -- total received
  cost_basis REAL NOT NULL,           -- total cost
  fee REAL NOT NULL DEFAULT 0,
  profit REAL NOT NULL,
  buyer TEXT,
  sale_type TEXT NOT NULL DEFAULT 'listing',  -- listing | instant
  sold_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,                -- uuid
  card_id TEXT NOT NULL REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL,
  price REAL NOT NULL,
  shipping REAL NOT NULL DEFAULT 0,
  seller_name TEXT NOT NULL,
  seller_rating REAL,
  seller_sales INTEGER,
  eta_days REAL,
  listed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deal_score REAL,                    -- market/total; <0.9 = below market
  source TEXT NOT NULL DEFAULT 'npc'
);
CREATE INDEX IF NOT EXISTS idx_listings_card ON listings (card_id);
CREATE INDEX IF NOT EXISTS idx_listings_expiry ON listings (expires_at);

CREATE TABLE IF NOT EXISTS pack_products (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES sets(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- booster | bundle | etb | display | special
  msrp REAL,
  market_price REAL,                  -- typical sealed market price (USD, estimated for shop purposes)
  packs INTEGER NOT NULL,
  cards_per_pack INTEGER NOT NULL,
  release_date TEXT,
  description TEXT,
  image_url TEXT                      -- real wrapper art (TCGplayer CDN, matched from tcgcsv)
);

CREATE TABLE IF NOT EXISTS pack_product_cards (
  pack_product_id TEXT NOT NULL REFERENCES pack_products(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  slot TEXT NOT NULL,                 -- 'hit' | 'holo' | 'rev' | 'common'
  weight REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ppc ON pack_product_cards (pack_product_id, slot);

CREATE TABLE IF NOT EXISTS sealed_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES pack_products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  cost REAL NOT NULL,
  condition TEXT NOT NULL DEFAULT 'fresh',  -- sealed futures desk: 'fresh' (case-fresh premium) | 'worn' (shelf wear)
  escrow_loan INTEGER,                      -- set while posted as loan-desk collateral (sealed_loans.id)
  acquired_at TEXT NOT NULL
);

-- One row per daily deal bought this game-day. The primary key is the limit:
-- a second purchase of the same product on the same day cannot be recorded.
CREATE TABLE IF NOT EXISTS daily_deal_purchases (
  day_key TEXT NOT NULL,
  product_id TEXT NOT NULL,            -- a journal row, not stock: catalog pruning must not be blocked
  purchased_at TEXT NOT NULL,
  PRIMARY KEY (day_key, product_id)
);

-- The board as it stood on each past game day. Names and prices are copied in
-- so a later catalogue change cannot rewrite what the player missed.
CREATE TABLE IF NOT EXISTS daily_deal_history (
  day_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  slot INTEGER NOT NULL,               -- 0..2, the order the three cards sat in
  product_name TEXT NOT NULL,
  set_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  discount_pct INTEGER NOT NULL,
  base_price REAL NOT NULL,
  deal_price REAL NOT NULL,
  ends_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (day_key, product_id)
);

-- Sealed futures desk — the collectible-asset loan book. Boxes posted as
-- collateral carry escrow_loan = this id and never touch free stock.
CREATE TABLE IF NOT EXISTS sealed_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  principal REAL NOT NULL,
  balance REAL NOT NULL,                    -- outstanding, grows daily
  rate_daily REAL NOT NULL,
  collateral_qty INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',    -- active | settled | forfeited
  issued_at TEXT NOT NULL,
  last_accrual_day TEXT NOT NULL,
  settled_at TEXT
);

CREATE TABLE IF NOT EXISTS pull_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  pack_product_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  variant TEXT,
  value REAL NOT NULL,                -- estimated raw NM value at pull time
  rarity TEXT,
  is_hit INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT 'player' -- 'player' rips count toward Pull History/records; 'other' = NPC shows, opponents, break spots (world log only)
);
CREATE INDEX IF NOT EXISTS idx_pulls_session ON pull_history (session_id);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  amount REAL,
  created_at TEXT NOT NULL,
  href TEXT
);

CREATE TABLE IF NOT EXISTS wishlist (
  card_id TEXT PRIMARY KEY REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  target_price REAL,                  -- alert: fire when market drops to/below this
  added_at TEXT NOT NULL
);

-- =====================================================================
-- POLISH: MARKET DIGEST — weekly movers snapshot, auto-posted to the
-- activity feed when a new week starts and viewable on demand.
-- =====================================================================
CREATE TABLE IF NOT EXISTS market_digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week TEXT NOT NULL UNIQUE,          -- Monday key the digest covers
  body TEXT NOT NULL,                 -- JSON: gainers, losers, volume notes
  posted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- =====================================================================
-- PHASE 2: BINDERS (physical-feeling 9-pocket pages)
-- =====================================================================

CREATE TABLE IF NOT EXISTS binders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT 'yellow',   -- yellow | blue | red | green | purple
  cover TEXT NOT NULL DEFAULT 'vinyl',     -- cover stock: vinyl | canvas | leather | holo | gold | monster
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS binder_slots (
  binder_id INTEGER NOT NULL REFERENCES binders(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  slot INTEGER NOT NULL,                   -- 0..8 within a page
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  placed_at TEXT NOT NULL,
  UNIQUE (page, slot, binder_id),
  UNIQUE (inventory_id)                    -- a copy lives in at most one pocket
);
CREATE INDEX IF NOT EXISTS idx_binder_slots ON binder_slots (binder_id, page, slot);

-- =====================================================================
-- PHASE 2: NPC TRADERS (personality-driven collectors)
-- =====================================================================

CREATE TABLE IF NOT EXISTS traders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  archetype TEXT NOT NULL,             -- grail_hunter | set_builder | flipper | holo_hoarder | vintage_purist | deal_seeker
  cash REAL NOT NULL,
  seed_cash REAL NOT NULL,             -- archetype budget ceiling for cash regen
  traits TEXT NOT NULL,                -- JSON: patience, scrutiny, cashFlex, heat
  blurb TEXT NOT NULL,
  avatar TEXT NOT NULL,
  reputation REAL NOT NULL DEFAULT 0,  -- -10..+10; completed trades raise it, walk-aways lower it
  walked_away INTEGER NOT NULL DEFAULT 0, -- consecutive rejections of their offers
  trade_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traders_archetype ON traders (archetype);

-- The NPC's own collection — the pool you can propose trades against.
CREATE TABLE IF NOT EXISTS trader_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trader_id INTEGER NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  acquired_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trader_cards ON trader_cards (trader_id);

-- One negotiation thread per trader. Contents always describe the LATEST
-- proposal on the table (whose it is lives in `direction` + activity log).
CREATE TABLE IF NOT EXISTS trade_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trader_id INTEGER NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,             -- incoming (NPC proposed) | outgoing (you proposed)
  their_cards TEXT NOT NULL DEFAULT '[]',   -- JSON [{traderCardId, cardId, name, image, variant, condition, value}]
  their_cash REAL NOT NULL DEFAULT 0,
  your_items TEXT NOT NULL DEFAULT '[]',    -- JSON [{inventoryId, cardId, name, image, condition, value}]
  your_cash REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',         -- NPC's last words
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | rejected | expired
  rounds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_offers_status ON trade_offers (status);

-- =====================================================================
-- PHASE 3: CONVENTIONS (pop-up card shows with vendor booths)
-- =====================================================================

CREATE TABLE IF NOT EXISTS conventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  blurb TEXT NOT NULL,
  entry_fee REAL NOT NULL,
  opened_at TEXT NOT NULL,
  closes_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS convention_booths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL REFERENCES conventions(id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  avatar TEXT NOT NULL,
  specialty TEXT NOT NULL,             -- deals | bulk | vintage | modern | graded | trap
  blurb TEXT NOT NULL,
  mood REAL,                           -- 0..100, rolled on first visit (floor.ts)
  player_offered REAL,                 -- last offer the player made this show
  seller_counters INTEGER NOT NULL DEFAULT 0,
  sour REAL NOT NULL DEFAULT 0         -- 1 = table gone cold for the day
);
CREATE INDEX IF NOT EXISTS idx_convention_booths ON convention_booths (convention_id);

-- Ask prices are frozen at spawn — vendor opinions of value. The UI always
-- shows them against the live real-market anchor (DEAL / FAIR / PRICEY).
CREATE TABLE IF NOT EXISTS convention_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booth_id INTEGER NOT NULL REFERENCES convention_booths(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  graded_grade TEXT,                   -- set = graded slab booth stock
  ask REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',   -- available | sold
  sold_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_convention_items ON convention_items (booth_id, status);

-- =====================================================================
-- PHASE 3: AUCTION HOUSE (timed lots, NPC bidding wars, player consignment)
-- =====================================================================

CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  graded_grade TEXT,                   -- set = slab lot
  seller TEXT NOT NULL DEFAULT 'house', -- 'house' | 'you'
  inventory_id INTEGER,                -- set when you consign a card
  anchor REAL NOT NULL,                -- real market value at spawn
  estimate_low REAL NOT NULL,
  estimate_high REAL NOT NULL,
  current_bid REAL NOT NULL DEFAULT 0,
  bid_count INTEGER NOT NULL DEFAULT 0,
  leader TEXT,                         -- NPC name or 'you'
  my_escrow REAL NOT NULL DEFAULT 0,   -- your max bid currently locked
  opened_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  extended INTEGER NOT NULL DEFAULT 0, -- snipe-guard used
  status TEXT NOT NULL DEFAULT 'live', -- live | won | lost | passed | settled
  final_bid REAL,
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions (status);

-- =====================================================================
-- PHASE 3: ESTATE LOTS (mystery bundles sold at conventions)
-- =====================================================================

CREATE TABLE IF NOT EXISTS estate_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL REFERENCES conventions(id) ON DELETE CASCADE,
  seller_name TEXT NOT NULL,
  flavor TEXT NOT NULL,                -- bulk_clearout | mixed_vault | collector_decay
  card_count INTEGER NOT NULL,
  ask REAL NOT NULL,                   -- lot price
  seller_estimate REAL NOT NULL,       -- the estate's (noisy) valuation
  true_value REAL,                     -- realized: sum of real anchors at purchase
  status TEXT NOT NULL DEFAULT 'available',   -- available | sold
  bought_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_estate_lots ON estate_lots (convention_id, status);

CREATE TABLE IF NOT EXISTS estate_lot_cards (
  lot_id INTEGER NOT NULL REFERENCES estate_lots(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  condition TEXT NOT NULL DEFAULT 'NM'
);
CREATE INDEX IF NOT EXISTS idx_estate_lot_cards ON estate_lot_cards (lot_id);

-- =====================================================================
-- THE BUYLIST (NPC shops buying outright, rotating wants, store credit)
-- =====================================================================
CREATE TABLE IF NOT EXISTS buylist_wants (
  shop_id INTEGER NOT NULL,
  card_id TEXT NOT NULL REFERENCES cards(id),
  premium REAL NOT NULL DEFAULT 0.15
);
CREATE INDEX IF NOT EXISTS idx_buylist_wants ON buylist_wants (shop_id);

CREATE TABLE IF NOT EXISTS buylist_shelf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  card_id TEXT NOT NULL REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  price REAL NOT NULL,
  listed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_buylist_shelf ON buylist_shelf (shop_id);

CREATE TABLE IF NOT EXISTS buylist_credit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  delta REAL NOT NULL,
  created_at TEXT NOT NULL,
  note TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_buylist_credit ON buylist_credit_history (shop_id);

-- =====================================================================
-- STORAGE UNIT AUCTIONS (the locker gamble)
-- =====================================================================

CREATE TABLE IF NOT EXISTS storage_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  facility TEXT NOT NULL,
  unit_code TEXT NOT NULL,             -- e.g. 'B-14'
  flavor TEXT NOT NULL,                -- junk_drawer | random_locker | collector_unit | hoarder_dream
  street_price REAL NOT NULL,          -- the blind starting bid the facility asks
  contents_value REAL,                 -- sealed until opened (true sum of real anchors)
  winner_bid REAL,                     -- what you paid (null while open)
  status TEXT NOT NULL DEFAULT 'open', -- open | won | settled
  opened_at TEXT,
  closes_at TEXT NOT NULL,             -- bid window end
  opened_by TEXT                       -- NPC snipe name if they outbid you
);
CREATE INDEX IF NOT EXISTS idx_storage_units ON storage_units (status, closes_at);

CREATE TABLE IF NOT EXISTS storage_unit_cards (
  unit_id INTEGER NOT NULL REFERENCES storage_units(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  condition TEXT NOT NULL DEFAULT 'NM',
  hidden_collection INTEGER NOT NULL DEFAULT 0  -- 1 = part of the found-collection jackpot subset
);
CREATE INDEX IF NOT EXISTS idx_storage_unit_cards ON storage_unit_cards (unit_id);

-- =====================================================================
-- PHASE 3: NET WORTH HISTORY (weekly dashboard chart)
-- =====================================================================

CREATE TABLE IF NOT EXISTS networth_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week TEXT NOT NULL UNIQUE,          -- week start (Monday), e.g. '2026-09-14'
  cash REAL NOT NULL,
  collection REAL NOT NULL,
  listed REAL NOT NULL,
  sealed REAL NOT NULL,
  net_worth REAL NOT NULL,
  snapshotted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_networth_week ON networth_history (week DESC);

-- =====================================================================
-- PHASE 3: PACK BATTLES (head-to-head pack openings vs NPC rivals)
-- =====================================================================

CREATE TABLE IF NOT EXISTS pack_battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  opponent_id TEXT NOT NULL,
  stake REAL NOT NULL,
  player_total REAL NOT NULL,
  opponent_total REAL NOT NULL,
  player_cards TEXT NOT NULL,         -- JSON [{cardId,value,isHit}]
  opponent_cards TEXT NOT NULL,
  winner TEXT NOT NULL,               -- player | opponent
  tiebreak INTEGER NOT NULL DEFAULT 0,
  grudge_flag INTEGER NOT NULL DEFAULT 0,  -- 1 = grudge match (doubled stakes)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pack_battles_created ON pack_battles (created_at DESC);

-- Real sealed-market prices per product (PriceCharting lookups).
CREATE TABLE IF NOT EXISTS sealed_prices (
  product_id TEXT PRIMARY KEY,
  market REAL NOT NULL,
  source TEXT NOT NULL,
  retrieved_at TEXT NOT NULL
);

-- Phase 4 — Estate & collection buyouts: sight-unseen whole collections.
CREATE TABLE IF NOT EXISTS estate_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_name TEXT NOT NULL,
  persona TEXT NOT NULL,
  mood INTEGER NOT NULL,               -- 0 grouchy..100 warm; shifts with respect shown
  card_count INTEGER NOT NULL,
  ask REAL NOT NULL,                   -- the number on the listing (moves with counters)
  opening_ask REAL NOT NULL,           -- what the heirs first wanted
  seller_estimate REAL NOT NULL,       -- their (noisy) opinion of the whole thing
  player_offered REAL,
  counters_used INTEGER NOT NULL DEFAULT 0,
  final_said INTEGER NOT NULL DEFAULT 0,   -- heirs said "final" — next lowball walks
  glimpse_note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',     -- open | sold | taken | expired
  opened_day TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  bought_at TEXT,
  sold_for REAL,
  gen_anchor TEXT                      -- archetype at spawn (condition-band lookup on read)
);
CREATE INDEX IF NOT EXISTS idx_estate_sales_status ON estate_sales (status);

CREATE TABLE IF NOT EXISTS estate_sale_cards (
  sale_id INTEGER NOT NULL REFERENCES estate_sales(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  condition TEXT,                      -- NULL = face-down until the binder opens
  price REAL NOT NULL,                 -- glimpse: real value; face-down: expected-value price
  anchor REAL,                         -- NM-anchored dream price; the buy() roll settles it
  gen_anchor TEXT                      -- archetype at spawn, so the band follows the listing
);

-- Phase 4 — Reselling: inbound lots from sellers + flip stock economics.
CREATE TABLE IF NOT EXISTS resale_deals (
  id INTEGER PRIMARY KEY,
  seller TEXT NOT NULL,
  seller_type TEXT NOT NULL,          -- collection | dupes | chase | storage
  message TEXT NOT NULL,
  ask REAL NOT NULL,
  true_value REAL NOT NULL,
  haggled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open', -- open | bought | walked | expired
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resale_deal_cards (
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES resale_deals(id),
  card_id TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT 'NM',
  position INTEGER NOT NULL
);

-- Streaming room: one live stream at a time + channel stats.
CREATE TABLE IF NOT EXISTS streams (
  id INTEGER PRIMARY KEY,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  set_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  price REAL NOT NULL,
  packs_opened INTEGER NOT NULL DEFAULT 0,
  packs_planned INTEGER NOT NULL,
  peak_viewers INTEGER NOT NULL DEFAULT 0,
  donations_total REAL NOT NULL DEFAULT 0,
  chat_lines INTEGER NOT NULL DEFAULT 0,
  best_card_id TEXT,
  best_card_name TEXT,
  best_card_value REAL,
  followers_gain INTEGER,
  status TEXT NOT NULL DEFAULT 'live',
  started_at TEXT NOT NULL,
  ended_at TEXT
);

-- Case breaks: sell rip spots on a stream; the pulls go to spot-holders.
CREATE TABLE IF NOT EXISTS stream_breaks (
  id INTEGER PRIMARY KEY,
  stream_id INTEGER REFERENCES streams(id),  -- NULL until the break goes live
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  set_id TEXT NOT NULL,
  spot_price REAL NOT NULL,
  product_cost REAL NOT NULL,
  spots_total INTEGER NOT NULL,
  spots_sold INTEGER NOT NULL DEFAULT 0,
  teams_json TEXT,                          -- set-relative roster snapshot for this break
  gross REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'selling',  -- selling | settled
  created_at TEXT NOT NULL,
  settled_at TEXT
);

-- One row per claimed spot; unsold teams simply never get a row.
CREATE TABLE IF NOT EXISTS stream_break_spots (
  id INTEGER PRIMARY KEY,
  break_id INTEGER NOT NULL REFERENCES stream_breaks(id),
  spot_no INTEGER NOT NULL,
  team TEXT NOT NULL,
  team_dex INTEGER,
  holder TEXT NOT NULL,
  payout REAL NOT NULL DEFAULT 0,
  pulls INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT NOT NULL
);

-- Every card pulled during the break, attributed to its spot (or the house).
CREATE TABLE IF NOT EXISTS stream_break_pulls (
  id INTEGER PRIMARY KEY,
  break_id INTEGER NOT NULL REFERENCES stream_breaks(id),
  spot_id INTEGER,
  card_id TEXT NOT NULL,
  value REAL NOT NULL,
  pack_no INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stream_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  followers INTEGER NOT NULL DEFAULT 120,
  total_streams INTEGER NOT NULL DEFAULT 0,
  total_packs INTEGER NOT NULL DEFAULT 0,
  total_donations REAL NOT NULL DEFAULT 0,
  best_card_name TEXT,
  best_card_value REAL
);

-- Sponsors: brands offer paid contracts as your channel grows.
CREATE TABLE IF NOT EXISTS sponsor_offers (
  id INTEGER PRIMARY KEY,
  brand TEXT NOT NULL,
  product_kind TEXT NOT NULL,             -- booster | bundle | etb | display | special
  brand_label TEXT NOT NULL,
  tagline TEXT NOT NULL,
  packs_required INTEGER NOT NULL,
  payout_per_pack REAL NOT NULL,
  follower_bonus INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sponsor_contracts (
  id INTEGER PRIMARY KEY,
  brand TEXT NOT NULL,
  product_kind TEXT NOT NULL,
  brand_label TEXT NOT NULL,
  packs_required INTEGER NOT NULL,
  packs_delivered INTEGER NOT NULL DEFAULT 0,
  payout_per_pack REAL NOT NULL,
  follower_bonus INTEGER NOT NULL,
  accepted_at TEXT NOT NULL,
  completed_at TEXT
);

-- Rivalry memory: grudge level, rematch challenges, battle counts.
CREATE TABLE IF NOT EXISTS rival_memory (
  opponent_id TEXT PRIMARY KEY,
  grudge REAL NOT NULL DEFAULT 0,     -- 0..10; grows on their losses, drains on revenge
  battles INTEGER NOT NULL DEFAULT 0,
  pending_product TEXT,               -- product they demand a rematch over
  saltiest TEXT,                      -- what they're still salty about
  updated_at TEXT
);

-- Pack Battle tournaments: single-elimination brackets with escalating rounds.
CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  size INTEGER NOT NULL,              -- 4 or 8 players
  entry REAL NOT NULL,                -- what you paid in
  round INTEGER NOT NULL DEFAULT 0,   -- 0 = semifinal not yet played
  bracket TEXT NOT NULL,              -- JSON rounds: [[{a,b,winner?},...],...]
  status TEXT NOT NULL DEFAULT 'active',  -- active | won | eliminated | abandoned
  prize REAL NOT NULL DEFAULT 0,      -- paid out on win
  created_at TEXT NOT NULL,
  finished_at TEXT
);

-- =====================================================================
-- Vendor tables: rent a table at the current show and sell your own
-- collection from it. Stock lives in inventory (status = 'at_table'),
-- so binders/listings/graders can't touch it while it's on the table.
-- =====================================================================
CREATE TABLE IF NOT EXISTS vendor_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER REFERENCES conventions(id) ON DELETE CASCADE, -- NULL for host-show booths
  host_show_id INTEGER REFERENCES card_shows(id) ON DELETE CASCADE,   -- set when the table is at the player's own show
  fee REAL NOT NULL,                  -- table rent paid at spawn (0 for host-show booths)
  location TEXT NOT NULL DEFAULT 'main floor',
  revenue REAL NOT NULL DEFAULT 0,    -- gross sales
  cost_out REAL NOT NULL DEFAULT 0,   -- cost basis of what sold
  buyer_count INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0, -- 1 = packed up; stock returned to collection
  opened_at TEXT NOT NULL
);

-- One row per sale: NPC walk-up buys a slotted unit off the table.
CREATE TABLE IF NOT EXISTS vendor_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES vendor_tables(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL,      -- the inventory row the unit came from
  card_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  condition TEXT NOT NULL,
  quantity INTEGER NOT NULL,          -- units in this sale (1 normally)
  price REAL NOT NULL,
  cost_basis REAL NOT NULL,           -- per-unit basis of the row
  sold_at TEXT NOT NULL
);

-- =====================================================================
-- PHASE 5: HOST YOUR OWN CARD SHOW — book a venue, price the gate, sell
-- vendor tables to NPC dealers, and keep your reputation alive.
-- =====================================================================
CREATE TABLE IF NOT EXISTS card_shows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue TEXT NOT NULL,
  gate REAL NOT NULL,
  table_price REAL NOT NULL,
  tables_total INTEGER NOT NULL,
  booked_at TEXT NOT NULL,
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  -- special guest attractions: JSON array of guest ids booked for the day
  guests TEXT NOT NULL DEFAULT '[]',
  -- show-day results (0/NULL until resolved)
  walkins INTEGER,
  gate_revenue REAL,
  tables_sold INTEGER,
  table_revenue REAL,
  refund INTEGER,
  rep_delta INTEGER,
  notes TEXT
);

-- NPC dealers who bought into the show — flavor + the rep→demand flywheel.
CREATE TABLE IF NOT EXISTS card_show_dealers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER NOT NULL REFERENCES card_shows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  avatar TEXT NOT NULL,
  paid REAL NOT NULL,
  reliable INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_card_show_dealers ON card_show_dealers (show_id);

-- =====================================================================
-- PHASE 4: THE CARD SHOP — a permanent storefront. Daily rent, display
-- cases stocked from your own collection, walk-in customer NPCs whose
-- traffic follows the time of day and your shop's reputation.
-- =====================================================================
CREATE TABLE IF NOT EXISTS shop (
  id INTEGER PRIMARY KEY CHECK (id = 1),   -- exactly one shop
  name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'hole-in-the-wall',
  opened_at TEXT NOT NULL,            -- ISO of lease signing
  last_rent_day TEXT,                 -- UTC day key last charged rent for
  reputation INTEGER NOT NULL DEFAULT 0,
  lifetime_revenue REAL NOT NULL DEFAULT 0,
  lifetime_cost REAL NOT NULL DEFAULT 0,
  customer_count INTEGER NOT NULL DEFAULT 0,
  today_customers INTEGER NOT NULL DEFAULT 0,
  today_revenue REAL NOT NULL DEFAULT 0,
  no_sale_streak INTEGER NOT NULL DEFAULT 0, -- stocked-but-zero-customer days
  -- RENT VS BUY (v0.5.97): tenants ride landlord reviews (rent creeps with
  -- revenue); owners hold the deed on a mortgage that drafts daily and, once
  -- paid off, costs nothing forever.
  bought_at TEXT,                     -- ISO of the deed purchase (NULL = tenant)
  deed_price REAL,                    -- the price paid, for records
  last_rent_review TEXT,              -- ISO of the last landlord rent review
  rent_current REAL                   -- live rent (NULL = tier base; reviews raise it)
);

-- =====================================================================
-- TAX SEASON — on the first tick of each calendar month, the IRS of
-- cardboard assesses last month's shop profit (product revenue minus
-- rent, payroll, interest, overhead) and your grading spend, which is
-- an ordinary and necessary business expense. Losses carry forward.
-- =====================================================================
CREATE TABLE IF NOT EXISTS tax_filings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL UNIQUE,         -- period key being filed FOR (YYYY-QN for quarters)
  revenue REAL NOT NULL,
  deductions REAL NOT NULL,           -- total write-offs
  taxable REAL NOT NULL,              -- profit after deductions
  carryforward REAL NOT NULL,         -- prior losses applied
  tax REAL NOT NULL,                  -- what was actually paid
  rate REAL NOT NULL,                 -- bracket rate applied
  strategy TEXT NOT NULL DEFAULT 'honest', -- honest | aggressive
  audited INTEGER NOT NULL DEFAULT 0,      -- flag: this return got audited
  penalty REAL NOT NULL DEFAULT 0,         -- assessed if the audit found phantom deductions
  fine REAL NOT NULL DEFAULT 0,            -- late-license / underpayment fines
  filed_at TEXT NOT NULL
);

-- =====================================================================
-- QUARTERLY ESTIMATED TAXES — a licensed business pays as it earns:
-- four estimated payments a year, reconciled by the true-up return
-- after each quarter closes. Overpay and the credit rolls forward;
-- underpay and the underpayment fine lands on the true-up.
-- =====================================================================
CREATE TABLE IF NOT EXISTS tax_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quarter TEXT NOT NULL,              -- 'YYYY-QN' the payment is credited to
  amount REAL NOT NULL,
  paid_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tax_payments_q ON tax_payments (quarter);

-- Case catalog: bigger shops unlock bigger cases. Fixed ids so re-running the
-- schema never duplicates the furniture (INSERT OR IGNORE conflicts on the PK).
CREATE TABLE IF NOT EXISTS shop_cases (
  id INTEGER PRIMARY KEY,
  tier TEXT NOT NULL,                 -- which shop tier unlocks this case
  label TEXT NOT NULL,
  blurb TEXT NOT NULL,
  price REAL NOT NULL,                -- one-time purchase
  slots INTEGER NOT NULL
);
INSERT OR IGNORE INTO shop_cases (id, tier, label, blurb, price, slots) VALUES
  (1, 'hole-in-the-wall', 'Glass counter case', 'The one the register sits on. Six cards face-up.', 40, 6),
  (2, 'hole-in-the-wall', 'Wall pegboard', 'Pegs and sleeves. Low-rent but it moves bulk.', 25, 8),
  (3, 'storefront', 'Locked slab tower', 'LED-lit tower for graded cards. The crown jewels.', 220, 8),
  (4, 'storefront', 'Long display wall', 'Dedicated wall for set builders and deep pockets.', 150, 12),
  (5, 'flagship', 'Museum case', 'Climate-controlled, alarmed, gorgeous. High rollers only.', 900, 10),
  (6, 'flagship', 'Dollar bin wall', 'Rows of penny sleeves. Volume is a strategy.', 120, 20);

-- What's currently sitting in a case (ask price lives in inventory.listing_price).
CREATE TABLE IF NOT EXISTS shop_case_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES shop_cases(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_shop_case_cards ON shop_case_cards (case_id);

-- Walk-in ledger.
CREATE TABLE IF NOT EXISTS shop_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER,
  inventory_id INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  cost_basis REAL NOT NULL,           -- per-unit
  buyer TEXT NOT NULL,
  sold_at TEXT NOT NULL,
  roundup REAL NOT NULL DEFAULT 0     -- spare change donated to the cause
);

-- =====================================================================
-- PHASE 4: ADVANCED FINANCE — business loans, credit limits, overdrafts.
-- Interest accrues once per day; the bank auto-drafts rent you can't
-- cover; three consecutive missed drafts trigger a seizure.
-- =====================================================================
CREATE TABLE IF NOT EXISTS finance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  credit_score INTEGER NOT NULL DEFAULT 600,
  missed_drafts INTEGER NOT NULL DEFAULT 0,   -- consecutive missed rent days
  total_borrowed REAL NOT NULL DEFAULT 0,
  total_interest REAL NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO finance (id) VALUES (1);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'loan',  -- loan | overdraft (auto-drafted rent)
  lender TEXT NOT NULL,
  principal REAL NOT NULL,
  balance REAL NOT NULL,              -- outstanding, grows daily
  rate_daily REAL NOT NULL,           -- e.g. 0.02 = 2%/day
  interest_paid REAL NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL,
  last_accrual_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'  -- active | repaid | defaulted
);

-- =====================================================================
-- PHASE 4: SHOP STAFF — hire specialists with real daily wages and real
-- effects: a buyer sources underpriced stock from the market feed, a
-- grader submits high-EV candidates for grading, counter help lifts
-- walk-in traffic. Miss payroll and they walk.
-- =====================================================================
CREATE TABLE IF NOT EXISTS shop_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,                 -- buyer | grader | counter
  name TEXT NOT NULL,
  wage REAL NOT NULL,                 -- per in-game day, drafted on rent day
  quality INTEGER NOT NULL,           -- 1..5 star effect multiplier
  hired_at TEXT NOT NULL,
  sourced_value REAL NOT NULL DEFAULT 0,   -- buyer: market value of stock found
  sourced_cost REAL NOT NULL DEFAULT 0,    -- buyer: what it cost you
  submits INTEGER NOT NULL DEFAULT 0,      -- grader: cards sent out
  sales_lift INTEGER NOT NULL DEFAULT 0,   -- counter: attributed sales
  -- Employees with lives (v0.5.94): mood drifts with fair pay and honored
  -- requests, xp trains quality stars, day_off/day_off_ask hold granted and
  -- pending days off (game-day keys), poach/huff hold open JSON crises.
  xp REAL NOT NULL DEFAULT 0,              -- experience; crosses XP_STAR thresholds to train quality up
  mood REAL NOT NULL DEFAULT 50,           -- satisfaction 0..100; low mood invites a huff
  day_off TEXT,                            -- granted day off: game-day key they don't work
  day_off_ask TEXT,                        -- pending day-off request: game-day key they asked for
  poach TEXT,                              -- rival offer JSON { offered, rival, filed }
  huff TEXT                                -- open grievance JSON { kind, asked?, text, filed }
);
CREATE INDEX IF NOT EXISTS idx_shop_employees ON shop_employees (role);

-- =====================================================================
-- PHASE 4: BULK BOXES — the dollar bin. Package low-value collection
-- cards at a flat per-card price; customers buy them by the handful.
-- =====================================================================
CREATE TABLE IF NOT EXISTS bulk_boxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,                -- 'Dollar Box', 'Half-Dollar Bin', ...
  price_per_card REAL NOT NULL,       -- flat ask per card
  capacity INTEGER NOT NULL,          -- max cards the box holds
  paid REAL NOT NULL DEFAULT 0,       -- what the box cost to assemble (basis)
  revenue REAL NOT NULL DEFAULT 0,
  cards_sold INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Cards currently in a bulk box. Basis comes from inventory.cost_basis.
CREATE TABLE IF NOT EXISTS bulk_box_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  box_id INTEGER NOT NULL REFERENCES bulk_boxes(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_bulk_box_cards ON bulk_box_cards (box_id);

-- =====================================================================
-- PHASE 4: MYSTERY GRAB BAGS — sealed packs of 10 junk cards with one
-- guaranteed "hit" (worth at least 5× the bag price). Assembled from
-- your own stock, sold to walk-in customers, or bought back by you for
-- the reveal. Contents are sealed until opened.
-- =====================================================================
CREATE TABLE IF NOT EXISTS grab_bags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL DEFAULT 'Mystery Grab Bag',
  price REAL NOT NULL,                -- retail price per bag
  hit_value REAL NOT NULL,            -- market value of the guaranteed hit at sealing
  status TEXT NOT NULL DEFAULT 'in_shop',  -- in_shop | sold | opened | stocked_back
  cost_basis REAL NOT NULL DEFAULT 0, -- total basis of the 10 cards
  sold_to TEXT,                       -- buyer name when sold
  revenue REAL,                       -- what the bag fetched
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS grab_bag_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bag_id INTEGER NOT NULL REFERENCES grab_bags(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL UNIQUE,
  is_hit INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_grab_bag_cards ON grab_bag_cards (bag_id);

-- =====================================================================
-- PHASE 5: SUPPLIES — penny sleeves, toploaders, and one-touches as
-- purchasable stock. Unprotected raw cards slowly wear (NM → LP → …)
-- on the game clock; sleeved cards hold, toploaded cards never wear.
-- Supplies spend is an overhead business expense in the tax code.
-- =====================================================================
CREATE TABLE IF NOT EXISTS supplies (
  kind TEXT PRIMARY KEY,              -- sleeve | toploader | one_touch | mailer
  quantity INTEGER NOT NULL DEFAULT 0
);

-- =====================================================================
-- PHASE 4: SHOP P&L LEDGER — every shop money event lands here with a
-- week key and a product line, so the weekly statement is a plain query.
-- =====================================================================
CREATE TABLE IF NOT EXISTS shop_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week TEXT NOT NULL,                 -- Monday date key, e.g. 2026-09-14
  line TEXT NOT NULL,                 -- cases | bulk | bags | rent | payroll | interest | overhead | shows
  location TEXT NOT NULL DEFAULT 'main',   -- main | satellite — per-location P&L
  amount REAL NOT NULL,               -- signed: revenue positive, costs negative
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT                     -- exact timestamp; tax windows read this when present
);
CREATE INDEX IF NOT EXISTS idx_shop_ledger_week ON shop_ledger (week, line);

-- Daily rollups for the Home dashboard: revenue by day, reputation trend.
CREATE TABLE IF NOT EXISTS shop_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL UNIQUE,           -- UTC day key
  cases REAL NOT NULL DEFAULT 0,
  bulk REAL NOT NULL DEFAULT 0,
  bags REAL NOT NULL DEFAULT 0,
  costs REAL NOT NULL DEFAULT 0,
  customers INTEGER NOT NULL DEFAULT 0,
  reputation INTEGER NOT NULL DEFAULT 0,   -- shop reputation at end of day
  net_worth REAL NOT NULL DEFAULT 0        -- shop lifetime net (revenue - costs) at end of day
);

-- =====================================================================
-- PHASE 5: THE FRANCHISE — a second storefront across town, run day-to-day
-- by a hired manager. Shelf stock lives in inventory with status 'on_shelf'
-- (ask in listing_price) so binders/listings/graders can't touch it. The
-- manager's quality decides how honestly the till balances: cheap managers
-- leak stock. Revenue lands in the main till; the books track it per location
-- via shop_ledger.location.
-- =====================================================================
-- Satellite storefronts: id 1 is the first franchise, id 2 unlocks once a
-- district manager runs the chain. The flagship shop lives in `shop`.
CREATE TABLE IF NOT EXISTS franchise (
  id INTEGER PRIMARY KEY CHECK (id IN (1, 2, 3)),
  name TEXT NOT NULL,
  tier TEXT NOT NULL,                 -- mirror of shop tiers
  manager_name TEXT NOT NULL,
  manager_quality INTEGER NOT NULL,   -- 1..5 stars
  manager_wage REAL NOT NULL,         -- per day, drafted on rent day
  opened_at TEXT NOT NULL,
  last_rent_day TEXT,
  reputation INTEGER NOT NULL DEFAULT 0,
  lifetime_revenue REAL NOT NULL DEFAULT 0,
  lifetime_cost REAL NOT NULL DEFAULT 0,
  customer_count INTEGER NOT NULL DEFAULT 0,
  today_customers INTEGER NOT NULL DEFAULT 0,
  today_revenue REAL NOT NULL DEFAULT 0,
  no_sale_streak INTEGER NOT NULL DEFAULT 0,
  skim_streak INTEGER NOT NULL DEFAULT 0, -- consecutive clean audits at this tier of manager honesty
  promoted_from INTEGER,              -- shop_employees.id they were promoted from (NULL = external hire)
  promoted_wage REAL,                 -- counter wage they earned before the promotion (for the ride home)
  loyalty REAL NOT NULL DEFAULT 50,   -- 0..100: pay fairness + tenure build it; skim busts and refusals burn it
  wage_start REAL,                    -- the wage they signed at — the anchor fairness is measured from
  manager_since TEXT,                 -- when THIS manager took the keys (tenure resets on replacement)
  raise_demand TEXT                   -- JSON { asked, filed } while a raise demand is on the table
);

-- The region: a regional manager hired above the district manager. One row,
-- single-slot semantics like the DM's meta key but a real table so the Friday
-- report and loyalty history read like every other payroll entity.
CREATE TABLE IF NOT EXISTS regional_managers (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  quality INTEGER NOT NULL,           -- 1..5 stars
  wage REAL NOT NULL,                 -- per day, drafted on the Friday report
  hired_at TEXT NOT NULL,
  promoted_from INTEGER,              -- district manager can't be promoted here (different job) — kept for parity
  promoted_wage REAL,
  loyalty REAL NOT NULL DEFAULT 50,
  raise_demand TEXT                   -- JSON { asked, filed }
);

-- Achievements & milestones: one row per definition ever unlocked. Progress
-- is computed live from the real tables; this table only remembers WHEN the
-- badge popped (and that the feed line already fired).
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  unlocked_at TEXT NOT NULL
);

-- The rival shop across the street: an NPC storefront with its own cases,
-- pricing, and staff. It spawns once your shop proves the block has foot
-- traffic, undercuts you in price wars, siphons walk-ins, and can be bought
-- out — at a price that climbs every time you flinch.
CREATE TABLE IF NOT EXISTS rival_shop (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  quality INTEGER NOT NULL,           -- staff/owner quality 1..5
  reputation INTEGER NOT NULL DEFAULT 20,
  aggression REAL NOT NULL DEFAULT 0.5, -- stance 0..1: drives asks, restock, war odds
  cash REAL NOT NULL DEFAULT 500,     -- their till; funds restocks and survival
  price_war_until TEXT,               -- ISO date the current war runs through
  buyout_bump REAL NOT NULL DEFAULT 1, -- asking price multiplier; grows on each refusal
  sold INTEGER NOT NULL DEFAULT 0,    -- bought out: the block remembers, no successor
  spawned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rival_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no INTEGER NOT NULL,           -- 1..6 display cases
  card_id TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  quantity INTEGER NOT NULL DEFAULT 1,
  ask REAL NOT NULL,                  -- per-unit ask
  basis REAL NOT NULL,                -- what they paid
  listed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rival_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  basis REAL NOT NULL,
  buyer TEXT NOT NULL,
  sold_at TEXT NOT NULL
);

-- Reprint announcements: a card gets cratered by reprint news and recovers
-- over ~3 weeks as the panic fades. Read through regimes.factor().
CREATE TABLE IF NOT EXISTS reprint_shocks (
  card_id TEXT PRIMARY KEY,
  severity REAL NOT NULL,             -- 0..1, the depth at announcement
  announced_at TEXT NOT NULL
);

-- The consignment counter: NPC collectors consign cards to the shop; the shop
-- sells them and keeps a 20% cut. NPC stock never enters your inventory.
CREATE TABLE IF NOT EXISTS shop_consignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  quantity INTEGER NOT NULL DEFAULT 1,
  ask REAL NOT NULL,                   -- the shelf price (per the shop's hand)
  owner_name TEXT NOT NULL,
  owner_min REAL NOT NULL,             -- consignor's walk-away floor
  patience_days INTEGER NOT NULL DEFAULT 10,
  consigned_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,            -- when patience runs out (set at accept)
  status TEXT NOT NULL DEFAULT 'offered',  -- offered | active | sold | pulled
  sold_price REAL,                     -- what it actually sold for
  commission REAL                      -- the shop's 20% cut
);
CREATE INDEX IF NOT EXISTS idx_consignments_status ON shop_consignments (status);

-- The satellites' shelf stock: one row per displayed inventory row.
CREATE TABLE IF NOT EXISTS franchise_shelf_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store INTEGER NOT NULL DEFAULT 1,   -- which satellite (1..3)
  inventory_id INTEGER NOT NULL UNIQUE
);

-- Walk-in ledger for the satellites (mirrors shop_sales, tagged per store).
CREATE TABLE IF NOT EXISTS franchise_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store INTEGER NOT NULL DEFAULT 1,   -- which satellite (1..3)
  inventory_id INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  cost_basis REAL NOT NULL,
  buyer TEXT NOT NULL,
  skimmed REAL NOT NULL DEFAULT 0,    -- manager skim on this sale (never while watched)
  sold_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_franchise_sales ON franchise_sales (sold_at DESC);

-- BidBay (Phase 5) — the online storefront: list from the binder at any ask,
-- NPC bargain hunters browse a live feed and snipe underpriced listings.
CREATE TABLE IF NOT EXISTS ebay_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id),
  card_id TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  quantity INTEGER NOT NULL DEFAULT 1,
  ask REAL NOT NULL,                  -- PER UNIT ask
  market_at_list REAL NOT NULL,       -- resolved market per unit when listed
  status TEXT NOT NULL DEFAULT 'live', -- live | sold | cancelled
  views INTEGER NOT NULL DEFAULT 0,
  watchers INTEGER NOT NULL DEFAULT 0,
  buyer TEXT,
  sold_price REAL,                    -- per-unit hammer (= ask)
  fee REAL,                           -- marketplace fee, whole order
  shipping REAL,                      -- shipping cost, whole order
  net REAL,                           -- whole order credited on payout
  paid INTEGER NOT NULL DEFAULT 0,
  promoted_ticks INTEGER NOT NULL DEFAULT 0, -- remaining ticks of paid promotion (0 = organic)
  listed_at TEXT NOT NULL,
  sold_at TEXT,
  ships_at TEXT                       -- payout lands when the envelope "arrives"
);
CREATE INDEX IF NOT EXISTS idx_ebay_listings_status ON ebay_listings (status);

CREATE TABLE IF NOT EXISTS ebay_watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL UNIQUE,
  max_price REAL,                         -- notify only at/below this (NULL = any listing)
  last_market_id INTEGER NOT NULL DEFAULT 0,  -- cursor: hunt feed rows already considered
  last_auction_id INTEGER NOT NULL DEFAULT 0, -- cursor: NPC auction rows already considered
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ebay_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES ebay_listings(id),
  buyer TEXT NOT NULL,
  stars INTEGER NOT NULL,             -- 1..5
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- BidBay's NPC seller side: rotating junk drawers and collections you can snipe.
-- You're not the only hunter — rival bot buyers grab the best deals first.
CREATE TABLE IF NOT EXISTS ebay_market (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  quantity INTEGER NOT NULL DEFAULT 1,
  ask REAL NOT NULL,                  -- per-unit ask
  market_at_list REAL NOT NULL,       -- resolved market per unit when seeded
  seller TEXT NOT NULL,
  listed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- BidBay auction mode: lot-style auctions where NPC bidders escalate before
-- the hammer. Bidding wars beget bidding wars — each bid raises the heat.
CREATE TABLE IF NOT EXISTS ebay_auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id),
  card_id TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  quantity INTEGER NOT NULL DEFAULT 1,
  start REAL NOT NULL,                -- opening bid (whole lot)
  market_at_list REAL NOT NULL,       -- resolved market per unit at start
  current_bid REAL NOT NULL DEFAULT 0,
  bid_count INTEGER NOT NULL DEFAULT 0,
  leader TEXT,
  extended INTEGER NOT NULL DEFAULT 0, -- snipe guard used?
  status TEXT NOT NULL DEFAULT 'live', -- live | sold | expired | cancelled
  fee REAL, shipping REAL, net REAL,
  paid INTEGER NOT NULL DEFAULT 0,
  listed_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  sold_at TEXT,
  ships_at TEXT
);

-- Shipping & condition disputes: one row per sold BidBay order (fixed-price
-- and auction). The sale leaves the binder immediately; the MONEY waits in
-- escrow while the seller packs, ships, and (sometimes) fights a dispute.
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- fixed | auction
  ref_id INTEGER NOT NULL,            -- ebay_listings / ebay_auctions id
  card_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  gross REAL NOT NULL,                -- whole-order hammer (before fees)
  fee REAL NOT NULL,                  -- marketplace fee, whole order
  postage REAL NOT NULL DEFAULT 0,    -- charged at ship time
  net REAL NOT NULL,                  -- what the seller nets on success
  buyer TEXT NOT NULL,
  method TEXT,                        -- economy | standard | priority
  pack TEXT,                          -- bare | sleeved | toploaded | museum
  photos INTEGER NOT NULL DEFAULT 0,  -- pack-out photos taken
  status TEXT NOT NULL DEFAULT 'to_ship', -- to_ship | in_transit | disputed | delivered | lost
  packed_at TEXT,
  arrives_at TEXT,
  resolved_at TEXT,
  outcome TEXT                        -- clean | refund | won_dispute
);

-- NPC-run auctions on the hunt feed: you bid against rival bots for hot
-- cards. Your bid is escrowed the moment you lead; outbid = instant refund.
CREATE TABLE IF NOT EXISTS ebay_npc_auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  quantity INTEGER NOT NULL DEFAULT 1,
  market_at_list REAL NOT NULL,
  current_bid REAL NOT NULL DEFAULT 0,
  min_next REAL NOT NULL,
  leader TEXT,
  my_escrow REAL NOT NULL DEFAULT 0,   -- player's escrowed max bid (0 = not leading)
  my_max REAL NOT NULL DEFAULT 0,      -- player's committed proxy max
  bid_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'live', -- live | sold | passed
  hammer REAL, winner TEXT,
  listed_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  settled_at TEXT
);

-- Yard sales: weekend driveways. Asks are vibes-priced against true_market;
-- peeks are calibrated at 25-35% of real value; boxes are sealed until bought.
CREATE TABLE IF NOT EXISTS yard_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  rigidity REAL NOT NULL DEFAULT 0.7,
  box_ask REAL,
  box_taken INTEGER NOT NULL DEFAULT 0,
  player_offered REAL NOT NULL DEFAULT 0,
  seller_counters INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'live',
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS yard_sale_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES yard_sales(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  condition TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  ask REAL NOT NULL,
  peek TEXT NOT NULL,
  true_market REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
);
