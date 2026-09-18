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
  variant TEXT NOT NULL,              -- 'normal' | 'holofoil' | 'reverseHolofoil' | '1stEditionNormal' | '1stEditionHolofoil'
  low REAL, mid REAL, high REAL,
  market REAL,
  direct_low REAL,
  avg1 REAL, avg7 REAL, avg30 REAL,   -- cardmarket only
  retrieved_at TEXT NOT NULL          -- ISO timestamp when WE retrieved it
);
CREATE INDEX IF NOT EXISTS idx_prices_lookup
  ON price_records (card_id, kind, variant, retrieved_at DESC);

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
  favorite INTEGER NOT NULL DEFAULT 0
);
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
  description TEXT
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
  acquired_at TEXT NOT NULL
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
  opened_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pulls_session ON pull_history (session_id);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  amount REAL,
  created_at TEXT NOT NULL
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
  blurb TEXT NOT NULL
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
  convention_id INTEGER NOT NULL REFERENCES conventions(id) ON DELETE CASCADE,
  fee REAL NOT NULL,                  -- table rent paid at spawn
  location TEXT NOT NULL DEFAULT 'main floor',
  revenue REAL NOT NULL DEFAULT 0,    -- gross sales
  cost_out REAL NOT NULL DEFAULT 0,   -- cost basis of what sold
  buyer_count INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0, -- 1 = packed up; stock returned to collection
  opened_at TEXT NOT NULL,
  UNIQUE(convention_id)               -- one table per show
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
  no_sale_streak INTEGER NOT NULL DEFAULT 0  -- stocked-but-zero-customer days
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
  sold_at TEXT NOT NULL
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
  sales_lift INTEGER NOT NULL DEFAULT 0    -- counter: attributed sales
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
-- PHASE 4: SHOP P&L LEDGER — every shop money event lands here with a
-- week key and a product line, so the weekly statement is a plain query.
-- =====================================================================
CREATE TABLE IF NOT EXISTS shop_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week TEXT NOT NULL,                 -- Monday date key, e.g. 2026-09-14
  line TEXT NOT NULL,                 -- cases | bulk | bags | rent | payroll | interest | overhead
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
