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
  await pool.query(schema);
  console.log('[db] schema ready');

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
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS difficulty_label VARCHAR(20)`,
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS difficulty_weights VARCHAR(64)`,
    `ALTER TABLE duels ADD COLUMN IF NOT EXISTS difficulty_speed_pct INT`,
    // Needed by the chest / comeback / streak-freeze UPDATEs added in May 2026.
    // schema.sql also has this ALTER, but include here as belt-and-suspenders
    // since several endpoints will 500 without it.
    `ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); } catch (e) {
      console.warn('[db] migration skipped:', e.message);
    }
  }
  console.log('[db] migrations done');
}
