// One-shot diagnostic for the BLOOM-DVEX friend-request issue.
// Run via: railway run --service Postgres-z2RQ node scripts/diag_friend.mjs
// Reads the DB URL from the injected env; never prints it.
import pg from 'pg';
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) { console.error('no db url in env'); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const CODE = 'DVEX';
try {
  // 1) Does BLOOM-DVEX exist as a profile?
  const prof = await pool.query(
    `SELECT device_id, player_code, display_name, created_at FROM player_profiles
      WHERE player_code = $1 OR player_code = $2`, [CODE, 'BLOOM-' + CODE]);
  console.log('=== profile for BLOOM-DVEX ===');
  console.log(prof.rows.length ? prof.rows : '(NONE — code does not exist as a profile)');

  if (prof.rows.length) {
    const dev = prof.rows[0].device_id;
    // 2) Any friend_requests TO this device?
    const incoming = await pool.query(
      `SELECT id, from_device, status, created_at, responded_at FROM friend_requests
        WHERE to_device = $1 ORDER BY created_at DESC LIMIT 10`, [dev]);
    console.log('\n=== friend_requests TO BLOOM-DVEX (last 10) ===');
    console.log(incoming.rows.length ? incoming.rows : '(NONE)');

    // 3) Push subscription?
    const push = await pool.query(
      `SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE device_id = $1`, [dev]);
    console.log('\n=== push subscriptions for BLOOM-DVEX:', push.rows[0].n, '===');
  }

  // 4) Overall friend_requests health (last 24h)
  const recent = await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM friend_requests
      WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY status`);
  console.log('\n=== friend_requests created last 24h (by status) ===');
  console.log(recent.rows.length ? recent.rows : '(none in 24h)');

  // 5) total friend_requests + friendships counts
  const totals = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM friend_requests) AS requests,
            (SELECT COUNT(*)::int FROM friendships)     AS friendships,
            (SELECT COUNT(*)::int FROM push_subscriptions) AS push_subs`);
  console.log('\n=== totals ===');
  console.log(totals.rows[0]);
} catch (e) {
  console.error('DIAG ERROR:', e.message);
} finally {
  await pool.end();
}
