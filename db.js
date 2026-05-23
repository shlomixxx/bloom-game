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
    // Stage 17 — Premium Battle Pass columns.
    `ALTER TABLE player_season_progress ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE player_season_progress ADD COLUMN IF NOT EXISTS premium_purchased_at TIMESTAMPTZ`,
    `ALTER TABLE player_season_progress ADD COLUMN IF NOT EXISTS claimed_premium_tiers JSONB NOT NULL DEFAULT '[]'::jsonb`,
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
