// scripts/seed_demo.js
// Populate the local/Railway DB with believable demo data for screenshots,
// investor demos, and load-testing the admin UI.
//
// Usage:
//   node scripts/seed_demo.js                     # default 30/30/5
//   node scripts/seed_demo.js --players 50        # override player count
//   node scripts/seed_demo.js --days 60           # longer history
//   node scripts/seed_demo.js --contests 8        # more contests
//   node scripts/seed_demo.js --clean             # remove all demo-* rows
//   node scripts/seed_demo.js --reset             # --clean then re-seed
//   node scripts/seed_demo.js --force             # bypass the "looks like prod" guard
//
// Safe to run against Railway DB — only touches device_id LIKE 'demo-%' rows.
// Refuses to run if > 1000 non-demo daily_scores exist (proxy for prod) unless --force.

import { pool } from '../db.js';

const args = parseArgs(process.argv.slice(2));
const PLAYERS  = Math.max(1, parseInt(args.players  || '30', 10));
const DAYS     = Math.max(1, parseInt(args.days     || '30', 10));
const CONTESTS = Math.max(0, parseInt(args.contests || '5',  10));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--clean')  out.clean  = true;
    else if (a === '--reset')  out.reset  = true;
    else if (a === '--force')  out.force  = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      out[key] = argv[i + 1];
      i++;
    }
  }
  return out;
}

// Reproducible-ish randomness so two runs back-to-back produce similar shapes.
let _seed = 1337;
function rnd() { _seed = (_seed * 16807) % 2147483647; return _seed / 2147483647; }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function randInt(lo, hi) { return Math.floor(rnd() * (hi - lo + 1)) + lo; }

const NAMES_HE = ['דני', 'מיכל', 'יוסי', 'שירה', 'אבי', 'רונית', 'גיל', 'נועה', 'תמר', 'אריק',
                  'מאיה', 'אורי', 'איתי', 'לינוי', 'עופר', 'אסף', 'הילה', 'איציק', 'ליאת', 'גלעד'];
const NAMES_EN = ['Alex', 'Jordan', 'Sam', 'Riley', 'Casey', 'Morgan', 'Avery', 'Quinn'];
const CONTEST_NAMES = [
  'תחרות סוף שבוע', 'המשפחה של דני', 'פיצוץ ראש חודש', 'חברי העבודה',
  'דור 2026', 'מי הכי טוב?', 'אלופי ה-Bloom', 'תחרות סופ"ש', 'דמו למשקיעים'
];

function demoDeviceId(i) {
  return 'demo-' + String(i).padStart(3, '0') + '-' + 'xxxxxxxx'.repeat(2);
}
// Local-time YYYY-MM-DD so the dates land on the correct calendar day in the
// DB regardless of the runner's UTC offset. `Date.toISOString().slice(0,10)`
// would silently shift everything to UTC, putting late-night-Israel seed rows
// on yesterday's date and ruining the cohort math.
function localIsoDate(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function demoContestCode(i) {
  // Use letters that the regular generator allows — but mark as demo with a 'D' prefix.
  return 'D' + String(i).padStart(2, '0') + 'DEMO'.slice(0, 4);
}

async function isLooksLikeProd() {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM daily_scores WHERE device_id NOT LIKE 'demo-%'`
  );
  return (r.rows[0].c | 0) > 1000;
}

async function clean() {
  console.log('[clean] removing demo-* rows…');
  // Watchers/live_state reference device_id directly (not FK-cascaded from devices).
  // Manual cleanup for every table we might have touched.
  await pool.query(`DELETE FROM device_visits     WHERE device_id LIKE 'demo-%'`);
  await pool.query(`DELETE FROM daily_scores      WHERE device_id LIKE 'demo-%'`);
  // contest_scores cascades automatically when its contest is deleted.
  await pool.query(`DELETE FROM contests          WHERE code LIKE 'D%DEMO' OR host_device_id LIKE 'demo-%'`);
  await pool.query(`DELETE FROM contest_live_state WHERE device_id LIKE 'demo-%'`);
  await pool.query(`DELETE FROM contest_watchers   WHERE watcher_device_id LIKE 'demo-%' OR target_device_id LIKE 'demo-%'`);
  console.log('[clean] done.');
}

async function seed() {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Players: assign a "skill" 0-1 — pulls scores from a wider band the higher it is.
  const players = [];
  for (let i = 0; i < PLAYERS; i++) {
    players.push({
      deviceId: demoDeviceId(i),
      name: rnd() < 0.7 ? pick(NAMES_HE) : pick(NAMES_EN),
      skill: rnd(),
      // first-visit day offset in the window — bias toward earlier so we have full cohorts.
      firstDayOffset: Math.floor(rnd() * DAYS),
      // probability of visiting / playing on any given day after first visit.
      retainProb: 0.15 + rnd() * 0.7
    });
  }

  console.log(`[seed] inserting ${PLAYERS} players × up to ${DAYS} days…`);
  for (const p of players) {
    for (let off = p.firstDayOffset; off < DAYS; off++) {
      const date = new Date(today); date.setDate(today.getDate() - (DAYS - 1 - off));
      const visited = off === p.firstDayOffset || rnd() < p.retainProb;
      if (!visited) continue;
      const visitCount = 1 + Math.floor(rnd() * 4);
      const firstAt = new Date(date); firstAt.setHours(randInt(7, 22), randInt(0, 59));
      await pool.query(
        `INSERT INTO device_visits (device_id, date, visit_count, first_at, last_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (device_id, date) DO UPDATE SET visit_count = EXCLUDED.visit_count, last_at = EXCLUDED.last_at`,
        [p.deviceId, localIsoDate(date), visitCount, firstAt]
      );
      // 70% of visits also produce a played game; bounce rate of 30%.
      if (rnd() > 0.3) {
        const base = 300 + Math.pow(p.skill, 2) * 6000;
        const score = Math.max(50, Math.round(base * (0.5 + rnd())));
        const tier = Math.min(8, 1 + Math.floor(p.skill * 7 * rnd()));
        const updatedAt = new Date(firstAt); updatedAt.setMinutes(updatedAt.getMinutes() + randInt(2, 20));
        await pool.query(
          `INSERT INTO daily_scores (date, device_id, name, score, tier, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT (date, device_id) DO UPDATE SET score = EXCLUDED.score, tier = EXCLUDED.tier, updated_at = EXCLUDED.updated_at`,
          [localIsoDate(date), p.deviceId, p.name, score, tier, updatedAt]
        );
      }
    }
  }
  console.log(`[seed] players + scores inserted`);

  if (CONTESTS > 0) {
    console.log(`[seed] creating ${CONTESTS} contests…`);
    const states = [
      // (endsAtDelta in days, label)
      [ 0.5, 'מסתיים היום'],
      [ 3,   'באמצע'],
      [ 7,   'התחיל לפני שבוע'],
      [-1,   'הסתיים אתמול'],
      [14,   'ארוך טווח']
    ];
    for (let i = 0; i < CONTESTS; i++) {
      const code = demoContestCode(i);
      const name = (i < CONTEST_NAMES.length ? CONTEST_NAMES[i] : 'תחרות #' + (i + 1));
      const state = states[i % states.length];
      const host = players[i % players.length];
      const createdAt = new Date(today); createdAt.setDate(createdAt.getDate() - Math.floor(rnd() * 5));
      const endsAt = new Date(today); endsAt.setDate(endsAt.getDate() + state[0]);
      const boardType = rnd() < 0.6 ? 'shared' : 'free';
      const boardSeed = boardType === 'shared' ? Math.floor(rnd() * 2147483647) : null;
      // Wipe pre-existing demo contest with this code in case --reset wasn't used.
      await pool.query(`DELETE FROM contests WHERE code = $1`, [code]);
      await pool.query(
        `INSERT INTO contests (code, name, host_name, host_device_id, board_seed, board_type, duration_days, created_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [code, name, host.name, host.deviceId, boardSeed, boardType, Math.max(1, state[0] | 0) || 1, createdAt, endsAt]
      );
      // Random 2-10 members
      const memberCount = 2 + Math.floor(rnd() * 9);
      const members = [host];
      while (members.length < memberCount) {
        const cand = players[Math.floor(rnd() * players.length)];
        if (!members.some(m => m.deviceId === cand.deviceId)) members.push(cand);
      }
      for (const m of members) {
        const games = 1 + Math.floor(rnd() * 8);
        const score = Math.round(games * (200 + Math.pow(m.skill, 2) * 1800));
        const tier = Math.min(8, 1 + Math.floor(m.skill * 7 * rnd()));
        const lastPlayed = new Date(today); lastPlayed.setDate(lastPlayed.getDate() - Math.floor(rnd() * 3));
        await pool.query(
          `INSERT INTO contest_scores (contest_code, device_id, display_name, score, highest_tier, games_played, joined_at, last_played_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
           ON CONFLICT (contest_code, device_id) DO UPDATE SET
             score = EXCLUDED.score, highest_tier = EXCLUDED.highest_tier,
             games_played = EXCLUDED.games_played, last_played_at = EXCLUDED.last_played_at`,
          [code, m.deviceId, m.name, score, tier, games, lastPlayed]
        );
      }
    }
    console.log(`[seed] contests + memberships inserted`);
  }

  // One spicy outlier on the most recent day to demo z-score flagging.
  const outlierDay = new Date(today); outlierDay.setDate(outlierDay.getDate());
  await pool.query(
    `INSERT INTO daily_scores (date, device_id, name, score, tier, created_at, updated_at)
     VALUES (CURRENT_DATE, $1, $2, $3, 8, NOW(), NOW())
     ON CONFLICT (date, device_id) DO UPDATE SET score = EXCLUDED.score, tier = 8, updated_at = NOW()`,
    [demoDeviceId(999), 'BOT_TESTER', 9_500_000]
  );
  console.log(`[seed] inserted z-score outlier (demo-999, score=9,500,000) to demo flagging`);
}

(async function main() {
  try {
    if (args.clean && !args.reset) {
      await clean();
      return;
    }
    const looksProd = await isLooksLikeProd();
    if (looksProd && !args.force) {
      console.error('[abort] this DB has > 1000 non-demo rows in daily_scores — looks like production.');
      console.error('        re-run with --force if you really want to seed alongside live data.');
      process.exit(1);
    }
    if (args.reset) await clean();
    await seed();
    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM device_visits WHERE device_id LIKE 'demo-%')::int AS visits,
         (SELECT COUNT(*) FROM daily_scores  WHERE device_id LIKE 'demo-%')::int AS scores,
         (SELECT COUNT(*) FROM contests      WHERE code LIKE 'D%DEMO')::int       AS contests,
         (SELECT COUNT(*) FROM contest_scores cs JOIN contests c ON c.code = cs.contest_code
            WHERE c.code LIKE 'D%DEMO')::int                                       AS contest_scores`
    );
    console.log('[seed] done. counts:', counts.rows[0]);
  } catch (e) {
    console.error('[seed] failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
