CREATE TABLE IF NOT EXISTS daily_scores (
  date TEXT NOT NULL,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  tier INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (date, device_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_scores_lookup ON daily_scores (date, score DESC);
