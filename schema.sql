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
-- T2.5 — Daily Checklist all-done bonus. One-shot reward per device per
-- day when 5/5 checklist items are complete. Server validates allDone
-- by re-running the checklist query (anti-cheat). Default 100💎 keeps
-- it meaningful but not exploitable (max 100/day per device).
INSERT INTO game_config (key, value) VALUES ('checklist_all_done_reward', '100')
  ON CONFLICT (key) DO NOTHING;
-- T3.1 — In-game booster prices. Boosters are spent gems mid-game to
-- alter the current run. v1 ships PICK (choose next piece tier) + POP
-- (remove any tile). Available only in practice + dynamic modes (NOT
-- daily/contest/duel for fairness). Each booster max once per game on
-- the client; server allows multiple buys to keep schema simple.
INSERT INTO game_config (key, value) VALUES ('booster_enabled',    'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('booster_pick_price', '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('booster_pop_price',  '40')   ON CONFLICT (key) DO NOTHING;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS is_random_match BOOLEAN DEFAULT FALSE;

-- M1 — Self-Promo Engine. Replaces external AdSense with in-house
-- promotions for OUR products (skins, deals, gem packs, etc). Each
-- "ad slot" in the game shows a smart-targeted promo card instead of
-- a third-party ad. Player can still get their gem reward; the promo
-- adds an optional CTA to buy/visit one of our products.
CREATE TABLE IF NOT EXISTS internal_promos (
  id              BIGSERIAL PRIMARY KEY,
  slug            VARCHAR(60) UNIQUE NOT NULL,
  kind            VARCHAR(40) NOT NULL, -- 'starter_pack' / 'daily_deal' / 'skin' / 'gacha' / 'battle_pass' / 'gem_pack' / 'custom'
  title           VARCHAR(120) NOT NULL,
  body            VARCHAR(400) NOT NULL,
  cta_text        VARCHAR(60) NOT NULL DEFAULT 'קנה עכשיו',
  cta_target      VARCHAR(60) NOT NULL, -- e.g. 'open_starter_pack' / 'open_daily_deal' / 'open_skin_shop' / 'open_gacha'
  image_emoji     VARCHAR(8) NOT NULL DEFAULT '🎁',
  bg_gradient     VARCHAR(120), -- optional custom gradient
  level_min       INT NOT NULL DEFAULT 1,
  level_max       INT NOT NULL DEFAULT 999,
  weight          INT NOT NULL DEFAULT 100, -- higher = more often
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  -- If this promo targets a player-specific gate (e.g. don't show
  -- starter_pack to someone who already bought it), the kind drives
  -- a server-side exclusion query.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promos_enabled_kind ON internal_promos (is_enabled, kind);

CREATE TABLE IF NOT EXISTS promo_impressions (
  id              BIGSERIAL PRIMARY KEY,
  promo_id        BIGINT NOT NULL REFERENCES internal_promos(id) ON DELETE CASCADE,
  device_id       VARCHAR(64) NOT NULL,
  slot            VARCHAR(30) NOT NULL DEFAULT 'home_tile', -- 'ad_watch' / 'home_tile' / 'game_over' / etc.
  shown_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promo_impr_device_time ON promo_impressions (device_id, shown_at DESC);
CREATE INDEX IF NOT EXISTS idx_promo_impr_promo ON promo_impressions (promo_id, shown_at DESC);

CREATE TABLE IF NOT EXISTS promo_clicks (
  id              BIGSERIAL PRIMARY KEY,
  promo_id        BIGINT NOT NULL REFERENCES internal_promos(id) ON DELETE CASCADE,
  device_id       VARCHAR(64) NOT NULL,
  slot            VARCHAR(30) NOT NULL DEFAULT 'home_tile',
  clicked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promo_clicks_promo ON promo_clicks (promo_id, clicked_at DESC);

INSERT INTO game_config (key, value) VALUES ('promo_enabled', 'true') ON CONFLICT (key) DO NOTHING;
-- Cooldown: same promo can't reappear within X minutes for the same device.
INSERT INTO game_config (key, value) VALUES ('promo_cooldown_minutes', '60') ON CONFLICT (key) DO NOTHING;

-- ── 6 seeded default promos ──
INSERT INTO internal_promos (slug, kind, title, body, cta_text, cta_target, image_emoji, bg_gradient, level_min, level_max, weight) VALUES
('starter_pack_promo', 'starter_pack',
  '🎁 חבילת פתיחה — חד-פעמית',
  '1,500💎 + סקין חדש + 3 דרגות Battle Pass · במחיר 500💎 בלבד (חוסך 79%)',
  'פתח את החבילה →',
  'open_starter_pack',
  '🎁',
  'linear-gradient(135deg, #FFD93D 0%, #FF9F2E 50%, #FF6B9D 100%)',
  1, 999, 150)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO internal_promos (slug, kind, title, body, cta_text, cta_target, image_emoji, bg_gradient, level_min, level_max, weight) VALUES
('daily_deal_promo', 'daily_deal',
  '🔥 דיל היום!',
  'הצעה מתחלפת בכל יום. הנחות עד 60%. נגמר בחצות.',
  'בדוק עכשיו →',
  'open_daily_deal',
  '🔥',
  'linear-gradient(135deg, #FF4D6D 0%, #FF8DA1 100%)',
  5, 999, 120)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO internal_promos (slug, kind, title, body, cta_text, cta_target, image_emoji, bg_gradient, level_min, level_max, weight) VALUES
('skin_shop_promo', 'skin',
  '🎨 סקינים חדשים בחנות',
  'התאם אישית את הלוח שלך. סקין Aurora אגדי + עוד 6 סגנונות.',
  'גלה →',
  'open_skin_shop',
  '🎨',
  'linear-gradient(135deg, #7A5FE0 0%, #B59FFA 100%)',
  8, 999, 80)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO internal_promos (slug, kind, title, body, cta_text, cta_target, image_emoji, bg_gradient, level_min, level_max, weight) VALUES
('gacha_promo', 'gacha',
  '🎰 גאצ׳ה — סקין אגדי מובטח!',
  'פול חינם זמין היום. אגדי מובטח כל 50 פולים.',
  'נסה את המזל →',
  'open_gacha',
  '🎰',
  'linear-gradient(135deg, #3D1A78 0%, #7A5FE0 50%, #FF6B9D 100%)',
  18, 999, 70)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO internal_promos (slug, kind, title, body, cta_text, cta_target, image_emoji, bg_gradient, level_min, level_max, weight) VALUES
('battle_pass_promo', 'battle_pass',
  '✨ Battle Pass Premium',
  '×2 פרסים בכל דרגה · עד 32,000💎 לעונה · רק 1,500💎',
  'שדרג עכשיו →',
  'open_battle_pass',
  '✨',
  'linear-gradient(135deg, #FFD93D 0%, #FFFAEC 100%)',
  12, 999, 90)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO internal_promos (slug, kind, title, body, cta_text, cta_target, image_emoji, bg_gradient, level_min, level_max, weight) VALUES
('gem_bank_promo', 'custom',
  '💰 הבנק שלך מחכה',
  'הפקד 💎 וצבור 1% ריבית יומית. שחקנים חכמים חוסכים.',
  'פתח את הבנק →',
  'open_gem_bank',
  '💰',
  'linear-gradient(135deg, #1B5E20 0%, #2E7D32 50%, #66BB6A 100%)',
  8, 999, 60)
ON CONFLICT (slug) DO NOTHING;

-- A5 — Live PvP Race. Polling-based "real-time" 60-second race using
-- the existing duels table. is_live flag distinguishes from async duels.
-- started_at is set on match; both players post heartbeats every 1s.
-- Auto-settles after duration_seconds elapse via cron.
ALTER TABLE duels ADD COLUMN IF NOT EXISTS is_live BOOLEAN DEFAULT FALSE;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS duration_seconds INT DEFAULT 60;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS challenger_live_score INT DEFAULT 0;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS opponent_live_score INT DEFAULT 0;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS live_last_heartbeat_at TIMESTAMPTZ;

INSERT INTO game_config (key, value) VALUES ('live_race_enabled',  'true') ON CONFLICT (key) DO NOTHING;
-- Default race length in seconds. 60s = adrenaline; 90s = more strategy.
INSERT INTO game_config (key, value) VALUES ('live_race_duration', '60')   ON CONFLICT (key) DO NOTHING;
-- Winner reward (taken from wager pool; if no wager, paid from house).
INSERT INTO game_config (key, value) VALUES ('live_race_winner_reward', '50') ON CONFLICT (key) DO NOTHING;

-- A9 — Ghost Mode. Stores the column-index sequence of every drop in
-- a game so other players can "race the ghost" of someone who finished
-- the same daily/practice run earlier. Storage is minimal (~30 ints per
-- game = <100 bytes JSON per row).
ALTER TABLE daily_scores ADD COLUMN IF NOT EXISTS drops_sequence JSONB;
ALTER TABLE difficulty_scores ADD COLUMN IF NOT EXISTS drops_sequence JSONB;

INSERT INTO game_config (key, value) VALUES ('ghost_enabled', 'true') ON CONFLICT (key) DO NOTHING;
-- Minimum drops for a ghost to be "raceable" (3 drops = trivial game, skip).
INSERT INTO game_config (key, value) VALUES ('ghost_min_drops', '5') ON CONFLICT (key) DO NOTHING;
-- Reward for the racing player when they beat the ghost.
INSERT INTO game_config (key, value) VALUES ('ghost_beat_reward', '30') ON CONFLICT (key) DO NOTHING;

-- TD.2 — Ghost Replay push notification. When a player A submits a
-- daily score that overtakes friend B's score on the same date, B
-- gets a push: "A passed you! He scored 12,500. Come race the ghost".
-- One push per (sender, recipient, date) to avoid spam when the
-- sender keeps improving.
INSERT INTO game_config (key, value) VALUES ('ghost_push_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('ghost_push_min_lead', '500') ON CONFLICT (key) DO NOTHING;

-- A8 — Squad Tournaments. Weekly 4-guild bracket competition. Auto-matched
-- Sunday morning. 4 guilds play through the week → Wednesday evening
-- semifinals (top-2 scores per pair) → Saturday evening final → winner
-- guild's members each get 1000💎. Differs from Stage 37 Guild Wars (1v1)
-- by being a 4-way bracket — 3 elimination stages, more drama, weekly
-- cadence ON TOP of the daily-war cadence Guild Wars already provides.
CREATE TABLE IF NOT EXISTS squad_tournaments (
  id              BIGSERIAL PRIMARY KEY,
  week_start      DATE NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  -- Statuses: active (week-long score gathering) →
  -- semifinals (Wed eve, top-2 of each pair advance) →
  -- finals (Sat eve, finalists compete) →
  -- finished (winner credited, gems distributed)
  winner_guild_id INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  semifinals_at   TIMESTAMPTZ,
  finals_at       TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  UNIQUE (week_start)
);

CREATE TABLE IF NOT EXISTS squad_tournament_guilds (
  tournament_id      BIGINT NOT NULL REFERENCES squad_tournaments(id) ON DELETE CASCADE,
  guild_id           INT NOT NULL,
  bracket_position   INT NOT NULL, -- 0,1 = pair A; 2,3 = pair B
  score_total        BIGINT NOT NULL DEFAULT 0,
  games_count        INT NOT NULL DEFAULT 0,
  eliminated_at      TIMESTAMPTZ,
  semifinal_winner   BOOLEAN NOT NULL DEFAULT FALSE,
  final_winner       BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tournament_id, guild_id)
);
CREATE INDEX IF NOT EXISTS idx_squad_guilds_guild ON squad_tournament_guilds (guild_id);

-- Per-member score contribution tracking (so the modal can show who's
-- carrying the guild this week).
CREATE TABLE IF NOT EXISTS squad_tournament_contributions (
  tournament_id BIGINT NOT NULL REFERENCES squad_tournaments(id) ON DELETE CASCADE,
  device_id     VARCHAR(64) NOT NULL,
  guild_id      INT NOT NULL,
  score_contrib BIGINT NOT NULL DEFAULT 0,
  games_count   INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, device_id)
);

-- Reward-claim dedup (one claim per device per tournament).
CREATE TABLE IF NOT EXISTS squad_tournament_claims (
  tournament_id BIGINT NOT NULL REFERENCES squad_tournaments(id) ON DELETE CASCADE,
  device_id     VARCHAR(64) NOT NULL,
  amount        INT NOT NULL,
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, device_id)
);

INSERT INTO game_config (key, value) VALUES ('squad_tournament_enabled',     'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('squad_tournament_min_members', '3')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('squad_tournament_winner_reward','1000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('squad_tournament_finalist_reward','300') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('squad_tournament_semi_reward', '100') ON CONFLICT (key) DO NOTHING;

-- A10 — Compound Interest Gem Bank. Player deposits 💎 → bank pays
-- daily compound interest. Withdrawal costs a percentage fee. Pure
-- behavioral economics — loss-aversion (withdrawal fee) + compound
-- dopamine (numbers grow every day).
--
-- Daily interest cron runs at 03:00 Asia/Jerusalem (via server.js
-- setInterval — same pattern as PII purge + queue cleanup).
CREATE TABLE IF NOT EXISTS gem_bank (
  device_id          VARCHAR(64) PRIMARY KEY,
  deposited          BIGINT NOT NULL DEFAULT 0,
  total_interest_paid BIGINT NOT NULL DEFAULT 0,
  last_interest_date DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO game_config (key, value) VALUES ('bank_enabled',          'true') ON CONFLICT (key) DO NOTHING;
-- 1% daily interest by default. Stored as PERCENTAGE (1 = 1%). Admin
-- can tune (e.g. 0.5 = half percent, 2 = double).
INSERT INTO game_config (key, value) VALUES ('bank_interest_pct_daily', '1')   ON CONFLICT (key) DO NOTHING;
-- 5% withdrawal fee — the "stickiness" of the bank. Without this the
-- mechanic is pointless (player just deposits/withdraws freely).
INSERT INTO game_config (key, value) VALUES ('bank_withdrawal_fee_pct', '5')   ON CONFLICT (key) DO NOTHING;
-- Minimum deposit to prevent spam-flow micro-transactions
INSERT INTO game_config (key, value) VALUES ('bank_min_deposit',        '100') ON CONFLICT (key) DO NOTHING;
-- Daily cap so a whale doesn't accumulate infinite passive income
INSERT INTO game_config (key, value) VALUES ('bank_max_balance',        '1000000') ON CONFLICT (key) DO NOTHING;

-- A7 — 7-Day Login Calendar (Genshin pattern). Separate from the
-- existing daily-login flow (which pays streak-tiered rewards). This
-- is a 7-day cycle: day 1 → 2 → ... → 7 → 1, with escalating gem
-- rewards each day. Miss a day = reset to day 1 (FOMO of losing the
-- big day-7 payout drives daily returns).
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS login_cal_day INT DEFAULT 0;
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS login_cal_last_claim DATE;

INSERT INTO game_config (key, value) VALUES ('login_cal_enabled',  'true') ON CONFLICT (key) DO NOTHING;
-- Per-day rewards (1-7). Day 7 is the big jackpot — losing it = pain.
INSERT INTO game_config (key, value) VALUES ('login_cal_day_1_reward', '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('login_cal_day_2_reward', '100')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('login_cal_day_3_reward', '200')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('login_cal_day_4_reward', '500')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('login_cal_day_5_reward', '1000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('login_cal_day_6_reward', '2000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('login_cal_day_7_reward', '5000') ON CONFLICT (key) DO NOTHING;

-- A6 — Skill-based Duel Matchmaking. Solo players who don't have a
-- friend with a BLOOM code can hit "🎲 דו-קרב אקראי" → server pairs
-- them with another waiting player in similar trophy range. Atomic
-- match-or-queue: every search call either pairs two players in one
-- transaction OR upserts a queue row + returns "still searching".
-- Range widens each poll (50 → 200 → 500 → ANY) so a player isn't
-- stuck waiting forever even on a quiet hour.
CREATE TABLE IF NOT EXISTS duel_matchmaking_queue (
  device_id        VARCHAR(64) PRIMARY KEY,
  trophy_count     INT NOT NULL DEFAULT 0,
  display_name     VARCHAR(80),
  player_code      VARCHAR(10),
  joined_queue_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  poll_count       INT NOT NULL DEFAULT 0,
  difficulty_label VARCHAR(20) NOT NULL DEFAULT 'default'
);
CREATE INDEX IF NOT EXISTS idx_duel_queue_trophies
  ON duel_matchmaking_queue (trophy_count, joined_queue_at);

INSERT INTO game_config (key, value) VALUES ('random_match_enabled',       'true') ON CONFLICT (key) DO NOTHING;
-- Trophy range tiers — match widens with each poll. ±50 first try, then
-- ±200, then ±500, then ANY (after wait threshold).
INSERT INTO game_config (key, value) VALUES ('random_match_range_initial', '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('random_match_range_widen',   '150')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('random_match_max_wait_secs', '30')   ON CONFLICT (key) DO NOTHING;
-- Random duels are FREE (no wager) — opposite of code-duels which support
-- player-set wagers. This keeps the bar to entry low; trophy stakes are
-- the implicit competition.
INSERT INTO game_config (key, value) VALUES ('random_match_wager',         '0')    ON CONFLICT (key) DO NOTHING;

-- A2 — Friend Challenges (K-factor viral lever). Player A picks a friend
-- + target score → server creates a "beat this" challenge that the friend
-- can attempt by playing any game in 24h. When the friend's score crosses
-- target, status flips to 'passed' and both get a push. Otherwise expires.
-- Simpler than duels: no wager, no shared seed, no live race — just a
-- "can you beat my score?" thrown at a friend.
CREATE TABLE IF NOT EXISTS friend_challenges (
  id                  BIGSERIAL PRIMARY KEY,
  challenger_device   VARCHAR(64) NOT NULL,
  challenged_device   VARCHAR(64) NOT NULL,
  challenger_name     VARCHAR(80),
  challenged_name     VARCHAR(80),
  target_score        INT NOT NULL,
  board_id            INT, -- optional: specific dynamic board; NULL = any board
  board_name          VARCHAR(120),
  message             VARCHAR(200),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- statuses: pending / passed / failed_expired / declined
  result_score        INT,
  result_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friend_challenges_challenged_pending
  ON friend_challenges (challenged_device, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_friend_challenges_challenger_active
  ON friend_challenges (challenger_device, created_at DESC);

INSERT INTO game_config (key, value) VALUES ('friend_challenge_enabled',       'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('friend_challenge_expires_hours', '24')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('friend_challenge_max_pending',   '10')   ON CONFLICT (key) DO NOTHING;
-- Winner's gem reward when the challenged player passes the target.
-- BOTH sides get it (challenger because "you motivated them" = +50;
-- challenged because "you won = +50"). Encourages spamming challenges.
INSERT INTO game_config (key, value) VALUES ('friend_challenge_win_reward',    '50')   ON CONFLICT (key) DO NOTHING;

-- A3 — Trophy Chests (Clash Royale "must-return" pattern). After a trophy-
-- earning game (score ≥ threshold) the server may grant a chest. The chest
-- sits "earned" until the player taps "התחל לפתוח" — then a real-time
-- countdown starts. Player must come back N hours later to open + collect
-- gems. 4 slot maximum (creates scarcity — full slots block new chests).
-- Only ONE chest can be unlocking at a time (Clash Royale pattern — player
-- has to choose which chest to "burn" the time on).
CREATE TABLE IF NOT EXISTS trophy_chests (
  id                      BIGSERIAL PRIMARY KEY,
  device_id               VARCHAR(64) NOT NULL,
  chest_type              VARCHAR(20) NOT NULL,
  earned_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlock_started_at       TIMESTAMPTZ,
  opens_at                TIMESTAMPTZ,
  claimed_at              TIMESTAMPTZ,
  reward_gems             INT
);
CREATE INDEX IF NOT EXISTS idx_trophy_chests_device_unclaimed
  ON trophy_chests (device_id) WHERE claimed_at IS NULL;

INSERT INTO game_config (key, value) VALUES ('chest_enabled',                'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('chest_max_slots',              '4')    ON CONFLICT (key) DO NOTHING;
-- Earn chance (0-100) on any trophy-earning game whose score >= chest_min_score.
INSERT INTO game_config (key, value) VALUES ('chest_earn_chance_pct',        '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('chest_min_score',              '500')  ON CONFLICT (key) DO NOTHING;
-- Per-tier unlock durations (in MINUTES so admin can ship 1-min test chests
-- without rewriting the schema). Defaults match the spec: 4h / 8h / 24h.
INSERT INTO game_config (key, value) VALUES ('chest_common_minutes',         '240')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('chest_rare_minutes',           '480')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('chest_legendary_minutes',      '1440')  ON CONFLICT (key) DO NOTHING;
-- Per-tier reward ranges (random within [min, max] at earn time, stored
-- on the row so opening pays exactly what was rolled — no re-roll exploits).
INSERT INTO game_config (key, value) VALUES ('chest_common_gems_min',        '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('chest_common_gems_max',        '150')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('chest_rare_gems_min',          '200')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('chest_rare_gems_max',          '500')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('chest_legendary_gems_min',     '1000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('chest_legendary_gems_max',     '3000') ON CONFLICT (key) DO NOTHING;
-- Tier roll weights (sums to 100). Common drops most often, legendary rare.
INSERT INTO game_config (key, value) VALUES ('chest_weight_common',          '65')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('chest_weight_rare',            '28')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('chest_weight_legendary',       '7')    ON CONFLICT (key) DO NOTHING;
-- Guaranteed Legendary when a Trophy Road milestone is claimed (admin gate).
INSERT INTO game_config (key, value) VALUES ('chest_milestone_legendary',    'true') ON CONFLICT (key) DO NOTHING;

-- T7.2 — Golden Hour event. Admin-toggleable time-windowed XP multiplier.
-- When `event_golden_hour_active = 'true'` AND `event_golden_hour_ends_at`
-- is in the future, every season XP grant multiplies by `event_golden_hour_xp_mult`.
-- Admin starts via a button that sets active=true + ends_at = NOW() + duration.
-- Auto-deactivates server-side (lazy check at grant time when window expires).
INSERT INTO game_config (key, value) VALUES ('event_golden_hour_active',   'false') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_golden_hour_ends_at',  '')      ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('event_golden_hour_xp_mult',  '2')     ON CONFLICT (key) DO NOTHING;
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
-- IS.7 — how long the finisher of an ASYNC duel waits on the result overlay
-- before it flips to the friendly "score locked, we'll notify you" state.
-- (A live 60s race always uses the full 5-min poll.) Keeps players from being
-- trapped on a spinner when the opponent is offline.
INSERT INTO game_config (key, value) VALUES ('duel_async_wait_seconds', '45')
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

-- xp/level: progression columns referenced by ranking, FTUE gates, and
-- Phase-1 progressive-unlock. db.js applies these idempotently on boot,
-- but schema.sql must also carry them so a fresh psql replay matches.
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS xp INT DEFAULT 0;
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS level INT DEFAULT 1;
-- #15 — player moderation: ban a device (blocks all state-mutating endpoints).
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS banned_reason TEXT;

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
-- AS.1 Anti-stall + flow (kills the "wait for a bomb without playing" exploit).
-- A — events require activity: a bonus spawns only after N drops since the last one (a staller earns nothing).
INSERT INTO game_config (key, value) VALUES ('events_activity_gate_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('events_min_drops_since_last',  '3')    ON CONFLICT (key) DO NOTHING;
-- C — flow/combo meter: fast consecutive drops build a score multiplier that decays when idle.
INSERT INTO game_config (key, value) VALUES ('flow_meter_enabled',   'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('flow_window_ms',       '2500') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('flow_mult_per_level',  '0.15') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('flow_max_mult',        '2.0')  ON CONFLICT (key) DO NOTHING;
-- B — idle pressure: warn then act when the player stalls.
INSERT INTO game_config (key, value) VALUES ('idle_pressure_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('idle_warn_seconds',     '10')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('idle_action_seconds',   '18')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('idle_action',           'warn') ON CONFLICT (key) DO NOTHING;
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

-- TA.2 — Continue-ad dedup. Same exploit class as ad-watch: a player
-- who refreshes mid-game-over screen could re-claim the "watch ad to
-- continue" use because the client-only usedContinue flag reset on
-- every init(). Server now enforces per-game dedup + daily cap +
-- cooldown via _cont:* / _cont_count:* / _cont_rate:* keys.
INSERT INTO game_config (key, value) VALUES ('continue_daily_cap', '3') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('continue_cooldown_seconds', '30') ON CONFLICT (key) DO NOTHING;

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
-- Task #31 — escalating comeback ladder: bigger gift the longer you were away.
INSERT INTO game_config (key, value) VALUES ('dyn_comeback_reward_7',    '300')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('dyn_comeback_reward_14',   '600')  ON CONFLICT (key) DO NOTHING;
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
-- Friend Requests (FD.2 — May 29 2026)
-- Adds a request workflow on top of the existing instant-friendship
-- model. A request stays 'pending' until the target accepts (creates
-- friendship + pays bonus to both) or declines (no friendship + no
-- bonus). Old /api/friends/invite is kept for back-compat (existing
-- WhatsApp invite UX, ?ref= deep-links). New endpoints power the
-- search + request panel.
-- ============================================================
CREATE TABLE IF NOT EXISTS friend_requests (
  id          BIGSERIAL PRIMARY KEY,
  from_device VARCHAR(64) NOT NULL,
  to_device   VARCHAR(64) NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'accepted', 'declined', 'canceled')),
  message     VARCHAR(160),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (from_device <> to_device)
);
-- One pending request per (from, to) — second tap re-uses or no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS uq_friend_requests_pending
  ON friend_requests (from_device, to_device) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_friend_requests_to_pending
  ON friend_requests (to_device, created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_friend_requests_from_pending
  ON friend_requests (from_device, created_at DESC) WHERE status = 'pending';

INSERT INTO game_config (key, value) VALUES ('friend_requests_enabled',     'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('friend_requests_max_pending', '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('friend_search_min_chars',     '2')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('friend_search_max_results',   '20')   ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Cross-device Account Sync (FD.2 — May 29 2026)
--
-- Lets a player on device A generate a one-time 6-char code, type it
-- on device B (different browser, new install, lost-then-recovered
-- localStorage), and have device B inherit device A's identity. The
-- redeem endpoint replaces device B's localStorage `bloom_device_id`
-- + `bloom_device_token` with device A's values — server sees one
-- identity from then on. Player keeps their BLOOM-XXXX code, streak,
-- trophies, achievements, balance, friends, everything.
--
-- Anti-abuse: code is 6 random chars, expires in 10 min, single-use
-- (used_at + used_by_device_id stamped on redeem). Source device
-- must be authenticated when creating the code — only the real owner
-- can issue a transfer.
-- ============================================================
CREATE TABLE IF NOT EXISTS device_transfer_codes (
  code              VARCHAR(8) PRIMARY KEY,
  source_device_id  VARCHAR(64) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ,
  used_by_device_id VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS idx_dtc_source ON device_transfer_codes (source_device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dtc_active ON device_transfer_codes (expires_at) WHERE used_at IS NULL;

INSERT INTO game_config (key, value) VALUES ('device_sync_enabled',  'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('device_sync_ttl_min',  '10')   ON CONFLICT (key) DO NOTHING;

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
-- Weekly Leagues (Stage 34, May 2026)
-- 5 tiers (Bronze/Silver/Gold/Diamond/Master) based on lifetime XP
-- gained THIS week. Resets every Sunday (Asia/Jerusalem). Each tier
-- multiplies the daily login bonus and quest rewards. Creates the
-- week-over-week competitive structure that's missing — Brawl Stars
-- pattern that adds anxiety + aspiration.
-- ============================================================
CREATE TABLE IF NOT EXISTS player_weekly_xp (
  device_id          VARCHAR(64) NOT NULL,
  -- Week start date (Sunday in Asia/Jerusalem).
  week_start         DATE NOT NULL,
  xp_at_week_start   BIGINT NOT NULL,
  -- Computed at read time but we cache so client can show "this week's gain"
  -- without aggregating again.
  best_league_seen   VARCHAR(20),
  reward_claimed     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (device_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_weekly_xp_week
  ON player_weekly_xp (week_start DESC);

-- 4 config keys.
INSERT INTO game_config (key, value) VALUES ('league_enabled',                    'true') ON CONFLICT (key) DO NOTHING;
-- Threshold XP for each tier (cumulative weekly gain to reach this tier).
INSERT INTO game_config (key, value) VALUES ('league_threshold_silver',           '500')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('league_threshold_gold',             '2000')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('league_threshold_diamond',          '10000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('league_threshold_master',           '50000') ON CONFLICT (key) DO NOTHING;
-- End-of-week bonus per tier (claimed on Sunday).
INSERT INTO game_config (key, value) VALUES ('league_reward_bronze_gems',         '50')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('league_reward_silver_gems',         '150')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('league_reward_gold_gems',           '400')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('league_reward_diamond_gems',        '1000')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('league_reward_master_gems',         '3000')  ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Rivalry System (Stage 33, May 2026)
-- Auto-pairs players close in lifetime XP into 24-hour "rivalries".
-- Personal competition with a specific named opponent + deadline +
-- close-enough delta to feel "I can catch them". The Clash Royale
-- pattern that converts passive ranking into active engagement.
-- ============================================================
CREATE TABLE IF NOT EXISTS player_rivalries (
  id                BIGSERIAL PRIMARY KEY,
  device_id         VARCHAR(64) NOT NULL,
  rival_device_id   VARCHAR(64) NOT NULL,
  -- XP snapshots at declaration time.
  my_xp_at_decl     BIGINT NOT NULL,
  rival_xp_at_decl  BIGINT NOT NULL,
  declared_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  resolved          BOOLEAN NOT NULL DEFAULT FALSE,
  -- 'won' / 'lost' / 'tied' / 'expired'.
  outcome           VARCHAR(20),
  resolved_at       TIMESTAMPTZ,
  -- True if this player viewed the rivalry (controls "new!" badge).
  viewed_by_player  BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_rivalries_active_lookup
  ON player_rivalries (device_id, expires_at DESC) WHERE NOT resolved;
CREATE INDEX IF NOT EXISTS idx_rivalries_recent
  ON player_rivalries (declared_at DESC);

-- 3 config keys.
INSERT INTO game_config (key, value) VALUES ('rival_enabled',          'true') ON CONFLICT (key) DO NOTHING;
-- Percent threshold — 2 players within this % of each other's XP are eligible.
INSERT INTO game_config (key, value) VALUES ('rival_threshold_pct',    '10')   ON CONFLICT (key) DO NOTHING;
-- Hours the rivalry stays active.
INSERT INTO game_config (key, value) VALUES ('rival_duration_hours',   '24')   ON CONFLICT (key) DO NOTHING;
-- Reward for winning a rivalry (overtaking the rival within the window).
INSERT INTO game_config (key, value) VALUES ('rival_win_reward_gems',  '150')  ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Guilds / Clans (Stage 27, May 2026)
-- Peer-pressure retention: shared daily goal + per-member contribution
-- tracking + shared reward. Industry data: clan members play 3.4× more
-- per day than soloists, +35% D30 retention.
-- v1 scope: create/join/leave + daily crown goal + reward claim.
-- Skipped (v2): chat, clan wars, leagues.
-- ============================================================
CREATE TABLE IF NOT EXISTS guilds (
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
);
CREATE INDEX IF NOT EXISTS idx_guilds_score
  ON guilds (total_score_alltime DESC);
CREATE INDEX IF NOT EXISTS idx_guilds_public
  ON guilds (is_public, member_count) WHERE is_public = TRUE;

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id            INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  device_id           VARCHAR(64) NOT NULL,
  role                VARCHAR(20) NOT NULL DEFAULT 'member',
  joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_score_contrib BIGINT NOT NULL DEFAULT 0,
  total_crowns_contrib INT NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_guild_members_device
  ON guild_members (device_id);
CREATE INDEX IF NOT EXISTS idx_guild_members_contrib
  ON guild_members (guild_id, total_score_contrib DESC);

-- One row per (guild, day) — tracks daily collective progress.
CREATE TABLE IF NOT EXISTS guild_daily_progress (
  guild_id           INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  date               DATE NOT NULL,
  goal_target        INT NOT NULL DEFAULT 30,
  goal_progress      INT NOT NULL DEFAULT 0,
  is_complete        BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at       TIMESTAMPTZ,
  PRIMARY KEY (guild_id, date)
);

-- Per-member claim tracking — atomic dedup for the daily reward.
CREATE TABLE IF NOT EXISTS guild_member_claims (
  guild_id      INT NOT NULL,
  device_id     VARCHAR(64) NOT NULL,
  date          DATE NOT NULL,
  reward_gems   INT NOT NULL,
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, device_id, date)
);

-- 5 config keys.
INSERT INTO game_config (key, value) VALUES ('guild_enabled',                 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('guild_create_cost_gems',        '500')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('guild_max_members',             '30')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('guild_daily_goal_crowns',       '30')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('guild_daily_reward_per_member', '200')  ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Replay Sharing (Stage 32, May 2026)
-- After high-score games, generate a share card (canvas → PNG) with
-- the player's score + branding + game URL. Big "📤 share" button
-- opens WhatsApp/native share with pre-filled challenge text.
-- The strongest K-factor lever in mobile games — every shared replay
-- = potential new user via friend.
--
-- We track shares for telemetry: who shares most → admin can reward
-- top sharers (future viral lever).
-- ============================================================
CREATE TABLE IF NOT EXISTS replay_shares (
  id              BIGSERIAL PRIMARY KEY,
  device_id       VARCHAR(64) NOT NULL,
  score           INT NOT NULL,
  tier            INT,
  mode            VARCHAR(20),
  shared_via      VARCHAR(20),  -- 'whatsapp' / 'native' / 'twitter' / 'copy_link' / 'save_image'
  is_new_best     BOOLEAN DEFAULT FALSE,
  shared_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_replay_shares_device
  ON replay_shares (device_id, shared_at DESC);
CREATE INDEX IF NOT EXISTS idx_replay_shares_recent
  ON replay_shares (shared_at DESC);

-- 5 config keys.
INSERT INTO game_config (key, value) VALUES ('replay_share_enabled',         'true') ON CONFLICT (key) DO NOTHING;
-- Minimum score to trigger the share prompt (lower = more shares but more noise).
INSERT INTO game_config (key, value) VALUES ('replay_share_min_score',       '10000') ON CONFLICT (key) DO NOTHING;
-- Pre-filled text for WhatsApp share — supports placeholders {score} {tier} {url}.
INSERT INTO game_config (key, value) VALUES ('replay_share_text_hebrew',     '🌸 שברתי שיא ב-BLOOM! הגעתי ל-{score} נקודות. נסה לשבור אותי 👉 {url}') ON CONFLICT (key) DO NOTHING;
-- Brand/footer text on the share card.
INSERT INTO game_config (key, value) VALUES ('replay_share_brand_text',      'BLOOM · משחק מיזוג ממכר') ON CONFLICT (key) DO NOTHING;
-- Game URL appended to all share text.
INSERT INTO game_config (key, value) VALUES ('replay_share_game_url',        'https://bloom-web-production-f3bd.up.railway.app') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Smart Notifications (Stage 31, May 2026)
-- Server-side scheduler that picks WHO to push, WHEN to push, and
-- WHY. Each scan: iterate subscribed devices → compute the highest-
-- emotional-priority signal for that device → send ONE personalized
-- push if the cooldown has elapsed.
--
-- Differs from Stage 10 (which is admin broadcast): this is auto-
-- triggered + personalized per-device. Stage 10 still works for
-- "send to everyone" announcements.
-- ============================================================
CREATE TABLE IF NOT EXISTS player_push_state (
  device_id           VARCHAR(64) PRIMARY KEY,
  last_sent_at        TIMESTAMPTZ,
  last_send_reason    VARCHAR(40),
  total_sent          INT NOT NULL DEFAULT 0,
  -- Tracks last-attempt-but-skipped time so we don't recompute too often.
  last_scan_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_player_push_state_sent
  ON player_push_state (last_sent_at DESC);

-- 6 config keys.
INSERT INTO game_config (key, value) VALUES ('smart_push_enabled',          'true') ON CONFLICT (key) DO NOTHING;
-- Cooldown hours between auto-pushes per device.
INSERT INTO game_config (key, value) VALUES ('smart_push_cooldown_hours',   '12')   ON CONFLICT (key) DO NOTHING;
-- Allowed hours (Asia/Jerusalem) — don't spam at 3am.
INSERT INTO game_config (key, value) VALUES ('smart_push_hour_start',       '9')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('smart_push_hour_end',         '22')   ON CONFLICT (key) DO NOTHING;
-- Scan interval in minutes (server-side timer).
INSERT INTO game_config (key, value) VALUES ('smart_push_scan_minutes',     '30')   ON CONFLICT (key) DO NOTHING;
-- Max devices to scan per tick (cap to avoid scan stampedes at large scale).
INSERT INTO game_config (key, value) VALUES ('smart_push_batch_size',       '500')  ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Lifetime Progression (Stage 30, May 2026)
-- Call-of-Duty prestige pattern. NEVER resets between seasons.
-- Levels 1-100, then "prestige" → reset to 1 with a ⭐ star.
-- Up to 10 prestige stars max.
-- XP is COMPUTED SERVER-SIDE from existing player activity (no
-- new XP grants needed):
--   total_xp = (games_played * 10) + (achievements * 75) +
--              (total_earned_gems / 2) + (collection_cells * 25) +
--              (gacha_pulls * 5) + (album_claims * 100)
-- This avoids the "I'm a returning player, why is my lifetime level
-- only 3?" problem — existing players are immediately rewarded for
-- their accumulated history.
-- ============================================================
CREATE TABLE IF NOT EXISTS player_lifetime_state (
  device_id            VARCHAR(64) PRIMARY KEY,
  -- Optional cached lifetime_xp for fast-render. Recomputed on every
  -- /state call; this column lets us store the prestige claim history.
  cached_xp            BIGINT NOT NULL DEFAULT 0,
  prestige_count       INT NOT NULL DEFAULT 0,
  last_prestige_at     TIMESTAMPTZ,
  -- JSONB array of milestone unlock keys ("title:novice", "frame:gold", etc).
  cosmetic_unlocks     JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_title        VARCHAR(40),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4 config keys.
INSERT INTO game_config (key, value) VALUES ('lifetime_enabled',          'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('lifetime_show_on_home',     'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('lifetime_xp_per_level',     '500')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('lifetime_prestige_reward',  '5000') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Tile Collection Album (Stage 29, May 2026)
-- Genshin-style visual collection: for each (board, tier) cell,
-- track whether the player has reached that tier on that board.
-- Completing a full board (all 8 tiers) or a full tier across all
-- boards earns bonus gems. Activates completionist drive at a
-- different axis than achievements (more granular: 8 cells per
-- board × all admin boards = potentially hundreds of cells).
-- ============================================================
CREATE TABLE IF NOT EXISTS player_tile_collection (
  device_id           VARCHAR(64) NOT NULL,
  board_id            INT NOT NULL,
  tier                INT NOT NULL CHECK (tier >= 1 AND tier <= 8),
  first_collected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, board_id, tier)
);
CREATE INDEX IF NOT EXISTS idx_tile_collection_device
  ON player_tile_collection (device_id);

CREATE TABLE IF NOT EXISTS player_collection_claims (
  id           BIGSERIAL PRIMARY KEY,
  device_id    VARCHAR(64) NOT NULL,
  -- 'board_complete' = filled all 8 tiers on a specific board (target_id = board_id)
  -- 'tier_complete'  = filled that tier on ALL boards (target_id = 1..8)
  claim_type   VARCHAR(20) NOT NULL,
  target_id    INT NOT NULL,
  reward_gems  INT NOT NULL,
  claimed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_claims_uniq
  ON player_collection_claims (device_id, claim_type, target_id);

-- 4 config keys.
INSERT INTO game_config (key, value) VALUES ('album_enabled',                  'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('album_show_on_home',             'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('album_reward_per_board_complete', '500') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('album_reward_per_tier_complete',  '200') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Achievement-driven Cross-Leaderboard (Stage 16, May 2026)
-- New competitive axis: rank by NUMBER of achievements unlocked,
-- not by score. Rewards completionists / breadth-players over
-- single-board grinders. Until now achievements lived only in
-- localStorage — this brings them server-side so we can build the
-- global leaderboard.
--
-- Achievement keys are strings like:
--  - "cross:pioneer5"     → played 5 different boards
--  - "cross:all_themes"   → played all 4 themed boards
--  - "board:42:crown"     → reached crown tile on board #42
--  - "board:42:score10"   → score ≥10K on board #42
-- The naming is opaque to the server; client controls the namespace.
-- ============================================================
CREATE TABLE IF NOT EXISTS player_achievements (
  id              BIGSERIAL PRIMARY KEY,
  device_id       VARCHAR(64) NOT NULL,
  achievement_key VARCHAR(120) NOT NULL,
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_achievements_uniq
  ON player_achievements (device_id, achievement_key);
CREATE INDEX IF NOT EXISTS idx_player_achievements_device
  ON player_achievements (device_id);
CREATE INDEX IF NOT EXISTS idx_player_achievements_recent
  ON player_achievements (unlocked_at DESC);

-- 2 config keys.
INSERT INTO game_config (key, value) VALUES ('ach_leaderboard_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('ach_leaderboard_show_on_home', 'true') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Limited-time Bundles (Stage 25 — themed event packs, May 2026)
-- Multi-day premium bundles tied to specific events (Hanukkah, Valentine,
-- Black Friday, etc.). Stronger FOMO than Daily Deals because: (a) bigger
-- contents, (b) longer window so anticipation builds, (c) explicit themed
-- design (color, emoji decoration) signals "this is special / limited".
--
-- Differs from Daily Deals: Daily Deals = 1 deal/day, auto-rotate; Bundles
-- = admin-scheduled, theme-decorated, often 3-30 day windows.
-- ============================================================
CREATE TABLE IF NOT EXISTS limited_bundles (
  id                      SERIAL PRIMARY KEY,
  slug                    VARCHAR(40) UNIQUE NOT NULL,
  name                    VARCHAR(120) NOT NULL,
  description             TEXT,
  emoji                   VARCHAR(10),
  -- Theme color (hex) for the banner gradient.
  theme_color             VARCHAR(20) DEFAULT '#A855F7',
  -- Decoration emoji that floats around the modal (e.g. 🕎 for Hanukkah).
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
);
CREATE INDEX IF NOT EXISTS idx_limited_bundles_window
  ON limited_bundles (is_enabled, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS limited_bundle_purchases (
  id                SERIAL PRIMARY KEY,
  device_id         VARCHAR(64) NOT NULL,
  bundle_id         INT NOT NULL,
  price_paid        INT,
  contents_snapshot JSONB,
  purchased_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_limited_bundle_purch_dev
  ON limited_bundle_purchases (device_id, bundle_id);

-- 2 config keys.
INSERT INTO game_config (key, value) VALUES ('bundles_enabled',       'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bundles_show_on_home',  'true') ON CONFLICT (key) DO NOTHING;

-- Seed 3 example bundles starting from today. Admin will edit dates.
-- Format: (slug, name, description, emoji, theme_color, decoration_emoji,
--          price, value, contents, starts_at, ends_at)
-- Slug must stay unique across all bundles ever created.
INSERT INTO limited_bundles (slug, name, description, emoji, theme_color, decoration_emoji, price_gems, original_value, contents, starts_at, ends_at) VALUES
  ('hanukkah_2026', '🕎 חבילת חנוכה',
   'חבילה מיוחדת לחנוכה — 8 ימים, 8 מתנות',
   '🕎', '#0B3A82', '🕯',
   600, 2400,
   '{"gems":1500,"skin_id":"gold","bp_tiers":3,"chest_count":5,"streak_freezes":2}'::jsonb,
   NOW(),
   NOW() + INTERVAL '8 days'),
  ('valentine_2026', '💕 חבילת ולנטיין',
   'אהבת לאהוב? תאהב גם את החבילה הזו — בלעדית לוולנטיין',
   '💕', '#EC4899', '🌹',
   400, 1800,
   '{"gems":1000,"skin_id":"candy","bp_tiers":2,"chest_count":3}'::jsonb,
   NOW(),
   NOW() + INTERVAL '14 days'),
  ('black_friday_2026', '🔥 בלאק פריידיי',
   'הצעה אחת בשנה! חבילת המגה הגדולה ביותר במחיר הטוב ביותר',
   '🔥', '#1F2937', '💸',
   1200, 5000,
   '{"gems":3000,"skin_id":"aurora","bp_tiers":5,"chest_count":10,"streak_freezes":5}'::jsonb,
   NOW() + INTERVAL '60 days',
   NOW() + INTERVAL '63 days')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Pet / Mascot (Stage 28 — Tamagotchi emotional anchor, May 2026)
-- A virtual flower-pet that grows with the player. 4 evolution stages
-- (sprout → sapling → bloom → king-bloom) by level. 4 moods based on
-- time since last visit (happy / neutral / sad / crying). Players can
-- pet (free, daily, +gems) or feed (costs gems, +xp). Pet XP is
-- granted automatically on game finish (server hook).
--
-- WHY: emotional attachment = daily-return hook. Players feel guilty
-- leaving the pet hungry. Tamagotchi pattern made $10B+ industry by
-- itself. We use a flower since BLOOM = bloom.
-- ============================================================
CREATE TABLE IF NOT EXISTS player_pet (
  device_id           VARCHAR(64) PRIMARY KEY,
  pet_name            VARCHAR(40),
  level               INT NOT NULL DEFAULT 1,
  xp                  INT NOT NULL DEFAULT 0,
  -- last_visited_at = last time the player opened the pet modal
  last_visited_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_fed_at         TIMESTAMPTZ,
  last_petted_at      TIMESTAMPTZ,
  last_petted_date    DATE,  -- for the daily-pet dedup
  feeds_today         INT NOT NULL DEFAULT 0,
  feeds_today_date    DATE,
  total_fed_count     INT NOT NULL DEFAULT 0,
  total_pet_count     INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8 config keys.
INSERT INTO game_config (key, value) VALUES ('pet_enabled',                'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('pet_xp_per_game',            '15')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('pet_xp_per_level',           '100')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('pet_max_level',              '20')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('pet_feed_price_gems',        '10')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('pet_feed_xp_reward',         '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('pet_feeds_per_day_max',      '3')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('pet_daily_pet_reward_gems',  '20')   ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Live Ops Calendar (Stage 26 — anticipation engine, May 2026)
-- Two surfaces: (1) DAILY CHECKLIST on home — 4-5 to-do items per
-- day (free pull, daily special, daily deal, quest, streak) that
-- activate completionist drive; (2) FULL CALENDAR modal showing
-- 30 days of scheduled events (tournaments + daily specials + custom
-- admin events). Plan-ahead anchoring: "I'm playing Thursday because
-- there's a tournament at 20:00".
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id            SERIAL PRIMARY KEY,
  event_date    DATE NOT NULL,
  title         VARCHAR(120) NOT NULL,
  description   TEXT,
  emoji         VARCHAR(10),
  category      VARCHAR(40),
  -- 'all_day' = no specific time; 'timed' = use start_time field
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date
  ON calendar_events (event_date, is_enabled);

-- Config keys (3).
INSERT INTO game_config (key, value) VALUES ('calendar_enabled',         'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('checklist_enabled',        'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('calendar_show_days',       '30')   ON CONFLICT (key) DO NOTHING;

-- Seed 3 example custom events the admin can edit/replace.
-- These show in the calendar but don't affect game logic.
-- Note: dates intentionally in the future so they show up immediately.
INSERT INTO calendar_events (event_date, title, description, emoji, category, sort_order) VALUES
  ((NOW() AT TIME ZONE 'Asia/Jerusalem')::date + INTERVAL '2 days', 'יום שישי משולש פרסים', 'כל המשחקים מקנים 3× XP — סוף שבוע מיוחד', '🎉', 'weekend', 1),
  ((NOW() AT TIME ZONE 'Asia/Jerusalem')::date + INTERVAL '7 days', 'שבוע סקינים בלעדי', 'סקין זוהר זמין בגאצה לזמן מוגבל', '✨', 'gacha', 2),
  ((NOW() AT TIME ZONE 'Asia/Jerusalem')::date + INTERVAL '14 days', 'סוף עונה — Battle Pass', 'אסוף את כל הדרגות שמגיעות לך', '🎖', 'battle_pass', 3)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Lives / Energy System (Stage 19 — scarcity-driven engagement)
-- Candy Crush pattern: limited lives, time-regen, ad/gems refill.
-- *** DEFAULT OFF *** — admin must explicitly opt in via lives_enabled.
-- Applies ONLY to dynamic boards (not daily/practice/contests/duels).
-- This is intentionally controversial — can boost retention OR cause
-- uninstalls. A/B-test before fully rolling out.
-- ============================================================
CREATE TABLE IF NOT EXISTS player_lives_state (
  device_id          VARCHAR(64) PRIMARY KEY,
  current_lives      INT NOT NULL DEFAULT 5,
  max_lives          INT NOT NULL DEFAULT 5,
  -- last_regen_at marks when the last regen tick happened; subsequent
  -- regens are computed forward from this timestamp.
  last_regen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_lives_spent  INT NOT NULL DEFAULT 0,
  total_ads_watched  INT NOT NULL DEFAULT 0,
  total_gems_spent   INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6 config keys. lives_enabled defaults to 'false' — opt-in only.
INSERT INTO game_config (key, value) VALUES ('lives_enabled',            'false') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('lives_max',                '5')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('lives_regen_minutes',      '30')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('lives_refill_price_gems',  '50')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('lives_ad_refill_count',    '1')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('lives_per_game_dynamic',   '1')     ON CONFLICT (key) DO NOTHING;

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

-- One-time self-healing cleanup. This seed historically had no EFFECTIVE
-- idempotency guard: the trailing `ON CONFLICT DO NOTHING` had no unique target
-- to match (gacha_pool's only constraint is its SERIAL id), so all 17 rows
-- re-inserted on EVERY boot — the live pool had ballooned to thousands of exact
-- copies. Collapse duplicate rows, keeping the lowest id of each distinct entry.
-- Rates were never affected (every entry duplicated equally), and nothing FKs
-- to gacha_pool.id except the optional gacha_featured_id config (graceful if
-- stale). Idempotent — a no-op once the pool is deduped.
DELETE FROM gacha_pool a
  USING gacha_pool b
 WHERE a.id > b.id
   AND a.rarity       =  b.rarity
   AND a.reward_type  =  b.reward_type
   AND a.amount       IS NOT DISTINCT FROM b.amount
   AND a.skin_id      IS NOT DISTINCT FROM b.skin_id
   AND a.display_name IS NOT DISTINCT FROM b.display_name
   AND a.emoji        IS NOT DISTINCT FROM b.emoji
   AND a.weight       =  b.weight
   AND a.is_featured  =  b.is_featured
   AND a.is_enabled   =  b.is_enabled;

-- Seed the pool with 17 entries (covers all 5 rarities, all reward types),
-- but ONLY when the table is empty — so re-running schema.sql on every boot can
-- never re-duplicate the seed again. Admin can edit/disable/add via the panel.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gacha_pool) THEN
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
      ('mythic',    'bp_tier',10, NULL,      '10 דרגות Battle Pass','🎖',  20);
  END IF;
END $$;

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

-- ============================================================
-- Home Variants (Stage 35 — Home Reorganization A/B test, May 2026)
-- Admin picks ONE variant globally. All players see the chosen layout.
-- Variants:
--   'standard'  → current v2 home (long scroll of all tiles)
--   'carousel'  → adds horizontal "what's hot now" carousel at top
--   'hero'      → massive single-action card + collapse other tiles
--   'jit'       → Just-In-Time: tiles unlock progressively by games played
-- ============================================================
-- Power Hero (May 2026): default flipped from 'standard' to 'hero' after user
-- reported the home was too crowded. The hero variant collapses 14+ secondary
-- tiles behind a categorized drawer + surfaces the single hottest signal as
-- a massive card above the primary CTA. Admin can still flip back via this key.
INSERT INTO game_config (key, value) VALUES ('home_variant',           'hero')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('home_jit_unlock_games',  '3,7,13,26') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Daily Spin Wheel (Stage 36 — Coin Master pattern, May 2026)
-- One spin per day per device. Wheel has 12 weighted segments;
-- the server rolls and grants atomically. Streak (consecutive
-- days spun) multiplies gem rewards up to a cap. The single
-- most addictive daily-return mechanic in F2P puzzles — Coin
-- Master built a $1B/year business on this exact pattern.
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_spin_state (
  device_id        VARCHAR(64) PRIMARY KEY,
  last_spin_date   DATE,
  current_streak   INT NOT NULL DEFAULT 0,
  longest_streak   INT NOT NULL DEFAULT 0,
  total_spins      INT NOT NULL DEFAULT 0,
  total_gems_won   BIGINT NOT NULL DEFAULT 0,
  last_reward      JSONB,
  last_spin_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_daily_spin_state_last ON daily_spin_state (last_spin_at DESC);

INSERT INTO game_config (key, value) VALUES ('daily_spin_enabled',           'true')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_show_on_home',      'true')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_streak_bonus_pct',  '10')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_streak_max_pct',    '200')   ON CONFLICT (key) DO NOTHING;
-- 12 wheel segments stored as flat keys: label, emoji, type (gems|bp_xp|chest|freeze|jackpot), amount, weight (out of 100), color
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_1_label',  '10 💎')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_1_emoji',  '💎')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_1_type',   'gems')      ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_1_amount', '10')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_1_weight', '25')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_1_color',  '#7EC9B0')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_2_label',  '25 💎')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_2_emoji',  '💎')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_2_type',   'gems')      ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_2_amount', '25')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_2_weight', '20')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_2_color',  '#9FD18F')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_3_label',  '50 💎')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_3_emoji',  '💎')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_3_type',   'gems')      ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_3_amount', '50')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_3_weight', '15')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_3_color',  '#F5C24B')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_4_label',  '5 XP פס')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_4_emoji',  '🎖')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_4_type',   'bp_xp')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_4_amount', '5')         ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_4_weight', '12')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_4_color',  '#A87FE0')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_5_label',  '100 💎')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_5_emoji',  '💎')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_5_type',   'gems')      ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_5_amount', '100')       ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_5_weight', '8')         ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_5_color',  '#F58F6A')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_6_label',  '🛡 הקפאה') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_6_emoji',  '🛡')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_6_type',   'freeze')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_6_amount', '1')         ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_6_weight', '5')         ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_6_color',  '#7AB8E0')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_7_label',  '20 XP פס')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_7_emoji',  '🎖')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_7_type',   'bp_xp')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_7_amount', '20')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_7_weight', '6')         ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_7_color',  '#8A6FC9')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_8_label',  '🎁 צ׳סט')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_8_emoji',  '🎁')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_8_type',   'chest')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_8_amount', '1')         ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_8_weight', '4')         ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_8_color',  '#F587B0')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_9_label',  '200 💎')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_9_emoji',  '💎')        ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_9_type',   'gems')      ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_9_amount', '200')       ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_9_weight', '3')         ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_9_color',  '#E05A8A')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_10_label',  '500 💎')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_10_emoji',  '💎')       ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_10_type',   'gems')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_10_amount', '500')      ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_10_weight', '1.5')      ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_10_color',  '#C9437E')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_11_label',  '1000 💎')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_11_emoji',  '💎')       ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_11_type',   'gems')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_11_amount', '1000')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_11_weight', '0.4')      ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_11_color',  '#A82255')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_12_label',  'JACKPOT')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_12_emoji',  '🏆')       ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_12_type',   'jackpot')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_12_amount', '5000')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_12_weight', '0.1')      ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_spin_seg_12_color',  '#FFD93D')  ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Guild Wars (Stage 37 — clan-vs-clan competition, May 2026)
-- Auto-matched weekly competition between two guilds. Each game
-- contributes to your guild's war score. Winner takes the pool.
-- Clash Royale pattern — boosted guild retention 3-5x at launch.
-- ============================================================
CREATE TABLE IF NOT EXISTS guild_wars (
  id                  BIGSERIAL PRIMARY KEY,
  guild_a_id          INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  guild_b_id          INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  guild_a_score       BIGINT NOT NULL DEFAULT 0,
  guild_b_score       BIGINT NOT NULL DEFAULT 0,
  guild_a_games       INT NOT NULL DEFAULT 0,
  guild_b_games       INT NOT NULL DEFAULT 0,
  status              VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active', 'ended', 'finalized'
  winner_guild_id     INT,
  finalized_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guild_wars_active ON guild_wars (status, ends_at);
CREATE INDEX IF NOT EXISTS idx_guild_wars_guild_a ON guild_wars (guild_a_id, status);
CREATE INDEX IF NOT EXISTS idx_guild_wars_guild_b ON guild_wars (guild_b_id, status);

CREATE TABLE IF NOT EXISTS guild_war_contributions (
  war_id              BIGINT NOT NULL REFERENCES guild_wars(id) ON DELETE CASCADE,
  device_id           VARCHAR(64) NOT NULL,
  guild_id            INT NOT NULL,
  score_contribution  BIGINT NOT NULL DEFAULT 0,
  games_count         INT NOT NULL DEFAULT 0,
  last_contrib_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (war_id, device_id)
);

CREATE TABLE IF NOT EXISTS guild_war_claims (
  war_id              BIGINT NOT NULL REFERENCES guild_wars(id) ON DELETE CASCADE,
  device_id           VARCHAR(64) NOT NULL,
  claimed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reward_gems         INT NOT NULL,
  PRIMARY KEY (war_id, device_id)
);

INSERT INTO game_config (key, value) VALUES ('guild_wars_enabled',            'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('guild_wars_duration_days',      '7')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('guild_wars_min_members_active', '3')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('guild_wars_winner_reward_per_member', '500')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('guild_wars_loser_reward_per_member',  '100')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('guild_wars_min_games_to_claim', '1')    ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Trophy Road (Stage 38 — Clash Royale pattern, May 2026)
-- The #1 retention mechanism in mobile games. Trophies go UP on
-- good plays, DOWN on bad ones. Fear of losing = grind dopamine.
-- Visual progression through "arenas" + milestone rewards every
-- N trophies (claimable per-tier, never resets unlike Battle Pass).
-- ============================================================
CREATE TABLE IF NOT EXISTS player_trophies (
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
);
CREATE INDEX IF NOT EXISTS idx_player_trophies_count ON player_trophies (trophies DESC);

CREATE TABLE IF NOT EXISTS trophy_history (
  id                 BIGSERIAL PRIMARY KEY,
  device_id          VARCHAR(64) NOT NULL,
  change_amount      INT NOT NULL,
  before_trophies    INT NOT NULL,
  after_trophies     INT NOT NULL,
  reason             VARCHAR(40) NOT NULL,
  meta               JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trophy_history_device ON trophy_history (device_id, created_at DESC);

-- Master toggles + tunables
INSERT INTO game_config (key, value) VALUES ('trophies_enabled',                'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_show_on_home',           'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_min_score_to_gain',      '500')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_min_score_to_lose',      '100')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_per_win_base',           '15')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_per_loss_base',          '-8')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_per_crown_bonus',        '40')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_per_personal_best',      '25')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_safe_floor',             '0')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_protect_under',          '50')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_celebrate_threshold',    '20')   ON CONFLICT (key) DO NOTHING;

-- 10 milestones: trophies → reward gems (admin can tune freely)
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_1_at',     '50')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_1_gems',   '50')     ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_2_at',     '150')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_2_gems',   '100')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_3_at',     '300')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_3_gems',   '200')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_4_at',     '600')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_4_gems',   '400')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_5_at',     '1000')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_5_gems',   '800')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_6_at',     '1800')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_6_gems',   '1500')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_7_at',     '3000')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_7_gems',   '2500')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_8_at',     '5000')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_8_gems',   '4000')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_9_at',     '8000')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_9_gems',   '6000')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_10_at',    '15000')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophies_milestone_10_gems',  '15000')  ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 🚨 player_issues — automatic + manual issue tracking (May 2026)
-- ============================================================
-- Every time a known error path fires (chest credit failed, duel
-- result lost, balance update conflict, etc.) we log a row here.
-- Admin sees them all in the 🚨 תקלות tab + can resolve / refund /
-- give compensation gems in one click. Turns the admin into a
-- proper player-support system instead of "lost in console logs".
CREATE TABLE IF NOT EXISTS player_issues (
  id                  BIGSERIAL PRIMARY KEY,
  device_id           VARCHAR(64) NOT NULL,
  player_code         VARCHAR(20),
  display_name        VARCHAR(120),
  kind                VARCHAR(40) NOT NULL,        -- e.g. 'chest_credit_failed', 'duel_orphan'
  severity            VARCHAR(10) NOT NULL DEFAULT 'medium',  -- 'low' | 'medium' | 'high' | 'critical'
  title               TEXT NOT NULL,               -- Hebrew, short
  detail              TEXT,                        -- longer description
  context             JSONB,                       -- arbitrary snapshot (gameId, score, etc.)
  source              VARCHAR(20) DEFAULT 'auto',  -- 'auto' | 'client' | 'manual'
  reported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status              VARCHAR(15) NOT NULL DEFAULT 'open',  -- 'open' | 'resolved' | 'dismissed'
  resolved_at         TIMESTAMPTZ,
  resolution_notes    TEXT,
  compensation_amount INT DEFAULT 0,
  compensation_paid   BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_player_issues_status ON player_issues (status, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_issues_device ON player_issues (device_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_issues_kind ON player_issues (kind, reported_at DESC);

-- Issue auto-compensation defaults (admin can tune)
INSERT INTO game_config (key, value) VALUES ('issues_default_compensation',      '100') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('issues_client_report_max_per_hour','10')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('issues_auto_compensate_critical',  'false') ON CONFLICT (key) DO NOTHING;
-- Auto-clear stale auto-logged api_* issues so a broken endpoint's flood doesn't drown the 🚨 tab.
INSERT INTO game_config (key, value) VALUES ('issues_auto_clear_enabled',        'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('issues_auto_clear_hours',          '24')   ON CONFLICT (key) DO NOTHING;
-- FTUE tutorial + in-game tour master toggles (admin can disable / A-B test).
INSERT INTO game_config (key, value) VALUES ('ftue_enabled',                     'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('tour_enabled',                     'true') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- BL.1 — Bot social-proof + auto-fallback for duels (May 2026)
--
-- Two retention levers:
--   1. Bot heartbeats counted in /api/stats/live so the live-pulse
--      bar never reads "1 שחקן פעיל" (cold-start retention killer).
--      Capped at real × multiplier to never feel absurdly fake.
--   2. When duel matchmaking finds no real opponent in N seconds,
--      a bot is spawned as the opponent. The player never feels
--      alone. Bot uses an Israeli name + synthetic BLOOM-XXXX code.
--      Score calibrated to give the player ~52% win rate (Royal
--      Match / Coin Master tuning — not too easy, not too hard).
-- ============================================================
ALTER TABLE duels ADD COLUMN IF NOT EXISTS is_bot_match  BOOLEAN     DEFAULT FALSE;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS bot_settle_at TIMESTAMPTZ;
-- BL.1.5 — pre-simulated trajectory for bot duels. Computed once on
-- first poll then cached. Shape: { snapshots: [{t,s,h,g}], finalScore,
-- finalGrid, finalTier }. ~30 snapshots × ~120 bytes ≈ 4 KB / duel.
-- Stores the bot's REAL gameplay (same seed + difficulty as player) so
-- the spectator widget shows actual moves instead of random shapes.
ALTER TABLE duels ADD COLUMN IF NOT EXISTS bot_trajectory JSONB;
CREATE INDEX IF NOT EXISTS idx_duels_bot_settle
  ON duels (bot_settle_at)
  WHERE is_bot_match = TRUE AND status = 'accepted' AND opponent_score IS NULL;

-- Master toggle + tuning knobs. All admin-tunable.
INSERT INTO game_config (key, value) VALUES ('bots_in_live_stats_enabled',           'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bots_live_stats_max_multiplier',       '2.5')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bots_live_stats_floor_when_zero_real', '6')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bot_duel_fallback_enabled',            'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bot_duel_fallback_after_seconds',      '8')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bot_duel_player_win_rate_pct',         '52')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bot_duel_settle_delay_min_seconds',    '20')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bot_duel_settle_delay_max_seconds',    '55')   ON CONFLICT (key) DO NOTHING;
-- AD.2 — auto-fleet: bots start at boot so the world is never empty. Admin-tunable.
INSERT INTO game_config (key, value) VALUES ('bots_auto_enabled',  'true')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bots_auto_count',    '10')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bots_auto_mode',     'daily') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bots_games_today_floor', '0') ON CONFLICT (key) DO NOTHING;
-- AD.4 — live "moves to survive" danger meter (loss-aversion). Default on.
INSERT INTO game_config (key, value) VALUES ('danger_meter_enabled', 'true') ON CONFLICT (key) DO NOTHING;
-- Task #24 — in-session "hot streak" meter on game-over (consecutive games at/above
-- the threshold). Default on; threshold = score that counts as a "win".
INSERT INTO game_config (key, value) VALUES ('win_streak_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('win_streak_threshold', '15000') ON CONFLICT (key) DO NOTHING;
-- Task #4 — push opt-in pre-prompt cooldown (hours). Lower = ask more often.
INSERT INTO game_config (key, value) VALUES ('push_prompt_cooldown_hours', '24') ON CONFLICT (key) DO NOTHING;
-- Task #5/#12 — seed fresh PUBLIC tournaments with believable bot scores so the
-- board is never empty (bots are excluded from real prizes). Private contests are never seeded.
INSERT INTO game_config (key, value) VALUES ('tournament_bot_seed_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('tournament_bot_seed_count', '6') ON CONFLICT (key) DO NOTHING;
-- Task #14 — admin-editable Trophy Road arena thresholds (🏆 at which trophy
-- count each of the 8 arenas begins). Name/emoji are also config-overridable
-- (trophy_arena_N_name / _emoji) but fall back to the hardcoded defaults.
INSERT INTO game_config (key, value) VALUES ('trophy_arena_1_at', '0') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophy_arena_2_at', '50') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophy_arena_3_at', '200') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophy_arena_4_at', '600') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophy_arena_5_at', '1500') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophy_arena_6_at', '3000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophy_arena_7_at', '6000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('trophy_arena_8_at', '12000') ON CONFLICT (key) DO NOTHING;
-- Task #22 — global multiplier on the shared ui-* micro-interaction durations.
INSERT INTO game_config (key, value) VALUES ('animation_duration_multiplier', '1') ON CONFLICT (key) DO NOTHING;
-- Task #23 — fire the Mystery Chest at EVERY game-over (daily/practice/contest),
-- not just dynamic boards. Per-day cap + pity floor still enforced server-side.
INSERT INTO game_config (key, value) VALUES ('chest_all_modes_enabled', 'true') ON CONFLICT (key) DO NOTHING;
-- Task #28 — per-duel bot percentile VARIANCE for drama (close losses + comeback
-- wins). Picks a different REAL simulated game from the bank per duel — no faking.
-- DEFAULT OFF (0) — admin opt-in given bot-score sensitivity. 0.10-0.20 = gentle drama.
INSERT INTO game_config (key, value) VALUES ('bot_traj_percentile_variance', '0') ON CONFLICT (key) DO NOTHING;
-- AD.5 — win-return celebration on home (confetti + sound after a win). Default on.
INSERT INTO game_config (key, value) VALUES ('home_win_celebration_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('home_win_celebration_min_score', '5000') ON CONFLICT (key) DO NOTHING;
-- AD.6 — "next daily rewards in HH:MM:SS" countdown on game-over. Default on.
INSERT INTO game_config (key, value) VALUES ('next_reward_countdown_enabled', 'true') ON CONFLICT (key) DO NOTHING;
-- AD.7 — daily auto-tournament (prime-time scheduled event). Default on.
INSERT INTO game_config (key, value) VALUES ('daily_tournament_enabled', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_tournament_name', '🏆 טורניר הערב') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_tournament_start_hour', '20') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_tournament_end_hour', '22') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_tournament_prize_1', '1000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_tournament_prize_2', '500') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('daily_tournament_prize_3', '250') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bot_live_race_fallback_after_seconds', '6')    ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- DU.2 — Duel system overhaul (2026-05-30)
--   1. Wager-aware matchmaking: random + live duels now carry a real
--      gem wager chosen by the initiator. The queue matches on a wager
--      band (exact bucket by default, widens when the queue is quiet).
--   2. bot_final_score: the bot's calibrated final is LOCKED at the
--      moment the player submits, so the spectator widget converges to
--      EXACTLY the settled number (kills the score mismatch).
-- Reuses the existing wager_rake config key for the rake %.
-- ============================================================
ALTER TABLE duel_matchmaking_queue ADD COLUMN IF NOT EXISTS wager INT NOT NULL DEFAULT 0;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS bot_final_score INT;

INSERT INTO game_config (key, value) VALUES ('duel_wager_match_tolerance_pct', '0')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('duel_wager_widen_after_polls',   '3')   ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('duel_wager_widen_band',          '50')  ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('duel_random_max_wager',          '100000') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('duel_pre_submit_display_cap',    '8000') ON CONFLICT (key) DO NOTHING;
-- DU.3 — "One Real Game, One Truth": bot duels show ONE real engine game
-- (score + board from the same trajectory, selected by elapsed time).
INSERT INTO game_config (key, value) VALUES ('bot_duel_trajectory_truth',    'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bot_traj_candidate_count',     '6')    ON CONFLICT (key) DO NOTHING;
INSERT INTO game_config (key, value) VALUES ('bot_traj_pick_percentile',     '0.40') ON CONFLICT (key) DO NOTHING;
