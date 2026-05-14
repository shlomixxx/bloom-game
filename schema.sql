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
