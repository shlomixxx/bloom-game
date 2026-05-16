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

-- Default merge mode: 'anchor' (new, result stays at drop) or 'classic' (old, leftmost wins)
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
  contest_code VARCHAR(8),
  device_id    VARCHAR(64) NOT NULL,
  amount       INT NOT NULL,
  type         VARCHAR(20) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

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
