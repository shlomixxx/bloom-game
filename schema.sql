-- BLOOM Database Schema - גרסה מאוחדת
-- מצב יומי (קיים) + תחרויות חברים (חדש)
-- db.js יריץ את כל הקובץ הזה בהפעלת השרת. בטוח להריץ פעמיים.

-- ============================================================
-- מצב יומי (Daily Challenge) - הטבלה הקיימת שלך
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_scores (
  date         DATE NOT NULL,
  device_id    VARCHAR(64) NOT NULL,
  name         VARCHAR(32) NOT NULL DEFAULT 'אנונימי',
  score        INTEGER NOT NULL DEFAULT 0,
  tier         INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, device_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_scores_date_score
  ON daily_scores (date, score DESC);

-- Country (ISO-3166 alpha-2). Populated from the flag picker on first home.
-- NULL = player hasn't picked yet. Used for the "מדינתי" leaderboard tab.
ALTER TABLE daily_scores ADD COLUMN IF NOT EXISTS country VARCHAR(2);
CREATE INDEX IF NOT EXISTS idx_daily_scores_country
  ON daily_scores (country, date, score DESC) WHERE country IS NOT NULL;

-- drops: number of pieces the player dropped during this game. Required by
-- /api/score going forward — the challengeDropsImplausible() heuristic uses
-- it to retroactively flag impossible scores. Pre-existing rows are NULL;
-- admin queries should filter where drops IS NOT NULL when joining on it.
ALTER TABLE daily_scores ADD COLUMN IF NOT EXISTS drops INTEGER;

-- Migration: legacy DBs created `date` as TEXT; admin queries compare it to
-- CURRENT_DATE. Postgres rejects `text = date` without an explicit cast.
-- Idempotent: only ALTERs if the column is still text.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_scores' AND column_name = 'date' AND data_type = 'text'
  ) THEN
    ALTER TABLE daily_scores ALTER COLUMN date TYPE DATE USING date::date;
  END IF;
END $$;

-- ============================================================
-- תחרויות חברים (Friends Competitions) - חדש
-- ============================================================

CREATE TABLE IF NOT EXISTS contests (
  code             VARCHAR(8) PRIMARY KEY,
  name             VARCHAR(100) NOT NULL,
  host_name        VARCHAR(50) NOT NULL,
  host_device_id   VARCHAR(64) NOT NULL,
  board_seed       BIGINT,
  board_type       VARCHAR(20) NOT NULL DEFAULT 'shared',
  duration_days    INTEGER NOT NULL DEFAULT 7,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  ends_at          TIMESTAMP NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_contests_ends_at
  ON contests (ends_at);

CREATE INDEX IF NOT EXISTS idx_contests_host
  ON contests (host_device_id);

-- Weekly auto-challenge support: distinguish private vs weekly contests
ALTER TABLE contests ADD COLUMN IF NOT EXISTS contest_type VARCHAR(20) NOT NULL DEFAULT 'private';

CREATE TABLE IF NOT EXISTS contest_scores (
  id              SERIAL PRIMARY KEY,
  contest_code    VARCHAR(8) NOT NULL REFERENCES contests(code) ON DELETE CASCADE,
  device_id       VARCHAR(64) NOT NULL,
  display_name    VARCHAR(50) NOT NULL,
  score           INTEGER NOT NULL DEFAULT 0,
  highest_tier    INTEGER NOT NULL DEFAULT 1,
  games_played    INTEGER NOT NULL DEFAULT 0,
  joined_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  last_played_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (contest_code, device_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_scores_contest_score
  ON contest_scores (contest_code, score DESC);

-- ============================================================
-- מצב חי בתחרות (Live state + spectators) — חדש
-- ============================================================
-- שורה אחת לכל (תחרות, מכשיר) בזמן שמשחק.
-- היעדר עדכון יותר מ-10s נחשב "לא במשחק" (סינון בקריאה, ללא cron).

CREATE TABLE IF NOT EXISTS contest_live_state (
  contest_code    VARCHAR(8) NOT NULL REFERENCES contests(code) ON DELETE CASCADE,
  device_id       VARCHAR(64) NOT NULL,
  display_name    VARCHAR(50) NOT NULL,
  live_score      INTEGER NOT NULL DEFAULT 0,
  highest_tier    INTEGER NOT NULL DEFAULT 1,
  next_tier       INTEGER,
  grid_json       TEXT,
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contest_code, device_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_live_state_updated
  ON contest_live_state (contest_code, updated_at DESC);

-- שורה אחת לכל זוג (צופה, נצפה). heartbeat מ-frontend כל 5s.
CREATE TABLE IF NOT EXISTS contest_watchers (
  contest_code        VARCHAR(8) NOT NULL REFERENCES contests(code) ON DELETE CASCADE,
  watcher_device_id   VARCHAR(64) NOT NULL,
  watcher_name        VARCHAR(50) NOT NULL,
  watcher_last_score  INTEGER NOT NULL DEFAULT 0,
  target_device_id    VARCHAR(64) NOT NULL,
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contest_code, watcher_device_id, target_device_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_watchers_target
  ON contest_watchers (contest_code, target_device_id, updated_at DESC);

-- ============================================================
-- ניתוח: ביקורים יומיים + audit log (אדמין) — חדש
-- ============================================================
-- שורה לכל (device, date). מאפשר חישוב bounce-rate ו-retention denominator.

CREATE TABLE IF NOT EXISTS device_visits (
  device_id    VARCHAR(64) NOT NULL,
  date         DATE NOT NULL,
  visit_count  INTEGER NOT NULL DEFAULT 1,
  first_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  last_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, date)
);

CREATE INDEX IF NOT EXISTS idx_device_visits_date
  ON device_visits (date);
CREATE INDEX IF NOT EXISTS idx_device_visits_device
  ON device_visits (device_id);

-- Audit log לפעולות אדמין (מחיקות, עריכת תחרויות וכו'). שורה חדשה
-- נכתבת בכל פעולה הרסנית. JSONB ל-metadata חופשי.

CREATE TABLE IF NOT EXISTS admin_actions (
  id           SERIAL PRIMARY KEY,
  action       VARCHAR(50) NOT NULL,
  target_type  VARCHAR(50),
  target_id    VARCHAR(120),
  metadata     JSONB,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_created
  ON admin_actions (created_at DESC);

-- ============================================================
-- אתגרי BLOOM (Public single-shot prize contests) — חדש
-- ============================================================
-- ניסיון אחד למכשיר לאתגר (PK על challenge_id + device_id).
-- ארבעה סוגים: race / top_n / beat / first_to_tier.

CREATE TABLE IF NOT EXISTS challenges (
  id              SERIAL PRIMARY KEY,
  slug            VARCHAR(40) UNIQUE NOT NULL,
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  challenge_type  VARCHAR(20) NOT NULL,
  threshold_score INTEGER,
  threshold_tier  INTEGER,
  winners_count   INTEGER NOT NULL DEFAULT 1,
  prize_text      VARCHAR(200) NOT NULL,
  prize_image_url VARCHAR(500),
  board_seed      BIGINT,
  starts_at       TIMESTAMP NOT NULL,
  ends_at         TIMESTAMP NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft',
  rules_text      TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenges_status_ends
  ON challenges (status, ends_at);

CREATE TABLE IF NOT EXISTS challenge_entries (
  challenge_id          INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  device_id             VARCHAR(64) NOT NULL,
  display_name          VARCHAR(50) NOT NULL,
  score                 INTEGER NOT NULL DEFAULT 0,
  highest_tier          INTEGER NOT NULL DEFAULT 1,
  drops_count           INTEGER NOT NULL DEFAULT 0,
  status                VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  started_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMP,
  reached_threshold_at  TIMESTAMP,
  reached_tier_at       TIMESTAMP,
  is_winner             BOOLEAN NOT NULL DEFAULT FALSE,
  winner_rank           INTEGER,
  cheat_flag            BOOLEAN NOT NULL DEFAULT FALSE,
  contact_name          VARCHAR(80),
  contact_phone         VARCHAR(40),
  contact_email         VARCHAR(120),
  contact_at            TIMESTAMP,
  prize_claimed         BOOLEAN NOT NULL DEFAULT FALSE,
  prize_claimed_at      TIMESTAMP,
  PRIMARY KEY (challenge_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_entries_score
  ON challenge_entries (challenge_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_challenge_entries_winners
  ON challenge_entries (challenge_id, is_winner) WHERE is_winner = TRUE;
CREATE INDEX IF NOT EXISTS idx_challenge_entries_threshold
  ON challenge_entries (challenge_id, reached_threshold_at) WHERE reached_threshold_at IS NOT NULL;
-- Privacy: index supports the 90-day PII auto-purge in server.js so the
-- nightly UPDATE doesn't sequential-scan as the table grows.
CREATE INDEX IF NOT EXISTS idx_challenge_entries_purge
  ON challenge_entries (prize_claimed_at)
  WHERE prize_claimed_at IS NOT NULL;

-- ============================================================
-- הגדרות משחק (Admin-controlled game config)
-- ============================================================
-- key-value store for runtime game settings the admin can toggle.
-- The client fetches /api/config on init and applies the values.

CREATE TABLE IF NOT EXISTS game_config (
  key    VARCHAR(60) PRIMARY KEY,
  value  TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- Grow the key column. The original 60-char cap was fine for hand-written
-- admin keys, but throwaway dedup rows (`_earn:<deviceId>:<action>:<date>:<meta>`)
-- routinely blow past 60 chars — when the INSERT silently exceeds the limit,
-- the dedup row never lands and the next call to /api/player/earn looks
-- like a first call. Bug surfaced during phase 4 testing.
ALTER TABLE game_config ALTER COLUMN key TYPE VARCHAR(255);

-- Default merge mode: 'anchor' (result stays at drop) | 'classic' (leftmost wins) |
-- 'smart' (engine simulates each candidate and picks the cell whose post-gravity
-- outcome is best for the player — adjacent same-tier neighbor = immediate chain).
INSERT INTO game_config (key, value) VALUES ('merge_mode', 'anchor')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('referral_enabled', 'true')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('referral_reward', '50')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('referred_bonus', '25')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('welcome_bonus', '100')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_reward', '10')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_login_reward', '25')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('streak_3_reward', '15')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('streak_7_reward', '50')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('streak_30_reward', '200')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('contest_1st_reward', '100')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('contest_2nd_reward', '40')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('contest_3rd_reward', '20')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('tile_shop_enabled', 'true')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('tile_price_2', '5')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('tile_price_3', '10')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('tile_price_4', '20')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('tile_price_5', '35')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('tile_price_6', '50')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('tile_price_7', '80')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('tile_price_8', '150')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('tile_price_multiplier', '1.0')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('powerup_random_tile', '15')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('powerup_choose_tile', '40')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('powerup_random_row', '60')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('powerup_choose_row', '100')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('wager_enabled', 'true')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('wager_min', '10')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('wager_max', '500')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('wager_rake', '5')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('wager_1st_pct', '60')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('wager_2nd_pct', '25')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('wager_3rd_pct', '10')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('jackpot_enabled', 'true')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('jackpot_entry', '5')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('jackpot_min_players', '5')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('jackpot_auto_settle', 'true')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('duel_enabled', 'true')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('duel_timeout_hours', '24')
  ON CONFLICT (key) DO NOTHING;

-- Weekly auto-challenge settings
INSERT INTO game_config (key, value) VALUES ('weekly_enabled', 'true')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('weekly_prize', '500')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('weekly_name', 'אתגר שבועי')
  ON CONFLICT (key) DO NOTHING;

-- Wager settlements (tracks every credit movement from bets)
CREATE TABLE IF NOT EXISTS wager_settlements (
  id           SERIAL PRIMARY KEY,
  contest_code VARCHAR(32),
  device_id    VARCHAR(64) NOT NULL,
  amount       INT NOT NULL,
  type         VARCHAR(32) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE wager_settlements ALTER COLUMN contest_code TYPE VARCHAR(32);
ALTER TABLE wager_settlements ALTER COLUMN type TYPE VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_wager_settlements_contest
  ON wager_settlements (contest_code);
CREATE INDEX IF NOT EXISTS idx_wager_settlements_device
  ON wager_settlements (device_id);

-- Daily jackpot pool
CREATE TABLE IF NOT EXISTS daily_jackpot (
  date     DATE PRIMARY KEY,
  pool     INT NOT NULL DEFAULT 0,
  entries  INT NOT NULL DEFAULT 0,
  settled  BOOLEAN NOT NULL DEFAULT false,
  settled_at TIMESTAMP
);

-- 1v1 Duels
CREATE TABLE IF NOT EXISTS duels (
  id                SERIAL PRIMARY KEY,
  challenger_device VARCHAR(64) NOT NULL,
  challenger_name   VARCHAR(100),
  challenger_code   VARCHAR(10),
  opponent_device   VARCHAR(64),
  opponent_name     VARCHAR(100),
  opponent_code     VARCHAR(10) NOT NULL,
  amount            INT NOT NULL DEFAULT 0,
  board_seed        BIGINT NOT NULL,
  challenger_score  INT,
  opponent_score    INT,
  winner_device     VARCHAR(64),
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_duels_opponent ON duels (opponent_code, status);
CREATE INDEX IF NOT EXISTS idx_duels_challenger ON duels (challenger_device, status);

-- ============================================================
-- Player heartbeat — tracks ALL active players (any mode)
-- ============================================================
CREATE TABLE IF NOT EXISTS player_heartbeat (
  device_id   VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(100),
  mode        VARCHAR(20) NOT NULL DEFAULT 'daily',
  score       INT NOT NULL DEFAULT 0,
  highest_tier INT NOT NULL DEFAULT 1,
  grid_json   TEXT,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Player identity + wallet + referrals
-- ============================================================

CREATE TABLE IF NOT EXISTS player_profiles (
  device_id    VARCHAR(64) PRIMARY KEY,
  player_code  VARCHAR(10) UNIQUE NOT NULL,
  display_name VARCHAR(100),
  balance      INT NOT NULL DEFAULT 0,
  total_earned INT NOT NULL DEFAULT 0,
  total_spent  INT NOT NULL DEFAULT 0,
  referred_by  VARCHAR(10),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_profiles_code
  ON player_profiles (player_code);

CREATE TABLE IF NOT EXISTS referrals (
  id              SERIAL PRIMARY KEY,
  referrer_code   VARCHAR(10) NOT NULL,
  referrer_device VARCHAR(64) NOT NULL,
  referred_device VARCHAR(64) NOT NULL,
  credits_awarded INT NOT NULL DEFAULT 50,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(referred_device)
);

-- Player country (ISO-3166 alpha-2). The flag picker writes here and the
-- value is mirrored onto every score submission so the leaderboard tabs
-- ("עולמי" / "מדינתי") can filter without an extra JOIN. NULL = not chosen.
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS country VARCHAR(2);

-- ============================================================
-- Difficulty leaderboard (practice + duel best per device per difficulty)
-- ============================================================
-- Mirrors daily_scores' shape so day/week/month windows reuse the same
-- DISTINCT ON (device_id) idiom. One row per (date, device, difficulty) —
-- "best score wins" upsert keeps it idempotent. Daily mode is excluded
-- (admin-controlled fairness); only practice & duel write here.
CREATE TABLE IF NOT EXISTS difficulty_scores (
  date              DATE NOT NULL,
  device_id         VARCHAR(64) NOT NULL,
  difficulty_label  VARCHAR(20) NOT NULL DEFAULT 'default',
  name              VARCHAR(32) NOT NULL DEFAULT 'אנונימי',
  score             INTEGER NOT NULL DEFAULT 0,
  tier              INTEGER NOT NULL DEFAULT 1,
  country           VARCHAR(2),
  source            VARCHAR(16) NOT NULL DEFAULT 'practice',
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, device_id, difficulty_label)
);
CREATE INDEX IF NOT EXISTS idx_difficulty_scores_lookup
  ON difficulty_scores (difficulty_label, date, score DESC);
CREATE INDEX IF NOT EXISTS idx_difficulty_scores_country
  ON difficulty_scores (difficulty_label, country, date, score DESC) WHERE country IS NOT NULL;

-- Same as daily_scores: drops becomes required server-side for anti-cheat.
ALTER TABLE difficulty_scores ADD COLUMN IF NOT EXISTS drops INTEGER;

-- ============================================================
-- Per-player skin ownership (server-authoritative)
-- ============================================================
-- One row per (device, skin) the player has purchased. POST /api/player/buy-skin
-- writes here in the same transaction as the balance deduction; GET
-- /api/player/skins reads it on boot to populate ownedSkins. localStorage
-- becomes a cache, not source of truth — a player who clears their browser
-- still keeps their cosmetics. Also closes the localStorage-edit exploit.
CREATE TABLE IF NOT EXISTS player_skins (
  device_id    VARCHAR(64) NOT NULL,
  skin_id      VARCHAR(40) NOT NULL,
  purchased_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, skin_id)
);
CREATE INDEX IF NOT EXISTS idx_player_skins_device ON player_skins (device_id);

-- Leaderboard tabs admin config (which scope-tabs the modal exposes).
-- Stored as a CSV of: world / country / difficulty (order matters → tab order).
INSERT INTO game_config (key, value) VALUES ('leaderboard_tabs_enabled', 'world,country,difficulty')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('leaderboard_default_tab', 'world')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('leaderboard_default_difficulty', 'default')
  ON CONFLICT (key) DO NOTHING;

INSERT INTO game_config (key, value) VALUES ('score_milestone_reward', '5')
  ON CONFLICT (key) DO NOTHING;

INSERT INTO game_config (key, value) VALUES ('crown_merge_enabled', 'true')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('crown_merge_bonus', '50000')
  ON CONFLICT (key) DO NOTHING;

-- Events system config
INSERT INTO game_config (key, value) VALUES ('events_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('events_start_delay', '30') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('events_min_gap', '20') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('events_max_gap', '45') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('events_min_empty_cells', '4') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_bomb_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_bomb_weight', '25') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_bomb_timer', '8') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_bomb_radius', '1') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_bomb_points_per_tile', '2000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_star_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_star_weight', '20') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_star_timer', '6') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_star_upgrade', '1') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_star_points', '500') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_gift_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_gift_weight', '25') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_gift_timer', '10') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_gift_credits_min', '5') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_gift_credits_max', '50') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_gift_jackpot_chance', '5') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_gift_jackpot_amount', '500') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_fever_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_fever_weight', '12') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_fever_timer', '5') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_fever_duration', '10') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_fever_multiplier', '3') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_freeze_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_freeze_weight', '8') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_freeze_timer', '4') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_freeze_clear_rows', '1') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_freeze_points', '1000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_freeze_min_filled_rows', '3') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_target_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_target_weight', '10') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_target_timer', '12') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_target_multiplier', '5') ON CONFLICT (key) DO NOTHING;

-- Shake intensity config (0 = disabled)
INSERT INTO game_config (key, value) VALUES ('shake_tier_up', '4') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('shake_crown_merge', '8') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('shake_milestone', '2') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('shake_multi_merge', '4') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('shake_new_best', '4') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_bomb_shake', '6') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_freeze_shake', '4') ON CONFLICT (key) DO NOTHING;

-- Contest alerts config
INSERT INTO game_config (key, value) VALUES ('contest_alerts_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('contest_alert_interval', '12') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('contest_alert_duration', '3500') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('contest_alert_shake_overtake', '3') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('contest_alert_shake_first', '4') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('contest_alert_shake_leader', '2') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('contest_alert_gap_pct', '0.1') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('contest_alert_gap_max', '5000') ON CONFLICT (key) DO NOTHING;

-- Monetization config
INSERT INTO game_config (key, value) VALUES ('continue_price', '200') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('ad_watch_reward', '30') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('ad_cooldown_seconds', '30') ON CONFLICT (key) DO NOTHING;
-- ad_daily_cap: maximum number of ad-watch claims per device per day. The
-- old design relied on a 30s per-watch cooldown, but a player who finishes
-- a game and refreshes can reset client state and farm ads indefinitely
-- (clipped only by the cooldown). Capping per-day puts a real ceiling on
-- this exploit. 5 watches/day × 30💎 = 150💎/day from ads — meaningful but
-- not game-breaking.
INSERT INTO game_config (key, value) VALUES ('ad_daily_cap', '5') ON CONFLICT (key) DO NOTHING;

-- Economy rebalance: applied once during 2026-05-17 migration.
-- These UPDATEs are commented out to prevent overwriting admin changes
-- on every deploy. Originals are kept here for reference only.
-- UPDATE game_config SET value = '15' WHERE key = 'daily_login_reward' AND value = '25';
-- UPDATE game_config SET value = '5' WHERE key = 'daily_reward' AND value = '10';
-- UPDATE game_config SET value = '2' WHERE key = 'event_gift_credits_min' AND value = '5';
-- UPDATE game_config SET value = '10' WHERE key = 'event_gift_credits_max' AND value = '50';
-- UPDATE game_config SET value = '100' WHERE key = 'event_gift_jackpot_amount' AND value = '500';
-- UPDATE game_config SET value = '300' WHERE key = 'tile_price_8' AND value = '150';
-- UPDATE game_config SET value = '150' WHERE key = 'tile_price_7' AND value = '80';
-- UPDATE game_config SET value = '100' WHERE key = 'tile_price_6' AND value = '50';
-- UPDATE game_config SET value = '200' WHERE key = 'powerup_price_choose_row' AND value = '100';
-- UPDATE game_config SET value = '120' WHERE key = 'powerup_price_random_row' AND value = '60';
-- UPDATE game_config SET value = '80' WHERE key = 'powerup_price_choose_tile' AND value = '40';
-- UPDATE game_config SET value = '30' WHERE key = 'powerup_price_random_tile' AND value = '15';

-- ============================================================
-- Difficulty + speed controls (admin-tunable)
-- ============================================================
-- drop_weights: 8 comma-separated integers — weight of each tier (1..8) in the
-- drop pool. Default 55/28/12/5/0/0/0/0 mirrors the original frontend constant.
-- Set a tier's weight to 0 to keep it out of the natural drop pool (it can
-- still appear via merges). All-zero falls back to the default at runtime.
INSERT INTO game_config (key, value) VALUES ('drop_weights', '55,28,12,5,0,0,0,0') ON CONFLICT (key) DO NOTHING;
-- game_speed_pct: 50–200. 100=default, lower=faster animations.
-- Multiplies the merge/gravity/drop sleeps in the gameplay loop.
INSERT INTO game_config (key, value) VALUES ('game_speed_pct', '100') ON CONFLICT (key) DO NOTHING;
-- slot_enabled: dramatic slot-machine spin on the tier ladder before each drop
INSERT INTO game_config (key, value) VALUES ('slot_enabled', 'true') ON CONFLICT (key) DO NOTHING;
-- slot_duration_ms: total time of the slot spin (200..2000)
INSERT INTO game_config (key, value) VALUES ('slot_duration_ms', '650') ON CONFLICT (key) DO NOTHING;
-- slot_intensity: how many tier slots the spin cycles through (1..8)
INSERT INTO game_config (key, value) VALUES ('slot_intensity', '8') ON CONFLICT (key) DO NOTHING;

-- AdSense + Stripe config
INSERT INTO game_config (key, value) VALUES ('adsense_client_id', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('stripe_publishable_key', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('diamond_pack_1_amount', '300') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('diamond_pack_1_price', '9.90') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('diamond_pack_2_amount', '1200') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('diamond_pack_2_price', '24.90') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('diamond_pack_3_amount', '4000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('diamond_pack_3_price', '59.90') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('diamond_pack_4_amount', '15000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('diamond_pack_4_price', '149.90') ON CONFLICT (key) DO NOTHING;
