-- App Market Radar schema v1. All timestamps are UTC ISO-8601 strings.
-- Provenance values: observed (fetched by a provider), user (manual entry), imported (file import), demo (fictional seed).

CREATE TABLE markets (
  code TEXT PRIMARY KEY CHECK (length(code) = 2),
  name TEXT NOT NULL,
  default_language TEXT NOT NULL DEFAULT 'en',
  enabled INTEGER NOT NULL DEFAULT 0,
  validated_ios_at TEXT,
  validated_android_at TEXT,
  notes TEXT
);

CREATE TABLE unified_categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_game INTEGER NOT NULL DEFAULT 0
);

-- Original store categories, never renamed by the taxonomy. unified_slug is the editable many-to-one mapping.
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  store_category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_game INTEGER NOT NULL DEFAULT 0,
  parent_store_category_id TEXT,
  unified_slug TEXT REFERENCES unified_categories(slug) ON UPDATE CASCADE ON DELETE SET NULL,
  UNIQUE (platform, store_category_id)
);

CREATE TABLE publishers (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  store_publisher_id TEXT,
  name TEXT NOT NULL,
  url TEXT,
  provenance TEXT NOT NULL DEFAULT 'observed',
  created_at TEXT NOT NULL,
  UNIQUE (platform, store_publisher_id)
);
CREATE INDEX idx_publishers_name ON publishers(name);

-- A cross-store product grouping. Listings join a product only through a VERIFIED link.
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  store_id TEXT NOT NULL,
  bundle_id TEXT,
  title TEXT NOT NULL,
  publisher_id INTEGER REFERENCES publishers(id),
  category_id INTEGER REFERENCES categories(id),
  is_game INTEGER NOT NULL DEFAULT 0,
  icon_url TEXT,
  release_date TEXT,
  product_id INTEGER REFERENCES products(id),
  provenance TEXT NOT NULL DEFAULT 'observed',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  tracked INTEGER NOT NULL DEFAULT 0,
  UNIQUE (platform, store_id)
);
CREATE INDEX idx_listings_title ON listings(title);
CREATE INDEX idx_listings_publisher ON listings(publisher_id);
CREATE INDEX idx_listings_category ON listings(category_id);

CREATE TABLE ingestion_runs (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  job TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  items INTEGER NOT NULL DEFAULT 0,
  error_class TEXT,
  message TEXT,
  log TEXT
);
CREATE INDEX idx_runs_provider ON ingestion_runs(provider, started_at);

-- Store-level observations of a listing in one market/language. Imported history is flagged and never merged with observed rows.
CREATE TABLE listing_observations (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  language TEXT,
  provider TEXT NOT NULL,
  provenance TEXT NOT NULL,
  import_id INTEGER REFERENCES imports(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES ingestion_runs(id),
  snapshot_day TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_url TEXT,
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','unavailable','failed','unknown')),
  title TEXT,
  subtitle TEXT,
  description TEXT,
  version TEXT,
  store_updated_at TEXT,
  release_date TEXT,
  price REAL,
  currency TEXT,
  rating REAL,
  rating_count INTEGER,
  rating_scope TEXT,
  install_band TEXT,
  install_lower_bound INTEGER,
  has_ads INTEGER,
  has_iap INTEGER,
  content_rating TEXT,
  genre_label TEXT,
  UNIQUE (listing_id, market, provider, provenance, snapshot_day)
);
CREATE INDEX idx_obs_listing ON listing_observations(listing_id, market, snapshot_day);

CREATE TABLE chart_snapshots (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES ingestion_runs(id),
  import_id INTEGER REFERENCES imports(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provenance TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  market TEXT NOT NULL,
  device TEXT NOT NULL,
  chart_type TEXT NOT NULL CHECK (chart_type IN ('free','paid','grossing')),
  category TEXT NOT NULL DEFAULT 'all',
  category_scope TEXT NOT NULL CHECK (category_scope IN ('all','category','filtered_subset')),
  snapshot_day TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  requested_depth INTEGER,
  observed_depth INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('complete','partial','failed','empty')),
  source_url TEXT,
  error_class TEXT,
  UNIQUE (provider, provenance, platform, market, device, chart_type, category, category_scope, snapshot_day)
);
CREATE INDEX idx_snap_scope ON chart_snapshots(platform, market, device, chart_type, category, snapshot_day);

CREATE TABLE chart_entries (
  snapshot_id INTEGER NOT NULL REFERENCES chart_snapshots(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank >= 1),
  price REAL,
  currency TEXT,
  PRIMARY KEY (snapshot_id, listing_id)
);
CREATE INDEX idx_entries_listing ON chart_entries(listing_id);
CREATE INDEX idx_entries_rank ON chart_entries(snapshot_id, rank);

CREATE TABLE listing_links (
  id INTEGER PRIMARY KEY,
  listing_a INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  listing_b INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('suggested','verified','rejected')),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE (listing_a, listing_b),
  CHECK (listing_a < listing_b)
);

CREATE TABLE watchlists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  notes TEXT,
  tags TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE watchlist_items (
  watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  notes TEXT,
  tags TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (watchlist_id, listing_id)
);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES ingestion_runs(id),
  type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);

-- Ads, organic posts, creator content, screenshots: references, not copied media.
CREATE TABLE evidence (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('paid_ad','organic_post','sponsorship_unverified','creator','screenshot','store_page','other')),
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  publisher_id INTEGER REFERENCES publishers(id) ON DELETE SET NULL,
  channel TEXT,
  market TEXT,
  advertiser TEXT,
  creator TEXT,
  hook TEXT,
  format TEXT,
  url TEXT,
  search_url TEXT,
  local_path TEXT,
  first_observed TEXT,
  last_observed TEXT,
  metrics_json TEXT NOT NULL DEFAULT '[]',
  tags TEXT,
  notes TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  provenance TEXT NOT NULL DEFAULT 'user',
  import_id INTEGER REFERENCES imports(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_evidence_listing ON evidence(listing_id);

CREATE TABLE onboarding_teardowns (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  version_label TEXT,
  observed_at TEXT NOT NULL,
  market TEXT,
  device TEXT,
  first_meaningful_action TEXT,
  steps_to_value INTEGER,
  signup_friction TEXT,
  paywall_timing TEXT,
  permissions TEXT,
  pricing TEXT,
  trial_terms TEXT,
  evidence_url TEXT,
  local_path TEXT,
  notes TEXT,
  provenance TEXT NOT NULL DEFAULT 'user',
  import_id INTEGER REFERENCES imports(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE keywords (
  id INTEGER PRIMARY KEY,
  phrase TEXT NOT NULL,
  group_name TEXT,
  platform TEXT,
  market TEXT,
  notes TEXT,
  provenance TEXT NOT NULL DEFAULT 'user',
  import_id INTEGER REFERENCES imports(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (phrase, group_name, platform, market)
);
-- Positions only from a verified search source or user-owned imports (never inferred).
CREATE TABLE keyword_observations (
  id INTEGER PRIMARY KEY,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  observed_day TEXT NOT NULL,
  position INTEGER,
  search_volume REAL,
  volume_unit TEXT,
  difficulty REAL,
  source TEXT NOT NULL,
  provenance TEXT NOT NULL,
  import_id INTEGER REFERENCES imports(id) ON DELETE CASCADE
);

CREATE TABLE imports (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  filename TEXT,
  source_label TEXT,
  created_at TEXT NOT NULL,
  rows_total INTEGER NOT NULL,
  rows_ok INTEGER NOT NULL,
  rows_bad INTEGER NOT NULL,
  rows_duplicate INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  is_private INTEGER NOT NULL DEFAULT 1
);

-- Private first-party analytics (Play Console / App Store Connect exports). Never exported publicly.
CREATE TABLE first_party_metrics (
  id INTEGER PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  market TEXT,
  source TEXT NOT NULL,
  UNIQUE (listing_id, day, metric, market, source)
);

CREATE TABLE private_notes (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  publisher_id INTEGER REFERENCES publishers(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE http_cache (
  url TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT NOT NULL
);
