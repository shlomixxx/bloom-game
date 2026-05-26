import pg from 'pg';
import { readFile } from 'node:fs/promises';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString,
  // Railway Postgres uses self-signed certs → rejectUnauthorized must be false.
  // Set PGSSL_STRICT=true in environments with proper CA-signed certs.
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: process.env.PGSSL_STRICT === 'true' },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

export async function initDb() {
  if (!connectionString) {
    console.warn('[db] DATABASE_URL is not set — leaderboard endpoints will fail until it is.');
    return;
  }
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  try {
    await pool.query(schema);
    console.log('[db] schema ready');
  } catch (e) {
    // If schema.sql has any syntax error, the WHOLE query throws and no
    // tables get created. By isolating the schema attempt from the migrations
    // below, we ensure the migration array's CREATE TABLE IF NOT EXISTS
    // backup statements still run — so a typo in a seed INSERT doesn't take
    // down new feature tables that the migrations array also defines.
    console.error('[db] schema.sql failed (will rely on migration backups):', e.message);
  }

  // Auto-migrations: add columns that may be missing from older tables.
  // Each ALTER TABLE IF NOT EXISTS is safe to re-run.
  const migrations = [
    `ALTER TABLE player_heartbeat ADD COLUMN IF NOT EXISTS grid_json TEXT`,
    `ALTER TABLE contests ADD COLUMN IF NOT EXISTS wager_amount INT DEFAULT 0`,
    `ALTER TABLE contests ADD COLUMN IF NOT EXISTS wager_pool INT DEFAULT 0`,
    `ALTER TABLE contests ADD COLUMN IF NOT EXISTS wager_settled BOOLEAN DEFAULT false`,
    `ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS xp INT DEFAULT 0`,
    `ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS level INT DEFAULT 1`,
    // Player-chosen difficulty per contest/duel. NULL or 'default' = use admin
    // globals. Stored as a label + the resolved weights/speed so the server's
    // preset table is authoritative at creation time even if presets change later.
    `ALTER TABLE contests ADD COLUMN IF NOT EXISTS difficulty_label VARCHAR(20)`,
    `ALTER TABLE contests ADD COLUMN IF NOT EXISTS difficulty_weights VARCHAR(64)`,
    `ALTER TABLE contests ADD COLUMN IF NOT EXISTS difficulty_speed_pct INT`,
    // A7 — 7-Day Login Calendar columns on player_profiles.
    `ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS login_cal_day INT DEFAULT 0`,
    `ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS login_cal_last_claim DATE`,
    // A9 — Ghost Mode drops_sequence columns (full def in schema.sql).
    `ALTER TABLE daily_scores ADD COLUMN IF NOT EXISTS drops_sequence JSONB`,
    `ALTER TABLE difficulty_scores ADD COLUMN IF NOT EXISTS drops_sequence JSONB`,
    // M1 — Self-Promo Engine (full def in schema.sql).
    `CREATE TABLE IF NOT EXISTS internal_promos (
      id              BIGSERIAL PRIMARY KEY,
      slug            VARCHAR(60) UNIQUE NOT NULL,
      kind            VARCHAR(40) NOT NULL,
      title           VARCHAR(120) NOT NULL,
      body            VARCHAR(400) NOT NULL,
      cta_text        VARCHAR(60) NOT NULL DEFAULT 'קנה עכשיו',
      cta_target      VARCHAR(60) NOT NULL,
      image_emoji     VARCHAR(8) NOT NULL DEFAULT '🎁',
      bg_gradient     VARCHAR(120),
      level_min       INT NOT NULL DEFAULT 1,
      level_max       INT NOT NULL DEFAULT 999,
      weight          INT NOT NULL DEFAULT 100,
      is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
      starts_at       TIMESTAMPTZ,
      ends_at         TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_promos_enabled_kind ON internal_promos (is_enabled, kind)`,
    `CREATE TABLE IF NOT EXISTS promo_impressions (
      id              BIGSERIAL PRIMARY KEY,
      promo_id        BIGINT NOT NULL REFERENCES internal_promos(id) ON DELETE CASCADE,
      device_id       VARCHAR(64) NOT NULL,
      slot            VARCHAR(30) NOT NULL,
      shown_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_promo_impr_device_time ON promo_impressions (device_id, shown_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_promo_impr_promo ON promo_impressions (promo_id, shown_at DESC)`,
    `CREATE TABLE IF NOT EXISTS promo_clicks (
      id              BIGSERIAL PRIMARY KEY,
      promo_id        BIGINT NOT NULL REFERENCES internal_promos(id) ON DELETE CASCADE,
      device_id       VARCHAR(64) NOT NULL,
      slot            VARCHAR(30) NOT NULL,
      clicked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_promo_clicks_promo ON promo_clicks (promo_id, clicked_at DESC)`,
    // A5 — Live PvP Race columns on duels (full def in schema.sql).
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS is_live BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS duration_seconds INT DEFAULT 60`,
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS challenger_live_score INT DEFAULT 0`,
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS opponent_live_score INT DEFAULT 0`,
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS live_last_heartbeat_at TIMESTAMPTZ`,
    // A8 — Squad Tournaments (full def in schema.sql).
    `CREATE TABLE IF NOT EXISTS squad_tournaments (
      id              BIGSERIAL PRIMARY KEY,
      week_start      DATE NOT NULL,
      status          VARCHAR(20) NOT NULL DEFAULT 'active',
      winner_guild_id INT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      semifinals_at   TIMESTAMPTZ,
      finals_at       TIMESTAMPTZ,
      finished_at     TIMESTAMPTZ,
      UNIQUE (week_start)
    )`,
    `CREATE TABLE IF NOT EXISTS squad_tournament_guilds (
      tournament_id      BIGINT NOT NULL REFERENCES squad_tournaments(id) ON DELETE CASCADE,
      guild_id           INT NOT NULL,
      bracket_position   INT NOT NULL,
      score_total        BIGINT NOT NULL DEFAULT 0,
      games_count        INT NOT NULL DEFAULT 0,
      eliminated_at      TIMESTAMPTZ,
      semifinal_winner   BOOLEAN NOT NULL DEFAULT FALSE,
      final_winner       BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (tournament_id, guild_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_squad_guilds_guild ON squad_tournament_guilds (guild_id)`,
    `CREATE TABLE IF NOT EXISTS squad_tournament_contributions (
      tournament_id BIGINT NOT NULL REFERENCES squad_tournaments(id) ON DELETE CASCADE,
      device_id     VARCHAR(64) NOT NULL,
      guild_id      INT NOT NULL,
      score_contrib BIGINT NOT NULL DEFAULT 0,
      games_count   INT NOT NULL DEFAULT 0,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tournament_id, device_id)
    )`,
    `CREATE TABLE IF NOT EXISTS squad_tournament_claims (
      tournament_id BIGINT NOT NULL REFERENCES squad_tournaments(id) ON DELETE CASCADE,
      device_id     VARCHAR(64) NOT NULL,
      amount        INT NOT NULL,
      claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tournament_id, device_id)
    )`,
    // A10 — Compound Interest Gem Bank (full def in schema.sql).
    `CREATE TABLE IF NOT EXISTS gem_bank (
      device_id          VARCHAR(64) PRIMARY KEY,
      deposited          BIGINT NOT NULL DEFAULT 0,
      total_interest_paid BIGINT NOT NULL DEFAULT 0,
      last_interest_date DATE,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS difficulty_label VARCHAR(20)`,
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS difficulty_weights VARCHAR(64)`,
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS difficulty_speed_pct INT`,
    // A6 — flag for random matchmaking duels so the find-random endpoint
    // can locate recently-paired duels for the OTHER player (who's still
    // polling and doesn't know they matched until next poll).
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS is_random_match BOOLEAN DEFAULT FALSE`,
    // Needed by the chest / comeback / streak-freeze UPDATEs added in May 2026.
    // schema.sql also has this ALTER, but include here as belt-and-suspenders
    // since several endpoints will 500 without it.
    `ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    // Stage 17 — Premium Battle Pass columns.
    `ALTER TABLE player_season_progress ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE player_season_progress ADD COLUMN IF NOT EXISTS premium_purchased_at TIMESTAMPTZ`,
    `ALTER TABLE player_season_progress ADD COLUMN IF NOT EXISTS claimed_premium_tiers JSONB NOT NULL DEFAULT '[]'::jsonb`,
    // Stage 20 — Starter Pack table (idempotent — full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS starter_pack_state (
      device_id      VARCHAR(64) PRIMARY KEY,
      season_id      VARCHAR(32) NOT NULL DEFAULT 'S1',
      first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      eligible_at    TIMESTAMPTZ,
      expires_at     TIMESTAMPTZ,
      purchased_at   TIMESTAMPTZ,
      dismissed_count INT NOT NULL DEFAULT 0,
      pack_contents  JSONB,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Stage 34 — Weekly Leagues (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS player_weekly_xp (
      device_id          VARCHAR(64) NOT NULL,
      week_start         DATE NOT NULL,
      xp_at_week_start   BIGINT NOT NULL,
      best_league_seen   VARCHAR(20),
      reward_claimed     BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (device_id, week_start)
    )`,
    // Stage 36 — Daily Spin Wheel (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS daily_spin_state (
      device_id        VARCHAR(64) PRIMARY KEY,
      last_spin_date   DATE,
      current_streak   INT NOT NULL DEFAULT 0,
      longest_streak   INT NOT NULL DEFAULT 0,
      total_spins      INT NOT NULL DEFAULT 0,
      total_gems_won   BIGINT NOT NULL DEFAULT 0,
      last_reward      JSONB,
      last_spin_at     TIMESTAMPTZ
    )`,
    // Stage 37 — Guild Wars (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS guild_wars (
      id              BIGSERIAL PRIMARY KEY,
      guild_a_id      INT NOT NULL,
      guild_b_id      INT NOT NULL,
      starts_at       TIMESTAMPTZ NOT NULL,
      ends_at         TIMESTAMPTZ NOT NULL,
      guild_a_score   BIGINT NOT NULL DEFAULT 0,
      guild_b_score   BIGINT NOT NULL DEFAULT 0,
      guild_a_games   INT NOT NULL DEFAULT 0,
      guild_b_games   INT NOT NULL DEFAULT 0,
      status          VARCHAR(20) NOT NULL DEFAULT 'active',
      winner_guild_id INT,
      finalized_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS guild_war_contributions (
      war_id              BIGINT NOT NULL,
      device_id           VARCHAR(64) NOT NULL,
      guild_id            INT NOT NULL,
      score_contribution  BIGINT NOT NULL DEFAULT 0,
      games_count         INT NOT NULL DEFAULT 0,
      last_contrib_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (war_id, device_id)
    )`,
    `CREATE TABLE IF NOT EXISTS guild_war_claims (
      war_id              BIGINT NOT NULL,
      device_id           VARCHAR(64) NOT NULL,
      claimed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reward_gems         INT NOT NULL,
      PRIMARY KEY (war_id, device_id)
    )`,
    // Stage 38 — Trophy Road (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS player_trophies (
      device_id            VARCHAR(64) PRIMARY KEY,
      trophies             INT NOT NULL DEFAULT 0,
      trophies_lifetime    BIGINT NOT NULL DEFAULT 0,
      highest_trophies     INT NOT NULL DEFAULT 0,
      current_arena_id     VARCHAR(30) NOT NULL DEFAULT 'sprout',
      claimed_milestones   JSONB NOT NULL DEFAULT '[]'::jsonb,
      total_games          INT NOT NULL DEFAULT 0,
      total_wins           INT NOT NULL DEFAULT 0,
      last_change          INT NOT NULL DEFAULT 0,
      last_change_at       TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS trophy_history (
      id                 BIGSERIAL PRIMARY KEY,
      device_id          VARCHAR(64) NOT NULL,
      change_amount      INT NOT NULL,
      before_trophies    INT NOT NULL,
      after_trophies     INT NOT NULL,
      reason             VARCHAR(40) NOT NULL,
      meta               JSONB,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // 🚨 player_issues (May 2026) — issue tracker + compensation log.
    `CREATE TABLE IF NOT EXISTS player_issues (
      id                  BIGSERIAL PRIMARY KEY,
      device_id           VARCHAR(64) NOT NULL,
      player_code         VARCHAR(20),
      display_name        VARCHAR(120),
      kind                VARCHAR(40) NOT NULL,
      severity            VARCHAR(10) NOT NULL DEFAULT 'medium',
      title               TEXT NOT NULL,
      detail              TEXT,
      context             JSONB,
      source              VARCHAR(20) DEFAULT 'auto',
      reported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status              VARCHAR(15) NOT NULL DEFAULT 'open',
      resolved_at         TIMESTAMPTZ,
      resolution_notes    TEXT,
      compensation_amount INT DEFAULT 0,
      compensation_paid   BOOLEAN DEFAULT FALSE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_player_issues_status ON player_issues (status, reported_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_player_issues_device ON player_issues (device_id, reported_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_player_issues_kind ON player_issues (kind, reported_at DESC)`,
    // A6 — Skill-based Duel Matchmaking queue (full def in schema.sql).
    `CREATE TABLE IF NOT EXISTS duel_matchmaking_queue (
      device_id        VARCHAR(64) PRIMARY KEY,
      trophy_count     INT NOT NULL DEFAULT 0,
      display_name     VARCHAR(80),
      player_code      VARCHAR(10),
      joined_queue_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      poll_count       INT NOT NULL DEFAULT 0,
      difficulty_label VARCHAR(20) NOT NULL DEFAULT 'default'
    )`,
    `CREATE INDEX IF NOT EXISTS idx_duel_queue_trophies
      ON duel_matchmaking_queue (trophy_count, joined_queue_at)`,
    // A2 — Friend Challenges (full def in schema.sql).
    `CREATE TABLE IF NOT EXISTS friend_challenges (
      id                  BIGSERIAL PRIMARY KEY,
      challenger_device   VARCHAR(64) NOT NULL,
      challenged_device   VARCHAR(64) NOT NULL,
      challenger_name     VARCHAR(80),
      challenged_name     VARCHAR(80),
      target_score        INT NOT NULL,
      board_id            INT,
      board_name          VARCHAR(120),
      message             VARCHAR(200),
      status              VARCHAR(20) NOT NULL DEFAULT 'pending',
      result_score        INT,
      result_at           TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at          TIMESTAMPTZ NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_friend_challenges_challenged_pending
      ON friend_challenges (challenged_device, status) WHERE status = 'pending'`,
    `CREATE INDEX IF NOT EXISTS idx_friend_challenges_challenger_active
      ON friend_challenges (challenger_device, created_at DESC)`,
    // A3 — Trophy Chests (Clash Royale must-return pattern; full def in schema.sql).
    `CREATE TABLE IF NOT EXISTS trophy_chests (
      id                BIGSERIAL PRIMARY KEY,
      device_id         VARCHAR(64) NOT NULL,
      chest_type        VARCHAR(20) NOT NULL,
      earned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      unlock_started_at TIMESTAMPTZ,
      opens_at          TIMESTAMPTZ,
      claimed_at        TIMESTAMPTZ,
      reward_gems       INT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_trophy_chests_device_unclaimed
      ON trophy_chests (device_id) WHERE claimed_at IS NULL`,
    // Stage 33 — Rivalry System (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS player_rivalries (
      id                BIGSERIAL PRIMARY KEY,
      device_id         VARCHAR(64) NOT NULL,
      rival_device_id   VARCHAR(64) NOT NULL,
      my_xp_at_decl     BIGINT NOT NULL,
      rival_xp_at_decl  BIGINT NOT NULL,
      declared_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at        TIMESTAMPTZ NOT NULL,
      resolved          BOOLEAN NOT NULL DEFAULT FALSE,
      outcome           VARCHAR(20),
      resolved_at       TIMESTAMPTZ,
      viewed_by_player  BOOLEAN NOT NULL DEFAULT FALSE
    )`,
    // Stage 27 — Guilds (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS guilds (
      id                  SERIAL PRIMARY KEY,
      code                VARCHAR(8) UNIQUE NOT NULL,
      name                VARCHAR(60) NOT NULL,
      emoji               VARCHAR(10),
      description         TEXT,
      creator_device_id   VARCHAR(64) NOT NULL,
      member_count        INT NOT NULL DEFAULT 1,
      total_score_alltime BIGINT NOT NULL DEFAULT 0,
      is_public           BOOLEAN NOT NULL DEFAULT TRUE,
      max_members         INT NOT NULL DEFAULT 30,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS guild_members (
      guild_id            INT NOT NULL,
      device_id           VARCHAR(64) NOT NULL,
      role                VARCHAR(20) NOT NULL DEFAULT 'member',
      joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_score_contrib BIGINT NOT NULL DEFAULT 0,
      total_crowns_contrib INT NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, device_id)
    )`,
    `CREATE TABLE IF NOT EXISTS guild_daily_progress (
      guild_id           INT NOT NULL,
      date               DATE NOT NULL,
      goal_target        INT NOT NULL DEFAULT 30,
      goal_progress      INT NOT NULL DEFAULT 0,
      is_complete        BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at       TIMESTAMPTZ,
      PRIMARY KEY (guild_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS guild_member_claims (
      guild_id      INT NOT NULL,
      device_id     VARCHAR(64) NOT NULL,
      date          DATE NOT NULL,
      reward_gems   INT NOT NULL,
      claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, device_id, date)
    )`,
    // Stage 32 — Replay Sharing (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS replay_shares (
      id              BIGSERIAL PRIMARY KEY,
      device_id       VARCHAR(64) NOT NULL,
      score           INT NOT NULL,
      tier            INT,
      mode            VARCHAR(20),
      shared_via      VARCHAR(20),
      is_new_best     BOOLEAN DEFAULT FALSE,
      shared_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Stage 31 — Smart Notifications (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS player_push_state (
      device_id           VARCHAR(64) PRIMARY KEY,
      last_sent_at        TIMESTAMPTZ,
      last_send_reason    VARCHAR(40),
      total_sent          INT NOT NULL DEFAULT 0,
      last_scan_at        TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Stage 30 — Lifetime Progression (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS player_lifetime_state (
      device_id            VARCHAR(64) PRIMARY KEY,
      cached_xp            BIGINT NOT NULL DEFAULT 0,
      prestige_count       INT NOT NULL DEFAULT 0,
      last_prestige_at     TIMESTAMPTZ,
      cosmetic_unlocks     JSONB NOT NULL DEFAULT '[]'::jsonb,
      current_title        VARCHAR(40),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Stage 29 — Tile Collection Album (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS player_tile_collection (
      device_id           VARCHAR(64) NOT NULL,
      board_id            INT NOT NULL,
      tier                INT NOT NULL CHECK (tier >= 1 AND tier <= 8),
      first_collected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (device_id, board_id, tier)
    )`,
    `CREATE TABLE IF NOT EXISTS player_collection_claims (
      id           BIGSERIAL PRIMARY KEY,
      device_id    VARCHAR(64) NOT NULL,
      claim_type   VARCHAR(20) NOT NULL,
      target_id    INT NOT NULL,
      reward_gems  INT NOT NULL,
      claimed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_claims_uniq
       ON player_collection_claims (device_id, claim_type, target_id)`,
    // Stage 16 — Achievement-driven Cross-Leaderboard (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS player_achievements (
      id              BIGSERIAL PRIMARY KEY,
      device_id       VARCHAR(64) NOT NULL,
      achievement_key VARCHAR(120) NOT NULL,
      unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_player_achievements_uniq
       ON player_achievements (device_id, achievement_key)`,
    // Stage 25 — Limited-time Bundles (full CREATE + seed in schema.sql).
    `CREATE TABLE IF NOT EXISTS limited_bundles (
      id                      SERIAL PRIMARY KEY,
      slug                    VARCHAR(40) UNIQUE NOT NULL,
      name                    VARCHAR(120) NOT NULL,
      description             TEXT,
      emoji                   VARCHAR(10),
      theme_color             VARCHAR(20) DEFAULT '#A855F7',
      decoration_emoji        VARCHAR(10),
      price_gems              INT NOT NULL,
      original_value          INT,
      contents                JSONB NOT NULL DEFAULT '{}'::jsonb,
      starts_at               TIMESTAMPTZ NOT NULL,
      ends_at                 TIMESTAMPTZ NOT NULL,
      is_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
      max_purchases_per_device INT NOT NULL DEFAULT 1,
      sort_order              INT NOT NULL DEFAULT 100,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS limited_bundle_purchases (
      id                SERIAL PRIMARY KEY,
      device_id         VARCHAR(64) NOT NULL,
      bundle_id         INT NOT NULL,
      price_paid        INT,
      contents_snapshot JSONB,
      purchased_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Stage 28 — Pet/Mascot table (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS player_pet (
      device_id           VARCHAR(64) PRIMARY KEY,
      pet_name            VARCHAR(40),
      level               INT NOT NULL DEFAULT 1,
      xp                  INT NOT NULL DEFAULT 0,
      last_visited_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_fed_at         TIMESTAMPTZ,
      last_petted_at      TIMESTAMPTZ,
      last_petted_date    DATE,
      feeds_today         INT NOT NULL DEFAULT 0,
      feeds_today_date    DATE,
      total_fed_count     INT NOT NULL DEFAULT 0,
      total_pet_count     INT NOT NULL DEFAULT 0,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Stage 26 — Live Ops Calendar (full CREATE + seed in schema.sql).
    `CREATE TABLE IF NOT EXISTS calendar_events (
      id            SERIAL PRIMARY KEY,
      event_date    DATE NOT NULL,
      title         VARCHAR(120) NOT NULL,
      description   TEXT,
      emoji         VARCHAR(10),
      category      VARCHAR(40),
      starts_at     TIMESTAMPTZ,
      ends_at       TIMESTAMPTZ,
      is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order    INT NOT NULL DEFAULT 100,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Stage 19 — Lives / Energy table (full CREATE in schema.sql).
    `CREATE TABLE IF NOT EXISTS player_lives_state (
      device_id          VARCHAR(64) PRIMARY KEY,
      current_lives      INT NOT NULL DEFAULT 5,
      max_lives          INT NOT NULL DEFAULT 5,
      last_regen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_lives_spent  INT NOT NULL DEFAULT 0,
      total_ads_watched  INT NOT NULL DEFAULT 0,
      total_gems_spent   INT NOT NULL DEFAULT 0,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Stage 18 — Skin Gacha tables (full CREATE + seed in schema.sql).
    `CREATE TABLE IF NOT EXISTS gacha_pool (
      id           SERIAL PRIMARY KEY,
      rarity       VARCHAR(20) NOT NULL,
      reward_type  VARCHAR(40) NOT NULL,
      amount       INT,
      skin_id      VARCHAR(40),
      display_name VARCHAR(80),
      emoji        VARCHAR(10),
      weight       INT NOT NULL DEFAULT 100,
      is_featured  BOOLEAN NOT NULL DEFAULT FALSE,
      is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS player_gacha_state (
      device_id              VARCHAR(64) PRIMARY KEY,
      total_pulls            INT NOT NULL DEFAULT 0,
      pity_counter           INT NOT NULL DEFAULT 0,
      free_pull_claimed_date DATE,
      last_pull_at           TIMESTAMPTZ,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS gacha_pulls_history (
      id           BIGSERIAL PRIMARY KEY,
      device_id    VARCHAR(64) NOT NULL,
      pull_index   INT NOT NULL,
      rarity       VARCHAR(20) NOT NULL,
      reward_type  VARCHAR(40) NOT NULL,
      amount       INT,
      skin_id      VARCHAR(40),
      display_name VARCHAR(80),
      emoji        VARCHAR(10),
      was_pity     BOOLEAN NOT NULL DEFAULT FALSE,
      was_featured BOOLEAN NOT NULL DEFAULT FALSE,
      was_free     BOOLEAN NOT NULL DEFAULT FALSE,
      pulled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Stage 21 — Daily Deals tables (full CREATE + seed in schema.sql).
    `CREATE TABLE IF NOT EXISTS daily_deals (
      id            SERIAL PRIMARY KEY,
      slug          VARCHAR(40) UNIQUE NOT NULL,
      name          VARCHAR(80) NOT NULL,
      description   TEXT,
      emoji         VARCHAR(10),
      price_gems    INT NOT NULL,
      original_value INT,
      contents      JSONB NOT NULL DEFAULT '{}'::jsonb,
      category      VARCHAR(40),
      is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order    INT NOT NULL DEFAULT 100,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS daily_deal_purchases (
      device_id     VARCHAR(64) NOT NULL,
      deal_id       INT NOT NULL,
      purchase_date DATE NOT NULL,
      price_paid    INT,
      contents_snapshot JSONB,
      purchased_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (device_id, deal_id, purchase_date)
    )`,
    // Power Hero (May 2026): flip existing prod DBs from 'standard' → 'hero'.
    // The schema.sql INSERT only runs for fresh rows (ON CONFLICT DO NOTHING),
    // so existing installs need this one-time UPDATE. Idempotent — only flips
    // if the value is still the old default; respects any admin override.
    `UPDATE game_config SET value = 'hero' WHERE key = 'home_variant' AND value = 'standard'`,
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); } catch (e) {
      console.warn('[db] migration skipped:', e.message);
    }
  }
  console.log('[db] migrations done');

  await seedSkinConfigurations();
}

// Seed the 7 historical skins into skin_configurations on first boot.
// Idempotent: ON CONFLICT (skin_id) DO NOTHING so admin tweaks survive.
// The tier definitions mirror SKIN_PACKS in src/01-constants.js — keep
// in sync if a default skin ever needs a visual rebalance, otherwise
// admins manage via the dashboard.
async function seedSkinConfigurations() {
  const SEED = [
    { skin_id: 'classic', name: '🌸 קלאסי', price: 0,   sort: 10,  tiers: [
      { bg: '#D3D1C7', fg: '#2C2C2A', svg_key: 'circle',  name: 'אבן',   emoji: '⬜' },
      { bg: '#C0DD97', fg: '#173404', svg_key: 'leaf',    name: 'עלה',   emoji: '🟩' },
      { bg: '#F4C0D1', fg: '#4B1528', svg_key: 'flower',  name: 'פרח',   emoji: '🟧' },
      { bg: '#F5C4B3', fg: '#4A1B0C', svg_key: 'flame',   name: 'אש',    emoji: '🟥' },
      { bg: '#FAC775', fg: '#412402', svg_key: 'bolt',    name: 'ברק',   emoji: '🟨' },
      { bg: '#9FE1CB', fg: '#04342C', svg_key: 'star',    name: 'כוכב',  emoji: '🟦' },
      { bg: '#B5D4F4', fg: '#042C53', svg_key: 'diamond', name: 'יהלום', emoji: '💎' },
      { bg: '#CECBF6', fg: '#26215C', svg_key: 'crown',   name: 'כתר',   emoji: '👑' }
    ]},
    { skin_id: 'ocean', name: '🌊 אוקיינוס', price: 200, sort: 20, tiers: [
      { bg: '#B8D4E3', fg: '#1A3A4A', svg_key: 'circle',  name: 'חול',     emoji: '⬜' },
      { bg: '#7EC8E3', fg: '#0A2540', svg_key: 'leaf',    name: 'גל',      emoji: '🟦' },
      { bg: '#4CA1AF', fg: '#FFFFFF', svg_key: 'flower',  name: 'אלמוג',   emoji: '🟧' },
      { bg: '#2C7DA0', fg: '#FFFFFF', svg_key: 'flame',   name: 'דג',      emoji: '🟥' },
      { bg: '#1B6B93', fg: '#FFFFFF', svg_key: 'bolt',    name: 'דולפין',  emoji: '🟨' },
      { bg: '#14557B', fg: '#FFD700', svg_key: 'star',    name: 'כוכב ים', emoji: '⭐' },
      { bg: '#0E3F5C', fg: '#7FDBFF', svg_key: 'diamond', name: 'פנינה',   emoji: '💎' },
      { bg: '#072A40', fg: '#FFD700', svg_key: 'crown',   name: 'פוסיידון', emoji: '👑' }
    ]},
    { skin_id: 'candy', name: '🍬 ממתקים', price: 200, sort: 30, tiers: [
      { bg: '#FFDEE9', fg: '#6B2043', svg_key: 'circle',  name: 'סוכריה', emoji: '⬜' },
      { bg: '#FF9AA2', fg: '#5C1A25', svg_key: 'leaf',    name: 'מסטיק', emoji: '🟩' },
      { bg: '#FFB7B2', fg: '#5C2A25', svg_key: 'flower',  name: 'גומי',  emoji: '🟧' },
      { bg: '#E2979C', fg: '#FFFFFF', svg_key: 'flame',   name: 'שוקולד', emoji: '🟥' },
      { bg: '#FFC8A2', fg: '#5C3A12', svg_key: 'bolt',    name: 'קרמל',  emoji: '🟨' },
      { bg: '#B5EAD7', fg: '#1A4A35', svg_key: 'star',    name: 'מנטה',  emoji: '🟦' },
      { bg: '#C7CEEA', fg: '#2A2D5E', svg_key: 'diamond', name: 'לביבה', emoji: '💎' },
      { bg: '#E8D5B7', fg: '#5C3A12', svg_key: 'crown',   name: 'עוגה',  emoji: '👑' }
    ]},
    { skin_id: 'space', name: '🌙 חלל', price: 300, sort: 40, tiers: [
      { bg: '#2D283E', fg: '#B8B5C8', svg_key: 'circle',  name: 'אבק',     emoji: '⬜' },
      { bg: '#564F6F', fg: '#E0DFEE', svg_key: 'leaf',    name: 'סלע',     emoji: '🟩' },
      { bg: '#4A2A7A', fg: '#D4A5FF', svg_key: 'flower',  name: 'ערפילית', emoji: '🟧' },
      { bg: '#9B59B6', fg: '#FFFFFF', svg_key: 'flame',   name: 'כוכב',    emoji: '🟥' },
      { bg: '#E74C3C', fg: '#FFFFFF', svg_key: 'bolt',    name: 'סופרנובה', emoji: '🟨' },
      { bg: '#F39C12', fg: '#FFFFFF', svg_key: 'star',    name: 'שמש',     emoji: '🟦' },
      { bg: '#3498DB', fg: '#FFFFFF', svg_key: 'diamond', name: 'גלקסיה',  emoji: '💎' },
      { bg: '#1A1A2E', fg: '#FFD700', svg_key: 'crown',   name: 'חור שחור', emoji: '👑' }
    ]},
    { skin_id: 'fire', name: '🔥 אש וקרח', price: 300, sort: 50, tiers: [
      { bg: '#E8E8E8', fg: '#333333', svg_key: 'circle',  name: 'אפר',    emoji: '⬜' },
      { bg: '#A8D8EA', fg: '#1A3A4A', svg_key: 'leaf',    name: 'קרח',    emoji: '🟩' },
      { bg: '#78C4D4', fg: '#0A2540', svg_key: 'flower',  name: 'כפור',   emoji: '🟧' },
      { bg: '#FFB347', fg: '#5C2A00', svg_key: 'flame',   name: 'ניצוץ',  emoji: '🟥' },
      { bg: '#FF6B35', fg: '#FFFFFF', svg_key: 'bolt',    name: 'להבה',   emoji: '🟨' },
      { bg: '#E63946', fg: '#FFFFFF', svg_key: 'star',    name: 'אש',     emoji: '🟦' },
      { bg: '#1D3557', fg: '#A8DADC', svg_key: 'diamond', name: 'קריסטל', emoji: '💎' },
      { bg: '#0D1B2A', fg: '#FFD700', svg_key: 'crown',   name: 'דרקון',  emoji: '👑' }
    ]},
    { skin_id: 'gold', name: '✨ VIP זהב', price: 500, sort: 60, tiers: [
      { bg: '#F5F0E1', fg: '#7A6B4E', svg_key: 'circle',  name: 'חול',    emoji: '⬜' },
      { bg: '#E8D9A0', fg: '#5C4A12', svg_key: 'leaf',    name: 'נחושת', emoji: '🟩' },
      { bg: '#D4AF37', fg: '#3A2A00', svg_key: 'flower',  name: 'ברונזה', emoji: '🟧' },
      { bg: '#C5A028', fg: '#FFFFFF', svg_key: 'flame',   name: 'כסף',    emoji: '🟥' },
      { bg: '#B8941E', fg: '#FFFFFF', svg_key: 'bolt',    name: 'זהב',    emoji: '🟨' },
      { bg: '#A07818', fg: '#FFFFFF', svg_key: 'star',    name: 'פלטינה', emoji: '🟦' },
      { bg: '#8B6914', fg: '#FFE4A0', svg_key: 'diamond', name: 'יהלום',  emoji: '💎' },
      { bg: '#6B4E0A', fg: '#FFD700', svg_key: 'crown',   name: 'מלך',    emoji: '👑' }
    ]},
    { skin_id: 'aurora', name: '🌌 אורורה', price: 300, sort: 70, special_class: 'aurora', tiers: [
      { bg: 'linear-gradient(140deg,#EBE7DA 0%,#C0BAA8 100%)', fg: '#3D3A33', svg_key: 'circle',  name: 'אבן',   emoji: '⬜' },
      { bg: 'linear-gradient(140deg,#D9EDB7 0%,#88B450 100%)', fg: '#1F3A0E', svg_key: 'leaf',    name: 'עלה',   emoji: '🟩' },
      { bg: 'linear-gradient(140deg,#FFD3E2 0%,#E07AA8 100%)', fg: '#5C1A38', svg_key: 'flower',  name: 'פרח',   emoji: '🟧' },
      { bg: 'linear-gradient(140deg,#FFC4A0 0%,#EE7548 100%)', fg: '#5A1E08', svg_key: 'flame',   name: 'אש',    emoji: '🟥' },
      { bg: 'linear-gradient(140deg,#FFDA7A 0%,#E89010 100%)', fg: '#3A1F00', svg_key: 'bolt',    name: 'ברק',   emoji: '🟨' },
      { bg: 'linear-gradient(140deg,#A8EBD0 0%,#2DAC85 100%)', fg: '#013024', svg_key: 'star',    name: 'כוכב',  emoji: '🟦' },
      { bg: 'linear-gradient(140deg,#B8D5F8 0%,#3F88D8 100%)', fg: '#042C53', svg_key: 'diamond', name: 'יהלום', emoji: '💎' },
      { bg: 'linear-gradient(110deg,#F0E8FF 0%,#9B8AE8 20%,#F5C8E8 40%,#9B8AE8 60%,#FFD37A 80%,#9B8AE8 100%)', fg: '#26215C', svg_key: 'crown', name: 'כתר', emoji: '👑' }
    ]}
  ];
  try {
    for (const s of SEED) {
      const def = JSON.stringify({ tiers: s.tiers });
      await pool.query(
        `INSERT INTO skin_configurations
           (skin_id, name, price, is_enabled, is_sellable, definition, special_class, sort_order)
         VALUES ($1, $2, $3, TRUE, TRUE, $4::jsonb, $5, $6)
         ON CONFLICT (skin_id) DO NOTHING`,
        [s.skin_id, s.name, s.price, def, s.special_class || null, s.sort]
      );
    }
    console.log('[db] skin_configurations seeded');
  } catch (e) {
    console.warn('[db] skin seed failed:', e.message);
  }
}
