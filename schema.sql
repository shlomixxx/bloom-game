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

-- Score mode: 'cumulative' (default — every game adds to the total) or
-- 'best' (only the player's highest single-game score counts). Set by the
-- host at contest creation; existing contests default to cumulative so
-- behavior is unchanged.
ALTER TABLE contests ADD COLUMN IF NOT EXISTS score_mode VARCHAR(16) NOT NULL DEFAULT 'cumulative';

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

-- "Soft leave": when a player taps נתק ממכשיר זה we mark the row instead
-- of deleting, so the score stays visible in the contest's leaderboard
-- (per the confirm copy) but /contests/mine filters them out — without
-- this, the contest re-appeared on every refresh and the leave button
-- looked broken. Cleared on re-join.
ALTER TABLE contest_scores ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

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
-- Tiered daily-login rewards — the client overlay escalates the displayed
-- amount with streak (25 → 50 → 100 → 200), so the server payment now
-- mirrors the same tiers. Without these tiers the overlay said +200 while
-- the wallet actually got the flat daily_login_reward, eroding trust.
INSERT INTO game_config (key, value) VALUES ('daily_login_reward_streak_3', '50')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_login_reward_streak_7', '100')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_login_reward_streak_30', '200')
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
-- Web Push subscriptions. One device can have multiple rows (one
-- per browser/install). When an event fires for a device, the
-- server iterates these subscriptions and pushes to each endpoint.
-- Expired subscriptions are auto-pruned on 410 Gone from the
-- push service.
-- ============================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  device_id    VARCHAR(64) NOT NULL,
  endpoint     TEXT        NOT NULL,
  p256dh_key   TEXT        NOT NULL,
  auth_key     TEXT        NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_by_device
  ON push_subscriptions (device_id);

-- ============================================================
-- Player-to-player gifts. Sender transfers gems to a recipient
-- (by BLOOM-XXXX player_code). Used as both the wallet transfer
-- ledger AND the unseen-notification queue — the recipient polls
-- this table on app open to surface a "🎁 X sent you Y💎" banner.
-- ============================================================
CREATE TABLE IF NOT EXISTS player_gifts (
  id               SERIAL PRIMARY KEY,
  sender_device    VARCHAR(64) NOT NULL,
  sender_code      VARCHAR(10),
  sender_name      VARCHAR(100),
  recipient_device VARCHAR(64) NOT NULL,
  recipient_code   VARCHAR(10) NOT NULL,
  amount           INT NOT NULL,
  message          VARCHAR(200),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen_at          TIMESTAMPTZ
);
-- Inbox query: unseen gifts for a recipient, newest first.
CREATE INDEX IF NOT EXISTS idx_player_gifts_inbox
  ON player_gifts (recipient_device, created_at DESC)
  WHERE seen_at IS NULL;

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

-- updated_at: needed by chest/comeback/streak-freeze UPDATEs added in
-- May 2026. Idempotent ALTER so legacy DBs pick it up on the next boot.
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

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
-- Tiered milestone rewards — must mirror SCORE_MILESTONES in src/11-game.js so
-- the banner number is what actually lands in the wallet. Server picks via
-- meta.milestone (validated against ALLOWED_MILESTONES in /api/player/earn).
INSERT INTO game_config (key, value) VALUES ('score_milestone_reward_10000',   '2')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('score_milestone_reward_25000',   '3')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('score_milestone_reward_50000',   '5')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('score_milestone_reward_100000',  '10')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('score_milestone_reward_250000',  '25')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('score_milestone_reward_500000',  '50')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('score_milestone_reward_1000000', '100') ON CONFLICT (key) DO NOTHING;

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
-- Aurora skin admin gate. Default 'true' (skin shows in shop). Set to 'false'
-- from the admin to hide the skin globally; players who had it active fall
-- back to 'classic' on next page load.
INSERT INTO game_config (key, value) VALUES ('aurora_skin_enabled', 'true') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Dynamic Boards — global admin controls (May 2026)
--
-- These keys let the admin toggle each of the 6 retention systems
-- on/off and tune every reward without a redeploy. Defaults
-- mirror the hardcoded client-side values; clients fall back to
-- the defaults when a key is missing or empty.
-- ============================================================

-- Master toggles for each retention system. Set to 'false' to disable
-- the surface entirely (no chip / no banner / no modal).
INSERT INTO game_config (key, value) VALUES ('dyn_quests_enabled',        'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_achievements_enabled',  'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_streak_enabled',        'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_personal_best_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_global_lb_enabled',     'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_fomo_enabled',          'true') ON CONFLICT (key) DO NOTHING;

-- Quest rewards (one per quest id in DYN_QUEST_POOL).
INSERT INTO game_config (key, value) VALUES ('dyn_quest_reward_play2',      '50')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_quest_reward_play3',      '100') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_quest_reward_score10k',   '50')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_quest_reward_score30k',   '100') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_quest_reward_score75k',   '250') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_quest_reward_tier7',      '75')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_quest_reward_tier8',      '200') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_quest_reward_theme',      '60')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_quest_reward_shape',      '60')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_quest_reward_beatself',   '120') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_quest_reward_beatleader', '300') ON CONFLICT (key) DO NOTHING;

-- Per-board achievement rewards.
INSERT INTO game_config (key, value) VALUES ('dyn_ach_reward_played',   '25')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_ach_reward_crown',    '150') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_ach_reward_score10',  '50')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_ach_reward_score50',  '150') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_ach_reward_score100', '300') ON CONFLICT (key) DO NOTHING;

-- Cross-board achievement rewards.
INSERT INTO game_config (key, value) VALUES ('dyn_ach_reward_pioneer5',     '200')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_ach_reward_pioneer10',    '500')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_ach_reward_crown5',       '500')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_ach_reward_all_themes',   '800')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_ach_reward_all_shapes',   '800')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_ach_reward_leaderboard1', '1000') ON CONFLICT (key) DO NOTHING;

-- Streak milestone rewards.
INSERT INTO game_config (key, value) VALUES ('dyn_streak_reward_3',   '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_streak_reward_7',   '150')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_streak_reward_14',  '300')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_streak_reward_30',  '600')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_streak_reward_60',  '1000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_streak_reward_100', '2000') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Dynamic Boards — Mystery Chest (May 2026)
--
-- The "Skinner box" layer. Every dynamic-board game-over rolls a
-- random reward on the server (anti-cheat), reveals via a slot-
-- machine animation on the client. Five rarity tiers, weights and
-- amounts fully admin-controlled. First N chests of the day are
-- "boosted" (uncommon+ guaranteed) to prevent early frustration.
-- ============================================================
INSERT INTO game_config (key, value) VALUES ('dyn_chest_enabled',          'true') ON CONFLICT (key) DO NOTHING;
-- Rarity weights (relative, normalised on the server). Defaults sum to 100.
INSERT INTO game_config (key, value) VALUES ('dyn_chest_weight_common',    '60') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_weight_uncommon',  '25') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_weight_rare',      '12') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_weight_legendary', '2')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_weight_mythic',    '1')  ON CONFLICT (key) DO NOTHING;
-- Min/max amounts per tier (server picks a uniform value within range).
INSERT INTO game_config (key, value) VALUES ('dyn_chest_common_min',       '3')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_common_max',       '10')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_uncommon_min',     '15')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_uncommon_max',     '30')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_rare_min',         '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_rare_max',         '100')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_legendary_min',    '200')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_legendary_max',    '400')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_mythic_min',       '800')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_mythic_max',       '1500') ON CONFLICT (key) DO NOTHING;
-- Daily cap (counted server-side via dedup key) and "boosted first-N" pity.
INSERT INTO game_config (key, value) VALUES ('dyn_chest_daily_cap',        '20') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_chest_boosted_count',    '3')  ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Dynamic Boards — Streak Freeze (May 2026)
--
-- Duolingo-style soft-monetization. Player buys "freezes" with 💎
-- that auto-apply when they miss a single day. Prevents the
-- "I lost my 14-day streak over one missed day" frustration which
-- causes hard churn after 2 weeks.
-- ============================================================
INSERT INTO game_config (key, value) VALUES ('dyn_streak_freeze_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_streak_freeze_price',   '200')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_streak_freeze_max_per_streak', '2') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Dynamic Boards — Comeback Bonus (May 2026)
--
-- When a player who HAD a streak ≥3 returns after 3+ days of
-- absence, surface a big celebration overlay + grant a bonus.
-- Re-engages lapsed players with a positive emotion instead of
-- the punishment of "your streak was reset".
-- ============================================================
INSERT INTO game_config (key, value) VALUES ('dyn_comeback_enabled',     'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_comeback_min_days',    '3')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_comeback_min_streak',  '3')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_comeback_reward',      '150')  ON CONFLICT (key) DO NOTHING;
-- Bonus boost when comeback player ALSO has a freeze ready to apply.
INSERT INTO game_config (key, value) VALUES ('dyn_comeback_freeze_gift', '1')    ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Season Pass (May 2026)
--
-- The #1 retention engine in modern F2P (Fortnite / Genshin / Apex).
-- Player earns Season XP from every action, climbs a 20-tier track,
-- manually claims rewards at each unlocked tier (Clash Royale-style
-- claim hook). Each season lasts ~30 days; admin advances the
-- season_id to reset progress + change the theme.
--
-- Storage: one row per (device_id, season_id). claimed_tiers is a
-- JSONB int[] of tier numbers the player already collected.
-- ============================================================
CREATE TABLE IF NOT EXISTS player_season_progress (
  device_id      VARCHAR(64) NOT NULL,
  season_id      VARCHAR(32) NOT NULL,
  xp             INT NOT NULL DEFAULT 0,
  claimed_tiers  JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_xp_at     TIMESTAMPTZ,
  -- per-game-id dedup: keep up to ~24h of recent game_ids so we never
  -- grant XP twice for the same finished game. Older entries are
  -- naturally rotated out by the JSONB-trim logic in the endpoint.
  recent_game_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, season_id)
);

CREATE INDEX IF NOT EXISTS idx_season_progress_season
  ON player_season_progress (season_id, xp DESC);

-- Stage 17 — Premium Battle Pass columns. Players who buy premium get a
-- 2nd reward per tier (industry-standard pattern from Fortnite/Apex).
-- is_premium is per-season — a player who buys premium for S1 starts
-- S2 on the free track unless they buy again. premium_purchased_at lets
-- the admin audit how many premium purchases happened per season.
-- claimed_premium_tiers parallels claimed_tiers — separate so claiming
-- a free tier doesn't mark the premium one as claimed (they're paid
-- atomically together, but tracked independently for UI clarity).
ALTER TABLE player_season_progress ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE player_season_progress ADD COLUMN IF NOT EXISTS premium_purchased_at TIMESTAMPTZ;
ALTER TABLE player_season_progress ADD COLUMN IF NOT EXISTS claimed_premium_tiers JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Master toggle + active season + season name (for the modal header).
INSERT INTO game_config (key, value) VALUES ('season_pass_enabled',   'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_pass_season_id', 'S1')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_pass_name',      '🌸 עונה 1 — הפריחה') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_pass_ends_at',   '')     ON CONFLICT (key) DO NOTHING;

-- XP earning rates. Each is admin-tunable. Defaults tuned so a casual
-- player (3 games/day) climbs ~1 tier/day, and a heavy player (10
-- games/day with crowns) climbs ~2-3 tiers/day.
INSERT INTO game_config (key, value) VALUES ('season_xp_game_finish',   '10') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_xp_crown_bonus',   '25') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_xp_per_10k_score', '5')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_xp_quest_done',    '30') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_xp_achievement',   '50') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_xp_max_per_game',  '100') ON CONFLICT (key) DO NOTHING;

-- Tier rewards — 20 tiers. Format: tier_<N>_xp + tier_<N>_reward (gems).
-- The XP thresholds use an "easy early, harder late" curve so the first
-- 5 tiers feel like instant progression (the "first-day wow") and tier
-- 20 takes ~3-4 weeks of consistent play.
INSERT INTO game_config (key, value) VALUES ('season_tier_1_xp',  '40')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_1_reward', '25')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_2_xp',  '100')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_2_reward', '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_3_xp',  '180')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_3_reward', '75')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_4_xp',  '280')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_4_reward', '100')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_5_xp',  '400')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_5_reward', '150')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_6_xp',  '550')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_6_reward', '200')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_7_xp',  '720')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_7_reward', '250')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_8_xp',  '920')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_8_reward', '300')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_9_xp',  '1150') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_9_reward', '400')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_10_xp', '1420') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_10_reward','550') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_11_xp', '1720') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_11_reward','650') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_12_xp', '2050') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_12_reward','750') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_13_xp', '2420') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_13_reward','900') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_14_xp', '2820') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_14_reward','1050') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_15_xp', '3250') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_15_reward','1200') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_16_xp', '3720') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_16_reward','1400') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_17_xp', '4220') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_17_reward','1600') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_18_xp', '4750') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_18_reward','1800') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_19_xp', '5320') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_19_reward','2100') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_20_xp', '5950') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_20_reward','3000') ON CONFLICT (key) DO NOTHING;

-- Stage 17 — Premium Battle Pass master config + 20 premium-track rewards.
-- The premium track doubles each free reward (industry standard pattern).
-- Sum: ~32,000💎 per season for premium players vs ~16,000💎 for free.
-- Pricing: 1500💎 OR $4.99 (USD price is display-only until Stripe lands).
INSERT INTO game_config (key, value) VALUES ('season_pass_premium_enabled',     'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_pass_premium_price_gems',  '1500') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_pass_premium_price_usd',   '4.99') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_1_premium_reward',  '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_2_premium_reward',  '100')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_3_premium_reward',  '150')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_4_premium_reward',  '200')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_5_premium_reward',  '300')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_6_premium_reward',  '400')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_7_premium_reward',  '500')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_8_premium_reward',  '600')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_9_premium_reward',  '800')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_10_premium_reward', '1100') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_11_premium_reward', '1300') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_12_premium_reward', '1500') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_13_premium_reward', '1800') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_14_premium_reward', '2100') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_15_premium_reward', '2400') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_16_premium_reward', '2800') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_17_premium_reward', '3200') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_18_premium_reward', '3600') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_19_premium_reward', '4200') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('season_tier_20_premium_reward', '6000') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Live Tournaments — stage 12 (May 2026)
--
-- Scheduled prime-time events: admin creates a tournament with a
-- start/end window + prize amounts for top-N. Any dynamic-board
-- game played within the window submits the player's BEST score
-- to the tournament. After end_at, top-N auto-claim their prizes
-- on the next /api/tournaments fetch (no cron needed — lazy
-- finalize keeps the infra simple).
--
-- The killer hook: "Wed 8pm Tournament" creates a "must show up"
-- moment. Players plan their evening around it.
-- ============================================================
CREATE TABLE IF NOT EXISTS tournaments (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  -- prize_pool: JSON array of {rank, reward}. E.g. [{rank:1,reward:5000},{rank:2,reward:2000},{rank:3,reward:1000}]
  prize_pool    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- status: scheduled | live | ended | finalized
  status        TEXT NOT NULL DEFAULT 'scheduled',
  -- True after the top-N prizes have been auto-credited.
  finalized_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournaments_window
  ON tournaments (starts_at, ends_at);

CREATE TABLE IF NOT EXISTS tournament_scores (
  tournament_id INT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  device_id     VARCHAR(64) NOT NULL,
  name          VARCHAR(32) NOT NULL DEFAULT 'אנונימי',
  score         INT NOT NULL DEFAULT 0,
  tier          INT NOT NULL DEFAULT 1,
  games_played  INT NOT NULL DEFAULT 0,
  country       VARCHAR(2),
  prize_claimed INT,  -- amount awarded when finalized (NULL = not yet)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_scores_lb
  ON tournament_scores (tournament_id, score DESC);

-- Master toggle.
INSERT INTO game_config (key, value) VALUES ('tournament_enabled', 'true') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Friends Invite + Shared Streak — stage 13 (May 2026)
--
-- Viral loop: player A shares their BLOOM-XXXX code with friend B
-- via WhatsApp/native share. B opens the URL (with ?ref=BLOOM-XXXX)
-- or pastes the code in the friends modal → both get a one-time
-- signup bonus. Recurring: every day BOTH players play a dynamic
-- game, each gets a shared-day bonus.
--
-- Symmetric storage: (device_a, device_b) where device_a is always
-- the lexicographically-smaller string. Avoids duplicate rows for
-- the same friendship.
-- ============================================================
CREATE TABLE IF NOT EXISTS friendships (
  device_a    VARCHAR(64) NOT NULL,
  device_b    VARCHAR(64) NOT NULL,
  -- Who invited whom (for analytics + audit). Always equals device_a OR device_b.
  initiator   VARCHAR(64) NOT NULL,
  -- Signup bonus paid out (idempotent flag).
  bonus_paid  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_a, device_b),
  CHECK (device_a < device_b)
);

CREATE INDEX IF NOT EXISTS idx_friendships_device_a ON friendships (device_a);
CREATE INDEX IF NOT EXISTS idx_friendships_device_b ON friendships (device_b);

-- Per-day shared-play bonus dedup. One row when BOTH players played
-- a dynamic-board game on the same Asia/Jerusalem date — bonus paid
-- to both. Prevents double-pay if both finish multiple games same day.
CREATE TABLE IF NOT EXISTS friendship_shared_days (
  device_a   VARCHAR(64) NOT NULL,
  device_b   VARCHAR(64) NOT NULL,
  date       DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_a, device_b, date),
  CHECK (device_a < device_b)
);

-- Daily "last played dynamic" tracker — used by the shared-day bonus
-- to know who played today. Kept separately from daily_scores so the
-- mode-check stays cheap.
CREATE TABLE IF NOT EXISTS player_daily_dyn_activity (
  device_id VARCHAR(64) NOT NULL,
  date      DATE NOT NULL,
  game_count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (device_id, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_dyn_activity_date ON player_daily_dyn_activity (date);

-- Master toggle + per-feature rewards.
INSERT INTO game_config (key, value) VALUES ('friends_enabled',          'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('friends_signup_bonus',     '200')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('friends_shared_day_bonus', '100')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('friends_max_per_device',   '50')   ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Daily Login Multiplier Stack — stage 14 (May 2026)
--
-- The existing daily_login_reward + tiered streak bonuses already
-- pay more for longer streaks. This adds stacked multipliers from
-- the dynamic-board streak + friend shared-day pairing — so a
-- player with both streaks active gets visibly bigger rewards,
-- and the overlay shows the WHY ("base × 3 × 1.25 × 1.25").
-- ============================================================
INSERT INTO game_config (key, value) VALUES ('daily_login_mult_dyn_streak_pct',     '25') ON CONFLICT (key) DO NOTHING; -- +25% when dyn_streak ≥ 3
INSERT INTO game_config (key, value) VALUES ('daily_login_mult_dyn_streak_min',     '3')  ON CONFLICT (key) DO NOTHING; -- min dyn streak for the bonus
INSERT INTO game_config (key, value) VALUES ('daily_login_mult_friend_shared_pct',  '20') ON CONFLICT (key) DO NOTHING; -- +20% if any friend shared yesterday
INSERT INTO game_config (key, value) VALUES ('daily_login_mult_max_pct',            '300') ON CONFLICT (key) DO NOTHING; -- cap final reward at 4x base (anti-abuse safety)

-- Push notifications: master toggle. The push_subscriptions table
-- is defined earlier in this file (line ~410); we only need the
-- master toggle here so the admin can disable broadcasts globally.
INSERT INTO game_config (key, value) VALUES ('push_enabled', 'true') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Dynamic Boards — phase 2 (May 2026)
-- The board_configurations table backs admin-managed alternate
-- boards (column multipliers, themed packs, future special cells
-- and shapes). One row per configuration; the highest-priority
-- row that's currently "active" by date wins. Definitions are
-- JSON to keep the schema flexible across the 6 future types.
-- ============================================================
CREATE TABLE IF NOT EXISTS board_configurations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('multipliers', 'special_cells', 'shape', 'themed', 'mode', 'vip')),
  definition JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT false,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  target_audience TEXT NOT NULL DEFAULT 'all',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_board_configs_active
  ON board_configurations (priority DESC, id DESC)
  WHERE is_active = true;

-- Phase 3 (May 2026): per-mode targeting. The admin can mark each board
-- as applying to one or more game modes (dynamic / practice / daily /
-- duel / contest / challenge). Default is ['dynamic'] = pure opt-in
-- (the original phase-2 redesigned behavior). ALTER... DEFAULT applies
-- to existing rows in PostgreSQL — so legacy boards stay opt-in.
ALTER TABLE board_configurations
  ADD COLUMN IF NOT EXISTS applies_to TEXT[] NOT NULL DEFAULT ARRAY['dynamic']::TEXT[];

-- Duels snapshot the active duel-board AT CREATION TIME so both players
-- always play the same board even if admin changes the active one mid-
-- duel. NULL = no board (vanilla duel — current behavior).
ALTER TABLE duels
  ADD COLUMN IF NOT EXISTS board_multipliers JSONB,
  ADD COLUMN IF NOT EXISTS board_name TEXT;

-- ============================================================
-- Per-board global leaderboard (May 2026)
--
-- One row per (board_id, device_id) — best score that device has
-- ever posted on that specific dynamic board. Mirrors the
-- "best score wins" pattern of daily_scores: the upsert in
-- /api/boards/:id/score uses WHERE score < EXCLUDED.score.
--
-- Why a separate table:
--  - Dynamic boards already EXCLUDED from daily_scores by design
--    (the "fair leaderboard" guard in src/11-game.js skips
--    dynamic mode), so we need somewhere to put these scores.
--  - Per-board scope means each board has its own competitive
--    arena — a player who's #1 on Hanukkah may be #47 on
--    Valentine. Highest replayability multiplier.
--  - FK to board_configurations(id) keeps stale board rows
--    cleaned up automatically when an admin deletes a board.
-- ============================================================
CREATE TABLE IF NOT EXISTS dynamic_board_scores (
  board_id   INTEGER NOT NULL REFERENCES board_configurations(id) ON DELETE CASCADE,
  device_id  VARCHAR(64) NOT NULL,
  name       VARCHAR(32) NOT NULL DEFAULT 'אנונימי',
  score      INTEGER NOT NULL DEFAULT 0,
  tier       INTEGER NOT NULL DEFAULT 1,
  country    VARCHAR(2),
  drops      INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (board_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_dynamic_board_scores_board_score
  ON dynamic_board_scores (board_id, score DESC);

-- ============================================================
-- Skin Configurations (admin-managed shop catalog, May 2026)
-- Single source of truth for everything the skin shop shows + the
-- buy-skin endpoint enforces. Replaces the hardcoded SKIN_PRICES map
-- on the server and SKIN_PACKS on the client (which now only carries
-- a fallback used until the boot fetch resolves).
--
-- definition shape: { tiers: [t1, t2, ..., t8] } where each ti is
--   { bg: "#hex or linear-gradient(...)", fg: "#hex", svg_key: "crown",
--     name: "כתר", emoji: "👑" }
-- svg_key references the SVG dictionary in src/01-constants.js
-- (circle/leaf/flower/flame/bolt/star/diamond/crown).
--
-- is_enabled = show in shop at all
-- is_sellable = can be purchased now (false = existing owners keep,
--   new buyers see "currently unavailable")
-- special_class = optional body class (e.g. 'aurora' to flip
--   body.skin-aurora-active and enable the bespoke CSS animations).
-- ============================================================
CREATE TABLE IF NOT EXISTS skin_configurations (
  id            SERIAL PRIMARY KEY,
  skin_id       VARCHAR(40) UNIQUE NOT NULL,
  name          VARCHAR(80) NOT NULL,
  price         INTEGER NOT NULL DEFAULT 0,
  is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  is_sellable   BOOLEAN NOT NULL DEFAULT TRUE,
  definition    JSONB NOT NULL DEFAULT '{}'::jsonb,
  special_class VARCHAR(40),
  sort_order    INTEGER NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skin_configurations_sort
  ON skin_configurations (sort_order, id);

-- ============================================================
-- Skin Gacha (Stage 18 — variable-reward Skinner box, May 2026)
-- The Genshin/Apex pattern that drives $4B/year in cosmetics revenue.
-- 5 rarity tiers with admin-tunable weights. Pity system guarantees
-- legendary+ at threshold. Daily free pull drives daily return.
-- 10x bundle creates "ענק" purchase psychology.
--
-- Pool is admin-managed: each row = one possible reward at a given
-- rarity. Weights are relative within the rarity (e.g. inside the
-- "uncommon" tier with 3 entries weighted 100/50/25 → 57%/29%/14%).
-- ============================================================
CREATE TABLE IF NOT EXISTS gacha_pool (
  id           SERIAL PRIMARY KEY,
  rarity       VARCHAR(20) NOT NULL,  -- common/uncommon/rare/legendary/mythic
  reward_type  VARCHAR(40) NOT NULL,  -- gems/skin/bp_tier/chest/freeze
  amount       INT,                   -- for gems/bp_tier/chest/freeze
  skin_id      VARCHAR(40),           -- for skin
  display_name VARCHAR(80),           -- shown on the reveal card
  emoji        VARCHAR(10),
  weight       INT NOT NULL DEFAULT 100,
  is_featured  BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gacha_pool_rarity
  ON gacha_pool (rarity, is_enabled);

CREATE TABLE IF NOT EXISTS player_gacha_state (
  device_id              VARCHAR(64) PRIMARY KEY,
  total_pulls            INT NOT NULL DEFAULT 0,
  -- pity_counter resets to 0 every time the player pulls legendary OR mythic.
  -- When it reaches gacha_pity_threshold, the next pull is FORCED to be at
  -- least legendary — the "guaranteed" mechanic that keeps players grinding.
  pity_counter           INT NOT NULL DEFAULT 0,
  free_pull_claimed_date DATE,
  last_pull_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gacha_pulls_history (
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
);
CREATE INDEX IF NOT EXISTS idx_gacha_pulls_device
  ON gacha_pulls_history (device_id, pulled_at DESC);

-- Master config keys (15 total).
INSERT INTO game_config (key, value) VALUES ('gacha_enabled',            'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('gacha_name',               '🎰 גאצ׳ה סקינים') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('gacha_price_single',       '100')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('gacha_price_ten',          '900')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('gacha_pity_threshold',     '50')   ON CONFLICT (key) DO NOTHING;
-- Rarity weights — sum to 100. Tweak to make the game more/less generous.
INSERT INTO game_config (key, value) VALUES ('gacha_weight_common',      '60')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('gacha_weight_uncommon',    '25')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('gacha_weight_rare',        '12')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('gacha_weight_legendary',   '2.5')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('gacha_weight_mythic',      '0.5')  ON CONFLICT (key) DO NOTHING;
-- Daily free pull — the daily-return hook.
INSERT INTO game_config (key, value) VALUES ('gacha_free_pull_enabled',  'true') ON CONFLICT (key) DO NOTHING;
-- Featured: admin picks ONE pool item to "feature" (boosted rate within its rarity).
INSERT INTO game_config (key, value) VALUES ('gacha_featured_id',        '')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('gacha_featured_boost_pct', '30')   ON CONFLICT (key) DO NOTHING;
-- Discount for 10-pull: 900 instead of 1000 (10% off) by default.
-- Set to same as 10*single to disable the discount.
INSERT INTO game_config (key, value) VALUES ('gacha_show_on_home',       'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('gacha_dups_to_gems_pct',   '50')   ON CONFLICT (key) DO NOTHING;

-- Seed the pool with 17 entries (covers all 5 rarities, all reward types).
-- Admin can edit/disable/add via the panel.
INSERT INTO gacha_pool (rarity, reward_type, amount, skin_id, display_name, emoji, weight) VALUES
  -- Common (60%): small payouts so consolation prizes feel ok
  ('common',    'gems',  20,  NULL,      '20 יהלומים',         '💎',  100),
  ('common',    'gems',  30,  NULL,      '30 יהלומים',         '💎',  60),
  ('common',    'gems',  50,  NULL,      '50 יהלומים',         '💎',  30),
  -- Uncommon (25%): useful consumables
  ('uncommon',  'gems',  100, NULL,      '100 יהלומים',        '💎',  100),
  ('uncommon',  'chest', 1,   NULL,      'תיבת הפתעה',          '🎁',  60),
  ('uncommon',  'freeze',1,   NULL,      'הקפאת רצף',           '🛡',  40),
  -- Rare (12%): bigger items
  ('rare',      'gems',  300, NULL,      '300 יהלומים',        '💎',  80),
  ('rare',      'chest', 3,   NULL,      '3 תיבות הפתעה',       '🎁',  60),
  ('rare',      'bp_tier',1,  NULL,      'דרגת Battle Pass',    '🎖',  40),
  ('rare',      'skin',  NULL,'fire',    'סקין: אש',           '🔥',  20),
  -- Legendary (2.5%): the dopamine hits
  ('legendary', 'gems',  1500,NULL,      '1500 יהלומים',       '💎',  60),
  ('legendary', 'bp_tier',3,  NULL,      '3 דרגות Battle Pass', '🎖',  40),
  ('legendary', 'skin',  NULL,'space',   'סקין: חלל',          '🚀',  30),
  ('legendary', 'skin',  NULL,'gold',    'סקין: זהב',          '👑',  25),
  -- Mythic (0.5%): the rare-mention moments. Players remember these for years.
  ('mythic',    'gems',  5000,NULL,      '5000 יהלומים',       '💎',  50),
  ('mythic',    'skin',  NULL,'aurora',  'סקין: זוהר',         '✨',  30),
  ('mythic',    'bp_tier',10, NULL,      '10 דרגות Battle Pass','🎖',  20)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Daily Deals (Stage 21 — rotating daily offer, May 2026)
-- One deal per day (Asia/Jerusalem), deterministic pick from the
-- pool. 50-70% discount creates anchoring psychology. 24h countdown
-- creates urgency. One purchase per device per day per deal.
--
-- Pool is admin-managed via the daily_deals table; admin adds/edits
-- offers + can force a specific deal via daily_deals_override_id.
-- Contents JSONB supports: gems / skin_id / bp_tiers / chest_count /
-- streak_freezes / powerup_id+count.
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_deals (
  id            SERIAL PRIMARY KEY,
  slug          VARCHAR(40) UNIQUE NOT NULL,
  name          VARCHAR(80) NOT NULL,
  description   TEXT,
  emoji         VARCHAR(10),
  price_gems    INT NOT NULL,
  -- original value (for the strikethrough). Display only.
  original_value INT,
  contents      JSONB NOT NULL DEFAULT '{}'::jsonb,
  category      VARCHAR(40),
  is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_daily_deals_enabled
  ON daily_deals (is_enabled, sort_order);

CREATE TABLE IF NOT EXISTS daily_deal_purchases (
  device_id     VARCHAR(64) NOT NULL,
  deal_id       INT NOT NULL,
  purchase_date DATE NOT NULL,
  price_paid    INT,
  contents_snapshot JSONB,
  purchased_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, deal_id, purchase_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_deal_purchases_device
  ON daily_deal_purchases (device_id, purchase_date DESC);

-- Master config keys
INSERT INTO game_config (key, value) VALUES ('daily_deals_enabled',       'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_deals_show_on_home',  'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_deals_override_id',   '')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_deals_per_day',       '1')    ON CONFLICT (key) DO NOTHING;

-- Seed 7 starter deals — admin can edit/disable/remove via the panel.
-- Format: (slug, name, description, emoji, price, value, contents, category)
INSERT INTO daily_deals (slug, name, description, emoji, price_gems, original_value, contents, category) VALUES
  ('gem_starter',  '💎 חבילת יהלומים', 'הצעה יומית — 200💎 במחיר חצי', '💎', 50,  200, '{"gems":200}'::jsonb, 'gems'),
  ('gem_bundle',   '💎 חבילת ענק',     '1200💎 בהנחה משמעותית',         '💎', 500, 1200,'{"gems":1200}'::jsonb,'gems'),
  ('skin_deal',    '🎨 דיל סקין',      'סקין fire ב-60% הנחה',          '🎨', 200, 500, '{"skin_id":"fire"}'::jsonb,'skin'),
  ('bp_boost',     '🎖 קפיצת Battle Pass', 'דרגת BP מיידית',            '🎖', 300, 800, '{"bp_tiers":1}'::jsonb,'battle_pass'),
  ('chest_x3',     '🎁 3 תיבות הפתעה', '3 mystery chests בהנחה',         '🎁', 150, 450, '{"chest_count":3}'::jsonb,'chest'),
  ('freeze_x3',    '🛡 3 הקפאות רצף',  'הגנה משלוש פספוסי ימים',         '🛡', 300, 600, '{"streak_freezes":3}'::jsonb,'freeze'),
  ('mega_bundle',  '🌟 חבילת מגה',     'יהלומים + סקין + דרגת BP',       '🌟', 800, 2500,'{"gems":1000,"skin_id":"space","bp_tiers":1}'::jsonb,'mega')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Starter Pack (Stage 20 — first-purchase funnel, May 2026)
-- The single highest-conversion offer in F2P puzzle games (50-90%
-- buy-through in industry data). One-time per device. 7-day countdown
-- after the player's first decent game (≥ trigger_score). One device
-- can only ever buy ONCE per season_id (so a new season can reset
-- and offer again to existing players).
-- ============================================================
CREATE TABLE IF NOT EXISTS starter_pack_state (
  device_id      VARCHAR(64) PRIMARY KEY,
  season_id      VARCHAR(32) NOT NULL DEFAULT 'S1',
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- eligible_at is set when the player crosses the trigger score
  -- threshold for the first time. expires_at = eligible_at + N hours.
  eligible_at    TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  purchased_at   TIMESTAMPTZ,
  dismissed_count INT NOT NULL DEFAULT 0,
  -- Snapshot of the pack contents at purchase time so future config
  -- changes don't mess with what the player actually got.
  pack_contents  JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_starter_pack_eligible
  ON starter_pack_state (eligible_at, expires_at)
  WHERE purchased_at IS NULL;

INSERT INTO game_config (key, value) VALUES ('starter_pack_enabled',           'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('starter_pack_price_gems',        '500')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('starter_pack_price_usd',         '1.99') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('starter_pack_trigger_score',     '5000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('starter_pack_expires_hours',     '168')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('starter_pack_reward_gems',       '1500') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('starter_pack_reward_skin_id',    'fire') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('starter_pack_reward_bp_tiers',   '3')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('starter_pack_name',              '🎁 חבילת פתיחה') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Daily Special Board (Stage 15 — Daily mini-event boards, May 2026)
-- One dynamic board each day (Asia/Jerusalem) becomes the "🌟 הלוח של היום"
-- with 3× Season XP + 2× quest rewards. Deterministic per-date pick from
-- the active dynamic boards list; all players see the SAME board today,
-- but it rotates. Drives daily-board roulette ("what's special today?")
-- which is the single most-tested daily-return hook in F2P puzzle games.
--
-- Admin override: `daily_special_override_id` = numeric board id forces
-- that board to be today's special regardless of the hash pick.
-- Empty string = use the deterministic hash.
-- ============================================================
INSERT INTO game_config (key, value) VALUES ('daily_special_enabled',      'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_special_xp_mult',      '3')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_special_reward_mult',  '2')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_special_override_id',  '')     ON CONFLICT (key) DO NOTHING;
