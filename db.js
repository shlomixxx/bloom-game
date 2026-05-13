import pg from 'pg';
import { readFile } from 'node:fs/promises';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
});

export async function initDb() {
  if (!connectionString) {
    console.warn('[db] DATABASE_URL is not set — leaderboard endpoints will fail until it is.');
    return;
  }
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  console.log('[db] schema ready');
}
