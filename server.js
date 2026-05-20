import express from 'express';
import { timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
import { readFile as readFileSw } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { pool, initDb } from './db.js';
import { startBots, stopBots, getBotStatus } from './bot-engine.js';

// ============================================================
// GLOBAL ERROR HANDLERS — prevent crashes from killing the server
// Node.js default: unhandled promise rejection KILLS the process.
// We log and continue. Bot system depends on this — async errors
// shouldn't restart the server and wipe in-memory bot state.
// ============================================================
// Optional error webhook — set ERROR_WEBHOOK env var (Discord/Slack/etc URL)
// to forward unhandled errors. Failures to deliver are themselves swallowed
// so the webhook can never crash us recursively.
function reportToWebhook(payload) {
  const url = process.env.ERROR_WEBHOOK;
  if (!url) return;
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  } catch (_) { /* swallow */ }
}
process.on('unhandledRejection', (reason) => {
  console.error('[unhandled rejection]', reason);
  reportToWebhook({
    type: 'unhandled_rejection',
    message: String(reason && reason.message || reason),
    stack: reason && reason.stack || null,
    ts: new Date().toISOString()
  });
});
process.on('uncaughtException', (err) => {
  console.error('[uncaught exception]', err);
  reportToWebhook({
    type: 'uncaught_exception',
    message: err && err.message,
    stack: err && err.stack,
    ts: new Date().toISOString()
  });
});

const app = express();
app.disable('x-powered-by');

// Security headers. HSTS forces HTTPS for a year — safe on Railway since
// it always serves HTTPS. CSP locks every fetch source down to 'self'
// except the GA tag (which is the only third-party script in the shell)
// and 'unsafe-inline' for scripts/styles (the game's IIFE is inline). If
// CSP breaks something at deploy, comment the Content-Security-Policy
// line out — every other header is independently useful.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' https://www.google-analytics.com; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
  next();
});

// CORS — strict same-origin allowlist. The previous `origin.includes(host)`
// check was a substring match — origin `https://evil.example.com.attacker.com`
// would pass against host `attacker.com`. Now we require an exact set match.
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next(); // direct/curl/no-Origin
  const host = req.headers.host || '';
  const allowed = new Set([`https://${host}`, `http://${host}`]);
  // Production canonical host stays explicit so reverse-proxy host rewrites
  // don't break the allowlist. Add new domains here.
  allowed.add('https://bloom-web-production-f3bd.up.railway.app');
  if (!allowed.has(origin)) {
    return res.status(403).json({ error: 'cross_origin_blocked' });
  }
  next();
});

app.use(express.json({ limit: '4kb' }));

// ============================================================
// SEO: robots.txt + sitemap.xml
// ============================================================
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: https://bloom-web-production-f3bd.up.railway.app/sitemap.xml`);
});

app.get('/sitemap.xml', async (_req, res) => {
  const base = 'https://bloom-web-production-f3bd.up.railway.app';
  const today = new Date().toISOString().slice(0, 10);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${base}/welcome</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>${base}/privacy</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>
</urlset>`);
});

// Privacy policy — static page, served at /privacy and /privacy.html.
app.get('/privacy', (_req, res) => res.sendFile('privacy.html', { root: 'public' }));

// ============================================================
// LANDING PAGE — /welcome (SEO-rich, server-rendered)
// ============================================================
app.get('/welcome', async (_req, res) => {
  // Pull live stats for social proof
  let totalPlayers = 0, totalGames = 0, topScore = 0;
  try {
    const stats = await pool.query(`SELECT COUNT(DISTINCT device_id) as players, COUNT(*) as games, MAX(score) as top FROM daily_scores`);
    if (stats.rows[0]) { totalPlayers = stats.rows[0].players|0; totalGames = stats.rows[0].games|0; topScore = stats.rows[0].top|0; }
  } catch (e) {}

  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BLOOM — משחק מיזוג ממכר בעברית | שחק עכשיו בחינם</title>
<meta name="description" content="BLOOM — משחק מיזוג ממכר בעברית! מזג אריחים, גלה 8 דרגות, הגע לכתר 👑 תחרות חברים, סקינים, אתגרים יומיים. חינם, ללא הורדה.">
<meta name="keywords" content="bloom, משחק מיזוג, suika, merge game, משחק בעברית, תחרות, משחק ממכר, משחק חינם">
<link rel="canonical" href="https://bloom-web-production-f3bd.up.railway.app/welcome">
<meta property="og:type" content="website">
<meta property="og:title" content="BLOOM — משחק מיזוג ממכר 🌸">
<meta property="og:description" content="מזג אריחים, גלה 8 דרגות, הגע לכתר. ${totalPlayers > 0 ? totalPlayers + ' שחקנים כבר משחקים!' : 'שחק עכשיו בחינם!'}">
<meta property="og:image" content="https://bloom-web-production-f3bd.up.railway.app/assets/social-share.png">
<meta property="og:url" content="https://bloom-web-production-f3bd.up.railway.app/welcome">
<meta property="og:locale" content="he_IL">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"VideoGame","name":"BLOOM","description":"משחק מיזוג ממכר בעברית","url":"https://bloom-web-production-f3bd.up.railway.app/","genre":["Puzzle","Casual"],"gamePlatform":["Web","Mobile Web","PWA"],"inLanguage":"he","offers":{"@type":"Offer","price":"0","priceCurrency":"ILS"}}
</script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0F0D0B;--card:#1A1816;--gold:#FAC775;--gold-dark:#BA7517;--text:#F2EFE9;--muted:#6F6E68;--green:#25D366}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden;direction:rtl}
.hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 20px;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-20%;left:50%;width:600px;height:600px;background:radial-gradient(circle,rgba(250,199,117,0.08) 0%,transparent 70%);transform:translateX(-50%);animation:heroGlow 6s ease-in-out infinite}
@keyframes heroGlow{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.2)}}
.hero-icons{display:flex;gap:12px;margin-bottom:24px;position:relative}
.hero-icon{width:56px;height:56px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:28px;animation:float 3s ease-in-out infinite}
.hero-icon:nth-child(2){animation-delay:0.2s}.hero-icon:nth-child(3){animation-delay:0.4s}.hero-icon:nth-child(4){animation-delay:0.6s}.hero-icon:nth-child(5){animation-delay:0.8s}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.hero-brand{font-size:56px;font-weight:900;letter-spacing:0.15em;color:var(--gold);margin-bottom:8px;position:relative;text-shadow:0 0 40px rgba(250,199,117,0.3)}
.hero-sub{font-size:18px;color:var(--muted);margin-bottom:32px;max-width:400px;line-height:1.7}
.hero-sub strong{color:var(--text)}
.cta-play{display:inline-block;padding:18px 48px;background:linear-gradient(135deg,var(--gold) 0%,var(--gold-dark) 100%);color:#1C1A18;font-size:20px;font-weight:900;border-radius:16px;text-decoration:none;box-shadow:0 8px 30px rgba(250,199,117,0.3);transition:transform 0.15s,box-shadow 0.2s;font-family:inherit}
.cta-play:hover{transform:translateY(-2px);box-shadow:0 12px 40px rgba(250,199,117,0.4)}
.cta-play:active{transform:scale(0.98)}
.stats-row{display:flex;gap:24px;margin-top:32px;position:relative}
.stat-pill{padding:10px 20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:12px;text-align:center}
.stat-pill .val{font-size:22px;font-weight:900;color:var(--gold)}
.stat-pill .lbl{font-size:11px;color:var(--muted);margin-top:2px}
.features{padding:60px 20px;max-width:600px;margin:0 auto}
.features-title{text-align:center;font-size:28px;font-weight:900;color:var(--gold);margin-bottom:40px}
.feature{display:flex;align-items:flex-start;gap:16px;margin-bottom:28px;padding:20px;background:var(--card);border-radius:16px;border:1px solid rgba(255,255,255,0.04)}
.feature-icon{font-size:32px;flex-shrink:0;width:48px;text-align:center}
.feature-text h3{font-size:16px;font-weight:700;margin-bottom:4px}
.feature-text p{font-size:13px;color:var(--muted);line-height:1.6}
.bottom-cta{text-align:center;padding:60px 20px 80px}
.bottom-cta p{color:var(--muted);margin-bottom:20px;font-size:15px}
.wa-btn{display:inline-flex;align-items:center;gap:8px;padding:14px 28px;background:var(--green);color:#FFF;font-size:16px;font-weight:700;border-radius:14px;text-decoration:none;font-family:inherit;margin-top:12px;transition:transform 0.12s}
.wa-btn:hover{transform:scale(1.03)}
.wa-btn svg{width:20px;height:20px;fill:#FFF}
.footer{text-align:center;padding:20px;font-size:11px;color:var(--muted);border-top:1px solid rgba(255,255,255,0.04)}
@media(max-width:480px){.hero-brand{font-size:40px}.stats-row{flex-wrap:wrap;justify-content:center;gap:12px}.feature{flex-direction:column;align-items:center;text-align:center}}
</style>
</head>
<body>

<section class="hero">
  <div class="hero-icons">
    <div class="hero-icon" style="background:#C0DD97">🌿</div>
    <div class="hero-icon" style="background:#F4C0D1">🌸</div>
    <div class="hero-icon" style="background:#F5C4B3">🔥</div>
    <div class="hero-icon" style="background:#9FE1CB">⭐</div>
    <div class="hero-icon" style="background:#CECBF6">👑</div>
  </div>
  <h1 class="hero-brand">BLOOM</h1>
  <p class="hero-sub">משחק מיזוג <strong>ממכר</strong> בעברית.<br>מזג אריחים, גלה 8 דרגות, הגע ל<strong>כתר</strong> 👑</p>
  <a class="cta-play" href="/">🎮 שחק עכשיו — חינם</a>
  ${totalPlayers > 0 ? `<div class="stats-row">
    <div class="stat-pill"><div class="val">${totalPlayers.toLocaleString()}</div><div class="lbl">שחקנים</div></div>
    <div class="stat-pill"><div class="val">${totalGames.toLocaleString()}</div><div class="lbl">משחקים</div></div>
    <div class="stat-pill"><div class="val">${topScore.toLocaleString()}</div><div class="lbl">שיא עולמי</div></div>
  </div>` : ''}
</section>

<section class="features">
  <h2 class="features-title">למה BLOOM ממכר?</h2>
  <div class="feature"><div class="feature-icon">🧩</div><div class="feature-text"><h3>קל ללמוד, קשה לעצור</h3><p>הקש על עמודה → הפל אריח → מזג אריחים זהים → גלה דרגות חדשות. פשוט, אבל אי אפשר להפסיק.</p></div></div>
  <div class="feature"><div class="feature-icon">📅</div><div class="feature-text"><h3>אתגר יומי</h3><p>כל יום דאנג'ן חדש — אותו סידור אריחים לכל השחקנים. מי יביא את הציון הכי גבוה?</p></div></div>
  <div class="feature"><div class="feature-icon">🏆</div><div class="feature-text"><h3>אתגר שבועי + פרסים</h3><p>תחרות שבועית אוטומטית עם פרס 500 💎. תחרויות חברים עם הימורים.</p></div></div>
  <div class="feature"><div class="feature-icon">👀</div><div class="feature-text"><h3>צפייה חיה</h3><p>צפה בחברים שלך משחקים בזמן אמת. הם רואים שאתה צופה — הלחץ עולה!</p></div></div>
  <div class="feature"><div class="feature-icon">🎨</div><div class="feature-text"><h3>6 ערכות עיצוב</h3><p>קלאסי, ניאון, אוקיינוס, גלקסיה, ממתקים, זן. נסה לפני שקונה!</p></div></div>
  <div class="feature"><div class="feature-icon">🔥</div><div class="feature-text"><h3>רצף יומי + בונוסים</h3><p>שחק כל יום ותקבל בונוס 💎 שגדל. 7 ימים ברצף = בונוס ×4!</p></div></div>
</section>

<section class="bottom-cta">
  <p>חינם לגמרי. ללא הורדה. ללא רישום.</p>
  <a class="cta-play" href="/">🌸 שחק ב-BLOOM</a><br>
  <a class="wa-btn" href="https://wa.me/?text=${encodeURIComponent('🌸 גיליתי משחק מיזוג ממכר בעברית — BLOOM!\nנסה: https://bloom-web-production-f3bd.up.railway.app')}">
    <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
    שתף עם חברים
  </a>
</section>

<footer class="footer">
  BLOOM © 2026 · <a href="/" style="color:var(--gold)">שחק עכשיו</a> · <a href="/privacy" style="color:var(--muted)">פרטיות</a>
</footer>

</body></html>`);
});

// ============================================================
// GA4 INJECTION — replaces GA_MEASUREMENT_ID with env var GA_ID
// ============================================================
const GA_ID = process.env.GA_ID || '';

// Serve sw.js dynamically so CACHE_NAME auto-bumps on every deploy.
const BOOT_TS = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
let _swTemplate = null;
app.get('/sw.js', async (_req, res) => {
  try {
    if (!_swTemplate) _swTemplate = await readFileSw(new URL('./public/sw.js', import.meta.url), 'utf8');
    const body = _swTemplate.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'bloom-v1-${BOOT_TS}';`);
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(body);
  } catch (e) {
    res.status(500).send('// sw.js unavailable');
  }
});

if (GA_ID) {
  let indexHtml = '';
  try { indexHtml = readFileSync('public/index.html', 'utf8'); } catch (e) {}
  if (indexHtml) {
    const injectedHtml = indexHtml.replace(/GA_MEASUREMENT_ID/g, GA_ID);
    app.get('/', (_req, res) => {
      res.type('html').send(injectedHtml);
    });
  }
}

app.use(express.static('public', { maxAge: '5m', extensions: ['html'] }));

// ============================================================
// ADMIN — hidden URL + Basic Auth (defense in depth)
// ============================================================
// ADMIN_PATH is a random slug the user picks (e.g. "bloom-ops-K9pQ2v").
// ADMIN_PASSWORD is a 24+ char random secret. Both required to authenticate.
// If either env var is missing the admin surface returns 503 — never auto-allows.

const ADMIN_PATH_RAW = process.env.ADMIN_PATH || '';
const ADMIN_PATH = ADMIN_PATH_RAW
  ? ('/' + ADMIN_PATH_RAW.replace(/^\/+|\/+$/g, ''))
  : '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function requireAdmin(req, res, next) {
  if (!ADMIN_PATH || !ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'admin_not_configured' });
  }
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="bloom-admin", charset="UTF-8"');
    return res.status(401).send('Authentication required');
  }
  let decoded;
  try { decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8'); }
  catch (e) { return res.status(400).send('Bad auth header'); }
  const idx = decoded.indexOf(':');
  const supplied = idx >= 0 ? decoded.slice(idx + 1) : decoded;
  const a = Buffer.from(supplied);
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(403).send('Forbidden');
  }
  next();
}

async function logAdminAction(action, targetType, targetId, metadata) {
  try {
    await pool.query(
      `INSERT INTO admin_actions (action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4)`,
      [String(action).slice(0, 50), targetType ? String(targetType).slice(0, 50) : null,
       targetId ? String(targetId).slice(0, 120) : null, metadata || null]
    );
  } catch (e) {
    console.warn('logAdminAction failed', e.message);
  }
}

// ============================================================
// HELPERS
// ============================================================

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function cleanName(n) {
  const s = String(n || '').trim().slice(0, 24);
  return s || 'אנונימי';
}

function cleanContestName(n) {
  return String(n || '').trim().slice(0, 100);
}

function cleanDisplayName(n) {
  const s = String(n || '').trim().slice(0, 50);
  return s || 'אנונימי';
}

function generateContestCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniqueContestCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateContestCode();
    if (isCodeBlacklisted(code)) continue;
    const result = await pool.query('SELECT code FROM contests WHERE code = $1', [code]);
    if (result.rows.length === 0) return code;
  }
  throw new Error('Could not generate unique code after 20 attempts');
}

function shiftDateBack(iso, daysBack) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

// Accepts an ISO-3166 alpha-2 country code (e.g. "IL", "us"). Returns the
// canonical upper-case form, or null if the input doesn't look like a
// country code. We deliberately don't gate on a fixed allow-list — players
// from arbitrary territories should still get a flag. Empty string + "??"
// + "XX" are normalized to null so they never pollute the country index.
function cleanCountry(c) {
  if (!c) return null;
  const s = String(c).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return null;
  if (s === 'XX' || s === '??') return null;
  return s;
}

// Valid difficulty labels for the leaderboard query/insert path. The actual
// gameplay presets live in DIFFICULTY_PRESETS; this is just the input gate.
const DIFFICULTY_LABELS = ['default', 'easy', 'medium', 'hard', 'insane'];
function cleanDifficultyLabel(v) {
  const s = String(v || 'default').toLowerCase().trim();
  return DIFFICULTY_LABELS.includes(s) ? s : 'default';
}

// Validates a serialized 4x6 grid coming from a spectated client.
// Returns the canonical JSON string or null if the payload doesn't fit
// the expected shape (24 cells, each tier 0-8). Anything off-shape is
// rejected so we never store junk that the spectator's renderer would
// choke on.
function normalizeGridJson(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch (e) { return null; }
  }
  if (!Array.isArray(arr) || arr.length !== 24) return null;
  for (let i = 0; i < 24; i++) {
    const v = arr[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const n = v | 0;
    if (n < 0 || n > 8) return null;
    arr[i] = n;
  }
  return JSON.stringify(arr);
}

// How long since the last update a live row stays "live" — used both for
// in-game scoreboard overlays and for the watchers list. Kept loose enough
// (10s) to absorb the 5s spectator heartbeat plus typical network jitter.
const LIVE_FRESH_SECONDS = 10;

// ============================================================
// DIFFICULTY PRESETS — canonical mapping used by /api/contests and /api/duels
// ============================================================
// Players pick a label; the server resolves to weights+speed and stores those
// on the row so the snapshot is immutable even if the preset table changes
// later. 'default' (or null/unknown) means "use admin globals" — both columns
// stay NULL and the frontend falls back to its admin-tunable config.
const DIFFICULTY_PRESETS = {
  default: { weights: null,                   speed_pct: null },
  easy:    { weights: '70,25,5,0,0,0,0,0',    speed_pct: 100 },
  medium:  { weights: '30,35,25,10,0,0,0,0', speed_pct: 100 },
  hard:    { weights: '5,15,30,30,15,5,0,0', speed_pct: 100 },
  insane:  { weights: '0,0,10,30,35,20,5,0', speed_pct: 100 }
};
function resolveDifficulty(label) {
  const key = (typeof label === 'string' ? label.toLowerCase().trim() : '') || 'default';
  const preset = DIFFICULTY_PRESETS[key] || DIFFICULTY_PRESETS.default;
  return { label: preset === DIFFICULTY_PRESETS.default ? 'default' : key, weights: preset.weights, speed_pct: preset.speed_pct };
}

// ============================================================
// DEVICE TOKEN AUTH (HMAC-based anti-spoofing)
// ============================================================
// Each device registers once → gets an HMAC token tied to its deviceId.
// Score-sensitive endpoints verify the token. Old clients that don't send
// a token are allowed through during migration (soft enforcement).
// Set DEVICE_SECRET env var for stable tokens across restarts.

const DEVICE_SECRET = process.env.DEVICE_SECRET || randomBytes(32).toString('hex');
if (!process.env.DEVICE_SECRET) {
  console.warn('[auth] DEVICE_SECRET not set — using random (tokens reset on restart). Set it in Railway env vars.');
}

function generateDeviceToken(deviceId) {
  return createHmac('sha256', DEVICE_SECRET).update(deviceId).digest('hex');
}

function verifyDeviceToken(deviceId, token) {
  if (!token) return false;
  const expected = generateDeviceToken(deviceId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ============================================================
// DEVICE AUTH MIDDLEWARE
// ============================================================
// Two flavors:
//   requireDeviceAuth — hard: 400/401/403 if device or token missing/bad
//   softDeviceAuth    — rollout: accepts missing token, rejects only bad ones
// Use softDeviceAuth on every endpoint that mutates credits/scores/state for
// now. Once client telemetry shows ≥99% of requests carry a token, swap to
// requireDeviceAuth. Each middleware also sets req.deviceId for downstream
// handlers, but handlers still validate as before (defense in depth).

function requireDeviceAuth(req, res, next) {
  const deviceId =
    (req.body && typeof req.body.deviceId === 'string' && req.body.deviceId) ||
    req.headers['x-device-id'] ||
    null;
  const token =
    (req.body && typeof req.body.token === 'string' && req.body.token) ||
    req.headers['x-device-token'] ||
    null;
  if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
    return res.status(400).json({ error: 'bad_device' });
  }
  if (!token) return res.status(401).json({ error: 'missing_token' });
  if (!verifyDeviceToken(deviceId, token)) return res.status(403).json({ error: 'bad_token' });
  req.deviceId = deviceId;
  next();
}

function softDeviceAuth(req, res, next) {
  const deviceId =
    (req.body && typeof req.body.deviceId === 'string' && req.body.deviceId) ||
    req.headers['x-device-id'] || null;
  const token =
    (req.body && typeof req.body.token === 'string' && req.body.token) ||
    req.headers['x-device-token'] || null;
  if (token && deviceId && !verifyDeviceToken(deviceId, token)) {
    return res.status(403).json({ error: 'bad_token' });
  }
  req.deviceId = deviceId || null;
  next();
}

// POST /api/register — issues a token for a deviceId. Idempotent.
app.post('/api/register', (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('register', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    res.json({ ok: true, token: generateDeviceToken(deviceId) });
  } catch (e) {
    console.error('POST /api/register', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// RATE LIMITING (per-device, in-memory, sliding window)
// ============================================================
// Resets on server restart. Acceptable for a friends game with no auth.

const rateLimitStore = new Map(); // bucket key → array of timestamps
const MAX_RATE_LIMIT_KEYS = 50000;

function checkRateLimit(bucket, deviceId, maxRequests, windowMs) {
  if (!deviceId) return true; // bad inputs validated separately; don't double-fail
  if (rateLimitStore.size > MAX_RATE_LIMIT_KEYS) rateLimitStore.clear();
  const key = bucket + ':' + deviceId;
  const now = Date.now();
  const recent = (rateLimitStore.get(key) || []).filter(function(ts) { return now - ts < windowMs; });
  if (recent.length >= maxRequests) {
    return false;
  }
  recent.push(now);
  rateLimitStore.set(key, recent);
  return true;
}

// Periodic cleanup so the map doesn't grow unbounded
setInterval(function() {
  const cutoff = Date.now() - 60 * 60 * 1000; // anything older than 1 hour is gone
  for (const [k, arr] of rateLimitStore) {
    const fresh = arr.filter(function(ts) { return ts > cutoff; });
    if (fresh.length === 0) rateLimitStore.delete(k);
    else if (fresh.length !== arr.length) rateLimitStore.set(k, fresh);
  }
}, 5 * 60 * 1000);

// ============================================================
// CONTEST CODE GENERATION + BLACKLIST
// ============================================================
// The base alphabet already avoids 0/1/I/O. Filter out a small set of
// substrings that read offensive in the resulting codes.
const CODE_BLACKLIST = [
  'FUCK', 'SHIT', 'BITCH', 'DICK', 'COCK', 'CUNT', 'TWAT', 'PUSS',
  'ANAL', 'PORN', 'NAZI', 'KKK', 'HELL', 'CRAP', 'DAMN',
  'SLUT', 'WHORE', 'RAPE', 'SUCK'
];
function isCodeBlacklisted(code) {
  for (let i = 0; i < CODE_BLACKLIST.length; i++) {
    if (code.indexOf(CODE_BLACKLIST[i]) !== -1) return true;
  }
  return false;
}

// ============================================================
// DAILY CHALLENGE ENDPOINTS (קיימים — לא נגענו)
// ============================================================

app.post('/api/score', requireDeviceAuth, async (req, res) => {
  try {
    const { date, deviceId, name, score, tier, drops, token, country } = req.body || {};
    if (!isValidDate(date)) return res.status(400).json({ error: 'bad_date' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    // Token verification: reject if a token is provided but invalid.
    // Missing tokens are allowed (old clients) but logged for monitoring.
    if (token) {
      if (!verifyDeviceToken(deviceId, token)) {
        return res.status(403).json({ error: 'bad_token' });
      }
    }
    // Rate limit: max 60 daily score submissions per device per hour
    if (!checkRateLimit('daily:score', deviceId, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 1 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    // Anti-cheat: drops is now REQUIRED. A missing drops field used to bypass
    // challengeDropsImplausible entirely — the heuristic only fired when the
    // client volunteered the field. A cheater could just omit it. Now we 400.
    const dropsN = typeof drops === 'number' && Number.isFinite(drops) && drops >= 0 ? Math.floor(drops) : null;
    if (dropsN === null) {
      console.warn(`[anti-cheat] daily score rejected (no drops): device=${deviceId} score=${score}`);
      return res.status(400).json({ error: 'missing_drops' });
    }
    if (challengeDropsImplausible(score, dropsN)) {
      console.warn(`[anti-cheat] daily score rejected (implausible): device=${deviceId} score=${score} drops=${dropsN}`);
      return res.status(400).json({ error: 'implausible_score' });
    }
    const safeName = cleanName(name);
    const safeCountry = cleanCountry(country);
    if (safeCountry) {
      try {
        await pool.query(
          `UPDATE player_profiles SET country = $1 WHERE device_id = $2 AND (country IS NULL OR country <> $1)`,
          [safeCountry, deviceId]
        );
      } catch (e) { /* table may not have the column on legacy DBs */ }
    }
    await pool.query(
      `INSERT INTO daily_scores (date, device_id, name, score, tier, country, drops)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (date, device_id) DO UPDATE
         SET name = EXCLUDED.name,
             score = EXCLUDED.score,
             tier = EXCLUDED.tier,
             country = COALESCE(EXCLUDED.country, daily_scores.country),
             drops = EXCLUDED.drops,
             updated_at = NOW()
         WHERE daily_scores.score < EXCLUDED.score`,
      [date, deviceId, safeName, Math.floor(score), Math.floor(tier), safeCountry, dropsN]
    );
    // Keep player_profiles.display_name in sync so admin/duel/profile always
    // shows the same name the player picked on the daily leaderboard.
    if (safeName && safeName !== 'אנונימי') {
      try {
        await pool.query(
          `UPDATE player_profiles SET display_name = $1 WHERE device_id = $2 AND (display_name IS NULL OR display_name <> $1)`,
          [safeName, deviceId]
        );
      } catch (e) { /* profile may not exist yet for legacy devices */ }
    }
    const rankRes = await pool.query(
      `SELECT 1 + (
         SELECT COUNT(*) FROM daily_scores
         WHERE date = $1 AND score > (
           SELECT score FROM daily_scores WHERE date = $1 AND device_id = $2
         )
       ) AS rank`,
      [date, deviceId]
    );

    // Daily jackpot auto-contribution (first submission only)
    try {
      const jpEnabled = await pool.query(`SELECT value FROM game_config WHERE key = 'jackpot_enabled'`);
      if (!jpEnabled.rows.length || jpEnabled.rows[0].value !== 'false') {
        const jpEntry = await pool.query(`SELECT value FROM game_config WHERE key = 'jackpot_entry'`);
        const entryFee = parseInt((jpEntry.rows[0] || {}).value, 10) || 5;
        if (entryFee > 0) {
          // Skip if already contributed today.
          const alreadyIn = await pool.query(
            `SELECT 1 FROM wager_settlements WHERE contest_code = $1 AND device_id = $2 AND type = 'jackpot_entry'`,
            ['JP:' + date, deviceId]);
          if (!alreadyIn.rows.length) {
            // Atomic deduct: returns no rows if the player can't afford the entry,
            // in which case we silently skip — the player still keeps their score.
            const deduct = await pool.query(
              `UPDATE player_profiles
                  SET balance = balance - $1, total_spent = total_spent + $1
                WHERE device_id = $2 AND balance >= $1
                RETURNING balance`,
              [entryFee, deviceId]);
            if (deduct.rows.length) {
              await pool.query(
                `INSERT INTO daily_jackpot (date, pool, entries) VALUES ($1, $2, 1)
                 ON CONFLICT (date) DO UPDATE SET pool = daily_jackpot.pool + $2, entries = daily_jackpot.entries + 1`,
                [date, entryFee]);
              await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, 'jackpot_entry')`,
                ['JP:' + date, deviceId, -entryFee]);
            }
          }
        }
      }
    } catch (jpErr) { /* non-critical */ }

    const totalRes = await pool.query(`SELECT COUNT(*)::int AS c FROM daily_scores WHERE date = $1`, [date]);
    res.json({
      ok: true,
      rank: parseInt(rankRes.rows[0].rank, 10),
      total: totalRes.rows[0].c
    });
  } catch (e) {
    console.error('POST /api/score', e);
    res.status(500).json({ error: 'server' });
  }
});

app.get('/api/leaderboard/:date', async (req, res, next) => {
  try {
    const date = req.params.date;
    // Express matches /v2 against this :date param. Fall through to the
    // more-specific handlers (v2, range/:period) instead of 400'ing.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return next();
    if (!isValidDate(date)) return res.status(400).json({ error: 'bad_date' });
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    const rows = await pool.query(
      `SELECT name, score, tier, device_id
       FROM daily_scores
       WHERE date = $1
       ORDER BY score DESC, updated_at ASC
       LIMIT 50`,
      [date]
    );
    const list = rows.rows.map((r) => ({
      name: r.name,
      score: r.score,
      tier: r.tier,
      you: deviceId && r.device_id === deviceId
    }));
    let rank = null;
    if (deviceId) {
      const rankRes = await pool.query(
        `SELECT 1 + (
           SELECT COUNT(*) FROM daily_scores
           WHERE date = $1 AND score > COALESCE((
             SELECT score FROM daily_scores WHERE date = $1 AND device_id = $2
           ), -1)
         ) AS rank,
         EXISTS (SELECT 1 FROM daily_scores WHERE date = $1 AND device_id = $2) AS has_score`,
        [date, deviceId]
      );
      if (rankRes.rows[0].has_score) rank = parseInt(rankRes.rows[0].rank, 10);
    }
    const total = await pool.query(`SELECT COUNT(*)::int AS c FROM daily_scores WHERE date = $1`, [date]);
    res.json({ list, total: total.rows[0].c, rank });
  } catch (e) {
    console.error('GET /api/leaderboard', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/profile/country — one-time flag picker. Idempotent. Stores the
// country on player_profiles (auto-creates a stub row if absent) so future
// score submissions can default to it server-side when the client forgets.
app.post('/api/profile/country', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, country } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('profile:country', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cc = cleanCountry(country);
    if (!cc && country !== null && country !== '') {
      return res.status(400).json({ error: 'bad_country' });
    }
    try {
      await pool.query(
        `UPDATE player_profiles SET country = $1 WHERE device_id = $2`,
        [cc, deviceId]
      );
    } catch (e) { /* column missing on legacy DB */ }
    res.json({ ok: true, country: cc });
  } catch (e) {
    console.error('POST /api/profile/country', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/profile/name — let a player rename themselves from the home pill.
// Writes the new name to player_profiles.display_name. The daily-score upsert
// (POST /api/score) will re-sync on the next submission, so this gives an
// immediate effect even before they play another game.
app.post('/api/profile/name', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, name } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('profile:name', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const safe = cleanName(name);
    if (!safe || safe === 'אנונימי') return res.status(400).json({ error: 'bad_name' });
    try {
      await pool.query(
        `UPDATE player_profiles SET display_name = $1 WHERE device_id = $2`,
        [safe, deviceId]
      );
    } catch (e) { /* profile row may not exist yet */ }
    res.json({ ok: true, name: safe });
  } catch (e) {
    console.error('POST /api/profile/name', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/score/practice — non-daily best-per-difficulty leaderboard.
// Practice and duel modes both flow through here. Daily scores DO NOT call
// this (admin-controlled fairness); duel writes one row per participant.
// Body: { date, deviceId, name, score, tier, difficulty, country, source, drops, token }
app.post('/api/score/practice', requireDeviceAuth, async (req, res) => {
  try {
    const { date, deviceId, name, score, tier, drops, token, country, difficulty, source } = req.body || {};
    if (!isValidDate(date)) return res.status(400).json({ error: 'bad_date' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (token && !verifyDeviceToken(deviceId, token)) {
      return res.status(403).json({ error: 'bad_token' });
    }
    if (!checkRateLimit('practice:score', deviceId, 120, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 1 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    const dropsN = typeof drops === 'number' && Number.isFinite(drops) && drops >= 0 ? Math.floor(drops) : null;
    if (dropsN === null) {
      console.warn(`[anti-cheat] practice score rejected (no drops): device=${deviceId} score=${score}`);
      return res.status(400).json({ error: 'missing_drops' });
    }
    if (challengeDropsImplausible(score, dropsN)) {
      console.warn(`[anti-cheat] practice score rejected (implausible): device=${deviceId} score=${score} drops=${dropsN}`);
      return res.status(400).json({ error: 'implausible_score' });
    }
    const safeName = cleanName(name);
    const safeCountry = cleanCountry(country);
    const safeDiff = cleanDifficultyLabel(difficulty);
    const safeSource = (source === 'duel') ? 'duel' : 'practice';
    if (safeCountry) {
      try {
        await pool.query(
          `UPDATE player_profiles SET country = $1 WHERE device_id = $2 AND (country IS NULL OR country <> $1)`,
          [safeCountry, deviceId]
        );
      } catch (e) {}
    }
    await pool.query(
      `INSERT INTO difficulty_scores (date, device_id, difficulty_label, name, score, tier, country, source, drops)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (date, device_id, difficulty_label) DO UPDATE
         SET name = EXCLUDED.name,
             score = EXCLUDED.score,
             tier = EXCLUDED.tier,
             country = COALESCE(EXCLUDED.country, difficulty_scores.country),
             source = EXCLUDED.source,
             drops = EXCLUDED.drops,
             updated_at = NOW()
         WHERE difficulty_scores.score < EXCLUDED.score`,
      [date, deviceId, safeDiff, safeName, Math.floor(score), Math.floor(tier), safeCountry, safeSource, dropsN]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/score/practice', e);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/leaderboard/v2 — unified scope × time leaderboard.
//   scope=world      → all daily_scores rows in the date window
//   scope=country    → daily_scores rows filtered by the player's country
//                      (or ?country=XX override; defaults to viewer's country)
//   scope=difficulty → difficulty_scores rows for ?difficulty=...
// period=day|week|month, endDate=YYYY-MM-DD.
app.get('/api/leaderboard/v2', async (req, res) => {
  try {
    const scope = String(req.query.scope || 'world');
    const period = String(req.query.period || 'day');
    const endDate = String(req.query.endDate || '');
    if (!isValidDate(endDate)) return res.status(400).json({ error: 'bad_date' });
    if (!['day', 'week', 'month'].includes(period)) return res.status(400).json({ error: 'bad_period' });
    if (!['world', 'country', 'difficulty'].includes(scope)) return res.status(400).json({ error: 'bad_scope' });
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    const daysBack = period === 'day' ? 0 : period === 'week' ? 6 : 29;
    const startDate = shiftDateBack(endDate, daysBack);

    // Country scope: prefer ?country=, fall back to the viewer's profile.
    let viewerCountry = cleanCountry(req.query.country);
    if (scope === 'country' && !viewerCountry && deviceId) {
      try {
        const r = await pool.query(`SELECT country FROM player_profiles WHERE device_id = $1`, [deviceId]);
        if (r.rows.length && r.rows[0].country) viewerCountry = cleanCountry(r.rows[0].country);
      } catch (e) {}
    }
    if (scope === 'country' && !viewerCountry) {
      return res.json({ list: [], total: 0, rank: null, from: startDate, to: endDate, period, scope, country: null, needsCountry: true });
    }

    const difficulty = cleanDifficultyLabel(req.query.difficulty);
    let listQ, rankQ, totalQ;
    if (scope === 'difficulty') {
      const baseParams = [startDate, endDate, difficulty];
      listQ = {
        text:
          `SELECT best.name, best.score, best.tier, best.device_id, best.country, pp.player_code FROM (
             SELECT DISTINCT ON (device_id) name, score, tier, device_id, country
             FROM difficulty_scores
             WHERE date >= $1 AND date <= $2 AND difficulty_label = $3
             ORDER BY device_id, score DESC, updated_at ASC
           ) best
           LEFT JOIN player_profiles pp ON pp.device_id = best.device_id
           ORDER BY best.score DESC LIMIT 50`,
        values: baseParams
      };
      totalQ = {
        text: `SELECT COUNT(DISTINCT device_id)::int AS c FROM difficulty_scores
               WHERE date >= $1 AND date <= $2 AND difficulty_label = $3`,
        values: baseParams
      };
      if (deviceId) {
        rankQ = {
          text:
            `WITH best AS (
               SELECT DISTINCT ON (device_id) device_id, score
               FROM difficulty_scores
               WHERE date >= $1 AND date <= $2 AND difficulty_label = $3
               ORDER BY device_id, score DESC
             ),
             me AS (SELECT score FROM best WHERE device_id = $4)
             SELECT 1 + (SELECT COUNT(*) FROM best WHERE score > COALESCE((SELECT score FROM me), -1)) AS rank,
                    EXISTS (SELECT 1 FROM me) AS has_score`,
          values: [startDate, endDate, difficulty, deviceId]
        };
      }
    } else if (scope === 'country') {
      const baseParams = [startDate, endDate, viewerCountry];
      listQ = {
        text:
          `SELECT best.name, best.score, best.tier, best.device_id, best.country, pp.player_code FROM (
             SELECT DISTINCT ON (device_id) name, score, tier, device_id, country
             FROM daily_scores
             WHERE date >= $1 AND date <= $2 AND country = $3
             ORDER BY device_id, score DESC, updated_at ASC
           ) best
           LEFT JOIN player_profiles pp ON pp.device_id = best.device_id
           ORDER BY best.score DESC LIMIT 50`,
        values: baseParams
      };
      totalQ = {
        text: `SELECT COUNT(DISTINCT device_id)::int AS c FROM daily_scores
               WHERE date >= $1 AND date <= $2 AND country = $3`,
        values: baseParams
      };
      if (deviceId) {
        rankQ = {
          text:
            `WITH best AS (
               SELECT DISTINCT ON (device_id) device_id, score
               FROM daily_scores
               WHERE date >= $1 AND date <= $2 AND country = $3
               ORDER BY device_id, score DESC
             ),
             me AS (SELECT score FROM best WHERE device_id = $4)
             SELECT 1 + (SELECT COUNT(*) FROM best WHERE score > COALESCE((SELECT score FROM me), -1)) AS rank,
                    EXISTS (SELECT 1 FROM me) AS has_score`,
          values: [startDate, endDate, viewerCountry, deviceId]
        };
      }
    } else {
      // world
      const baseParams = [startDate, endDate];
      listQ = {
        text:
          `SELECT best.name, best.score, best.tier, best.device_id, best.country, pp.player_code FROM (
             SELECT DISTINCT ON (device_id) name, score, tier, device_id, country
             FROM daily_scores
             WHERE date >= $1 AND date <= $2
             ORDER BY device_id, score DESC, updated_at ASC
           ) best
           LEFT JOIN player_profiles pp ON pp.device_id = best.device_id
           ORDER BY best.score DESC LIMIT 50`,
        values: baseParams
      };
      totalQ = {
        text: `SELECT COUNT(DISTINCT device_id)::int AS c FROM daily_scores
               WHERE date >= $1 AND date <= $2`,
        values: baseParams
      };
      if (deviceId) {
        rankQ = {
          text:
            `WITH best AS (
               SELECT DISTINCT ON (device_id) device_id, score
               FROM daily_scores
               WHERE date >= $1 AND date <= $2
               ORDER BY device_id, score DESC
             ),
             me AS (SELECT score FROM best WHERE device_id = $3)
             SELECT 1 + (SELECT COUNT(*) FROM best WHERE score > COALESCE((SELECT score FROM me), -1)) AS rank,
                    EXISTS (SELECT 1 FROM me) AS has_score`,
          values: [startDate, endDate, deviceId]
        };
      }
    }

    const rowsRes = await pool.query(listQ);
    const list = rowsRes.rows.map((r) => ({
      name: r.name,
      score: r.score,
      tier: r.tier,
      country: r.country || null,
      player_code: r.player_code || null,
      you: !!(deviceId && r.device_id === deviceId)
    }));
    let rank = null;
    if (rankQ) {
      const rr = await pool.query(rankQ);
      if (rr.rows.length && rr.rows[0].has_score) rank = parseInt(rr.rows[0].rank, 10);
    }
    const total = (await pool.query(totalQ)).rows[0].c;
    res.json({
      list, total, rank,
      from: startDate, to: endDate, period, scope,
      country: viewerCountry || null,
      difficulty: scope === 'difficulty' ? difficulty : null
    });
  } catch (e) {
    console.error('GET /api/leaderboard/v2', e);
    res.status(500).json({ error: 'server' });
  }
});

app.get('/api/leaderboard/range/:period', async (req, res) => {
  try {
    const period = req.params.period;
    const endDate = String(req.query.endDate || '');
    if (!isValidDate(endDate)) return res.status(400).json({ error: 'bad_date' });
    if (!['day', 'week', 'month'].includes(period)) return res.status(400).json({ error: 'bad_period' });
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    const daysBack = period === 'day' ? 0 : period === 'week' ? 6 : 29;
    const startDate = shiftDateBack(endDate, daysBack);
    const rows = await pool.query(
      `SELECT name, score, tier, device_id FROM (
         SELECT DISTINCT ON (device_id) name, score, tier, device_id
         FROM daily_scores
         WHERE date >= $1 AND date <= $2
         ORDER BY device_id, score DESC, updated_at ASC
       ) best
       ORDER BY score DESC LIMIT 50`,
      [startDate, endDate]
    );
    const list = rows.rows.map((r) => ({
      name: r.name,
      score: r.score,
      tier: r.tier,
      you: !!(deviceId && r.device_id === deviceId)
    }));
    let rank = null;
    if (deviceId) {
      const rankRes = await pool.query(
        `WITH best AS (
           SELECT DISTINCT ON (device_id) device_id, score
           FROM daily_scores
           WHERE date >= $1 AND date <= $2
           ORDER BY device_id, score DESC
         ),
         me AS (SELECT score FROM best WHERE device_id = $3)
         SELECT 1 + (SELECT COUNT(*) FROM best WHERE score > COALESCE((SELECT score FROM me), -1)) AS rank,
                EXISTS (SELECT 1 FROM me) AS has_score`,
        [startDate, endDate, deviceId]
      );
      if (rankRes.rows[0].has_score) rank = parseInt(rankRes.rows[0].rank, 10);
    }
    const totalRes = await pool.query(
      `SELECT COUNT(DISTINCT device_id)::int AS c FROM daily_scores WHERE date >= $1 AND date <= $2`,
      [startDate, endDate]
    );
    res.json({ list, total: totalRes.rows[0].c, rank, from: startDate, to: endDate, period });
  } catch (e) {
    console.error('GET /api/leaderboard/range', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// FRIENDS COMPETITION ENDPOINTS (חדש)
// ============================================================

// GET /api/contests/mine — כל התחרויות שהמכשיר חבר בהן
app.get('/api/contests/mine', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    if (!deviceId || deviceId.length < 8) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const result = await pool.query(
      `SELECT
         c.code, c.name, c.host_name, c.ends_at, c.created_at, c.board_type,
         cs.score AS my_score, cs.highest_tier AS my_tier,
         cs.games_played AS my_games, cs.last_played_at AS my_last,
         (SELECT COUNT(*) FROM contest_scores WHERE contest_code = c.code) AS member_count,
         (SELECT 1 + COUNT(*) FROM contest_scores
            WHERE contest_code = c.code AND score > cs.score) AS my_rank
       FROM contests c
       INNER JOIN contest_scores cs ON cs.contest_code = c.code
       WHERE cs.device_id = $1
       ORDER BY cs.last_played_at DESC, c.created_at DESC`,
      [deviceId]
    );
    const contests = result.rows.map((r) => ({
      code: r.code,
      name: r.name,
      host_name: r.host_name,
      ends_at: r.ends_at,
      board_type: r.board_type,
      member_count: parseInt(r.member_count, 10) || 0,
      my: {
        score: r.my_score | 0,
        tier: r.my_tier | 0,
        games: r.my_games | 0,
        rank: parseInt(r.my_rank, 10) || 1,
        last: r.my_last
      }
    }));
    res.json({ ok: true, contests });
  } catch (e) {
    console.error('GET /api/contests/mine', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests — יצירת תחרות חדשה
app.post('/api/contests', requireDeviceAuth, async (req, res) => {
  try {
    const { name, hostName, deviceId, durationDays, boardType, wagerAmount, difficulty } = req.body || {};

    const cleanedName = cleanContestName(name);
    if (!cleanedName) return res.status(400).json({ error: 'bad_name' });

    const cleanedHost = cleanDisplayName(hostName);
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }

    // Rate limit: max 5 new contests per device per hour
    if (!checkRateLimit('contest:create', deviceId, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }

    const dur = Math.min(Math.max(parseInt(durationDays, 10) || 7, 1), 30);
    const type = boardType === 'free' ? 'free' : 'shared';
    const seed = type === 'shared' ? Math.floor(Math.random() * 2147483647) : null;
    const endsAt = new Date(Date.now() + dur * 24 * 60 * 60 * 1000);

    // Wager handling
    let wager = parseInt(wagerAmount, 10) || 0;
    if (wager > 0) {
      const wcfg = await pool.query(`SELECT key, value FROM game_config WHERE key IN ('wager_enabled','wager_min','wager_max')`);
      const cfg = {}; for (const r of wcfg.rows) cfg[r.key] = r.value;
      if (cfg.wager_enabled === 'false') { wager = 0; }
      else {
        const min = parseInt(cfg.wager_min, 10) || 10;
        const max = parseInt(cfg.wager_max, 10) || 500;
        if (wager < min) return res.status(400).json({ error: 'wager_too_low', min });
        if (wager > max) wager = max;
        // Atomic deduct from host: passes only if balance is sufficient.
        const deduct = await pool.query(
          `UPDATE player_profiles
              SET balance = balance - $1, total_spent = total_spent + $1
            WHERE device_id = $2 AND balance >= $1
            RETURNING balance`,
          [wager, deviceId]);
        if (!deduct.rows.length) {
          return res.status(400).json({ error: 'insufficient_balance' });
        }
      }
    }

    const code = await generateUniqueContestCode();

    const diff = resolveDifficulty(difficulty);

    const result = await pool.query(
      `INSERT INTO contests (code, name, host_name, host_device_id, board_seed, board_type, duration_days, ends_at, wager_amount, wager_pool, difficulty_label, difficulty_weights, difficulty_speed_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [code, cleanedName, cleanedHost, deviceId, seed, type, dur, endsAt, wager, wager, diff.label, diff.weights, diff.speed_pct]
    );

    // Record settlement entry for host
    if (wager > 0) {
      await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, 'entry')`,
        [code, deviceId, -wager]);
    }

    await pool.query(
      `INSERT INTO contest_scores (contest_code, device_id, display_name, score, highest_tier)
       VALUES ($1, $2, $3, 0, 1)
       ON CONFLICT (contest_code, device_id) DO NOTHING`,
      [code, deviceId, cleanedHost]
    );

    res.json({ ok: true, contest: result.rows[0] });
  } catch (e) {
    console.error('POST /api/contests', e);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/contests/:code — קבלת פרטי תחרות + לוח מובילים
app.get('/api/contests/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    if (!code) return res.status(400).json({ error: 'bad_code' });

    const contestResult = await pool.query('SELECT * FROM contests WHERE code = $1', [code]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const deviceId = String(req.query.deviceId || '').slice(0, 64);

    // Pull scores + currently-live overlay in one query so a single round
    // trip carries everything the contest leaderboard needs. The sort key
    // is "accumulated + live (if fresh)" so a player who's mid-game appears
    // at their *projected* rank, matching what the user expects to see.
    const scoresResult = await pool.query(
      `SELECT
         cs.device_id,
         cs.display_name,
         cs.score,
         cs.highest_tier,
         cs.games_played,
         cs.last_played_at,
         CASE WHEN ls.updated_at IS NOT NULL
               AND ls.updated_at > NOW() - ($2::int * INTERVAL '1 second')
              THEN ls.live_score ELSE NULL END AS live_score,
         CASE WHEN ls.updated_at IS NOT NULL
               AND ls.updated_at > NOW() - ($2::int * INTERVAL '1 second')
              THEN ls.highest_tier ELSE NULL END AS live_tier,
         CASE WHEN ls.updated_at IS NOT NULL
               AND ls.updated_at > NOW() - ($2::int * INTERVAL '1 second')
              THEN ls.updated_at ELSE NULL END AS live_updated_at
       FROM contest_scores cs
       LEFT JOIN contest_live_state ls
         ON ls.contest_code = cs.contest_code
        AND ls.device_id    = cs.device_id
       WHERE cs.contest_code = $1
       ORDER BY (cs.score + CASE WHEN ls.updated_at IS NOT NULL
                                   AND ls.updated_at > NOW() - ($2::int * INTERVAL '1 second')
                                  THEN ls.live_score ELSE 0 END) DESC,
                cs.last_played_at ASC`,
      [code, LIVE_FRESH_SECONDS]
    );

    // Watchers, grouped by who they're watching. Limited to LIVE_FRESH_SECONDS
    // since the last heartbeat so a closed tab stops counting almost immediately.
    const watchersResult = await pool.query(
      `SELECT target_device_id, watcher_name, watcher_last_score, updated_at
       FROM contest_watchers
       WHERE contest_code = $1
         AND updated_at > NOW() - ($2::int * INTERVAL '1 second')
       ORDER BY updated_at DESC`,
      [code, LIVE_FRESH_SECONDS]
    );
    const watchersByTarget = new Map();
    for (const w of watchersResult.rows) {
      const list = watchersByTarget.get(w.target_device_id) || [];
      list.push({ name: w.watcher_name, lastScore: w.watcher_last_score | 0 });
      watchersByTarget.set(w.target_device_id, list);
    }

    const players = scoresResult.rows.map((r) => {
      const watchers = watchersByTarget.get(r.device_id) || [];
      return {
        deviceId: r.device_id,
        name: r.display_name,
        score: r.score,
        tier: r.highest_tier,
        games: r.games_played,
        last: r.last_played_at,
        liveScore: r.live_score === null ? null : (r.live_score | 0),
        liveTier:  r.live_tier  === null ? null : (r.live_tier  | 0),
        liveUpdatedAt: r.live_updated_at,
        watchers: watchers,
        hasWatchers: watchers.length > 0,
        you: !!(deviceId && r.device_id === deviceId)
      };
    });

    res.json({
      ok: true,
      contest: contestResult.rows[0],
      players,
      liveFreshSeconds: LIVE_FRESH_SECONDS
    });
  } catch (e) {
    console.error('GET /api/contests/:code', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests/:code/join — הצטרפות לתחרות
app.post('/api/contests/:code/join', requireDeviceAuth, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { deviceId, displayName } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    // Rate limit: max 30 joins per device per hour
    if (!checkRateLimit('contest:join', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cleanedName = cleanDisplayName(displayName);

    const contestResult = await pool.query('SELECT * FROM contests WHERE code = $1', [code]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (new Date(contestResult.rows[0].ends_at) < new Date()) {
      return res.status(403).json({ error: 'ended' });
    }

    // Name uniqueness check — any OTHER device in this contest already using
    // this display name (case-insensitive) makes us reject.
    const nameClash = await pool.query(
      `SELECT 1 FROM contest_scores
       WHERE contest_code = $1
         AND LOWER(display_name) = LOWER($2)
         AND device_id <> $3
       LIMIT 1`,
      [code, cleanedName, deviceId]
    );
    if (nameClash.rows.length > 0) {
      return res.status(409).json({ error: 'name_taken' });
    }

    await pool.query(
      `INSERT INTO contest_scores (contest_code, device_id, display_name, score, highest_tier)
       VALUES ($1, $2, $3, 0, 1)
       ON CONFLICT (contest_code, device_id)
       DO UPDATE SET display_name = EXCLUDED.display_name`,
      [code, deviceId, cleanedName]
    );

    // Handle wager payment for new joiners
    const contest = contestResult.rows[0];
    const wagerAmt = contest.wager_amount | 0;
    if (wagerAmt > 0 && contest.host_device_id !== deviceId) {
      // Check if already paid (re-join shouldn't double-charge)
      const alreadyPaid = await pool.query(
        `SELECT 1 FROM wager_settlements WHERE contest_code = $1 AND device_id = $2 AND type = 'entry'`, [code, deviceId]);
      if (!alreadyPaid.rows.length) {
        // Atomic deduct: passes only if balance is sufficient.
        const deduct = await pool.query(
          `UPDATE player_profiles
              SET balance = balance - $1, total_spent = total_spent + $1
            WHERE device_id = $2 AND balance >= $1
            RETURNING balance`,
          [wagerAmt, deviceId]);
        if (!deduct.rows.length) {
          return res.status(400).json({ error: 'insufficient_balance', wagerRequired: wagerAmt });
        }
        await pool.query(`UPDATE contests SET wager_pool = wager_pool + $1 WHERE code = $2`, [wagerAmt, code]);
        await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, 'entry')`, [code, deviceId, -wagerAmt]);
      }
    }

    res.json({ ok: true, contest: contest });
  } catch (e) {
    console.error('POST /api/contests/:code/join', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests/:code/score — שליחת תוצאת משחק לתחרות
app.post('/api/contests/:code/score', requireDeviceAuth, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { deviceId, displayName, score, tier } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    // Rate limit: max 60 score submissions per device per hour (~1/min)
    if (!checkRateLimit('contest:score', deviceId, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    // Tighter per-game ceiling on top of the 10M sanity check. Real games top
    // out far below this — anything higher is a sign of accumulation abuse.
    const MAX_SCORE_PER_GAME = 1_500_000;
    if (Math.floor(score) > MAX_SCORE_PER_GAME) {
      return res.status(400).json({ error: 'score_too_high', max: MAX_SCORE_PER_GAME });
    }
    if (typeof tier !== 'number' || tier < 1 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    const cleanedName = cleanDisplayName(displayName);

    const contestResult = await pool.query('SELECT ends_at FROM contests WHERE code = $1', [code]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (new Date(contestResult.rows[0].ends_at) < new Date()) {
      return res.status(403).json({ error: 'ended' });
    }

    // Per-contest cool-down: a single device must wait at least 30s between
    // game submissions, so the cumulative score can't be inflated by spamming.
    const lastPlay = await pool.query(
      `SELECT last_played_at FROM contest_scores WHERE contest_code = $1 AND device_id = $2`,
      [code, deviceId]);
    if (lastPlay.rows.length && lastPlay.rows[0].last_played_at) {
      const sinceMs = Date.now() - new Date(lastPlay.rows[0].last_played_at).getTime();
      if (sinceMs < 30_000) {
        return res.status(429).json({ error: 'too_soon', waitMs: 30_000 - sinceMs });
      }
    }

    // If the submitter is trying to RENAME themselves to a name another
    // device in this contest already uses, silently keep their existing
    // name. The score still saves — we just don't let them steal the
    // identity. (New joiners hit the strict 409 inside /join above; this
    // path is only for ongoing players, and we don't want to lose a game's
    // score over a name choice.)
    let nameToStore = cleanedName;
    const existing = await pool.query(
      `SELECT display_name FROM contest_scores WHERE contest_code = $1 AND device_id = $2`,
      [code, deviceId]
    );
    if (existing.rows.length > 0) {
      const currentName = existing.rows[0].display_name;
      if (currentName && cleanedName.toLowerCase() !== currentName.toLowerCase()) {
        const clash = await pool.query(
          `SELECT 1 FROM contest_scores
           WHERE contest_code = $1
             AND LOWER(display_name) = LOWER($2)
             AND device_id <> $3
           LIMIT 1`,
          [code, cleanedName, deviceId]
        );
        if (clash.rows.length > 0) nameToStore = currentName;
      }
    }

    await pool.query(
      `INSERT INTO contest_scores (contest_code, device_id, display_name, score, highest_tier, games_played, last_played_at)
       VALUES ($1, $2, $3, $4, $5, 1, NOW())
       ON CONFLICT (contest_code, device_id)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         score = contest_scores.score + EXCLUDED.score,
         highest_tier = GREATEST(contest_scores.highest_tier, EXCLUDED.highest_tier),
         games_played = contest_scores.games_played + 1,
         last_played_at = NOW()`,
      [code, deviceId, nameToStore, Math.floor(score), Math.floor(tier)]
    );

    const rankRes = await pool.query(
      `SELECT 1 + (
         SELECT COUNT(*) FROM contest_scores
         WHERE contest_code = $1 AND score > (
           SELECT score FROM contest_scores WHERE contest_code = $1 AND device_id = $2
         )
       ) AS rank,
       (SELECT COUNT(*) FROM contest_scores WHERE contest_code = $1) AS total`,
      [code, deviceId]
    );

    res.json({
      ok: true,
      rank: parseInt(rankRes.rows[0].rank, 10),
      total: parseInt(rankRes.rows[0].total, 10)
    });
  } catch (e) {
    console.error('POST /api/contests/:code/score', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// LIVE CONTEST + SPECTATOR ENDPOINTS (חדש — שלב 3)
// ============================================================
// כל הראוטים הללו מעדכנים שורה לכל היותר — אין רשומות היסטוריות. שורות
// "נושנות" מסוננות בקריאה לפי LIVE_FRESH_SECONDS, ולכן אין צורך ב-cron
// לניקוי. ניקוי "אמיתי" קורה בהזדמנות (best-effort) בתוך POST /live-score.

async function purgeStaleLiveRowsBestEffort(code) {
  try {
    await pool.query(
      `DELETE FROM contest_live_state
       WHERE contest_code = $1 AND updated_at < NOW() - INTERVAL '1 hour'`,
      [code]
    );
    await pool.query(
      `DELETE FROM contest_watchers
       WHERE contest_code = $1 AND updated_at < NOW() - INTERVAL '1 hour'`,
      [code]
    );
  } catch (_) { /* best-effort */ }
}

// POST /api/contests/:code/live-score — עדכון ניקוד חי (ללא הגריד).
// מוחזר hasWatchers כדי שה-client ידע אם לטרוח לשלוח גם /live-state.
app.post('/api/contests/:code/live-score', softDeviceAuth, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { deviceId, displayName, liveScore, tier } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    // Rate limit: 1Hz heartbeat + slack → 120/min/device.
    if (!checkRateLimit('contest:live-score', deviceId, 120, 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof liveScore !== 'number' || !Number.isFinite(liveScore) || liveScore < 0 || liveScore > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 0 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    const cleanedName = cleanDisplayName(displayName);

    // Lazy purge — runs at most a few times a minute thanks to rate limiting.
    if (Math.random() < 0.01) purgeStaleLiveRowsBestEffort(code);

    await pool.query(
      // Note: live_score / highest_tier come straight from the client — each
      // contest game starts fresh so we overwrite both. Stale rows for a
      // previous game are gone after LIVE_FRESH_SECONDS anyway.
      `INSERT INTO contest_live_state (contest_code, device_id, display_name, live_score, highest_tier, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (contest_code, device_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         live_score   = EXCLUDED.live_score,
         highest_tier = EXCLUDED.highest_tier,
         updated_at   = NOW()`,
      [code, deviceId, cleanedName, Math.floor(liveScore), Math.floor(tier)]
    );

    const watchersRes = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM contest_watchers
       WHERE contest_code = $1
         AND target_device_id = $2
         AND updated_at > NOW() - ($3::int * INTERVAL '1 second')`,
      [code, deviceId, LIVE_FRESH_SECONDS]
    );
    const watcherCount = watchersRes.rows[0].c | 0;

    res.json({ ok: true, hasWatchers: watcherCount > 0, watcherCount });
  } catch (e) {
    console.error('POST /api/contests/:code/live-score', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests/:code/live-state — אותו דבר + גריד JSON. נשלח רק
// כשהשרת אמר "יש לך צופים" בתשובה הקודמת ל-/live-score.
app.post('/api/contests/:code/live-state', softDeviceAuth, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { deviceId, displayName, liveScore, tier, nextTier, gridJson } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('contest:live-state', deviceId, 120, 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof liveScore !== 'number' || !Number.isFinite(liveScore) || liveScore < 0 || liveScore > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 0 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    let nextTierVal = null;
    if (nextTier !== undefined && nextTier !== null) {
      if (typeof nextTier !== 'number' || nextTier < 0 || nextTier > 8) {
        return res.status(400).json({ error: 'bad_next_tier' });
      }
      nextTierVal = Math.floor(nextTier);
    }
    const cleanedName = cleanDisplayName(displayName);
    const gridStr = normalizeGridJson(gridJson);
    if (!gridStr) return res.status(400).json({ error: 'bad_grid' });

    await pool.query(
      `INSERT INTO contest_live_state (contest_code, device_id, display_name, live_score, highest_tier, next_tier, grid_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (contest_code, device_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         live_score   = EXCLUDED.live_score,
         highest_tier = EXCLUDED.highest_tier,
         next_tier    = EXCLUDED.next_tier,
         grid_json    = EXCLUDED.grid_json,
         updated_at   = NOW()`,
      [code, deviceId, cleanedName, Math.floor(liveScore), Math.floor(tier), nextTierVal, gridStr]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/contests/:code/live-state', e);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/contests/:code/live-state/:targetDeviceId — קריאת snapshot.
// מוחזר 404 אם אין שורה טרייה (=המשחק הסתיים / הופסק).
app.get('/api/contests/:code/live-state/:targetDeviceId', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const targetDeviceId = String(req.params.targetDeviceId || '').slice(0, 64);
    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (!targetDeviceId || targetDeviceId.length < 8) return res.status(400).json({ error: 'bad_device' });

    const result = await pool.query(
      `SELECT display_name, live_score, highest_tier, next_tier, grid_json, updated_at
       FROM contest_live_state
       WHERE contest_code = $1
         AND device_id = $2
         AND updated_at > NOW() - ($3::int * INTERVAL '1 second')`,
      [code, targetDeviceId, LIVE_FRESH_SECONDS]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'not_live' });

    const r = result.rows[0];
    let grid = null;
    if (r.grid_json) {
      try { grid = JSON.parse(r.grid_json); } catch (_) { grid = null; }
    }
    res.json({
      ok: true,
      live: {
        name: r.display_name,
        score: r.live_score | 0,
        tier:  r.highest_tier | 0,
        nextTier: r.next_tier === null ? null : (r.next_tier | 0),
        grid: grid,
        updatedAt: r.updated_at
      }
    });
  } catch (e) {
    console.error('GET /api/contests/:code/live-state/:targetDeviceId', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests/:code/watch — מתחיל/מחדש watch + heartbeat (כל 5s).
app.post('/api/contests/:code/watch', softDeviceAuth, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { watcherDeviceId, watcherName, watcherLastScore, targetDeviceId } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof watcherDeviceId !== 'string' || watcherDeviceId.length < 8 || watcherDeviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (typeof targetDeviceId !== 'string' || targetDeviceId.length < 8 || targetDeviceId.length > 64) {
      return res.status(400).json({ error: 'bad_target' });
    }
    if (watcherDeviceId === targetDeviceId) {
      return res.status(400).json({ error: 'self_watch' });
    }
    if (!checkRateLimit('contest:watch', watcherDeviceId, 60, 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const lastScore = (typeof watcherLastScore === 'number' && Number.isFinite(watcherLastScore)
      && watcherLastScore >= 0 && watcherLastScore <= 10_000_000) ? Math.floor(watcherLastScore) : 0;
    const cleanedName = cleanDisplayName(watcherName);

    await pool.query(
      `INSERT INTO contest_watchers (contest_code, watcher_device_id, watcher_name, watcher_last_score, target_device_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (contest_code, watcher_device_id, target_device_id) DO UPDATE SET
         watcher_name       = EXCLUDED.watcher_name,
         watcher_last_score = EXCLUDED.watcher_last_score,
         updated_at         = NOW()`,
      [code, watcherDeviceId, cleanedName, lastScore, targetDeviceId]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/contests/:code/watch', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/contests/:code/unwatch — מסלק watch מיידית.
app.post('/api/contests/:code/unwatch', softDeviceAuth, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const { watcherDeviceId, targetDeviceId } = req.body || {};

    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (typeof watcherDeviceId !== 'string' || watcherDeviceId.length < 8 || watcherDeviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (typeof targetDeviceId !== 'string' || targetDeviceId.length < 8 || targetDeviceId.length > 64) {
      return res.status(400).json({ error: 'bad_target' });
    }

    await pool.query(
      `DELETE FROM contest_watchers
       WHERE contest_code = $1
         AND watcher_device_id = $2
         AND target_device_id = $3`,
      [code, watcherDeviceId, targetDeviceId]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/contests/:code/unwatch', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// BLOOM CHALLENGES — public single-shot prize contests
// ============================================================

const CHALLENGE_TYPES = ['race', 'top_n', 'beat', 'first_to_tier'];

function cleanSlug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// Drops-vs-score sanity table. Calibrated against the BloomDebug bot's
// recorded games. Returns true if the score appears unreachable in the
// number of drops reported.
function challengeDropsImplausible(score, drops) {
  // Recalibrated for the exponential tier scoring + tier-up bonuses
  // introduced in the score-economy rebalance. Real games now produce
  // 2-3× higher scores per drop, so the old thresholds (50K / 25 drops)
  // would false-positive on legitimate skilled play. New thresholds
  // assume a strong player can reasonably hit ~100K in 25 drops by
  // chaining mid-tier merges + the +500/+1500 milestone bonuses.
  const tiers = [
    [100_000,   25],
    [200_000,   50],
    [500_000,  100],
    [1_500_000, 200],
    [3_000_000, 350]
  ];
  for (const [s, d] of tiers) {
    if (score >= s && drops < d) return true;
  }
  return false;
}

// Computes the z-score (vs. completed entries' scores) for one entry.
// Returns null if there's not enough data to be meaningful.
async function challengeZScore(challengeId, score) {
  const r = await pool.query(
    `SELECT AVG(score)::float AS m, COALESCE(STDDEV_SAMP(score), 0)::float AS s
     FROM challenge_entries
     WHERE challenge_id = $1 AND status IN ('completed','abandoned') AND score > 0`,
    [challengeId]
  );
  const m = r.rows[0].m;
  const s = r.rows[0].s;
  if (s == null || s <= 0) return null;
  return (score - m) / s;
}

// Map a DB challenge row to the public-facing summary shape.
function publicChallengeRow(c, myEntry, entriesCount, winnersFilled) {
  return {
    slug:           c.slug,
    name:           c.name,
    description:    c.description,
    challengeType:  c.challenge_type,
    thresholdScore: c.threshold_score,
    thresholdTier:  c.threshold_tier,
    winnersCount:   c.winners_count,
    prizeText:      c.prize_text,
    prizeImageUrl:  c.prize_image_url,
    startsAt:       c.starts_at,
    endsAt:         c.ends_at,
    status:         c.status,
    rulesText:      c.rules_text,
    entriesCount:   entriesCount | 0,
    winnersFilled:  winnersFilled | 0,
    myEntry:        myEntry || null
  };
}

// GET /api/challenges — list active + upcoming challenges that the public can see.
app.get('/api/challenges', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    const rows = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id)::int AS entries_count,
        (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id AND is_winner = TRUE)::int AS winners_filled
       FROM challenges c
       WHERE c.status IN ('active','draft')
         AND c.ends_at > NOW()
       ORDER BY (c.status = 'active') DESC, c.ends_at ASC`
    );
    let myEntries = new Map();
    if (deviceId && deviceId.length >= 8 && rows.rows.length) {
      const ids = rows.rows.map(r => r.id);
      const me = await pool.query(
        `SELECT challenge_id, score, highest_tier, status, is_winner, winner_rank, contact_at
         FROM challenge_entries WHERE device_id = $1 AND challenge_id = ANY($2::int[])`,
        [deviceId, ids]
      );
      for (const e of me.rows) myEntries.set(e.challenge_id, e);
    }
    const list = rows.rows
      .filter(c => c.status === 'active')  // draft challenges aren't shown publicly
      .map(c => publicChallengeRow(c, myEntries.get(c.id) || null, c.entries_count, c.winners_filled));
    res.json({ ok: true, challenges: list });
  } catch (e) {
    console.error('GET /api/challenges', e);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/challenges/history — past / ended challenges with winner info.
// Returns up to 50 most recently ended challenges, each with the winner names
// (top-3 by winner_rank) and this device's outcome (if they participated).
app.get('/api/challenges/history', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    const rows = await pool.query(
      `SELECT c.*,
         (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id)::int AS entries_count,
         (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id AND is_winner = TRUE)::int AS winners_filled
       FROM challenges c
       WHERE c.status IN ('ended','cancelled') OR c.ends_at <= NOW()
       ORDER BY c.ends_at DESC
       LIMIT 50`
    );
    if (!rows.rows.length) return res.json({ ok: true, challenges: [] });
    const ids = rows.rows.map(r => r.id);
    // Top winners per challenge
    const winnersRes = await pool.query(
      `SELECT challenge_id, display_name, score, winner_rank
       FROM challenge_entries
       WHERE challenge_id = ANY($1::int[]) AND is_winner = TRUE
       ORDER BY challenge_id, winner_rank ASC NULLS LAST`,
      [ids]
    );
    const winnersByChal = new Map();
    for (const w of winnersRes.rows) {
      if (!winnersByChal.has(w.challenge_id)) winnersByChal.set(w.challenge_id, []);
      const list = winnersByChal.get(w.challenge_id);
      if (list.length < 3) list.push({ name: w.display_name, score: w.score | 0, rank: w.winner_rank });
    }
    // My entries (if a deviceId is given)
    let myEntries = new Map();
    if (deviceId && deviceId.length >= 8) {
      const me = await pool.query(
        `SELECT challenge_id, score, highest_tier, status, is_winner, winner_rank, contact_at
         FROM challenge_entries WHERE device_id = $1 AND challenge_id = ANY($2::int[])`,
        [deviceId, ids]
      );
      for (const e of me.rows) myEntries.set(e.challenge_id, e);
    }
    const list = rows.rows.map(function(c) {
      const row = publicChallengeRow(c, myEntries.get(c.id) || null, c.entries_count, c.winners_filled);
      row.topWinners = winnersByChal.get(c.id) || [];
      return row;
    });
    res.json({ ok: true, challenges: list });
  } catch (e) {
    console.error('GET /api/challenges/history', e);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/challenges/:slug — single challenge detail + my entry + standings preview.
app.get('/api/challenges/:slug', async (req, res) => {
  try {
    const slug = cleanSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'bad_slug' });
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    const cr = await pool.query(`SELECT * FROM challenges WHERE slug = $1`, [slug]);
    if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
    const c = cr.rows[0];
    if (c.status === 'draft') return res.status(404).json({ error: 'not_found' });
    const countsRes = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = $1)::int AS entries_count,
         (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = $1 AND is_winner = TRUE)::int AS winners_filled`,
      [c.id]
    );
    const standings = await pool.query(
      `SELECT display_name, score, highest_tier, status, is_winner, winner_rank
       FROM challenge_entries WHERE challenge_id = $1
       ORDER BY (winner_rank IS NULL), winner_rank ASC, score DESC LIMIT 20`,
      [c.id]
    );
    let myEntry = null;
    if (deviceId && deviceId.length >= 8) {
      const me = await pool.query(
        `SELECT * FROM challenge_entries WHERE challenge_id = $1 AND device_id = $2`,
        [c.id, deviceId]
      );
      myEntry = me.rows[0] || null;
    }
    res.json({
      ok: true,
      challenge: publicChallengeRow(c, myEntry, countsRes.rows[0].entries_count, countsRes.rows[0].winners_filled),
      standings: standings.rows
    });
  } catch (e) {
    console.error('GET /api/challenges/:slug', e);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/challenges/:slug/enter — create the single attempt row.
app.post('/api/challenges/:slug/enter', requireDeviceAuth, async (req, res) => {
  try {
    const slug = cleanSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'bad_slug' });
    const { deviceId, displayName } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('challenge:enter', deviceId, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cleanedName = cleanDisplayName(displayName);
    if (!cleanedName || cleanedName === 'אנונימי') {
      return res.status(400).json({ error: 'bad_name' });
    }
    const cr = await pool.query(`SELECT * FROM challenges WHERE slug = $1`, [slug]);
    if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
    const c = cr.rows[0];
    if (c.status !== 'active') return res.status(403).json({ error: 'not_active' });
    if (new Date(c.starts_at) > new Date()) return res.status(403).json({ error: 'not_started' });
    if (new Date(c.ends_at) <= new Date())  return res.status(403).json({ error: 'ended' });
    // PK on (challenge_id, device_id) enforces single-attempt at the DB layer.
    try {
      await pool.query(
        `INSERT INTO challenge_entries (challenge_id, device_id, display_name)
         VALUES ($1, $2, $3)`,
        [c.id, deviceId, cleanedName]
      );
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'already_entered' });
      throw err;
    }
    res.json({
      ok: true,
      boardSeed:     c.board_seed,
      challengeType: c.challenge_type,
      thresholdScore: c.threshold_score,
      thresholdTier:  c.threshold_tier,
      winnersCount:  c.winners_count,
      prizeText:     c.prize_text
    });
  } catch (e) {
    console.error('POST /api/challenges/:slug/enter', e);
    res.status(500).json({ error: 'server' });
  }
});

// Internal: race-safe winner-slot grab. Returns winnerRank if this entry just
// won, or null if no slot was taken. Caller decides whether to set the
// reached_*_at timestamp.
async function maybeGrabWinnerSlot(client, challengeId, deviceId, eventColumn) {
  // FOR UPDATE locks the challenges row so two players can't both pass the
  // gating check simultaneously and overflow winners_count.
  const ch = await client.query(`SELECT id, winners_count FROM challenges WHERE id = $1 FOR UPDATE`, [challengeId]);
  if (!ch.rows.length) return null;
  const winnersCount = ch.rows[0].winners_count | 0;
  const won = await client.query(
    `SELECT COUNT(*)::int AS c FROM challenge_entries WHERE challenge_id = $1 AND is_winner = TRUE`,
    [challengeId]
  );
  const filled = won.rows[0].c | 0;
  if (filled >= winnersCount) return null;
  const nextRank = filled + 1;
  const upd = await client.query(
    `UPDATE challenge_entries
     SET is_winner = TRUE, winner_rank = $1, ${eventColumn} = NOW()
     WHERE challenge_id = $2 AND device_id = $3 AND is_winner = FALSE
     RETURNING winner_rank`,
    [nextRank, challengeId, deviceId]
  );
  if (!upd.rows.length) return null;
  return nextRank;
}

// POST /api/challenges/:slug/score — heartbeat per drop. score-only-grows.
app.post('/api/challenges/:slug/score', requireDeviceAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const slug = cleanSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'bad_slug' });
    const { deviceId, score, tier, drops, token } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (token && !verifyDeviceToken(deviceId, token)) {
      return res.status(403).json({ error: 'bad_token' });
    }
    if (!checkRateLimit('challenge:score', deviceId, 600, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 0 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    // drops becomes required here so the partial-state heartbeats can be
    // sanity-checked too. Pre-existing /score paths that omitted drops are
    // refused — clients must send it (the frontend already does).
    if (typeof drops !== 'number' || !Number.isFinite(drops) || drops < 0) {
      return res.status(400).json({ error: 'missing_drops' });
    }
    const dropsN = Math.floor(drops);

    const cr = await client.query(`SELECT * FROM challenges WHERE slug = $1`, [slug]);
    if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
    const c = cr.rows[0];
    if (c.status !== 'active') return res.status(403).json({ error: 'not_active' });

    const er = await client.query(
      `UPDATE challenge_entries
       SET score = GREATEST(score, $1),
           highest_tier = GREATEST(highest_tier, $2),
           drops_count = GREATEST(drops_count, $3)
       WHERE challenge_id = $4 AND device_id = $5 AND status = 'in_progress'
       RETURNING *`,
      [Math.floor(score), Math.floor(tier), dropsN, c.id, deviceId]
    );
    if (!er.rows.length) return res.status(409).json({ error: 'no_active_entry' });
    const entry = er.rows[0];

    let wonNow = null;
    // Race & first_to_tier check for winner slot eagerly so the threshold-crossing player
    // is rewarded in real time. Beat marks at /complete. Top_N marks at admin /finalize.
    if (c.challenge_type === 'race' && c.threshold_score != null
        && entry.score >= c.threshold_score && entry.reached_threshold_at == null) {
      await client.query('BEGIN');
      try {
        wonNow = await maybeGrabWinnerSlot(client, c.id, deviceId, 'reached_threshold_at');
        // If the slot was full, at least record the crossing time for analytics.
        if (wonNow == null) {
          await client.query(
            `UPDATE challenge_entries SET reached_threshold_at = COALESCE(reached_threshold_at, NOW())
             WHERE challenge_id = $1 AND device_id = $2`,
            [c.id, deviceId]
          );
        }
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; }
    } else if (c.challenge_type === 'first_to_tier' && c.threshold_tier != null
        && entry.highest_tier >= c.threshold_tier && entry.reached_tier_at == null) {
      await client.query('BEGIN');
      try {
        wonNow = await maybeGrabWinnerSlot(client, c.id, deviceId, 'reached_tier_at');
        if (wonNow == null) {
          await client.query(
            `UPDATE challenge_entries SET reached_tier_at = COALESCE(reached_tier_at, NOW())
             WHERE challenge_id = $1 AND device_id = $2`,
            [c.id, deviceId]
          );
        }
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; }
    }

    res.json({ ok: true, score: entry.score | 0, tier: entry.highest_tier | 0, isWinner: wonNow != null, winnerRank: wonNow });
  } catch (e) {
    console.error('POST /api/challenges/:slug/score', e);
    res.status(500).json({ error: 'server' });
  } finally {
    client.release();
  }
});

// POST /api/challenges/:slug/complete — final submit. Locks the entry.
app.post('/api/challenges/:slug/complete', requireDeviceAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const slug = cleanSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'bad_slug' });
    const { deviceId, score, tier, drops, token } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (token && !verifyDeviceToken(deviceId, token)) {
      return res.status(403).json({ error: 'bad_token' });
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 0 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    if (typeof drops !== 'number' || !Number.isFinite(drops) || drops < 0) {
      return res.status(400).json({ error: 'missing_drops' });
    }
    const dropsN = Math.floor(drops);

    const cr = await client.query(`SELECT * FROM challenges WHERE slug = $1`, [slug]);
    if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
    const c = cr.rows[0];

    // Lock the entry to 'completed' atomically. Anti-cheat sanity check runs here.
    const finalScore = Math.floor(score);
    const finalTier  = Math.floor(tier);
    const cheatByDrops = challengeDropsImplausible(finalScore, dropsN);

    const er = await client.query(
      `UPDATE challenge_entries
       SET score = GREATEST(score, $1),
           highest_tier = GREATEST(highest_tier, $2),
           drops_count = GREATEST(drops_count, $3),
           status = 'completed',
           completed_at = NOW(),
           cheat_flag = cheat_flag OR $4
       WHERE challenge_id = $5 AND device_id = $6 AND status = 'in_progress'
       RETURNING *`,
      [finalScore, finalTier, dropsN, cheatByDrops, c.id, deviceId]
    );
    if (!er.rows.length) return res.status(409).json({ error: 'no_active_entry' });
    const entry = er.rows[0];

    // Z-score outlier check (uses other completed entries as the baseline).
    const z = await challengeZScore(c.id, entry.score);
    if (z != null && z > 3) {
      await client.query(
        `UPDATE challenge_entries SET cheat_flag = TRUE WHERE challenge_id = $1 AND device_id = $2`,
        [c.id, deviceId]
      );
    }

    // For "beat" type, mark winner immediately if threshold met. No cap on winners.
    // Wrapped in transaction to prevent duplicate winner_rank under concurrency.
    let isWinner = entry.is_winner;
    let winnerRank = entry.winner_rank;
    if (c.challenge_type === 'beat' && c.threshold_score != null && entry.score >= c.threshold_score && !isWinner) {
      await client.query('BEGIN');
      try {
        const w = await client.query(
          `UPDATE challenge_entries SET is_winner = TRUE,
                  winner_rank = (SELECT COUNT(*)+1 FROM challenge_entries WHERE challenge_id = $1 AND is_winner = TRUE),
                  reached_threshold_at = COALESCE(reached_threshold_at, NOW())
           WHERE challenge_id = $1 AND device_id = $2 AND is_winner = FALSE
           RETURNING is_winner, winner_rank`,
          [c.id, deviceId]
        );
        if (w.rows.length) { isWinner = true; winnerRank = w.rows[0].winner_rank; }
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; }
    }

    // Compute rank in completed entries (for non-winners to see where they stand).
    const rk = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM challenge_entries
            WHERE challenge_id = $1 AND status IN ('completed','abandoned') AND score > $2)::int + 1 AS rank,
         (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = $1)::int AS total`,
      [c.id, entry.score]
    );

    res.json({
      ok: true,
      finalScore: entry.score | 0,
      finalTier:  entry.highest_tier | 0,
      isWinner: !!isWinner,
      winnerRank: winnerRank,
      rank: rk.rows[0].rank | 0,
      totalEntries: rk.rows[0].total | 0,
      cheatFlag: !!entry.cheat_flag || (z != null && z > 3),
      challengeType: c.challenge_type,
      thresholdScore: c.threshold_score
    });
  } catch (e) {
    console.error('POST /api/challenges/:slug/complete', e);
    res.status(500).json({ error: 'server' });
  } finally {
    client.release();
  }
});

// POST /api/challenges/:slug/claim — winner submits contact info.
app.post('/api/challenges/:slug/claim', requireDeviceAuth, async (req, res) => {
  try {
    const slug = cleanSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'bad_slug' });
    const { deviceId, contactName, contactPhone, contactEmail } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('challenge:claim', deviceId, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const name  = String(contactName  || '').trim().slice(0, 80);
    const phone = String(contactPhone || '').trim().slice(0, 40);
    const email = String(contactEmail || '').trim().slice(0, 120);
    if (!name)  return res.status(400).json({ error: 'bad_name' });
    if (!phone && !email) return res.status(400).json({ error: 'no_contact' });
    if (email && !email.includes('@')) return res.status(400).json({ error: 'bad_email' });
    const cr = await pool.query(`SELECT id FROM challenges WHERE slug = $1`, [slug]);
    if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
    const r = await pool.query(
      `UPDATE challenge_entries
       SET contact_name = $1, contact_phone = $2, contact_email = $3, contact_at = NOW()
       WHERE challenge_id = $4 AND device_id = $5 AND is_winner = TRUE AND contact_at IS NULL
       RETURNING 1`,
      [name, phone, email, cr.rows[0].id, deviceId]
    );
    if (!r.rows.length) return res.status(409).json({ error: 'not_winner_or_already_claimed' });
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/challenges/:slug/claim', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// VISIT PING (ניתוח ביקורים)
// ============================================================
// POST /api/ping — שורה אחת לכל (device, date). אם השורה כבר קיימת,
// מקדם visit_count ו-last_at. שימוש: ה-frontend קורא פעם אחת ב-init().

app.post('/api/ping', softDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    // Rate limit: 30/hour/device. The frontend only calls once per init(),
    // but a chatty refresher tab could spam — guard.
    if (!checkRateLimit('ping', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    await pool.query(
      `INSERT INTO device_visits (device_id, date)
       VALUES ($1, CURRENT_DATE)
       ON CONFLICT (device_id, date) DO UPDATE SET
         visit_count = device_visits.visit_count + 1,
         last_at     = NOW()`,
      [deviceId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/ping', e);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// ADMIN ROUTES (כל המסלולים מוגנים ב-requireAdmin)
// ============================================================

if (ADMIN_PATH && ADMIN_PASSWORD) {
  const adminRouter = express.Router();
  adminRouter.use(requireAdmin);

  // Static admin app — single file mirroring public/index.html pattern.
  adminRouter.use(express.static('admin', { maxAge: 0, extensions: ['html'] }));

  // ---------- DASHBOARD ----------
  // One round-trip returns every headline number the admin UI needs at boot.
  adminRouter.get('/api/dashboard', async (_req, res) => {
    try {
      const today = await pool.query(`SELECT CURRENT_DATE AS d`);
      const todayStr = today.rows[0].d.toISOString().slice(0, 10);

      // DAU/WAU/MAU from device_visits (true active = visited).
      const dauRes = await pool.query(
        `SELECT
           (SELECT COUNT(DISTINCT device_id) FROM device_visits WHERE date = CURRENT_DATE)         AS dau,
           (SELECT COUNT(DISTINCT device_id) FROM device_visits
             WHERE date >= CURRENT_DATE - INTERVAL '6 days')                                       AS wau,
           (SELECT COUNT(DISTINCT device_id) FROM device_visits
             WHERE date >= CURRENT_DATE - INTERVAL '29 days')                                      AS mau,
           (SELECT COUNT(*) FROM device_visits WHERE date = CURRENT_DATE
              AND device_id NOT IN (SELECT device_id FROM device_visits WHERE date < CURRENT_DATE)) AS new_today,
           (SELECT COUNT(*) FROM daily_scores WHERE date = CURRENT_DATE)                            AS games_today,
           (SELECT COUNT(*) FROM contests WHERE ends_at > NOW())                                    AS contests_active`
      );
      const k = dauRes.rows[0];

      // DAU 30-day sparkline data.
      const sparkRes = await pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day')::date AS d
         )
         SELECT d, COALESCE(COUNT(DISTINCT dv.device_id), 0) AS dau
         FROM days
         LEFT JOIN device_visits dv ON dv.date = days.d
         GROUP BY d
         ORDER BY d ASC`
      );
      const sparkline = sparkRes.rows.map(r => ({ date: r.d.toISOString().slice(0, 10), dau: r.dau | 0 }));

      // D1 retention — yesterday's first-visit cohort, who came back today.
      const d1Res = await pool.query(
        `WITH yesterday_first AS (
           SELECT device_id FROM device_visits dv
           WHERE date = CURRENT_DATE - INTERVAL '1 day'
             AND NOT EXISTS (
               SELECT 1 FROM device_visits dv2
               WHERE dv2.device_id = dv.device_id AND dv2.date < dv.date
             )
         )
         SELECT
           (SELECT COUNT(*) FROM yesterday_first)                                         AS cohort_size,
           (SELECT COUNT(*) FROM yesterday_first
              WHERE device_id IN (SELECT device_id FROM device_visits WHERE date = CURRENT_DATE)) AS returned`
      );
      const d1Cohort = parseInt(d1Res.rows[0].cohort_size, 10) || 0;
      const d1Returned = parseInt(d1Res.rows[0].returned, 10) || 0;
      const d1Pct = d1Cohort > 0 ? Math.round(1000 * d1Returned / d1Cohort) / 10 : null;

      // Anomaly flag: DAU vs 7-day rolling avg (excluding today).
      const baselineRes = await pool.query(
        `SELECT AVG(c)::float AS avg7 FROM (
           SELECT COUNT(DISTINCT device_id) AS c
           FROM device_visits
           WHERE date BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE - INTERVAL '1 day'
           GROUP BY date
         ) t`
      );
      const baseline = parseFloat(baselineRes.rows[0].avg7 || 0);
      const dauToday = k.dau | 0;
      let anomaly = null;
      if (baseline >= 5 && dauToday < baseline * 0.7) {
        anomaly = {
          severity: 'warn',
          message: 'DAU היום ' + dauToday + ' — צניחה של ' +
            Math.round(100 * (1 - dauToday / baseline)) + '% מהממוצע של 7 ימים (' +
            Math.round(baseline) + ')'
        };
      }

      res.json({
        ok: true,
        today: todayStr,
        kpis: {
          dau: dauToday,
          wau: k.wau | 0,
          mau: k.mau | 0,
          newToday: k.new_today | 0,
          gamesToday: k.games_today | 0,
          contestsActive: k.contests_active | 0,
          d1Pct, d1Cohort, d1Returned
        },
        benchmarks: { d1: 40, d7: 20, d30: 7 },  // 2026 hybrid-casual medians
        sparkline,
        anomaly
      });
    } catch (e) {
      console.error('admin /dashboard', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- RETENTION (cohorts) ----------
  adminRouter.get('/api/retention', async (_req, res) => {
    try {
      // Weekly cohorts (first-visit week) × D1/D7/D30 returns.
      // Last 8 weeks. A cohort with size < 3 is reported but flagged.
      const rows = await pool.query(
        `WITH first_visit AS (
           SELECT device_id, MIN(date) AS first_date
           FROM device_visits
           GROUP BY device_id
         ),
         cohort AS (
           SELECT date_trunc('week', first_date)::date AS week, device_id, first_date
           FROM first_visit
           WHERE first_date >= CURRENT_DATE - INTERVAL '8 weeks'
         )
         SELECT
           c.week,
           COUNT(*)::int AS size,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM device_visits v
             WHERE v.device_id = c.device_id AND v.date = c.first_date + 1
           ))::int AS d1,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM device_visits v
             WHERE v.device_id = c.device_id AND v.date = c.first_date + 7
           ))::int AS d7,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM device_visits v
             WHERE v.device_id = c.device_id AND v.date = c.first_date + 30
           ))::int AS d30
         FROM cohort c
         GROUP BY c.week
         ORDER BY c.week DESC`
      );
      const list = rows.rows.map(r => ({
        weekStart: r.week.toISOString().slice(0, 10),
        size: r.size,
        d1: r.size ? Math.round(1000 * r.d1 / r.size) / 10 : null,
        d7: r.size ? Math.round(1000 * r.d7 / r.size) / 10 : null,
        d30: r.size ? Math.round(1000 * r.d30 / r.size) / 10 : null
      }));
      res.json({ ok: true, cohorts: list });
    } catch (e) {
      console.error('admin /retention', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- FUNNEL ----------
  adminRouter.get('/api/funnel', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(60, parseInt(req.query.days, 10) || 7));
      const result = await pool.query(
        `WITH window_visits AS (
           SELECT DISTINCT device_id FROM device_visits
           WHERE date >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
         ),
         played AS (
           SELECT DISTINCT device_id FROM daily_scores
           WHERE date >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
         ),
         completed AS (
           SELECT DISTINCT device_id FROM daily_scores
           WHERE date >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day' AND score > 0
         ),
         returned AS (
           SELECT DISTINCT v.device_id FROM device_visits v
           JOIN device_visits v2 ON v2.device_id = v.device_id AND v2.date = v.date + 1
           WHERE v.date >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
         )
         SELECT
           (SELECT COUNT(*) FROM window_visits)::int AS visited,
           (SELECT COUNT(*) FROM played)::int        AS played,
           (SELECT COUNT(*) FROM completed)::int     AS completed,
           (SELECT COUNT(*) FROM returned)::int      AS returned_next_day`,
        [days]
      );
      res.json({ ok: true, days, funnel: result.rows[0] });
    } catch (e) {
      console.error('admin /funnel', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- HEATMAP ----------
  adminRouter.get('/api/heatmap', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 30));
      // game-overs from daily_scores.updated_at, converted to Asia/Jerusalem.
      const result = await pool.query(
        `SELECT
           EXTRACT(DOW  FROM updated_at AT TIME ZONE 'Asia/Jerusalem')::int AS dow,
           EXTRACT(HOUR FROM updated_at AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
           COUNT(*)::int AS games
         FROM daily_scores
         WHERE updated_at >= NOW() - $1::int * INTERVAL '1 day'
         GROUP BY dow, hour
         ORDER BY dow, hour`,
        [days]
      );
      // Fill the 7×24 grid.
      const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
      for (const r of result.rows) grid[r.dow][r.hour] = r.games;
      res.json({ ok: true, days, grid });
    } catch (e) {
      console.error('admin /heatmap', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- TOP SCORES + Z-SCORE OUTLIERS ----------
  adminRouter.get('/api/top-scores', async (req, res) => {
    try {
      const date = isValidDate(req.query.date) ? req.query.date : null;
      const params = date ? [date] : [];
      const dateClause = date ? 'WHERE date = $1' : 'WHERE date = CURRENT_DATE';
      const result = await pool.query(
        `WITH stats AS (
           SELECT AVG(score)::float AS m, COALESCE(STDDEV_SAMP(score), 0)::float AS s
           FROM daily_scores ${dateClause} AND score > 0
         )
         SELECT ds.name, ds.score, ds.tier, ds.device_id, ds.date, ds.updated_at,
                CASE WHEN s.s > 0 THEN ROUND(((ds.score - s.m) / s.s)::numeric, 2)::float ELSE 0 END AS zscore,
                CASE WHEN s.s > 0 AND (ds.score - s.m) / s.s > 3 THEN true ELSE false END AS outlier
         FROM daily_scores ds CROSS JOIN stats s
         ${dateClause}
         ORDER BY ds.score DESC
         LIMIT 50`,
        params
      );
      res.json({ ok: true, date: date || null, scores: result.rows });
    } catch (e) {
      console.error('admin /top-scores', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- CONTESTS ----------
  adminRouter.get('/api/contests', async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT c.code, c.name, c.host_name, c.host_device_id, c.board_type,
                c.duration_days, c.ends_at, c.status, c.created_at,
                COALESCE(c.contest_type, 'private') as contest_type,
                (SELECT COUNT(*) FROM contest_scores WHERE contest_code = c.code)::int AS members,
                (SELECT MAX(score) FROM contest_scores WHERE contest_code = c.code)    AS top_score
         FROM contests c
         ORDER BY (c.ends_at > NOW()) DESC, c.ends_at DESC`
      );
      res.json({ ok: true, contests: result.rows });
    } catch (e) {
      console.error('admin /contests', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // PATCH contest — change name / end / extend
  adminRouter.patch('/api/contest/:code', async (req, res) => {
    try {
      const code = String(req.params.code || '').toUpperCase().slice(0, 8);
      const { name, endsAt, status } = req.body || {};
      if (!code) return res.status(400).json({ error: 'bad_code' });
      const sets = [], values = [code];
      if (typeof name === 'string') {
        const n = cleanContestName(name);
        if (!n) return res.status(400).json({ error: 'bad_name' });
        sets.push('name = $' + (values.length + 1)); values.push(n);
      }
      if (typeof endsAt === 'string') {
        const d = new Date(endsAt);
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'bad_ends_at' });
        sets.push('ends_at = $' + (values.length + 1)); values.push(d);
      }
      if (typeof status === 'string') {
        if (!['active', 'paused', 'ended'].includes(status)) return res.status(400).json({ error: 'bad_status' });
        sets.push('status = $' + (values.length + 1)); values.push(status);
      }
      if (!sets.length) return res.status(400).json({ error: 'no_changes' });
      const r = await pool.query(
        `UPDATE contests SET ${sets.join(', ')} WHERE code = $1 RETURNING *`,
        values
      );
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      await logAdminAction('contest.patch', 'contest', code, { fields: { name, endsAt, status } });
      res.json({ ok: true, contest: r.rows[0] });
    } catch (e) {
      console.error('admin PATCH /contest', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // DELETE contest — cascade through scores/live state via FK ON DELETE CASCADE.
  adminRouter.delete('/api/contest/:code', async (req, res) => {
    try {
      const code = String(req.params.code || '').toUpperCase().slice(0, 8);
      const r = await pool.query(`DELETE FROM contests WHERE code = $1 RETURNING name`, [code]);
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      await logAdminAction('contest.delete', 'contest', code, { name: r.rows[0].name });
      res.json({ ok: true });
    } catch (e) {
      console.error('admin DELETE /contest', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- PLAYERS ----------
  adminRouter.get('/api/players', async (req, res) => {
    try {
      const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10)  || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const q      = String(req.query.q || '').trim();
      const params = [limit, offset];
      let where = '';
      if (q) {
        params.push('%' + q + '%');
        const i = params.length;
        // Match on display name (daily_scores), device_id, player_code, or profile display_name
        where = `WHERE ds.name ILIKE $${i} OR ds.device_id ILIKE $${i} OR pp.player_code ILIKE $${i} OR pp.display_name ILIKE $${i}`;
      }
      const rows = await pool.query(
        `SELECT
           ds.device_id,
           COALESCE(pp.display_name, MAX(ds.name)) AS name,
           pp.player_code                          AS player_code,
           pp.country                              AS country,
           COUNT(*)::int                           AS games_played,
           MAX(ds.score)                           AS best_score,
           MAX(ds.tier)                            AS best_tier,
           MIN(ds.date)                            AS first_played,
           MAX(ds.date)                            AS last_played
         FROM daily_scores ds
         LEFT JOIN player_profiles pp ON pp.device_id = ds.device_id
         ${where}
         GROUP BY ds.device_id, pp.display_name, pp.player_code, pp.country
         ORDER BY last_played DESC
         LIMIT $1 OFFSET $2`,
        params
      );
      const total = await pool.query(
        `SELECT COUNT(DISTINCT ds.device_id)::int AS c
         FROM daily_scores ds
         LEFT JOIN player_profiles pp ON pp.device_id = ds.device_id
         ${where}`,
        q ? [params[2]] : []
      );
      res.json({ ok: true, players: rows.rows, total: total.rows[0].c });
    } catch (e) {
      console.error('admin /players', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // Single-player drill-down.
  adminRouter.get('/api/player/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').slice(0, 64);
      if (!id) return res.status(400).json({ error: 'bad_id' });
      const scores = await pool.query(
        `SELECT date, score, tier, updated_at FROM daily_scores WHERE device_id = $1 ORDER BY date DESC LIMIT 50`,
        [id]
      );
      const contests = await pool.query(
        `SELECT cs.contest_code, c.name AS contest_name, cs.display_name, cs.score, cs.highest_tier,
                cs.games_played, cs.last_played_at
         FROM contest_scores cs JOIN contests c ON c.code = cs.contest_code
         WHERE cs.device_id = $1
         ORDER BY cs.last_played_at DESC`,
        [id]
      );
      const visits = await pool.query(
        `SELECT date, visit_count FROM device_visits WHERE device_id = $1 ORDER BY date DESC LIMIT 90`,
        [id]
      );
      res.json({
        ok: true,
        deviceId: id,
        scores: scores.rows,
        contests: contests.rows,
        visits: visits.rows
      });
    } catch (e) {
      console.error('admin /player/:id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // DELETE player — cascades manually since daily_scores has no FK back.
  adminRouter.delete('/api/player/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').slice(0, 64);
      if (!id) return res.status(400).json({ error: 'bad_id' });
      const meta = {};
      const c1 = await pool.query('DELETE FROM daily_scores   WHERE device_id = $1 RETURNING 1', [id]);
      const c2 = await pool.query('DELETE FROM contest_scores WHERE device_id = $1 RETURNING 1', [id]);
      const c3 = await pool.query('DELETE FROM device_visits  WHERE device_id = $1 RETURNING 1', [id]);
      const c4 = await pool.query('DELETE FROM contest_live_state WHERE device_id = $1 RETURNING 1', [id]);
      const c5 = await pool.query('DELETE FROM contest_watchers  WHERE watcher_device_id = $1 OR target_device_id = $1 RETURNING 1', [id]);
      meta.deletions = {
        daily_scores: c1.rowCount, contest_scores: c2.rowCount,
        device_visits: c3.rowCount, contest_live_state: c4.rowCount, contest_watchers: c5.rowCount
      };
      await logAdminAction('player.delete', 'player', id, meta);
      res.json({ ok: true, deletions: meta.deletions });
    } catch (e) {
      console.error('admin DELETE /player', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- AUDIT LOG ----------
  adminRouter.get('/api/audit', async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
      const rows = await pool.query(
        `SELECT id, action, target_type, target_id, metadata, created_at
         FROM admin_actions ORDER BY id DESC LIMIT $1`,
        [limit]
      );
      res.json({ ok: true, actions: rows.rows });
    } catch (e) {
      console.error('admin /audit', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- PRIVACY — manual PII purge for challenge winners ----------
  // Wipes contact_* on challenge entries whose prize was claimed >90d ago.
  // The 24h interval below runs the same query automatically; this endpoint
  // lets admins trigger it on demand and surfaces the row count.
  adminRouter.post('/api/privacy/purge', async (_req, res) => {
    try {
      const r = await pool.query(
        `UPDATE challenge_entries
           SET contact_name = NULL, contact_phone = NULL, contact_email = NULL
         WHERE prize_claimed_at IS NOT NULL
           AND prize_claimed_at < NOW() - INTERVAL '90 days'
           AND (contact_name IS NOT NULL OR contact_phone IS NOT NULL OR contact_email IS NOT NULL)`
      );
      await logAdminAction('privacy.purge', null, null, { rows: r.rowCount });
      res.json({ ok: true, purged: r.rowCount });
    } catch (e) {
      console.error('admin /privacy/purge', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- LIVE — what's happening right now ----------
  adminRouter.get('/api/live', async (_req, res) => {
    try {
      // Contest live state (existing)
      const live = await pool.query(
        `SELECT ls.contest_code, ls.device_id, ls.display_name, ls.live_score, ls.highest_tier, ls.updated_at, c.name AS contest_name
         FROM contest_live_state ls JOIN contests c ON c.code = ls.contest_code
         WHERE ls.updated_at > NOW() - INTERVAL '60 seconds'
         ORDER BY ls.live_score DESC`
      );
      // All active players from heartbeat (daily, practice, contest, challenge)
      const heartbeat = await pool.query(
        `SELECT device_id, display_name, mode, score, highest_tier, updated_at
         FROM player_heartbeat
         WHERE updated_at > NOW() - INTERVAL '20 seconds'
         ORDER BY score DESC`
      );
      const watchers = await pool.query(
        `SELECT contest_code, watcher_name, target_device_id, watcher_last_score, updated_at
         FROM contest_watchers
         WHERE updated_at > NOW() - INTERVAL '60 seconds'
         ORDER BY updated_at DESC`
      );
      res.json({ ok: true, live: live.rows, heartbeat: heartbeat.rows, watchers: watchers.rows });
    } catch (e) {
      console.error('admin /live', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- CHALLENGES ----------
  adminRouter.get('/api/challenges', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT c.*,
           (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id)::int                  AS entries_count,
           (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id AND is_winner = TRUE)::int AS winners_filled,
           (SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = c.id AND cheat_flag = TRUE)::int AS cheat_count
         FROM challenges c
         ORDER BY (c.status = 'active') DESC, c.created_at DESC`
      );
      res.json({ ok: true, challenges: r.rows });
    } catch (e) {
      console.error('admin /challenges', e);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.post('/api/challenges', async (req, res) => {
    try {
      const b = req.body || {};
      // Hebrew-only names cleanSlug to "" — fall back to a generated slug so
      // the admin doesn't need to pick an ASCII slug for every contest.
      let slug = cleanSlug(b.slug || b.name || '');
      if (!slug || slug.length < 3) {
        slug = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      }
      const name = cleanContestName(b.name);
      if (!name) return res.status(400).json({ error: 'bad_name' });
      const type = b.challenge_type;
      if (!CHALLENGE_TYPES.includes(type)) return res.status(400).json({ error: 'bad_type' });
      const winners = Math.max(1, Math.min(100, parseInt(b.winners_count, 10) || 1));
      const prizeText = String(b.prize_text || '').trim().slice(0, 200);
      if (!prizeText) return res.status(400).json({ error: 'bad_prize' });
      const prizeImageUrl = b.prize_image_url ? String(b.prize_image_url).trim().slice(0, 500) : null;
      if (prizeImageUrl && !/^https?:\/\//i.test(prizeImageUrl)) return res.status(400).json({ error: 'bad_image_url' });
      let thresholdScore = null, thresholdTier = null;
      if (type === 'race' || type === 'beat') {
        thresholdScore = parseInt(b.threshold_score, 10);
        if (!Number.isFinite(thresholdScore) || thresholdScore < 100 || thresholdScore > 10_000_000) {
          return res.status(400).json({ error: 'bad_threshold_score' });
        }
      } else if (type === 'first_to_tier') {
        thresholdTier = parseInt(b.threshold_tier, 10);
        if (!Number.isFinite(thresholdTier) || thresholdTier < 2 || thresholdTier > 8) {
          return res.status(400).json({ error: 'bad_threshold_tier' });
        }
      }
      const startsAt = b.starts_at ? new Date(b.starts_at) : new Date();
      const endsAt   = b.ends_at   ? new Date(b.ends_at)   : null;
      if (!endsAt || isNaN(endsAt.getTime())) return res.status(400).json({ error: 'bad_ends_at' });
      if (endsAt <= startsAt) return res.status(400).json({ error: 'ends_before_starts' });
      const rulesText = b.rules_text ? String(b.rules_text).trim() : null;
      const boardSeed = b.board_seed != null && Number.isFinite(parseInt(b.board_seed, 10))
        ? parseInt(b.board_seed, 10) : Math.floor(Math.random() * 2147483647);
      const status = b.status === 'active' ? 'active' : 'draft';

      const r = await pool.query(
        `INSERT INTO challenges (slug, name, description, challenge_type, threshold_score, threshold_tier,
                                 winners_count, prize_text, prize_image_url, board_seed, starts_at, ends_at, rules_text, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [slug, name, b.description || null, type, thresholdScore, thresholdTier,
         winners, prizeText, prizeImageUrl, boardSeed, startsAt, endsAt, rulesText, status]
      );
      await logAdminAction('challenge.create', 'challenge', String(r.rows[0].id), { slug, name, type });
      res.json({ ok: true, challenge: r.rows[0] });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'slug_taken' });
      console.error('admin POST /challenges', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // Lock-down rules: once entries exist + starts_at passed, only "cosmetic"
  // fields are editable. Hard-mode fields (type, thresholds, winners_count)
  // would change the game mid-flight.
  const LOCKED_FIELDS = new Set(['challenge_type', 'threshold_score', 'threshold_tier', 'winners_count', 'starts_at', 'board_seed']);
  const SAFE_FIELDS   = new Set(['name', 'description', 'prize_text', 'prize_image_url', 'rules_text', 'ends_at', 'status']);

  adminRouter.patch('/api/challenges/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
      const cr = await pool.query(`SELECT * FROM challenges WHERE id = $1`, [id]);
      if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
      const current = cr.rows[0];
      const entriesRes = await pool.query(`SELECT COUNT(*)::int AS c FROM challenge_entries WHERE challenge_id = $1`, [id]);
      const hasEntries = (entriesRes.rows[0].c | 0) > 0;
      const startsHasPassed = new Date(current.starts_at) <= new Date();
      const locked = hasEntries && startsHasPassed;
      const b = req.body || {};
      const sets = [], values = [id];
      const apply = (col, val) => { sets.push(col + ' = $' + (values.length + 1)); values.push(val); };
      for (const k of Object.keys(b)) {
        if (locked && LOCKED_FIELDS.has(k)) {
          return res.status(409).json({ error: 'challenge_locked', field: k });
        }
        if (!LOCKED_FIELDS.has(k) && !SAFE_FIELDS.has(k)) continue;
        // Per-field validation when changing locked fields on a draft (allowed).
        if (k === 'name')             { const v = cleanContestName(b[k]); if (!v) return res.status(400).json({error:'bad_name'}); apply('name', v); }
        else if (k === 'description') { apply('description', b[k] ? String(b[k]).trim() : null); }
        else if (k === 'prize_text')  { const v = String(b[k]||'').trim().slice(0,200); if (!v) return res.status(400).json({error:'bad_prize'}); apply('prize_text', v); }
        else if (k === 'prize_image_url') {
          const v = b[k] ? String(b[k]).trim().slice(0,500) : null;
          if (v && !/^https?:\/\//i.test(v)) return res.status(400).json({error:'bad_image_url'});
          apply('prize_image_url', v);
        }
        else if (k === 'rules_text')  { apply('rules_text', b[k] ? String(b[k]).trim() : null); }
        else if (k === 'ends_at') {
          const d = new Date(b[k]); if (isNaN(d.getTime())) return res.status(400).json({error:'bad_ends_at'});
          // If already locked, only allow extending (can't cut the contest short on players).
          if (locked && d < new Date(current.ends_at)) return res.status(409).json({error:'cannot_shorten'});
          apply('ends_at', d);
        }
        else if (k === 'status') {
          if (!['draft','active','ended','cancelled'].includes(b[k])) return res.status(400).json({error:'bad_status'});
          apply('status', b[k]);
        }
        else if (k === 'starts_at') {
          const d = new Date(b[k]); if (isNaN(d.getTime())) return res.status(400).json({error:'bad_starts_at'});
          apply('starts_at', d);
        }
        else if (k === 'challenge_type') {
          if (!CHALLENGE_TYPES.includes(b[k])) return res.status(400).json({error:'bad_type'});
          apply('challenge_type', b[k]);
        }
        else if (k === 'threshold_score') {
          const v = parseInt(b[k], 10);
          if (!Number.isFinite(v) || v < 100 || v > 10_000_000) return res.status(400).json({error:'bad_threshold_score'});
          apply('threshold_score', v);
        }
        else if (k === 'threshold_tier') {
          const v = parseInt(b[k], 10);
          if (!Number.isFinite(v) || v < 2 || v > 8) return res.status(400).json({error:'bad_threshold_tier'});
          apply('threshold_tier', v);
        }
        else if (k === 'winners_count') {
          const v = parseInt(b[k], 10);
          if (!Number.isFinite(v) || v < 1 || v > 100) return res.status(400).json({error:'bad_winners_count'});
          apply('winners_count', v);
        }
        else if (k === 'board_seed') {
          const v = parseInt(b[k], 10);
          if (!Number.isFinite(v)) return res.status(400).json({error:'bad_board_seed'});
          apply('board_seed', v);
        }
      }
      if (!sets.length) return res.status(400).json({ error: 'no_changes' });
      sets.push('updated_at = NOW()');
      const r = await pool.query(`UPDATE challenges SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
      await logAdminAction('challenge.patch', 'challenge', String(id), { fields: Object.keys(b) });
      res.json({ ok: true, challenge: r.rows[0] });
    } catch (e) {
      console.error('admin PATCH /challenges/:id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.delete('/api/challenges/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
      const r = await pool.query(`DELETE FROM challenges WHERE id = $1 RETURNING slug, name`, [id]);
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      await logAdminAction('challenge.delete', 'challenge', String(id), { slug: r.rows[0].slug, name: r.rows[0].name });
      res.json({ ok: true });
    } catch (e) {
      console.error('admin DELETE /challenges/:id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // Full entries list for a challenge — admin sees everything including contact info + cheat flag.
  adminRouter.get('/api/challenges/:id/entries', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
      const cr = await pool.query(`SELECT * FROM challenges WHERE id = $1`, [id]);
      if (!cr.rows.length) return res.status(404).json({ error: 'not_found' });
      const er = await pool.query(
        `SELECT * FROM challenge_entries
         WHERE challenge_id = $1
         ORDER BY (winner_rank IS NULL), winner_rank ASC, score DESC, completed_at ASC`,
        [id]
      );
      res.json({ ok: true, challenge: cr.rows[0], entries: er.rows });
    } catch (e) {
      console.error('admin /challenges/:id/entries', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // Finalize — closes the challenge, marks in_progress as abandoned, runs winner
  // assignment for top_n (race/beat already mark eagerly).
  adminRouter.post('/api/challenges/:id/finalize', async (req, res) => {
    const client = await pool.connect();
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
      await client.query('BEGIN');
      const cr = await client.query(`SELECT * FROM challenges WHERE id = $1 FOR UPDATE`, [id]);
      if (!cr.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not_found' }); }
      const c = cr.rows[0];
      // Mark in_progress entries as abandoned (final score = whatever they had).
      await client.query(
        `UPDATE challenge_entries SET status = 'abandoned' WHERE challenge_id = $1 AND status = 'in_progress'`,
        [id]
      );
      if (c.challenge_type === 'top_n') {
        await client.query(
          `UPDATE challenge_entries SET is_winner = TRUE, winner_rank = sub.rnk
           FROM (
             SELECT device_id, ROW_NUMBER() OVER (ORDER BY score DESC, completed_at ASC NULLS LAST) AS rnk
             FROM challenge_entries
             WHERE challenge_id = $1 AND status IN ('completed','abandoned') AND score > 0
           ) sub
           WHERE challenge_entries.challenge_id = $1
             AND challenge_entries.device_id = sub.device_id
             AND sub.rnk <= $2`,
          [id, c.winners_count]
        );
      }
      await client.query(`UPDATE challenges SET status = 'ended', updated_at = NOW() WHERE id = $1`, [id]);
      await client.query('COMMIT');
      await logAdminAction('challenge.finalize', 'challenge', String(id), { type: c.challenge_type });
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('admin POST /challenges/:id/finalize', e);
      res.status(500).json({ error: 'server' });
    } finally {
      client.release();
    }
  });

  // Manual override on a single entry — toggle winner / cheat_flag / prize_claimed.
  adminRouter.patch('/api/challenges/:id/entries/:device_id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const did = String(req.params.device_id || '').slice(0, 64);
      if (!Number.isFinite(id) || !did) return res.status(400).json({ error: 'bad_params' });
      const sets = [], values = [id, did];
      const b = req.body || {};
      if (typeof b.is_winner === 'boolean') {
        sets.push('is_winner = $' + (values.length + 1)); values.push(b.is_winner);
        if (!b.is_winner) sets.push('winner_rank = NULL');
      }
      if (typeof b.cheat_flag === 'boolean') {
        sets.push('cheat_flag = $' + (values.length + 1)); values.push(b.cheat_flag);
      }
      if (typeof b.prize_claimed === 'boolean') {
        sets.push('prize_claimed = $' + (values.length + 1)); values.push(b.prize_claimed);
        sets.push('prize_claimed_at = ' + (b.prize_claimed ? 'NOW()' : 'NULL'));
      }
      if (!sets.length) return res.status(400).json({ error: 'no_changes' });
      const r = await pool.query(
        `UPDATE challenge_entries SET ${sets.join(', ')} WHERE challenge_id = $1 AND device_id = $2 RETURNING *`,
        values
      );
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      await logAdminAction('entry.patch', 'challenge_entry', id + ':' + did, b);
      res.json({ ok: true, entry: r.rows[0] });
    } catch (e) {
      console.error('admin PATCH /challenges/:id/entries/:device_id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- GAME CONFIG ----------

  // ---------- SERVER BOTS ----------
  adminRouter.get('/api/bots', async (_req, res) => {
    // Get our local in-memory state
    const localStatus = getBotStatus();
    // Also fetch from DB to handle multi-instance Railway setup —
    // if WE'RE not the leader, the leader's bots show up in player_heartbeat
    if (!localStatus.running) {
      try {
        // First check if there's a saved bot config — if not, no bots should be running
        const cfgRow = await pool.query(`SELECT value FROM game_config WHERE key = '__bot_engine_state'`);
        if (!cfgRow.rows.length) {
          // No saved config = admin pressed stop or never started → return not running
          return res.json({ ok: true, ...localStatus, _source: 'local-no-config' });
        }
        const cfg = JSON.parse(cfgRow.rows[0].value);
        if (!cfg.enabled) {
          return res.json({ ok: true, ...localStatus, _source: 'local-disabled' });
        }
        // Check for fresh bot heartbeats (5s window — bots flush every 1.5-3s)
        const r = await pool.query(
          `SELECT device_id, display_name, mode, score, highest_tier
           FROM player_heartbeat
           WHERE device_id LIKE 'bot-%' AND updated_at > NOW() - INTERVAL '6 seconds'
           ORDER BY score DESC LIMIT 20`
        );
        return res.json({
          ok: true,
          running: r.rows.length > 0, // only truly running if we see fresh heartbeats
          count: r.rows.length,
          pending: 0,
          exiting: 0,
          config: {
            mode: cfg.mode || 'practice',
            speed: cfg.speed || 'normal',
            contestCode: cfg.contestCode || null,
            challengeSlug: cfg.challengeSlug || null,
            targetCount: cfg.count || 0,
            restartMin: cfg.restartMin || 30,
            restartMax: cfg.restartMax || 90,
            maxGamesPerBot: cfg.maxGamesPerBot || 1
          },
          bots: r.rows.map(b => ({
            deviceId: b.device_id,
            name: b.display_name,
            score: b.score | 0,
            tier: b.highest_tier | 0,
            games: 0,
            mode: b.mode
          })),
          _source: 'db'
        });
      } catch (e) { /* fall through to local status */ }
    }
    res.json({ ok: true, ...localStatus, _source: 'local' });
  });
  // Debug: raw bot engine state
  adminRouter.get('/api/bots/debug', async (_req, res) => {
    try {
      const status = getBotStatus();
      // Also query heartbeat table for bot rows
      const bots = await pool.query(
        `SELECT device_id, display_name, mode, score, highest_tier, updated_at,
                EXTRACT(EPOCH FROM (NOW() - updated_at)) AS age_sec
         FROM player_heartbeat
         WHERE device_id LIKE 'bot-%'
         ORDER BY updated_at DESC
         LIMIT 20`
      );
      res.json({
        ok: true,
        engineStatus: status,
        heartbeatBots: bots.rows,
        serverTime: new Date().toISOString(),
        uptime: Math.round(process.uptime()) + 's'
      });
    } catch (e) {
      res.status(500).json({ error: 'server', detail: e.message });
    }
  });
  adminRouter.post('/api/bots/start', (req, res) => {
    const count = Math.max(1, Math.min(200, parseInt(req.body.count, 10) || 10));
    const config = {
      mode: req.body.mode || 'practice',
      speed: req.body.speed || 'normal',
      contestCode: req.body.contestCode || null,
      challengeSlug: req.body.challengeSlug || null,
      restartMin: Math.max(5, Math.min(300, parseInt(req.body.restartMin, 10) || 30)),
      restartMax: Math.max(10, Math.min(600, parseInt(req.body.restartMax, 10) || 90)),
      maxGamesPerBot: Math.max(1, Math.min(50, parseInt(req.body.maxGamesPerBot, 10) || 1))
    };
    const started = startBots(count, pool, config);
    logAdminAction('bots.start', 'bots', String(count), { ...config, started });
    // Persist config so bots auto-restart after server restart (Railway deploys etc)
    pool.query(
      `INSERT INTO game_config (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      ['__bot_engine_state', JSON.stringify({ enabled: true, count, ...config })]
    ).catch(() => {});
    res.json({ ok: true, count: started });
  });
  adminRouter.post('/api/bots/stop', async (_req, res) => {
    stopBots(); // stops on THIS instance only
    logAdminAction('bots.stop', 'bots', '0', {});
    // Clear persisted state so bots don't auto-restart on other instances
    pool.query(`DELETE FROM game_config WHERE key = '__bot_engine_state'`).catch(() => {});
    pool.query(`DELETE FROM game_config WHERE key = '__bot_engine_leader'`).catch(() => {});
    // Clear ALL bot heartbeats so followers report 'not running' immediately
    pool.query(`DELETE FROM player_heartbeat WHERE device_id LIKE 'bot-%'`).catch(() => {});
    res.json({ ok: true });
  });

  // ---------- VERSION INFO ----------
  // Reports the cache-buster version embedded in /index.html (the same string
  // clients see as `?v=...` on /app.js) plus the git SHA Railway injects, so
  // the admin always knows EXACTLY which build is live in production.
  const SERVER_START_TIME = Date.now();
  adminRouter.get('/api/version', async (_req, res) => {
    let appVersion = 'unknown';
    try {
      const fs = await import('fs');
      const path = await import('path');
      const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
      const m = html.match(/\/app\.js\?v=([\w-]+)/);
      if (m) appVersion = m[1];
    } catch (e) { /* silent — leave as unknown */ }
    res.json({
      ok: true,
      appVersion,
      gitSha: (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || '').slice(0, 7),
      gitBranch: process.env.RAILWAY_GIT_BRANCH || process.env.GIT_BRANCH || '',
      nodeVersion: process.version,
      uptimeSec: Math.round((Date.now() - SERVER_START_TIME) / 1000),
      startedAt: new Date(SERVER_START_TIME).toISOString()
    });
  });

  // ---------- LEADERBOARD ENTRY DELETION ----------
  // Per-row delete for daily scores. Affects every leaderboard window
  // (day/week/month) since they all read from daily_scores.
  adminRouter.delete('/api/score/:date/:deviceId', async (req, res) => {
    try {
      const date = String(req.params.date || '');
      const did = String(req.params.deviceId || '').slice(0, 64);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad_date' });
      if (!did) return res.status(400).json({ error: 'missing_device' });
      const r = await pool.query(
        `DELETE FROM daily_scores WHERE date = $1 AND device_id = $2 RETURNING name, score`,
        [date, did]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      await logAdminAction('score.delete', 'daily_scores', `${date}/${did.slice(0,12)}`, {
        name: r.rows[0].name, score: r.rows[0].score, date
      });
      res.json({ ok: true, deleted: r.rows[0] });
    } catch (e) {
      console.error('admin DELETE /score', e);
      res.status(500).json({ error: 'server' });
    }
  });
  // Per-row delete for contest scores. Also clears live-state to avoid the
  // ghost reappearing while the player still has a live heartbeat in flight.
  adminRouter.delete('/api/contest-score/:code/:deviceId', async (req, res) => {
    try {
      const code = String(req.params.code || '').toUpperCase().slice(0, 8);
      const did = String(req.params.deviceId || '').slice(0, 64);
      if (!code) return res.status(400).json({ error: 'missing_code' });
      if (!did) return res.status(400).json({ error: 'missing_device' });
      const r = await pool.query(
        `DELETE FROM contest_scores WHERE contest_code = $1 AND device_id = $2 RETURNING display_name, score`,
        [code, did]
      );
      await pool.query(`DELETE FROM contest_live_state WHERE contest_code = $1 AND device_id = $2`, [code, did]);
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      await logAdminAction('contest_score.delete', 'contest_scores', `${code}/${did.slice(0,12)}`, {
        name: r.rows[0].display_name, score: r.rows[0].score, contest: code
      });
      res.json({ ok: true, deleted: r.rows[0] });
    } catch (e) {
      console.error('admin DELETE /contest-score', e);
      res.status(500).json({ error: 'server' });
    }
  });
  // Per-row delete for contest entries (full member list) — alias used by the
  // contest-leaderboard view in admin.
  adminRouter.get('/api/contest/:code/scores', async (req, res) => {
    try {
      const code = String(req.params.code || '').toUpperCase().slice(0, 8);
      const r = await pool.query(
        `SELECT device_id, display_name, score, highest_tier, games_played, joined_at, last_played_at
         FROM contest_scores WHERE contest_code = $1 ORDER BY score DESC LIMIT 200`, [code]);
      res.json({ ok: true, code, scores: r.rows });
    } catch (e) {
      console.error('admin GET /contest/:code/scores', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- PLAYER MANAGEMENT ----------

  // Settle contest wager — distribute pool to top 3
  adminRouter.post('/api/wager/settle', async (req, res) => {
    const { contestCode } = req.body || {};
    if (!contestCode) return res.status(400).json({ error: 'missing_code' });
    try {
      const contest = await pool.query('SELECT * FROM contests WHERE code = $1', [contestCode]);
      if (!contest.rows.length) return res.status(404).json({ error: 'not_found' });
      const c = contest.rows[0];
      if ((c.wager_amount | 0) === 0) return res.json({ ok: false, reason: 'no_wager' });
      if (c.wager_settled) return res.json({ ok: false, reason: 'already_settled' });
      const pool_amount = c.wager_pool | 0;
      if (pool_amount <= 0) return res.json({ ok: false, reason: 'empty_pool' });

      // Get top 3 players who actually played (score > 0)
      const top = await pool.query(
        `SELECT device_id, display_name, score FROM contest_scores
         WHERE contest_code = $1 AND score > 0 ORDER BY score DESC LIMIT 3`, [contestCode]);

      // Get config percentages
      const cfgRows = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'wager_%'`);
      const cfg = {}; for (const r of cfgRows.rows) cfg[r.key] = r.value;
      const rake = parseInt(cfg.wager_rake, 10) || 5;
      const pct1 = parseInt(cfg.wager_1st_pct, 10) || 60;
      const pct2 = parseInt(cfg.wager_2nd_pct, 10) || 25;
      const pct3 = parseInt(cfg.wager_3rd_pct, 10) || 10;

      const rakeAmount = Math.round(pool_amount * rake / 100);
      const distributable = pool_amount - rakeAmount;
      const prizes = [
        Math.round(distributable * pct1 / (pct1 + pct2 + pct3)),
        Math.round(distributable * pct2 / (pct1 + pct2 + pct3)),
        Math.round(distributable * pct3 / (pct1 + pct2 + pct3))
      ];

      const winners = [];
      for (let i = 0; i < Math.min(3, top.rows.length); i++) {
        const prize = prizes[i] || 0;
        if (prize <= 0) continue;
        const p = top.rows[i];
        await pool.query(`UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1 WHERE device_id = $2`, [prize, p.device_id]);
        await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, $4)`,
          [contestCode, p.device_id, prize, 'win_' + (i + 1)]);
        winners.push({ name: p.display_name, score: p.score, prize, place: i + 1 });
      }

      // Record rake
      if (rakeAmount > 0) {
        await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, 'house', $2, 'rake')`,
          [contestCode, rakeAmount]);
      }

      // Mark as settled
      await pool.query(`UPDATE contests SET wager_settled = true WHERE code = $1`, [contestCode]);
      logAdminAction('wager.settle', contestCode, contestCode, { pool: pool_amount, rake: rakeAmount, winners });

      res.json({ ok: true, pool: pool_amount, rake: rakeAmount, winners });
    } catch (e) {
      console.error('wager/settle', e.message);
      res.status(500).json({ error: 'server' });
    }
  });

  // Jackpot stats
  adminRouter.get('/api/jackpot/stats', async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM daily_jackpot ORDER BY date DESC LIMIT 14`);
      res.json({ ok: true, days: r.rows });
    } catch (e) {
      res.status(500).json({ error: 'server' });
    }
  });

  // Settle daily jackpot for a specific date
  adminRouter.post('/api/jackpot/settle', async (req, res) => {
    const { date } = req.body || {};
    if (!date) return res.status(400).json({ error: 'missing_date' });
    try {
      const jp = await pool.query(`SELECT * FROM daily_jackpot WHERE date = $1`, [date]);
      if (!jp.rows.length) return res.json({ ok: false, reason: 'no_jackpot' });
      const j = jp.rows[0];
      if (j.settled) return res.json({ ok: false, reason: 'already_settled' });
      if ((j.pool | 0) <= 0) return res.json({ ok: false, reason: 'empty_pool' });

      const cfgRows = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'wager_%' OR key = 'jackpot_%'`);
      const cfg = {}; for (const r of cfgRows.rows) cfg[r.key] = r.value;
      const rake = parseInt(cfg.wager_rake, 10) || 5;
      const pct1 = parseInt(cfg.wager_1st_pct, 10) || 60;
      const pct2 = parseInt(cfg.wager_2nd_pct, 10) || 25;
      const pct3 = parseInt(cfg.wager_3rd_pct, 10) || 10;
      const minPlayers = parseInt(cfg.jackpot_min_players, 10) || 5;

      // Get top 3 daily scores for that date
      const top = await pool.query(
        `SELECT device_id, name, score FROM daily_scores WHERE date = $1 ORDER BY score DESC LIMIT 3`, [date]);

      if (top.rows.length < minPlayers && j.entries < minPlayers) {
        return res.json({ ok: false, reason: 'not_enough_players', min: minPlayers, actual: j.entries });
      }

      const poolAmt = j.pool | 0;
      const rakeAmt = Math.round(poolAmt * rake / 100);
      const dist = poolAmt - rakeAmt;
      const prizes = [
        Math.round(dist * pct1 / (pct1 + pct2 + pct3)),
        Math.round(dist * pct2 / (pct1 + pct2 + pct3)),
        Math.round(dist * pct3 / (pct1 + pct2 + pct3))
      ];

      const winners = [];
      for (let i = 0; i < Math.min(3, top.rows.length); i++) {
        const prize = prizes[i] || 0;
        if (prize <= 0) continue;
        const p = top.rows[i];
        await pool.query(`UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1 WHERE device_id = $2`, [prize, p.device_id]);
        await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, $4)`,
          ['JP:' + date, p.device_id, prize, 'jackpot_win_' + (i + 1)]);
        winners.push({ name: p.name, score: p.score, prize, place: i + 1 });
      }
      if (rakeAmt > 0) {
        await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, 'house', $2, 'jackpot_rake')`,
          ['JP:' + date, rakeAmt]);
      }
      await pool.query(`UPDATE daily_jackpot SET settled = true, settled_at = NOW() WHERE date = $1`, [date]);
      logAdminAction('jackpot.settle', date, date, { pool: poolAmt, rake: rakeAmt, winners });
      res.json({ ok: true, pool: poolAmt, rake: rakeAmt, winners });
    } catch (e) {
      console.error('jackpot/settle', e.message);
      res.status(500).json({ error: 'server' });
    }
  });

  // Wager stats for admin dashboard
  adminRouter.get('/api/wager/stats', async (_req, res) => {
    try {
      const active = await pool.query(
        `SELECT c.code, c.name, c.wager_amount, c.wager_pool, c.wager_settled, c.ends_at,
                (SELECT COUNT(*) FROM contest_scores WHERE contest_code = c.code) as players
         FROM contests c WHERE c.wager_amount > 0 ORDER BY c.created_at DESC LIMIT 50`);
      const totalRake = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM wager_settlements WHERE type = 'rake' OR type = 'jackpot_rake'`);
      const duels = await pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'pending') as pending, COUNT(*) FILTER (WHERE status = 'settled') as settled FROM duels`);
      res.json({ ok: true, contests: active.rows, totalRake: totalRake.rows[0].total | 0, duels: duels.rows[0] });
    } catch (e) {
      res.status(500).json({ error: 'server' });
    }
  });
  // Update player balance (set exact amount or add/subtract)
  adminRouter.post('/api/players/balance', async (req, res) => {
    const { deviceId, playerCode, amount, mode } = req.body || {};
    // Find player by code or deviceId
    const identifier = playerCode || deviceId;
    if (!identifier || amount == null) return res.status(400).json({ error: 'missing_params' });
    try {
      const findCol = playerCode ? 'player_code' : 'device_id';
      const player = await pool.query(`SELECT device_id, player_code, balance FROM player_profiles WHERE ${findCol} = $1`, [identifier]);
      if (!player.rows.length) return res.status(404).json({ error: 'player_not_found' });
      const p = player.rows[0];
      const amt = parseInt(amount, 10) || 0;
      let newBalance;
      if (mode === 'set') {
        newBalance = Math.max(0, amt);
        await pool.query(`UPDATE player_profiles SET balance = $1 WHERE device_id = $2`, [newBalance, p.device_id]);
      } else if (mode === 'subtract') {
        newBalance = Math.max(0, p.balance - Math.abs(amt));
        await pool.query(`UPDATE player_profiles SET balance = $1, total_spent = total_spent + $2 WHERE device_id = $3`,
          [newBalance, Math.abs(amt), p.device_id]);
      } else {
        // default: add
        newBalance = p.balance + Math.abs(amt);
        await pool.query(`UPDATE player_profiles SET balance = $1, total_earned = total_earned + $2 WHERE device_id = $3`,
          [newBalance, Math.abs(amt), p.device_id]);
      }
      logAdminAction('player.balance', p.player_code, identifier, { mode: mode || 'add', amount: amt, newBalance });
      res.json({ ok: true, playerCode: p.player_code, newBalance });
    } catch (e) {
      res.status(500).json({ error: 'server', msg: e.message });
    }
  });

  // Get referral stats
  adminRouter.get('/api/referrals', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT r.*, 
                (SELECT display_name FROM player_profiles WHERE device_id = r.referrer_device) as referrer_name,
                (SELECT display_name FROM player_profiles WHERE device_id = r.referred_device) as referred_name
         FROM referrals r ORDER BY r.created_at DESC LIMIT 200`);
      res.json({ ok: true, referrals: r.rows });
    } catch (e) {
      res.status(500).json({ error: 'server', msg: e.message });
    }
  });

  // ---------- GAME CONFIG (moved after bots) ----------
  adminRouter.get('/api/config', async (_req, res) => {
    try {
      const r = await pool.query('SELECT key, value, updated_at FROM game_config ORDER BY key');
      res.json({ ok: true, config: r.rows });
    } catch (e) {
      res.status(500).json({ error: 'server' });
    }
  });
  adminRouter.patch('/api/config/:key', async (req, res) => {
    try {
      // game_config.key is VARCHAR(255) since the round-2 dedup-key widening,
      // but we still cap admin-editable keys conservatively. Refuse the
      // throwaway dedup namespaces so a typo here can't wipe a player's
      // earn-history or ad-watch state.
      const key = String(req.params.key || '').slice(0, 120);
      const { value } = req.body || {};
      if (!key || typeof value !== 'string') return res.status(400).json({ error: 'bad_input' });
      if (/^_(earn|gift_rate|ad|ad_rate|ad_count):/.test(key)) {
        return res.status(400).json({ error: 'reserved_key' });
      }
      await pool.query(
        `INSERT INTO game_config (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value.slice(0, 500)]
      );
      _configCache = {}; _configCacheTs = 0; // bust cache
      await logAdminAction('config.update', 'game_config', key, { value });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'server' });
    }
  });

  // ---------- CSV EXPORT ----------
  const exportTables = {
    'daily_scores':       ['date', 'device_id', 'name', 'score', 'tier', 'created_at', 'updated_at'],
    'contests':           ['code', 'name', 'host_name', 'host_device_id', 'board_type', 'duration_days', 'created_at', 'ends_at', 'status'],
    'contest_scores':     ['contest_code', 'device_id', 'display_name', 'score', 'highest_tier', 'games_played', 'joined_at', 'last_played_at'],
    'device_visits':      ['device_id', 'date', 'visit_count', 'first_at', 'last_at'],
    'admin_actions':      ['id', 'action', 'target_type', 'target_id', 'metadata', 'created_at'],
    'challenges':         ['id', 'slug', 'name', 'challenge_type', 'threshold_score', 'threshold_tier', 'winners_count', 'prize_text', 'starts_at', 'ends_at', 'status', 'created_at'],
    'challenge_entries':  ['challenge_id', 'device_id', 'display_name', 'score', 'highest_tier', 'drops_count', 'status', 'is_winner', 'winner_rank', 'cheat_flag', 'contact_name', 'contact_phone', 'contact_email', 'contact_at', 'prize_claimed', 'started_at', 'completed_at']
  };
  function csvEscape(v) {
    if (v === null || v === undefined) return '';
    let s;
    if (v instanceof Date) s = v.toISOString();
    else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  adminRouter.get('/api/export/:table.csv', async (req, res) => {
    const table = req.params.table;
    const cols = exportTables[table];
    if (!cols) return res.status(404).json({ error: 'unknown_table' });
    try {
      const r = await pool.query(`SELECT ${cols.join(', ')} FROM ${table} ORDER BY 1 DESC LIMIT 10000`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="bloom_${table}_${new Date().toISOString().slice(0,10)}.csv"`);
      res.write('﻿'); // BOM for Excel + Hebrew
      res.write(cols.join(',') + '\n');
      for (const row of r.rows) {
        res.write(cols.map(c => csvEscape(row[c])).join(',') + '\n');
      }
      res.end();
    } catch (e) {
      console.error('admin /export', e);
      res.status(500).json({ error: 'server' });
    }
  });

  app.use(ADMIN_PATH, adminRouter);
  console.log('[admin] mounted at ' + ADMIN_PATH);
} else {
  console.log('[admin] disabled — set ADMIN_PATH + ADMIN_PASSWORD env vars to enable');
}

// ============================================================
// PLAYER HEARTBEAT — tracks all active players (any mode)
// ============================================================
// ============================================================
// PUBLIC PLAYER PROFILE — /player/BLOOM-XXXX
// ============================================================
app.get('/player/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase().slice(0, 10);
  try {
    const p = await pool.query(
      `SELECT player_code, display_name, balance, total_earned, total_spent, COALESCE(xp, 0) as xp, COALESCE(level, 1) as level, created_at FROM player_profiles WHERE player_code = $1`, [code]);
    if (!p.rows.length) return res.status(404).send('<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>שחקן לא נמצא — BLOOM</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#F7F5F0;color:#1C1A18;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;text-align:center}h2{margin-bottom:16px}a{color:#BA7517;font-weight:600}</style></head><body><h2>🔍 שחקן לא נמצא</h2><p>הקוד ' + code + ' לא קיים</p><br><a href="/">🌸 שחק ב-BLOOM</a></body></html>');
    const player = p.rows[0];
    const lvl = calcLevel(player.xp);
    const nextXp = lvl.nextXp || lvl.xp;
    const progress = lvl.progress || 100;

    // Richer stats
    const gamesRow = await pool.query(`SELECT COUNT(*) as games, MAX(score) as best, COUNT(DISTINCT date) as days_active FROM daily_scores WHERE device_id = (SELECT device_id FROM player_profiles WHERE player_code = $1)`, [code]);
    const stats = gamesRow.rows[0] || { games: 0, best: 0, days_active: 0 };
    const contestRow = await pool.query(`SELECT COUNT(DISTINCT contest_code) as contests, SUM(games_played) as contest_games FROM contest_scores WHERE device_id = (SELECT device_id FROM player_profiles WHERE player_code = $1)`, [code]);
    const cStats = contestRow.rows[0] || { contests: 0, contest_games: 0 };
    const referrals = await pool.query(`SELECT COUNT(*) as count FROM referrals WHERE referrer_code = $1`, [code]);
    const daysSinceJoin = Math.max(1, Math.round((Date.now() - new Date(player.created_at).getTime()) / 86400000));
    const joinDate = new Date(player.created_at).toLocaleDateString('he-IL');
    const name = (player.display_name || 'שחקן').replace(/[<>"'&]/g, '');
    const shareUrl = `https://bloom-web-production-f3bd.up.railway.app/player/${code}`;
    const shareText = `🌸 ${name} ב-BLOOM — רמה ${lvl.level} ${lvl.title} · שיא ${(stats.best|0).toLocaleString()} נקודות. תצליח לנצח?`;

    res.send(`<!DOCTYPE html><html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — BLOOM Player Profile</title>
<meta name="description" content="${shareText}">
<meta property="og:type" content="profile">
<meta property="og:title" content="${name} — BLOOM 🌸">
<meta property="og:description" content="רמה ${lvl.level} ${lvl.title} · שיא ${(stats.best|0).toLocaleString()} · ${stats.games|0} משחקים">
<meta property="og:url" content="${shareUrl}">
<meta property="og:image" content="https://bloom-web-production-f3bd.up.railway.app/assets/social-share.png">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${name} — BLOOM">
<meta name="twitter:description" content="רמה ${lvl.level} · שיא ${(stats.best|0).toLocaleString()} נקודות">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;direction:rtl}
body.light{background:linear-gradient(180deg,#F5F5F0 0%,#FFF 60%);color:#1C1A18}
body.dark{background:linear-gradient(180deg,#1F1D1B 0%,#1A1816 60%);color:#F2EFE9}
.card{max-width:380px;width:100%;border-radius:24px;padding:32px 24px;animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)}
.light .card{background:#FFF;box-shadow:0 8px 30px rgba(0,0,0,0.08)}
.dark .card{background:#252320;box-shadow:0 8px 30px rgba(0,0,0,0.3)}
@keyframes popIn{from{transform:scale(0.9);opacity:0}to{transform:scale(1);opacity:1}}
.avatar{width:64px;height:64px;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700}
.light .avatar{background:linear-gradient(135deg,#FAC775,#BA7517);color:#FFF}
.dark .avatar{background:linear-gradient(135deg,#3D2E0A,#BA7517);color:#FFF}
.name{font-size:24px;font-weight:800;text-align:center;margin-bottom:2px}
.code{font-size:12px;text-align:center;letter-spacing:0.12em;margin-bottom:12px}
.light .code{color:#A8A6A0}.dark .code{color:#6F6E68}
.level-badge{text-align:center;margin-bottom:6px}
.level-badge span{display:inline-block;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:700}
.light .level-badge span{background:linear-gradient(135deg,#F0E6FF,#E8D8FF);color:#5B21B6}
.dark .level-badge span{background:linear-gradient(135deg,#2A1F3D,#3D2E5A);color:#C4A7F0}
.xp-bar{width:80%;margin:0 auto 16px;height:6px;border-radius:3px;overflow:hidden}
.light .xp-bar{background:#F0E6FF}.dark .xp-bar{background:#2A1F3D}
.xp-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#9B59B6,#6C3483);transition:width 1s ease-out}
.xp-text{text-align:center;font-size:10px;margin-bottom:16px}
.light .xp-text{color:#A8A6A0}.dark .xp-text{color:#6F6E68}
.stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px}
.stat{border-radius:14px;padding:14px 8px;text-align:center}
.light .stat{background:#FAFAF6}.dark .stat{background:#1F1D1B}
.stat-val{font-size:20px;font-weight:800}
.stat-lbl{font-size:10px;margin-top:3px}
.light .stat-lbl{color:#A8A6A0}.dark .stat-lbl{color:#6F6E68}
.stat-val.gold{color:#BA7517}
.stats2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.joined{text-align:center;font-size:11px;margin-bottom:16px}
.light .joined{color:#A8A6A0}.dark .joined{color:#6F6E68}
.btns{display:flex;flex-direction:column;gap:8px}
.btn-play{display:block;width:100%;padding:16px;border-radius:14px;font-size:16px;font-weight:700;text-decoration:none;text-align:center;font-family:inherit;border:none;cursor:pointer}
.light .btn-play{background:#1C1A18;color:#FFF}.dark .btn-play{background:#FAC775;color:#1C1A18}
.btn-share{display:flex;gap:8px}
.btn-share button{flex:1;padding:12px;border-radius:12px;font-size:13px;font-weight:600;border:none;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px}
.btn-copy{}.light .btn-copy{background:#F5F2EC;color:#1C1A18}.dark .btn-copy{background:#2C2A28;color:#F2EFE9}
.btn-wa{background:#25D366!important;color:#FFF!important}
.btn-wa svg{width:16px;height:16px;fill:#FFF}
</style>
<script>(function(){var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches;document.body.className=d?'dark':'light'})()</script>
</head><body>
<div class="card">
<div class="avatar">${name.charAt(0)}</div>
<div class="name">${name}</div>
<div class="code">${player.player_code}</div>
<div class="level-badge"><span>${lvl.title} · רמה ${lvl.level}</span></div>
<div class="xp-bar"><div class="xp-fill" style="width:${progress}%"></div></div>
<div class="xp-text">${player.xp.toLocaleString()} / ${nextXp.toLocaleString()} XP</div>
<div class="stats">
<div class="stat"><div class="stat-val gold">${(stats.best|0).toLocaleString()}</div><div class="stat-lbl">🏆 שיא</div></div>
<div class="stat"><div class="stat-val">${stats.games|0}</div><div class="stat-lbl">🎮 משחקים</div></div>
<div class="stat"><div class="stat-val">${player.balance|0} 💎</div><div class="stat-lbl">קרדיטים</div></div>
</div>
<div class="stats2">
<div class="stat"><div class="stat-val">${stats.days_active|0}</div><div class="stat-lbl">📅 ימים פעילים</div></div>
<div class="stat"><div class="stat-val">${cStats.contests|0}</div><div class="stat-lbl">🏅 תחרויות</div></div>
<div class="stat"><div class="stat-val">${(player.total_earned|0).toLocaleString()}</div><div class="stat-lbl">💎 הרוויח</div></div>
<div class="stat"><div class="stat-val">${referrals.rows[0].count|0}</div><div class="stat-lbl">🔗 הפניות</div></div>
</div>
<div class="joined">📆 הצטרף ב-${joinDate} · ${daysSinceJoin} ימים ב-BLOOM</div>
<div class="btns">
<a class="btn-play" href="/?ref=${code}">🌸 שחק גם ב-BLOOM</a>
<div class="btn-share">
<button class="btn-copy" onclick="var t='${shareText.replace(/'/g,"\\'")} ${shareUrl}';if(navigator.share)navigator.share({text:t}).catch(function(){});else if(navigator.clipboard){navigator.clipboard.writeText(t);this.textContent='✓ הועתק'}">📤 שתף פרופיל</button>
<button class="btn-wa" onclick="window.open('https://wa.me/?text='+encodeURIComponent('${shareText.replace(/'/g,"\\'")} ${shareUrl}'),'_blank')"><svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>WhatsApp</button>
</div>
</div>
</div></body></html>`);
  } catch (e) {
    console.error('profile', e.message);
    res.status(500).send('שגיאה');
  }
});

// ============================================================
// Player identity + referrals
// ============================================================

// GET /api/jackpot/today — current daily jackpot pool
app.get('/api/jackpot/today', async (_req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const cfgRow = await pool.query(`SELECT value FROM game_config WHERE key = 'jackpot_enabled'`);
    if (cfgRow.rows.length && cfgRow.rows[0].value === 'false') return res.json({ ok: true, enabled: false });
    const r = await pool.query(`SELECT pool, entries FROM daily_jackpot WHERE date = $1`, [today]);
    const row = r.rows[0] || { pool: 0, entries: 0 };
    res.json({ ok: true, enabled: true, pool: row.pool | 0, entries: row.entries | 0, date: today });
  } catch (e) {
    res.json({ ok: true, enabled: false });
  }
});

// Generate a unique BLOOM-XXXX code
function generatePlayerCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1 for clarity
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return 'BLOOM-' + code;
}

// GET /api/player/code — get or create player code
app.get('/api/player/code', async (req, res) => {
  const deviceId = req.headers['x-device-id'] || req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: 'missing_device' });
  try {
    // Check if player already has a code
    const existing = await pool.query(
      'SELECT player_code, balance, xp FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (existing.rows.length) {
      const p = existing.rows[0];
      const lvl = calcLevel(p.xp || 0);
      return res.json({ ok: true, code: p.player_code, balance: p.balance, xp: p.xp || 0, level: lvl });
    }
    // Generate unique code (retry if collision)
    const wcfg = await pool.query(`SELECT value FROM game_config WHERE key = 'welcome_bonus'`);
    const welcomeBonus = parseInt((wcfg.rows[0] || {}).value, 10) || 100;
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generatePlayerCode();
      try {
        await pool.query(
          `INSERT INTO player_profiles (device_id, player_code, balance, total_earned) VALUES ($1, $2, $3, $3)`,
          [deviceId, code, welcomeBonus]);
        return res.json({ ok: true, code: code, balance: welcomeBonus, isNew: true });
      } catch (e) {
        if (e.code === '23505') continue; // unique violation, retry
        throw e;
      }
    }
    res.status(500).json({ error: 'code_generation_failed' });
  } catch (e) {
    console.error('player/code', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/referral — register a referral

// XP per action and level thresholds
const XP_MAP = {
  daily_complete: 50, daily_login: 15, streak_3: 30, streak_7: 80, streak_30: 300,
  contest_1st: 100, contest_2nd: 50, contest_3rd: 30,
  score_milestone: 10, event_gift: 5
};

// Server-authoritative skin prices. Must match SKIN_PACKS in src/01-constants.js.
// Client cannot influence the cost; buy-skin reads from this map only.
const SKIN_PRICES = {
  classic: 0,
  ocean:   200,
  candy:   200,
  space:   300,
  fire:    300,
  gold:    500
};
const LEVELS = [
  { level: 1,  xp: 0,      title: 'מתחיל' },
  { level: 2,  xp: 50,     title: 'מתחיל+' },
  { level: 3,  xp: 150,    title: 'טירון' },
  { level: 5,  xp: 500,    title: 'חובבן' },
  { level: 8,  xp: 1200,   title: 'שחקן' },
  { level: 10, xp: 2000,   title: 'שחקן+' },
  { level: 15, xp: 5000,   title: 'מקצוען' },
  { level: 20, xp: 10000,  title: 'מומחה' },
  { level: 30, xp: 25000,  title: 'אלוף' },
  { level: 50, xp: 50000,  title: 'אגדה' },
  { level: 100,xp: 150000, title: 'אלמוותי' },
];
function calcLevel(xp) {
  let lvl = LEVELS[0];
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].xp) { lvl = LEVELS[i]; break; }
  }
  const next = LEVELS.find(l => l.xp > xp) || null;
  return { level: lvl.level, title: lvl.title, xp, nextXp: next ? next.xp : null, nextTitle: next ? next.title : null, progress: next ? Math.round((xp - lvl.xp) / (next.xp - lvl.xp) * 100) : 100 };
}

// POST /api/player/earn — award credits + XP for gameplay actions
app.post('/api/player/earn', requireDeviceAuth, async (req, res) => {
  const { deviceId, action, meta } = req.body || {};
  if (!deviceId || !action) return res.status(400).json({ error: 'missing_params' });
  try {
    const player = await pool.query('SELECT device_id, balance, xp FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!player.rows.length) return res.json({ ok: false, reason: 'no_profile' });

    const actionMap = {
      'daily_login': 'daily_login_reward',
      'daily_complete': 'daily_reward',
      'streak_3': 'streak_3_reward',
      'streak_7': 'streak_7_reward',
      'streak_30': 'streak_30_reward',
      'contest_1st': 'contest_1st_reward',
      'contest_2nd': 'contest_2nd_reward',
      'contest_3rd': 'contest_3rd_reward',
      'score_milestone': 'score_milestone_reward',
      'event_gift': '_custom_amount_',
      // "Comeback" bonus: the client requests this when the player
      // returns after >= 2 days away. Amount is server-decided by
      // tier (2-6, 7-29, 30+ days), so the client can't choose how
      // much. Dedup is via the standard action+date map below — one
      // comeback per day max.
      'comeback': 'comeback_reward'
    };
    const configKey = actionMap[action];
    if (!configKey) return res.json({ ok: false, reason: 'unknown_action' });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

    // Event gifts: two layers of rate limit.
    //   (a) 30s minimum between gifts (was 10s, too loose at server-clamped cap)
    //   (b) hourly cap so a tab left open all afternoon can't drip into 5K credits
    if (action === 'event_gift') {
      if (!checkRateLimit('gift:hourly', deviceId, 20, 60 * 60 * 1000)) {
        return res.json({ ok: false, reason: 'rate_limited_hour' });
      }
      const rateKey = '_gift_rate:' + deviceId;
      const rateCheck = await pool.query('SELECT value FROM game_config WHERE key = $1', [rateKey]);
      if (rateCheck.rows.length) {
        const lastTs = parseInt(rateCheck.rows[0].value, 10) || 0;
        if (Date.now() - lastTs < 30_000) return res.json({ ok: false, reason: 'rate_limited' });
      }
      await pool.query(
        `INSERT INTO game_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [rateKey, String(Date.now())]).catch(() => {});
    } else {
      // All other actions: dedup per device per day. The OLD logic baked the
      // raw JSON(meta) into the key, which let a cheater bypass dedup by
      // sending meta:{x:Math.random()} — unlimited daily rewards. New logic:
      //   - Only the score_milestone action legitimately differentiates by
      //     meta (one row per milestone tier the player crossed). Allowlist.
      //   - That meta is validated against a fixed ALLOWED_MILESTONES list,
      //     so a cheater can't invent fake milestones to fan out the keyspace.
      //   - Everything else dedups purely on action+date.
      const META_DEDUP_ACTIONS = new Set(['score_milestone']);
      let validatedMeta = null;
      if (action === 'score_milestone' && meta && typeof meta === 'object') {
        const m = parseInt(meta.milestone, 10);
        const ALLOWED_MILESTONES = [10000, 25000, 50000, 100000, 250000, 500000, 1000000];
        if (ALLOWED_MILESTONES.includes(m)) validatedMeta = { milestone: m };
      }
      const metaKey = META_DEDUP_ACTIONS.has(action) && validatedMeta
        ? ':' + JSON.stringify(validatedMeta)
        : '';
      const dedupKey = action + ':' + today + metaKey;
      const dup = await pool.query(
        `SELECT 1 FROM game_config WHERE key = $1`, ['_earn:' + deviceId + ':' + dedupKey]);
      if (dup.rows.length) return res.json({ ok: false, reason: 'already_earned' });
      // Save dedup key. Log (don't swallow) failures — a silent failure here
      // would let the next call to /earn look like a first call, undoing dedup.
      await pool.query(
        `INSERT INTO game_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        ['_earn:' + deviceId + ':' + dedupKey, '1']
      ).catch((err) => {
        console.error('[earn] dedup-key insert failed', err.message, 'key=', '_earn:' + deviceId + ':' + dedupKey);
      });
    }

    // Calculate reward
    let reward;
    if (action === 'event_gift') {
      // The client suggests an amount in meta.amount (it rolled the dice locally
      // for UX), but the SERVER clamps to [event_gift_credits_min,
      // event_gift_credits_max]. This is the legacy path — new code should use
      // POST /api/player/gift where the server rolls the dice itself.
      const minRow = await pool.query(`SELECT value FROM game_config WHERE key = 'event_gift_credits_min'`);
      const maxRow = await pool.query(`SELECT value FROM game_config WHERE key = 'event_gift_credits_max'`);
      const minC = parseInt((minRow.rows[0] || {}).value, 10) || 5;
      const maxC = parseInt((maxRow.rows[0] || {}).value, 10) || 50;
      const requested = parseInt((meta && meta.amount) || 0, 10) || 0;
      reward = Math.min(Math.max(requested, minC), maxC);
    } else if (action === 'comeback') {
      // Server-decided amount by absence tier. Client sends meta.daysSince
      // for transparency, but the server enforces the buckets.
      const days = parseInt((meta && meta.daysSince) || 0, 10) || 0;
      if (days < 2) return res.json({ ok: false, reason: 'not_eligible' });
      // Tiered rewards — pulled from game_config with sensible defaults so
      // admins can tune them without code changes.
      const lvlA = await pool.query(`SELECT value FROM game_config WHERE key = 'comeback_reward_short'`);
      const lvlB = await pool.query(`SELECT value FROM game_config WHERE key = 'comeback_reward_mid'`);
      const lvlC = await pool.query(`SELECT value FROM game_config WHERE key = 'comeback_reward_long'`);
      const shortR = parseInt((lvlA.rows[0] || {}).value, 10) || 50;   // 2-6 days
      const midR   = parseInt((lvlB.rows[0] || {}).value, 10) || 100;  // 7-29 days
      const longR  = parseInt((lvlC.rows[0] || {}).value, 10) || 200;  // 30+ days
      reward = days >= 30 ? longR : days >= 7 ? midR : shortR;
    } else {
      const cfgRow = await pool.query('SELECT value FROM game_config WHERE key = $1', [configKey]);
      reward = parseInt((cfgRow.rows[0] || {}).value, 10) || 0;
    }
    if (reward <= 0) return res.json({ ok: false, reason: 'reward_disabled' });

    // Award credits + XP
    const xpGain = XP_MAP[action] || 10;
    const oldXp = (player.rows[0].xp || 0);
    const newXp = oldXp + xpGain;
    const oldLevel = calcLevel(oldXp);
    const newLevel = calcLevel(newXp);
    const leveledUp = newLevel.level > oldLevel.level;

    await pool.query(
      `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, xp = COALESCE(xp, 0) + $2, level = $3 WHERE device_id = $4`,
      [reward, xpGain, newLevel.level, deviceId]);

    const newBal = player.rows[0].balance + reward;
    res.json({ ok: true, action, reward, xpGain, newBalance: newBal, level: newLevel, leveledUp });
  } catch (e) {
    console.error('player/earn', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/gift — server-decided gift event.
// Replaces the legacy earnCredits('event_gift', {amount}) path where the
// client controlled the amount. Here the SERVER rolls the jackpot dice and
// pays out, so a DevTools loop cannot inflate credits. Same rate-limit
// pattern as the legacy path (30s gate + 20/hr cap) shared via the
// 'gift:hourly' bucket and '_gift_rate:<device>' game_config row.
app.post('/api/player/gift', requireDeviceAuth, async (req, res) => {
  const deviceId = req.deviceId;
  try {
    const player = await pool.query('SELECT balance FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!player.rows.length) return res.json({ ok: false, reason: 'no_profile' });
    if (!checkRateLimit('gift:hourly', deviceId, 20, 60 * 60 * 1000)) {
      return res.json({ ok: false, reason: 'rate_limited_hour' });
    }
    const rateKey = '_gift_rate:' + deviceId;
    const rateCheck = await pool.query('SELECT value FROM game_config WHERE key = $1', [rateKey]);
    if (rateCheck.rows.length) {
      const lastTs = parseInt(rateCheck.rows[0].value, 10) || 0;
      if (Date.now() - lastTs < 30_000) return res.json({ ok: false, reason: 'rate_limited' });
    }
    await pool.query(
      `INSERT INTO game_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [rateKey, String(Date.now())]).catch(() => {});

    const cfgRows = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'event_gift_%'`);
    const cfg = {};
    for (const r of cfgRows.rows) cfg[r.key] = r.value;
    const minC = parseInt(cfg.event_gift_credits_min, 10) || 5;
    const maxC = parseInt(cfg.event_gift_credits_max, 10) || 50;
    const jpChance = parseInt(cfg.event_gift_jackpot_chance, 10) || 5;
    const jpAmount = parseInt(cfg.event_gift_jackpot_amount, 10) || 200;
    const isJackpot = Math.random() * 100 < jpChance;
    const reward = isJackpot
      ? jpAmount
      : (minC + Math.floor(Math.random() * (maxC - minC + 1)));

    const upd = await pool.query(
      `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1
       WHERE device_id = $2 RETURNING balance`,
      [reward, deviceId]);
    res.json({
      ok: true,
      reward,
      isJackpot,
      newBalance: upd.rows.length ? upd.rows[0].balance : (player.rows[0].balance + reward)
    });
  } catch (e) {
    console.error('player/gift', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/ad-watch — claim a "watch ad" reward, tied to a single
// game (gameId). The old flow paid via /api/player/earn action='event_gift',
// which (a) used the wrong cap (event_gift_credits_max=10 by admin config
// instead of ad_watch_reward=30), and (b) had only a 30s cooldown so a
// player who finishes a game and refreshes can farm 200💎/hour indefinitely.
// New flow: each game can claim at most one ad reward, plus a per-day cap
// (ad_daily_cap, default 5) and 30s cooldown. Refreshing the page does not
// create new gameIds — sessionStorage on the client preserves the same id.
app.post('/api/player/ad-watch', requireDeviceAuth, async (req, res) => {
  const deviceId = req.deviceId;
  const gameId = String((req.body && req.body.gameId) || '').slice(0, 64);
  if (!gameId || !/^[A-Za-z0-9_-]{8,64}$/.test(gameId)) {
    return res.status(400).json({ error: 'bad_game_id' });
  }
  try {
    const player = await pool.query('SELECT balance FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!player.rows.length) return res.json({ ok: false, reason: 'no_profile' });

    // Per-game dedup. One claim per (device, gameId), forever.
    const dedupKey = '_ad:' + deviceId + ':' + gameId;
    const dup = await pool.query(`SELECT 1 FROM game_config WHERE key = $1`, [dedupKey]);
    if (dup.rows.length) return res.json({ ok: false, reason: 'already_claimed' });

    // Read all relevant config in one round-trip.
    const cfgRows = await pool.query(
      `SELECT key, value FROM game_config WHERE key IN
       ('ad_watch_reward','ad_cooldown_seconds','ad_daily_cap')`);
    const cfg = {};
    for (const r of cfgRows.rows) cfg[r.key] = r.value;
    const reward    = Math.max(1, parseInt(cfg.ad_watch_reward, 10) || 30);
    const cooldownS = Math.max(0, parseInt(cfg.ad_cooldown_seconds, 10) || 30);
    const dailyCap  = Math.max(1, parseInt(cfg.ad_daily_cap, 10) || 5);

    // Cooldown gate (separate from event_gift's gate so they don't interfere).
    const rateKey = '_ad_rate:' + deviceId;
    const rateRow = await pool.query(`SELECT value FROM game_config WHERE key = $1`, [rateKey]);
    if (rateRow.rows.length && cooldownS > 0) {
      const lastTs = parseInt(rateRow.rows[0].value, 10) || 0;
      const waitMs = cooldownS * 1000 - (Date.now() - lastTs);
      if (waitMs > 0) return res.json({ ok: false, reason: 'rate_limited', cooldownMs: waitMs });
    }

    // Per-day cap. Key is `_ad_count:<device>:<YYYY-MM-DD>` storing the count.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const countKey = '_ad_count:' + deviceId + ':' + today;
    const countRow = await pool.query(`SELECT value FROM game_config WHERE key = $1`, [countKey]);
    const usedToday = countRow.rows.length ? (parseInt(countRow.rows[0].value, 10) || 0) : 0;
    if (usedToday >= dailyCap) {
      return res.json({ ok: false, reason: 'daily_cap', dailyCap, usedToday });
    }

    // Atomic-ish claim sequence. game_config is keyed so duplicate writes are
    // safe via ON CONFLICT DO UPDATE. The dedup key insert serializes the
    // claim — two concurrent requests for the same gameId race here, and
    // exactly one will land the row (PK on key), the other returns
    // already_claimed on the next pass.
    const dedupInsert = await pool.query(
      `INSERT INTO game_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING
       RETURNING 1`,
      [dedupKey, '1']);
    if (!dedupInsert.rows.length) {
      return res.json({ ok: false, reason: 'already_claimed' });
    }

    // Mark cooldown + bump per-day counter + pay reward.
    await pool.query(
      `INSERT INTO game_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [rateKey, String(Date.now())]);
    await pool.query(
      `INSERT INTO game_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = (game_config.value::int + 1)::text, updated_at = NOW()`,
      [countKey, String(usedToday + 1)]);
    const upd = await pool.query(
      `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1
         WHERE device_id = $2 RETURNING balance`,
      [reward, deviceId]);
    res.json({
      ok: true,
      reward,
      newBalance: upd.rows.length ? upd.rows[0].balance : (player.rows[0].balance + reward),
      dailyRemaining: Math.max(0, dailyCap - usedToday - 1),
      dailyCap
    });
  } catch (e) {
    console.error('player/ad-watch', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/gift-friend — player-to-player gem gift.
// Sender → recipient transfer + creates a player_gifts row that the
// recipient sees as a notification banner on next app open.
// Server-enforced: amount in [5, 200], no self-gifts, 10/day rate limit,
// atomic balance update with WHERE balance >= amount race safety.
app.post('/api/player/gift-friend', requireDeviceAuth, async (req, res) => {
  const deviceId = req.deviceId;
  const { recipientCode, amount, message } = req.body || {};
  if (!recipientCode || typeof recipientCode !== 'string') {
    return res.status(400).json({ ok: false, reason: 'missing_recipient' });
  }
  const normCode = recipientCode.trim().toUpperCase().replace(/^BLOOM-/, '');
  const fullCode = 'BLOOM-' + normCode;
  if (!/^BLOOM-[A-HJ-NP-Z2-9]{4}$/.test(fullCode)) {
    return res.json({ ok: false, reason: 'bad_code' });
  }
  const amt = parseInt(amount, 10) || 0;
  if (amt < 5 || amt > 200) {
    return res.json({ ok: false, reason: 'bad_amount' });
  }
  if (!checkRateLimit('gift_friend:daily', deviceId, 10, 24 * 60 * 60 * 1000)) {
    return res.json({ ok: false, reason: 'rate_limited_daily' });
  }
  try {
    // Look up sender + recipient by code
    const senderRow = await pool.query(
      'SELECT device_id, player_code, display_name, balance FROM player_profiles WHERE device_id = $1',
      [deviceId]);
    if (!senderRow.rows.length) return res.json({ ok: false, reason: 'no_sender_profile' });
    const sender = senderRow.rows[0];
    if (sender.player_code === fullCode) return res.json({ ok: false, reason: 'no_self_gift' });

    const recipientRow = await pool.query(
      'SELECT device_id, player_code FROM player_profiles WHERE player_code = $1',
      [fullCode]);
    if (!recipientRow.rows.length) return res.json({ ok: false, reason: 'recipient_not_found' });
    const recipient = recipientRow.rows[0];

    const safeMessage = (message || '').toString().trim().slice(0, 200) || null;

    // Atomic transfer: deduct from sender (with race-safe WHERE balance>=),
    // credit recipient, insert gift row. Wrapped in a transaction so a
    // partial failure doesn't leave the ledger inconsistent.
    let newBalance = sender.balance;
    await pool.query('BEGIN');
    try {
      const deduct = await pool.query(
        `UPDATE player_profiles
            SET balance = balance - $1, total_spent = total_spent + $1
          WHERE device_id = $2 AND balance >= $1
          RETURNING balance`,
        [amt, deviceId]);
      if (!deduct.rows.length) {
        await pool.query('ROLLBACK');
        return res.json({ ok: false, reason: 'insufficient_balance' });
      }
      newBalance = deduct.rows[0].balance;
      await pool.query(
        `UPDATE player_profiles
            SET balance = balance + $1, total_earned = total_earned + $1
          WHERE device_id = $2`,
        [amt, recipient.device_id]);
      await pool.query(
        `INSERT INTO player_gifts
           (sender_device, sender_code, sender_name, recipient_device, recipient_code, amount, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [deviceId, sender.player_code, sender.display_name, recipient.device_id, fullCode, amt, safeMessage]);
      await pool.query('COMMIT');
    } catch (txErr) {
      await pool.query('ROLLBACK');
      throw txErr;
    }
    res.json({ ok: true, amount: amt, recipientCode: fullCode, newBalance });
  } catch (e) {
    console.error('player/gift-friend', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/player/gifts/inbox — unseen gifts for this device.
// Marks them seen as a side effect — the banner is for first-sight,
// the gem balance is already credited, so we don't want the same
// gift to keep re-toasting on every poll.
app.get('/api/player/gifts/inbox', async (req, res) => {
  const deviceId = String(req.query.deviceId || '').slice(0, 64);
  if (!deviceId) return res.status(400).json({ error: 'missing_device' });
  try {
    const rows = await pool.query(
      `SELECT id, sender_code, sender_name, amount, message, created_at
         FROM player_gifts
        WHERE recipient_device = $1 AND seen_at IS NULL
        ORDER BY created_at DESC
        LIMIT 20`,
      [deviceId]);
    if (rows.rows.length) {
      const ids = rows.rows.map(function(r) { return r.id; });
      // Best-effort mark-as-seen — even if this fails the client can
      // de-dupe via localStorage, so a stuck row doesn't cause infinite
      // banners.
      pool.query(
        `UPDATE player_gifts SET seen_at = NOW() WHERE id = ANY($1::int[])`,
        [ids]).catch(function(e) { console.warn('gifts mark seen', e.message); });
    }
    res.json({ ok: true, gifts: rows.rows });
  } catch (e) {
    console.error('player/gifts/inbox', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/spend — deduct credits (for continue, premium items)
app.post('/api/player/spend', requireDeviceAuth, async (req, res) => {
  const { deviceId, amount } = req.body || {};
  if (!deviceId || !amount || amount <= 0) return res.json({ ok: false, reason: 'invalid' });
  try {
    // Atomic deduct: only succeeds if balance is sufficient. Same WHERE/RETURNING
    // pattern as buy-skin so two concurrent /spend requests can't double-deduct.
    const r = await pool.query(
      `UPDATE player_profiles
          SET balance = balance - $1
        WHERE device_id = $2 AND balance >= $1
        RETURNING balance`,
      [amount, deviceId]);
    if (!r.rows.length) {
      const exists = await pool.query('SELECT 1 FROM player_profiles WHERE device_id = $1', [deviceId]);
      return res.json({ ok: false, reason: exists.rows.length ? 'insufficient' : 'not_found' });
    }
    res.json({ ok: true, newBalance: r.rows[0].balance });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server' });
  }
});

// GET /api/tile-prices — get current tile prices for in-game shop
app.get('/api/tile-prices', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'tile_%'`);
    const cfg = {};
    for (const row of r.rows) cfg[row.key] = row.value;
    if (cfg.tile_shop_enabled === 'false') return res.json({ ok: true, enabled: false });
    const mult = parseFloat(cfg.tile_price_multiplier) || 1.0;
    const prices = {};
    for (let t = 2; t <= 8; t++) {
      prices[t] = Math.round((parseInt(cfg['tile_price_' + t], 10) || (t * 10)) * mult);
    }
    res.json({ ok: true, enabled: true, prices, multiplier: mult });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/buy-powerup — buy a delete power-up
// NOTE: there used to be a `refund` branch here that credited arbitrary
// `refundAmount` (capped at 1000) without any proof of prior purchase.
// That let anyone inflate their balance up to 1000 💎 per call. Removed.
// Cancel UX is now local-only on the client.
app.post('/api/player/buy-powerup', requireDeviceAuth, async (req, res) => {
  const { deviceId, powerup } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'missing_params' });
  if (!powerup) return res.status(400).json({ error: 'missing_params' });
  const validPowerups = ['powerup_random_tile', 'powerup_choose_tile', 'powerup_random_row', 'powerup_choose_row'];
  if (!validPowerups.includes(powerup)) return res.json({ ok: false, reason: 'invalid_powerup' });
  try {
    const priceRow = await pool.query(`SELECT value FROM game_config WHERE key = $1`, [powerup]);
    const cost = parseInt((priceRow.rows[0] || {}).value, 10) || 0;
    if (cost <= 0) return res.json({ ok: false, reason: 'powerup_disabled' });
    // Atomic deduct prevents two concurrent buy-powerup requests from each
    // passing a stale SELECT check and double-deducting.
    const r = await pool.query(
      `UPDATE player_profiles
          SET balance = balance - $1, total_spent = total_spent + $1
        WHERE device_id = $2 AND balance >= $1
        RETURNING balance`,
      [cost, deviceId]);
    if (!r.rows.length) {
      const exists = await pool.query('SELECT 1 FROM player_profiles WHERE device_id = $1', [deviceId]);
      return res.json({ ok: false, reason: exists.rows.length ? 'insufficient_balance' : 'no_profile' });
    }
    res.json({ ok: true, powerup, cost, newBalance: r.rows[0].balance });
  } catch (e) {
    console.error('buy-powerup', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/buy-tile — buy a specific tile during gameplay
app.post('/api/player/buy-tile', requireDeviceAuth, async (req, res) => {
  const { deviceId, tier } = req.body || {};
  if (!deviceId || !tier) return res.status(400).json({ error: 'missing_params' });
  try {
    const t = parseInt(tier, 10);
    if (t < 2 || t > 8) return res.json({ ok: false, reason: 'invalid_tier' });
    // Check tile shop enabled
    const enabledRow = await pool.query(`SELECT value FROM game_config WHERE key = 'tile_shop_enabled'`);
    if (enabledRow.rows.length && enabledRow.rows[0].value === 'false') return res.json({ ok: false, reason: 'shop_disabled' });
    // Get price
    const priceRow = await pool.query(`SELECT value FROM game_config WHERE key = $1`, ['tile_price_' + t]);
    const multRow = await pool.query(`SELECT value FROM game_config WHERE key = 'tile_price_multiplier'`);
    const basePrice = parseInt((priceRow.rows[0] || {}).value, 10) || (t * 10);
    const mult = parseFloat((multRow.rows[0] || {}).value) || 1.0;
    const cost = Math.round(basePrice * mult);
    // Atomic deduct: passes only if balance is sufficient.
    const r = await pool.query(
      `UPDATE player_profiles
          SET balance = balance - $1, total_spent = total_spent + $1
        WHERE device_id = $2 AND balance >= $1
        RETURNING balance`,
      [cost, deviceId]);
    if (!r.rows.length) {
      const exists = await pool.query('SELECT 1 FROM player_profiles WHERE device_id = $1', [deviceId]);
      return res.json({ ok: false, reason: exists.rows.length ? 'insufficient_balance' : 'no_profile' });
    }
    res.json({ ok: true, tier: t, cost, newBalance: r.rows[0].balance });
  } catch (e) {
    console.error('buy-tile', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/buy-skin — purchase a skin with credits.
// Price comes from SKIN_PRICES (server-authoritative). Records ownership in
// player_skins in the SAME transaction as the balance deduction, so a player
// can never end up debited without the skin (or with the skin but not debited).
// If the player already owns the skin, returns ok:true cost:0 alreadyOwned:true
// without re-charging.
app.post('/api/player/buy-skin', requireDeviceAuth, async (req, res) => {
  const { deviceId, skinId } = req.body || {};
  if (!deviceId || !skinId) return res.status(400).json({ error: 'missing_params' });
  if (!Object.prototype.hasOwnProperty.call(SKIN_PRICES, skinId)) {
    return res.json({ ok: false, reason: 'invalid_skin' });
  }
  const cost = SKIN_PRICES[skinId] | 0;
  try {
    // Already owns? Free no-op.
    const owned = await pool.query(
      `SELECT 1 FROM player_skins WHERE device_id = $1 AND skin_id = $2`,
      [deviceId, skinId]);
    if (owned.rows.length) {
      const bal = await pool.query('SELECT balance FROM player_profiles WHERE device_id = $1', [deviceId]);
      return res.json({
        ok: true, skinId, cost: 0, alreadyOwned: true,
        newBalance: bal.rows.length ? bal.rows[0].balance : 0
      });
    }
    // Atomic deduct + ownership insert in a single transaction. If the deduct
    // fails (insufficient balance), the ownership row never lands either.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `UPDATE player_profiles
            SET balance = balance - $1, total_spent = total_spent + $1
          WHERE device_id = $2 AND balance >= $1
          RETURNING balance`,
        [cost, deviceId]);
      if (!r.rows.length) {
        await client.query('ROLLBACK');
        const p = await pool.query('SELECT 1 FROM player_profiles WHERE device_id = $1', [deviceId]);
        return res.json({ ok: false, reason: p.rows.length ? 'insufficient_balance' : 'no_profile' });
      }
      await client.query(
        `INSERT INTO player_skins (device_id, skin_id) VALUES ($1, $2)
         ON CONFLICT (device_id, skin_id) DO NOTHING`,
        [deviceId, skinId]);
      await client.query('COMMIT');
      res.json({ ok: true, skinId, cost, newBalance: r.rows[0].balance });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('buy-skin', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/player/skins — list owned skin IDs for a device.
// No auth needed: just exposes what the player already paid for, keyed by
// their own deviceId. Client calls on boot to sync OWNED_SKINS_KEY in
// localStorage from the authoritative server list.
app.get('/api/player/skins', async (req, res) => {
  const deviceId = String(req.query.deviceId || '').slice(0, 64);
  if (!deviceId || deviceId.length < 8) return res.status(400).json({ error: 'bad_device' });
  try {
    const r = await pool.query(
      `SELECT skin_id FROM player_skins WHERE device_id = $1 ORDER BY purchased_at ASC`,
      [deviceId]);
    res.json({ ok: true, skins: r.rows.map(row => row.skin_id) });
  } catch (e) {
    console.error('GET /api/player/skins', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/skins/declare — one-time legacy migration.
// Before this phase, ownership was localStorage-only; legitimate buyers have
// skins on their device that the server doesn't know about. On first boot
// after deploy, the client posts its localStorage list once; the server
// records only valid SKIN_IDs. After the first call, GET /api/player/skins
// is authoritative and this endpoint becomes a no-op for that device.
// (We accept it idempotently — the ON CONFLICT DO NOTHING means a replay
// can't *remove* skins, only add. Worst case: a DevTools user gives
// themselves skins they didn't pay for, but that exploit existed before
// this phase too. The point now is that the DB becomes the source of truth
// going forward.)
app.post('/api/player/skins/declare', requireDeviceAuth, async (req, res) => {
  const deviceId = req.deviceId;
  const skins = Array.isArray(req.body && req.body.skins) ? req.body.skins : [];
  // Rate-limit just in case — one player declaring 1000 random strings is bounded.
  if (!checkRateLimit('skins:declare', deviceId, 3, 24 * 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  const valid = skins.filter(s =>
    typeof s === 'string' && Object.prototype.hasOwnProperty.call(SKIN_PRICES, s));
  try {
    for (const s of valid) {
      await pool.query(
        `INSERT INTO player_skins (device_id, skin_id) VALUES ($1, $2)
         ON CONFLICT (device_id, skin_id) DO NOTHING`,
        [deviceId, s]);
    }
    res.json({ ok: true, declared: valid.length });
  } catch (e) {
    console.error('POST /api/player/skins/declare', e.message);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/referral', requireDeviceAuth, async (req, res) => {
  const { deviceId, refCode } = req.body || {};
  if (!deviceId || !refCode) return res.status(400).json({ error: 'missing_params' });
  // Rate-limit referrals at 3/day/device on top of the ping requirement below,
  // so a single device can't burn through codes even if /api/ping has been hit.
  if (!checkRateLimit('referral', deviceId, 3, 24 * 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  try {
    // Refuse referrals from devices that haven't actually visited the site yet.
    // /api/ping fires on every page boot, so a real visitor will always have a
    // row. A fresh fake UUID + direct /referral hit will fail here.
    const visited = await pool.query(
      `SELECT 1 FROM device_visits WHERE device_id = $1 LIMIT 1`, [deviceId]);
    if (!visited.rows.length) return res.json({ ok: false, reason: 'device_not_seen' });
    // Check: can't refer yourself
    const self = await pool.query(
      'SELECT player_code FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (self.rows.length && self.rows[0].player_code === refCode) {
      return res.json({ ok: false, reason: 'self_referral' });
    }
    // Check: already referred?
    const alreadyReferred = await pool.query(
      'SELECT id FROM referrals WHERE referred_device = $1', [deviceId]);
    if (alreadyReferred.rows.length) {
      return res.json({ ok: false, reason: 'already_referred' });
    }
    // Find referrer
    const referrer = await pool.query(
      'SELECT device_id FROM player_profiles WHERE player_code = $1', [refCode]);
    if (!referrer.rows.length) {
      return res.json({ ok: false, reason: 'invalid_code' });
    }
    const referrerDevice = referrer.rows[0].device_id;
    // Read reward amounts from game_config
    const cfgRows = await pool.query(`SELECT key, value FROM game_config WHERE key IN ('referral_enabled','referral_reward','referred_bonus')`);
    const cfg = {};
    for (const r of cfgRows.rows) cfg[r.key] = r.value;
    if (cfg.referral_enabled === 'false') return res.json({ ok: false, reason: 'referrals_disabled' });
    const reward = parseInt(cfg.referral_reward, 10) || 50;
    const bonus = parseInt(cfg.referred_bonus, 10) || 25;
    // Record referral
    await pool.query(
      `INSERT INTO referrals (referrer_code, referrer_device, referred_device, credits_awarded)
       VALUES ($1, $2, $3, $4)`,
      [refCode, referrerDevice, deviceId, reward]);
    // Award credits to referrer
    await pool.query(
      `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1
       WHERE device_id = $2`, [reward, referrerDevice]);
    // Award welcome bonus to referred player (if they have a profile)
    await pool.query(
      `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1,
       referred_by = $2 WHERE device_id = $3`, [bonus, refCode, deviceId]);
    res.json({ ok: true, referrerReward: reward, referredReward: bonus });
  } catch (e) {
    console.error('referral', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// 1v1 DUELS
// ============================================================

// Create a duel challenge
app.post('/api/duels', requireDeviceAuth, async (req, res) => {
  const { deviceId, opponentCode, amount, difficulty } = req.body || {};
  if (!deviceId || !opponentCode) return res.status(400).json({ error: 'missing_params' });
  try {
    const duelEnabled = await pool.query(`SELECT value FROM game_config WHERE key = 'duel_enabled'`);
    if (duelEnabled.rows.length && duelEnabled.rows[0].value === 'false') return res.json({ ok: false, reason: 'duels_disabled' });

    const challenger = await pool.query('SELECT player_code, display_name FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!challenger.rows.length) return res.json({ ok: false, reason: 'no_profile' });
    if (challenger.rows[0].player_code === opponentCode) return res.json({ ok: false, reason: 'self_duel' });

    const bet = Math.max(0, parseInt(amount, 10) || 0);

    // Check opponent exists
    const opponent = await pool.query('SELECT device_id, display_name FROM player_profiles WHERE player_code = $1', [opponentCode]);
    if (!opponent.rows.length) return res.json({ ok: false, reason: 'opponent_not_found' });

    const timeoutH = await pool.query(`SELECT value FROM game_config WHERE key = 'duel_timeout_hours'`);
    const hours = parseInt((timeoutH.rows[0] || {}).value, 10) || 24;
    const seed = Math.floor(Math.random() * 2147483647);
    const expiresAt = new Date(Date.now() + hours * 3600000);

    // Atomic deduct from challenger — only if balance is sufficient. No SELECT race.
    if (bet > 0) {
      const deduct = await pool.query(
        `UPDATE player_profiles
            SET balance = balance - $1, total_spent = total_spent + $1
          WHERE device_id = $2 AND balance >= $1
          RETURNING balance`,
        [bet, deviceId]);
      if (!deduct.rows.length) return res.json({ ok: false, reason: 'insufficient_balance' });
    }

    const diff = resolveDifficulty(difficulty);

    const r = await pool.query(
      `INSERT INTO duels (challenger_device, challenger_name, challenger_code, opponent_code, opponent_device, opponent_name, amount, board_seed, expires_at, difficulty_label, difficulty_weights, difficulty_speed_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [deviceId, challenger.rows[0].display_name, challenger.rows[0].player_code, opponentCode, opponent.rows[0].device_id, opponent.rows[0].display_name, bet, seed, expiresAt, diff.label, diff.weights, diff.speed_pct]);

    // Return the FULL row so the challenger can start their game immediately
    // (Bug 3 fix). The frontend needs difficulty_weights, opponent_name, and
    // board_seed to kick off startDuelGame without waiting for opponent accept.
    res.json({ ok: true, duel: r.rows[0], duelId: r.rows[0].id, seed, amount: bet, expiresAt, difficulty: diff.label });
  } catch (e) {
    console.error('duels/create', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// Get my duels (pending, active, completed)
app.get('/api/duels/mine', async (req, res) => {
  const deviceId = req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: 'missing_device' });
  try {
    // Lazy cleanup: sweep stale pending duels FIRST so the response
    // already reflects the auto-expired ones (no "still pending"
    // ghosts in the player's list).
    await expireStalePendingDuels();
    const playerCode = await pool.query('SELECT player_code FROM player_profiles WHERE device_id = $1', [deviceId]);
    const code = playerCode.rows.length ? playerCode.rows[0].player_code : '';
    const r = await pool.query(
      `SELECT * FROM duels WHERE challenger_device = $1 OR opponent_device = $1 OR opponent_code = $2
       ORDER BY created_at DESC LIMIT 20`, [deviceId, code]);
    res.json({ ok: true, duels: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
});

// Accept a duel
app.post('/api/duels/:id/accept', requireDeviceAuth, async (req, res) => {
  const { deviceId } = req.body || {};
  const duelId = parseInt(req.params.id, 10);
  try {
    const d = await pool.query('SELECT * FROM duels WHERE id = $1', [duelId]);
    if (!d.rows.length) return res.json({ ok: false, reason: 'not_found' });
    const duel = d.rows[0];
    if (duel.status !== 'pending') return res.json({ ok: false, reason: 'not_pending' });
    if (new Date(duel.expires_at) < new Date()) return res.json({ ok: false, reason: 'expired' });

    // Verify this is the opponent
    const player = await pool.query('SELECT player_code FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!player.rows.length || player.rows[0].player_code !== duel.opponent_code) return res.json({ ok: false, reason: 'not_opponent' });

    const bet = duel.amount | 0;
    if (bet > 0) {
      // Atomic deduct — no SELECT race.
      const deduct = await pool.query(
        `UPDATE player_profiles
            SET balance = balance - $1, total_spent = total_spent + $1
          WHERE device_id = $2 AND balance >= $1
          RETURNING balance`,
        [bet, deviceId]);
      if (!deduct.rows.length) return res.json({ ok: false, reason: 'insufficient_balance' });
    }
    await pool.query(`UPDATE duels SET status = 'accepted', opponent_device = $1 WHERE id = $2`, [deviceId, duelId]);
    // If the challenger already submitted a score while the duel was pending
    // (the new "challenger plays immediately" flow), we don't auto-settle here
    // because the opponent hasn't played yet. They'll submit, and the score
    // endpoint will detect both scores present and settle. The reload below
    // returns the freshly accepted duel including any pre-existing
    // challenger_score so the client can show it as the live target.
    const reloaded = await pool.query('SELECT * FROM duels WHERE id = $1', [duelId]);
    res.json({ ok: true, duel: reloaded.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
});

// Lazy auto-expiry — runs on every duel read. Atomic + idempotent:
// any pending duel past its expires_at is transitioned to 'expired',
// the challenger's wager is refunded, and the refund is journalled to
// wager_settlements. No background cron is needed — players naturally
// trigger this when they open the duel modal or poll a result.
//
// SELECT ... FOR UPDATE is overkill for this volume; the WHERE clause
// with status='pending' makes the UPDATE itself race-safe (a concurrent
// /accept or /decline would have flipped the status first and our
// UPDATE would no-op via RETURNING 0 rows).
async function expireStalePendingDuels() {
  try {
    const stale = await pool.query(
      `UPDATE duels
          SET status = 'expired'
        WHERE status = 'pending' AND expires_at < NOW()
       RETURNING id, challenger_device, amount`);
    if (!stale.rows.length) return;
    // Refund each expired duel's wager in parallel — small N, safe.
    await Promise.all(stale.rows.map(async function(row) {
      const bet = row.amount | 0;
      if (bet > 0 && row.challenger_device) {
        try {
          await pool.query(
            `UPDATE player_profiles
                SET balance = balance + $1, total_spent = total_spent - $1
              WHERE device_id = $2`,
            [bet, row.challenger_device]);
          await pool.query(
            `INSERT INTO wager_settlements (contest_code, device_id, amount, type)
             VALUES ($1, $2, $3, 'duel_expire_refund')`,
            ['DUEL:' + row.id, row.challenger_device, bet]);
        } catch (refundErr) {
          // Best-effort — never throw from the auto-expire path.
          console.warn('duel expire refund failed', row.id, refundErr.message);
        }
      }
    }));
  } catch (e) {
    console.warn('expireStalePendingDuels swallowed', e.message);
  }
}

// POST /api/duels/:id/decline — opponent rejects a pending duel.
// Refunds the challenger's wager if any. Atomic + race-safe via the
// status='pending' guard on the UPDATE. Only the named opponent can
// decline (verified by player_code, same pattern as /accept).
app.post('/api/duels/:id/decline', requireDeviceAuth, async (req, res) => {
  const deviceId = req.deviceId;
  const duelId = parseInt(req.params.id, 10);
  if (!Number.isFinite(duelId) || duelId <= 0) return res.status(400).json({ error: 'bad_id' });
  try {
    const d = await pool.query('SELECT * FROM duels WHERE id = $1', [duelId]);
    if (!d.rows.length) return res.json({ ok: false, reason: 'not_found' });
    const duel = d.rows[0];
    if (duel.status !== 'pending') return res.json({ ok: false, reason: 'not_pending' });

    // Verify this device is the opponent (by player_code, like /accept).
    const player = await pool.query('SELECT player_code FROM player_profiles WHERE device_id = $1', [deviceId]);
    if (!player.rows.length || player.rows[0].player_code !== duel.opponent_code) {
      return res.json({ ok: false, reason: 'not_opponent' });
    }

    // Atomic transition + refund. The status='pending' guard on the
    // UPDATE makes the whole thing race-safe against concurrent accepts.
    await pool.query('BEGIN');
    try {
      const upd = await pool.query(
        `UPDATE duels SET status = 'declined' WHERE id = $1 AND status = 'pending' RETURNING 1`,
        [duelId]);
      if (!upd.rows.length) {
        await pool.query('ROLLBACK');
        return res.json({ ok: false, reason: 'race' });
      }
      // Refund the challenger's wager if one was on the table.
      const bet = duel.amount | 0;
      if (bet > 0 && duel.challenger_device) {
        await pool.query(
          `UPDATE player_profiles
              SET balance = balance + $1, total_spent = total_spent - $1
            WHERE device_id = $2`,
          [bet, duel.challenger_device]);
        await pool.query(
          `INSERT INTO wager_settlements (contest_code, device_id, amount, type)
           VALUES ($1, $2, $3, 'duel_decline_refund')`,
          ['DUEL:' + duelId, duel.challenger_device, bet]);
      }
      await pool.query('COMMIT');
    } catch (txErr) {
      await pool.query('ROLLBACK');
      throw txErr;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/duels/:id/decline', e);
    res.status(500).json({ error: 'server' });
  }
});

// GET single duel by id (used for polling after submitting a duel score —
// the player's UI watches this for the opponent's score to come in).
// We hide the opponent's score from a viewer who has not yet submitted their
// own, so a cheater can't peek at the target before playing.
app.get('/api/duels/:id', async (req, res) => {
  const duelId = parseInt(req.params.id, 10);
  if (!duelId) return res.status(400).json({ error: 'bad_id' });
  const viewerDeviceId = String(req.query.deviceId || '').slice(0, 64);
  try {
    // Same lazy sweep as /mine — so a player polling their own duel
    // sees it auto-flip to 'expired' the moment expires_at passes,
    // not the next time someone else triggers a sweep.
    await expireStalePendingDuels();
    const r = await pool.query('SELECT * FROM duels WHERE id = $1', [duelId]);
    if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
    const d = r.rows[0];
    if (d.status !== 'settled' && d.status !== 'tie') {
      const iAmChallenger = viewerDeviceId === d.challenger_device;
      const iAmOpponent   = viewerDeviceId === d.opponent_device;
      if (iAmChallenger && d.challenger_score == null) d.opponent_score = null;
      if (iAmOpponent   && d.opponent_score == null)   d.challenger_score = null;
      if (!iAmChallenger && !iAmOpponent) {
        d.challenger_score = null;
        d.opponent_score = null;
      }
    }
    res.json({ ok: true, duel: d });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
});

// Submit duel score. We accept submissions for both 'pending' (challenger
// already playing before opponent accepts) and 'accepted'. Settlement runs
// when both scores are present, regardless of status — see also
// /api/duels/:id/accept which calls the same settlement path if the
// challenger had already submitted.
app.post('/api/duels/:id/score', requireDeviceAuth, async (req, res) => {
  const { deviceId, score, drops, token } = req.body || {};
  const duelId = parseInt(req.params.id, 10);
  if (!duelId) return res.status(400).json({ error: 'bad_id' });
  if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
    return res.status(400).json({ error: 'bad_device' });
  }
  // Soft token check: only reject if token is provided and invalid. Once
  // every client is reliably sending tokens we can switch to hard-require.
  if (token && !verifyDeviceToken(deviceId, token)) {
    return res.status(403).json({ error: 'bad_token' });
  }
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
    return res.status(400).json({ error: 'bad_score' });
  }
  const dropsN = typeof drops === 'number' && Number.isFinite(drops) && drops >= 0 ? Math.floor(drops) : null;
  if (dropsN === null) {
    console.warn(`[anti-cheat] duel score rejected (no drops): device=${deviceId} score=${score}`);
    return res.status(400).json({ error: 'missing_drops' });
  }
  if (challengeDropsImplausible(Math.floor(score), dropsN)) {
    console.warn(`[anti-cheat] duel score rejected (implausible): device=${deviceId} score=${score} drops=${dropsN}`);
    return res.status(400).json({ error: 'implausible_score' });
  }
  try {
    const d = await pool.query('SELECT * FROM duels WHERE id = $1', [duelId]);
    if (!d.rows.length) return res.json({ ok: false, reason: 'not_found' });
    const duel = d.rows[0];
    if (duel.status !== 'accepted' && duel.status !== 'pending') {
      return res.json({ ok: false, reason: 'duel_closed', status: duel.status });
    }

    const s = Math.floor(score);
    const isChallenger = duel.challenger_device === deviceId;
    // Opponent can submit by device_id (after accepting) OR by player_code (if
    // they're the named opponent but haven't accepted yet — rare but possible
    // when challenger plays and opponent is matched by player code).
    let isOpponent = duel.opponent_device === deviceId;
    if (!isOpponent && duel.opponent_code) {
      const codeCheck = await pool.query('SELECT player_code FROM player_profiles WHERE device_id = $1', [deviceId]);
      if (codeCheck.rows.length && codeCheck.rows[0].player_code === duel.opponent_code) isOpponent = true;
    }
    if (!isChallenger && !isOpponent) return res.json({ ok: false, reason: 'not_participant' });

    // Each side may submit at most ONCE. The WHERE guard makes the UPDATE a
    // no-op if a score is already present, so a player can't replay a higher
    // score after seeing they were going to lose.
    let updated;
    if (isChallenger) {
      updated = await pool.query(
        `UPDATE duels SET challenger_score = $1
           WHERE id = $2 AND challenger_score IS NULL
             AND status IN ('pending','accepted')
           RETURNING 1`,
        [s, duelId]);
    } else {
      updated = await pool.query(
        `UPDATE duels SET opponent_score = $1
           WHERE id = $2 AND opponent_score IS NULL
             AND status IN ('pending','accepted')
           RETURNING 1`,
        [s, duelId]);
    }
    if (!updated.rows.length) {
      return res.json({ ok: false, reason: 'already_submitted' });
    }

    // Check if both scored → settle
    const reloaded = await pool.query('SELECT * FROM duels WHERE id = $1', [duelId]);
    const u = reloaded.rows[0];
    if (u.challenger_score != null && u.opponent_score != null && (u.status === 'pending' || u.status === 'accepted')) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const rake = 5;
        const totalPool = (u.amount | 0) * 2;
        const rakeAmt = Math.round(totalPool * rake / 100);
        const prize = totalPool - rakeAmt;
        let winner = null;
        if (u.challenger_score > u.opponent_score) winner = u.challenger_device;
        else if (u.opponent_score > u.challenger_score) winner = u.opponent_device;

        if (!winner) {
          if ((u.amount | 0) > 0) {
            await client.query(`UPDATE player_profiles SET balance = balance + $1 WHERE device_id = $2`, [u.amount, u.challenger_device]);
            await client.query(`UPDATE player_profiles SET balance = balance + $1 WHERE device_id = $2`, [u.amount, u.opponent_device]);
          }
          // status-guard prevents a double-settle if two requests race here.
          await client.query(`UPDATE duels SET status = 'tie', winner_device = NULL WHERE id = $1 AND status IN ('pending','accepted')`, [duelId]);
          await client.query('COMMIT');
          return res.json({ ok: true, result: 'tie', refunded: true });
        }
        if (prize > 0) {
          await client.query(`UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1 WHERE device_id = $2`, [prize, winner]);
        }
        await client.query(`UPDATE duels SET status = 'settled', winner_device = $1 WHERE id = $2 AND status IN ('pending','accepted')`, [winner, duelId]);
        await client.query('COMMIT');
        res.json({ ok: true, result: 'settled', winner: winner === deviceId ? 'you' : 'opponent', prize });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      res.json({ ok: true, result: 'waiting', yourScore: s });
    }
  } catch (e) {
    console.error('duels/score', e.message);
    res.status(500).json({ error: 'server' });
  }
});

app.post('/api/heartbeat', softDeviceAuth, async (req, res) => {
  try {
    const { deviceId, displayName, mode, score, highestTier, grid } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'missing_device' });
    const gridJson = Array.isArray(grid) ? JSON.stringify(grid) : null;
    const did = String(deviceId).slice(0, 64);
    const name = String(displayName || '').slice(0, 100) || 'אנונימי';
    const m = String(mode || 'daily').slice(0, 20);
    const s = Math.max(0, parseInt(score, 10) || 0);
    const t = Math.max(1, parseInt(highestTier, 10) || 1);
    try {
      // Try with grid_json first
      await pool.query(
        `INSERT INTO player_heartbeat (device_id, display_name, mode, score, highest_tier, grid_json, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (device_id) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, player_heartbeat.display_name),
             mode = EXCLUDED.mode, score = EXCLUDED.score, highest_tier = EXCLUDED.highest_tier,
             grid_json = COALESCE(EXCLUDED.grid_json, player_heartbeat.grid_json), updated_at = NOW()`,
        [did, name, m, s, t, gridJson]
      );
    } catch (colErr) {
      // Fallback: grid_json column might not exist yet
      await pool.query(
        `INSERT INTO player_heartbeat (device_id, display_name, mode, score, highest_tier, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (device_id) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, player_heartbeat.display_name),
             mode = EXCLUDED.mode, score = EXCLUDED.score, highest_tier = EXCLUDED.highest_tier, updated_at = NOW()`,
        [did, name, m, s, t]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('heartbeat', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// DELETE heartbeat — called when game ends so player disappears from admin live view
app.post('/api/heartbeat/end', softDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'missing_device' });
    await pool.query('DELETE FROM player_heartbeat WHERE device_id = $1', [String(deviceId).slice(0, 64)]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
});

// Universal spectator endpoint — watch ANY player regardless of mode
app.get('/api/live-state/:deviceId', async (req, res) => {
  try {
    const did = String(req.params.deviceId || '').slice(0, 64);
    // Try with grid_json first, fallback without it
    let r;
    try {
      r = await pool.query(
        `SELECT display_name, mode, score, highest_tier, grid_json, updated_at
         FROM player_heartbeat WHERE device_id = $1 AND updated_at > NOW() - INTERVAL '60 seconds'`, [did]);
    } catch (e) {
      r = await pool.query(
        `SELECT display_name, mode, score, highest_tier, updated_at
         FROM player_heartbeat WHERE device_id = $1 AND updated_at > NOW() - INTERVAL '60 seconds'`, [did]);
    }
    if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
    const row = r.rows[0];
    let grid = null;
    if (row.grid_json) { try { grid = JSON.parse(row.grid_json); } catch (e) {} }
    res.json({
      ok: true,
      name: row.display_name,
      mode: row.mode,
      score: row.score | 0,
      tier: row.highest_tier | 0,
      grid: grid,
      updatedAt: row.updated_at
    });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
});

// Cleanup stale heartbeats: every 30s, anything older than 60s
// Aggressive cleanup helps when server restarts orphan bot rows in DB
setInterval(async () => {
  try {
    await pool.query(`DELETE FROM player_heartbeat WHERE updated_at < NOW() - INTERVAL '60 seconds'`);
  } catch (e) {}
}, 30 * 1000);

// Privacy: nightly PII auto-purge for challenge winners. Contact details for
// prize claims are kept for 90 days for fulfilment, then wiped. Israel Privacy
// Law + GDPR compliance. Backed by idx_challenge_entries_purge in schema.sql.
setInterval(async () => {
  try {
    const r = await pool.query(
      `UPDATE challenge_entries
         SET contact_name = NULL, contact_phone = NULL, contact_email = NULL
       WHERE prize_claimed_at IS NOT NULL
         AND prize_claimed_at < NOW() - INTERVAL '90 days'
         AND (contact_name IS NOT NULL OR contact_phone IS NOT NULL OR contact_email IS NOT NULL)`
    );
    if (r.rowCount > 0) console.log(`[privacy] auto-purged ${r.rowCount} PII rows`);
  } catch (e) {
    console.warn('[privacy] auto-purge failed', e.message);
  }
}, 24 * 60 * 60 * 1000);

// Periodic cleanup of throwaway game_config rows.
// _earn:* (per-day dedup keys) and _gift_rate:* (last-gift timestamps) grow
// unbounded otherwise. _earn keys are needed for cohort dedup so keep 30 days;
// _gift_rate is only needed for the 30s gate so 1 day is plenty.
setInterval(async () => {
  try {
    await pool.query(`DELETE FROM game_config WHERE key LIKE '_earn:%' AND updated_at < NOW() - INTERVAL '30 days'`);
    await pool.query(`DELETE FROM game_config WHERE key LIKE '_gift_rate:%' AND updated_at < NOW() - INTERVAL '1 day'`);
  } catch (e) {
    console.warn('[cleanup] game_config purge failed', e.message);
  }
}, 60 * 60 * 1000); // hourly

// Periodic cleanup of stale contest_live_state + contest_watchers rows.
// Reads filter by LIVE_FRESH_SECONDS already, but DB rows accumulate forever
// without a sweep. Run every 5 min, drop anything older than 1 hour.
setInterval(async () => {
  try {
    await pool.query(`DELETE FROM contest_live_state WHERE updated_at < NOW() - INTERVAL '1 hour'`);
    await pool.query(`DELETE FROM contest_watchers WHERE updated_at < NOW() - INTERVAL '1 hour'`);
  } catch (e) {
    console.warn('[cleanup] live state purge failed', e.message);
  }
}, 5 * 60 * 1000);

// ============================================================
// GAME CONFIG (admin-controlled runtime settings)
// ============================================================

// In-memory cache refreshed every 60s (avoids DB hit per page load).
let _configCache = {};
let _configCacheTs = 0;
const CONFIG_CACHE_TTL = 60 * 1000;

async function loadConfig() {
  if (Date.now() - _configCacheTs < CONFIG_CACHE_TTL) return _configCache;
  try {
    const r = await pool.query('SELECT key, value FROM game_config');
    const cfg = {};
    for (const row of r.rows) cfg[row.key] = row.value;
    _configCache = cfg;
    _configCacheTs = Date.now();
  } catch (e) {
    console.warn('loadConfig failed', e.message);
  }
  return _configCache;
}

app.get('/api/config', async (_req, res) => {
  try {
    const cfg = await loadConfig();
    res.json({ ok: true, config: cfg });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// GET /api/stats/live — public live-pulse counts for the home screen
// social-proof badge (UX audit §1.4). Returns:
//   activeNow:    players who heartbeated to contest_live_state within
//                 the last 30 seconds — the live spectator window
//   playingNow:   players who pinged any device_visit within the last
//                 ~3 minutes (broader signal: "people on the site")
//   gamesToday:   total daily_scores rows submitted today (Asia/Jerusalem
//                 day boundary, matching the rest of the daily logic)
// Designed for 15-second polling from the client; very cheap queries.
app.get('/api/stats/live', async (_req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    // Tiered fallback so the home v2 social-proof bar never disappears:
    // activeNow → playingNow → gamesToday → activeThisHour → gamesThisWeek.
    const [active, playing, games, activeHr, gamesWeek] = await Promise.all([
      pool.query(`SELECT COUNT(DISTINCT device_id)::int AS c FROM contest_live_state WHERE updated_at > NOW() - INTERVAL '30 seconds'`),
      pool.query(`SELECT COUNT(DISTINCT device_id)::int AS c FROM device_visits WHERE last_at > NOW() - INTERVAL '3 minutes'`),
      pool.query(`SELECT COUNT(*)::int AS c FROM daily_scores WHERE date = $1`, [today]),
      pool.query(`SELECT COUNT(DISTINCT device_id)::int AS c FROM device_visits WHERE last_at > NOW() - INTERVAL '1 hour'`),
      pool.query(`SELECT COUNT(*)::int AS c FROM daily_scores WHERE date >= ($1::date - INTERVAL '7 days')::date`, [today])
    ]);
    res.json({
      activeNow: active.rows[0].c,
      playingNow: playing.rows[0].c,
      gamesToday: games.rows[0].c,
      activeThisHour: activeHr.rows[0].c,
      gamesThisWeek: gamesWeek.rows[0].c
    });
  } catch (e) {
    console.error('GET /api/stats/live', e);
    res.status(500).json({ error: 'server' });
  }
});

// GET /api/weekly — current active weekly contest
app.get('/api/weekly', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.code, c.name, c.ends_at, c.created_at, c.board_type,
              (SELECT COUNT(*) FROM contest_scores WHERE contest_code = c.code) as players,
              (SELECT MAX(score) FROM contest_scores WHERE contest_code = c.code) as top_score
       FROM contests c
       WHERE c.contest_type = 'weekly' AND c.status = 'active' AND c.ends_at > NOW()
       ORDER BY c.created_at DESC LIMIT 1`);
    if (!r.rows.length) return res.json({ ok: true, weekly: null });
    const w = r.rows[0];
    const deviceId = req.query.deviceId || '';
    let myEntry = null;
    if (deviceId) {
      const me = await pool.query(
        `SELECT score, games_played, display_name FROM contest_scores WHERE contest_code = $1 AND device_id = $2`,
        [w.code, deviceId]);
      if (me.rows.length) myEntry = me.rows[0];
    }
    // Prize from config
    const prizeRow = await pool.query(`SELECT value FROM game_config WHERE key = 'weekly_prize'`);
    const prize = parseInt((prizeRow.rows[0] || {}).value, 10) || 500;
    res.json({ ok: true, weekly: {
      code: w.code, name: w.name, endsAt: w.ends_at, createdAt: w.created_at,
      players: w.players | 0, topScore: w.top_score | 0, prize,
      joined: !!myEntry, myScore: myEntry ? myEntry.score : 0,
      myGames: myEntry ? myEntry.games_played : 0
    }});
  } catch (e) {
    console.error('GET /api/weekly', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// ============================================================
// SERVER START
// ============================================================

const port = process.env.PORT || 3000;
initDb()
  .catch((e) => console.error('[db] init failed:', e))
  .finally(() => {
    // On startup, kill any leftover bot heartbeats from previous instances.
    // Real bots will re-register through startBots if admin re-activates them.
    pool.query(`DELETE FROM player_heartbeat WHERE device_id LIKE 'bot-%'`)
      .then(r => { if (r.rowCount > 0) console.log(`[startup] cleared ${r.rowCount} orphan bot heartbeats`); })
      .catch(() => {});

    // Auto-restart bots if admin had them running before this server instance
    // started (crash recovery / deploy resilience).
    //
    // CRITICAL: When Railway runs multiple instances (horizontal scaling),
    // we use a DB-based leader lock so only ONE instance runs the bot engine.
    // Otherwise N instances all start/stop bots in a loop, killing each other.
    //
    // The lock is a row in game_config with our instance's ID. We check
    // every 30s — if we're still the leader, run bots. If not, stay idle.
    const INSTANCE_ID = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const LOCK_TTL_SEC = 90; // lock expires if not renewed
    let isBotLeader = false;

    async function tryAcquireBotLock() {
      try {
        // Attempt to grab the lock atomically. INSERT...ON CONFLICT DO UPDATE
        // only succeeds if the existing row is stale (older than LOCK_TTL_SEC).
        const r = await pool.query(
          `INSERT INTO game_config (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_at = NOW()
             WHERE game_config.value = $2
                OR game_config.updated_at < NOW() - INTERVAL '${LOCK_TTL_SEC} seconds'
           RETURNING value`,
          ['__bot_engine_leader', INSTANCE_ID]
        );
        return r.rows.length > 0 && r.rows[0].value === INSTANCE_ID;
      } catch (e) {
        return false;
      }
    }

    async function startBotsIfLeader() {
      const acquired = await tryAcquireBotLock();
      if (acquired && !isBotLeader) {
        isBotLeader = true;
        console.log(`[bots] this instance is the leader (${INSTANCE_ID})`);
        // Load saved state and start bots
        try {
          const r = await pool.query(`SELECT value FROM game_config WHERE key = '__bot_engine_state' LIMIT 1`);
          if (r.rows.length) {
            const state = JSON.parse(r.rows[0].value);
            if (state && state.enabled && state.count > 0) {
              console.log(`[bots] auto-restarting ${state.count} bots from persisted config`);
              startBots(state.count, pool, {
                mode: state.mode || 'practice',
                speed: state.speed || 'normal',
                contestCode: state.contestCode || null,
                challengeSlug: state.challengeSlug || null,
                restartMin: state.restartMin || 30,
                restartMax: state.restartMax || 90,
                maxGamesPerBot: state.maxGamesPerBot || 1
              });
            }
          }
        } catch (e) { console.error('[bots] failed to restore state:', e.message); }
      } else if (!acquired && isBotLeader) {
        // We were the leader but lost the lock — stop bots
        isBotLeader = false;
        console.log(`[bots] no longer the leader — stopping`);
        stopBots();
      } else if (acquired && isBotLeader) {
        // Still the leader — check if admin pressed stop (state row was deleted)
        try {
          const r = await pool.query(`SELECT value FROM game_config WHERE key = '__bot_engine_state' LIMIT 1`);
          if (!r.rows.length && getBotStatus().running) {
            // State was deleted but we're still running bots — stop them
            console.log(`[bots] state row deleted — stopping bots`);
            stopBots();
          }
        } catch (e) {}
      }
    }

    // First attempt 2s after startup, then renew/check every 5s for fast response
    setTimeout(startBotsIfLeader, 2000);
    setInterval(startBotsIfLeader, 5000);

    const server = app.listen(port, () => console.log(`[bloom] listening on ${port}`));

    // ============================================================
    // EPHEMERAL TABLE CLEANUP (every hour)
    // ============================================================
    setInterval(async () => {
      try {
        await pool.query(`DELETE FROM contest_live_state WHERE updated_at < NOW() - INTERVAL '1 hour'`);
        await pool.query(`DELETE FROM contest_watchers WHERE updated_at < NOW() - INTERVAL '1 hour'`);
      } catch (e) {
        console.warn('[cleanup] ephemeral cleanup failed', e.message);
      }
    }, 60 * 60 * 1000);

    // ============================================================
    // JACKPOT AUTO-SETTLE (runs every hour, settles yesterday's jackpot)
    // ============================================================
    async function autoSettleJackpot() {
      try {
        const autoEnabled = await pool.query(`SELECT value FROM game_config WHERE key = 'jackpot_auto_settle'`);
        if (autoEnabled.rows.length && autoEnabled.rows[0].value === 'false') return;

        // Find unsettled jackpots from previous days
        const unsettled = await pool.query(
          `SELECT date, pool, entries FROM daily_jackpot WHERE settled = false AND date < (NOW() AT TIME ZONE 'Asia/Jerusalem')::date ORDER BY date`);
        
        for (const j of unsettled.rows) {
          if ((j.pool | 0) <= 0) continue;
          const jpDate = j.date instanceof Date ? j.date.toISOString().slice(0, 10) : String(j.date);
          
          // Get config
          const cfgRows = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'wager_%' OR key LIKE 'jackpot_%'`);
          const cfg = {}; for (const r of cfgRows.rows) cfg[r.key] = r.value;
          const rake = parseInt(cfg.wager_rake, 10) || 5;
          const pct1 = parseInt(cfg.wager_1st_pct, 10) || 60;
          const pct2 = parseInt(cfg.wager_2nd_pct, 10) || 25;
          const pct3 = parseInt(cfg.wager_3rd_pct, 10) || 10;
          const minPlayers = parseInt(cfg.jackpot_min_players, 10) || 5;

          if ((j.entries | 0) < minPlayers) {
            // Not enough players — refund everyone
            const refunds = await pool.query(
              `SELECT device_id, ABS(amount) as amt FROM wager_settlements WHERE contest_code = $1 AND type = 'jackpot_entry'`, ['JP:' + jpDate]);
            for (const rf of refunds.rows) {
              await pool.query(`UPDATE player_profiles SET balance = balance + $1, total_spent = total_spent - $1 WHERE device_id = $2`, [rf.amt, rf.device_id]);
            }
            await pool.query(`UPDATE daily_jackpot SET settled = true, settled_at = NOW() WHERE date = $1`, [jpDate]);
            console.log(`[jackpot] ${jpDate}: refunded ${refunds.rows.length} players (below min ${minPlayers})`);
            continue;
          }

          // Get top 3
          const top = await pool.query(
            `SELECT device_id, name, score FROM daily_scores WHERE date = $1 ORDER BY score DESC LIMIT 3`, [jpDate]);
          
          const poolAmt = j.pool | 0;
          const rakeAmt = Math.round(poolAmt * rake / 100);
          const dist = poolAmt - rakeAmt;
          const prizes = [
            Math.round(dist * pct1 / (pct1 + pct2 + pct3)),
            Math.round(dist * pct2 / (pct1 + pct2 + pct3)),
            Math.round(dist * pct3 / (pct1 + pct2 + pct3))
          ];

          for (let i = 0; i < Math.min(3, top.rows.length); i++) {
            const prize = prizes[i] || 0;
            if (prize <= 0) continue;
            await pool.query(`UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1 WHERE device_id = $2`, [prize, top.rows[i].device_id]);
            await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, $2, $3, $4)`,
              ['JP:' + jpDate, top.rows[i].device_id, prize, 'jackpot_win_' + (i + 1)]);
          }
          if (rakeAmt > 0) {
            await pool.query(`INSERT INTO wager_settlements (contest_code, device_id, amount, type) VALUES ($1, 'house', $2, 'jackpot_rake')`,
              ['JP:' + jpDate, rakeAmt]);
          }
          await pool.query(`UPDATE daily_jackpot SET settled = true, settled_at = NOW() WHERE date = $1`, [jpDate]);
          console.log(`[jackpot] ${jpDate}: settled ${poolAmt}💎 → ${top.rows.length} winners, ${rakeAmt} rake`);
        }
      } catch (e) {
        console.warn('[jackpot] auto-settle failed:', e.message);
      }
    }
    // Run every hour + once on startup (after 30 seconds delay)
    setTimeout(autoSettleJackpot, 30000);
    setInterval(autoSettleJackpot, 60 * 60 * 1000);

    // ============================================================
    // WEEKLY AUTO-CHALLENGE (creates a new weekly contest each Sunday)
    // ============================================================
    async function ensureWeeklyContest() {
      try {
        const enabledRow = await pool.query(`SELECT value FROM game_config WHERE key = 'weekly_enabled'`);
        if (enabledRow.rows.length && enabledRow.rows[0].value === 'false') return;

        // Check if there's an active weekly contest
        const active = await pool.query(
          `SELECT code, ends_at FROM contests WHERE contest_type = 'weekly' AND status = 'active' AND ends_at > NOW() ORDER BY created_at DESC LIMIT 1`);
        if (active.rows.length) return; // Already have an active weekly

        // Mark any expired weekly contests as ended
        await pool.query(
          `UPDATE contests SET status = 'ended' WHERE contest_type = 'weekly' AND status = 'active' AND ends_at <= NOW()`);

        // Create new weekly contest
        const nameRow = await pool.query(`SELECT value FROM game_config WHERE key = 'weekly_name'`);
        const prizeRow = await pool.query(`SELECT value FROM game_config WHERE key = 'weekly_prize'`);
        const baseName = (nameRow.rows[0] || {}).value || 'אתגר שבועי';
        const prize = parseInt((prizeRow.rows[0] || {}).value, 10) || 500;

        // Calculate end: next Sunday midnight Israel time
        const now = new Date();
        const israelNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
        const dayOfWeek = israelNow.getDay(); // 0=Sun
        const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
        const endsAt = new Date(now.getTime() + daysUntilSunday * 86400000);
        endsAt.setHours(23, 59, 59, 0);

        // Week number for naming
        const weekStart = new Date(now);
        const weekNum = Math.ceil(((weekStart - new Date(weekStart.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
        const contestName = baseName + ' #' + weekNum;

        const code = await generateUniqueContestCode();
        const seed = Math.floor(Math.random() * 2147483647);

        await pool.query(
          `INSERT INTO contests (code, name, host_name, host_device_id, board_seed, board_type, duration_days, ends_at, contest_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'weekly')`,
          [code, contestName, 'BLOOM', 'system', seed, 'free', daysUntilSunday, endsAt.toISOString()]
        );

        console.log(`[weekly] Created weekly contest: ${code} "${contestName}" (ends ${endsAt.toISOString()}, prize ${prize}💎)`);
      } catch (e) {
        console.warn('[weekly] ensureWeeklyContest failed:', e.message);
      }
    }
    // Run on startup + every hour
    setTimeout(ensureWeeklyContest, 15000);
    setInterval(ensureWeeklyContest, 60 * 60 * 1000);

    // ============================================================
    // GRACEFUL SHUTDOWN
    // ============================================================
    function shutdown(signal) {
      console.log(`[bloom] ${signal} received, shutting down gracefully`);
      // Release leader lock so other instance can take over instantly
      if (isBotLeader) {
        pool.query(`DELETE FROM game_config WHERE key = '__bot_engine_leader' AND value = $1`, [INSTANCE_ID])
          .catch(() => {});
        stopBots();
      }
      server.close(() => {
        pool.end(() => {
          console.log('[bloom] shut down complete');
          process.exit(0);
        });
      });
      setTimeout(() => { console.error('[bloom] forced shutdown'); process.exit(1); }, 10000);
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  });
