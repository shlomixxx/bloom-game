import express from 'express';
import { timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
import { readFile as readFileSw } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { pool, initDb } from './db.js';
import { startBots, stopBots, getBotStatus } from './bot-engine.js';
import webpush from 'web-push';

// ============================================================
// WEB PUSH (PWA notifications) — closed-app delivery
// ============================================================
// Set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT in env.
// Generate keys with:  node -e "console.log(require('web-push').generateVAPIDKeys())"
// Without keys, all sendPushToDevice() calls become silent no-ops
// so the rest of the app keeps working in dev.
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT || 'mailto:shlomibusiness@gmail.com';
let _webpushConfigured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    _webpushConfigured = true;
    console.log('[push] VAPID configured');
  } catch (e) {
    console.warn('[push] VAPID setup failed:', e.message);
  }
} else {
  console.log('[push] VAPID keys not set — push disabled');
}

// Best-effort fire-and-forget push. Returns immediately, doesn't
// throw. Failures (network, invalid subscription, expired 410)
// are logged + the dead subscription is pruned on 410. Designed
// to be called from inside request handlers without blocking
// the response.
async function sendPushToDevice(deviceId, payload) {
  if (!_webpushConfigured || !deviceId) return;
  try {
    const subs = await pool.query(
      `SELECT endpoint, p256dh_key, auth_key
         FROM push_subscriptions
        WHERE device_id = $1`, [deviceId]);
    if (!subs.rows.length) return;
    const body = JSON.stringify(payload);
    await Promise.all(subs.rows.map(async function(row) {
      const sub = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh_key, auth: row.auth_key }
      };
      try {
        await webpush.sendNotification(sub, body, { TTL: 60 * 60 * 24 });
      } catch (err) {
        // 410 Gone or 404 Not Found = subscription expired, prune it.
        const code = err && err.statusCode;
        if (code === 410 || code === 404) {
          try {
            await pool.query(
              `DELETE FROM push_subscriptions WHERE device_id = $1 AND endpoint = $2`,
              [deviceId, row.endpoint]);
          } catch (delErr) { /* swallow */ }
        } else {
          console.warn('[push] send failed', code, err && err.message);
        }
      }
    }));
  } catch (e) {
    console.warn('[push] sendPushToDevice swallowed', e.message);
  }
}

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
    // Anti-skew: reject submissions whose date differs from the server's
    // Asia/Jerusalem today by more than 1 day. A device with a wrong clock
    // could otherwise farm daily seeds from the future or revive expired ones.
    {
      const serverToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      const diffDays = Math.abs((new Date(date).getTime() - new Date(serverToday).getTime()) / 86400000);
      if (!Number.isFinite(diffDays) || diffDays > 1) {
        return res.status(400).json({ error: 'bad_date' });
      }
    }
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
         AND cs.left_at IS NULL
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
    const { name, hostName, deviceId, durationDays, boardType, wagerAmount, difficulty, scoreMode } = req.body || {};

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

    // Score mode — 'best' means only the player's highest single-game
    // score counts (max-of); 'cumulative' adds every game to the total
    // (the long-standing default). Whitelisted so a malformed body can't
    // store a garbage value the upsert below would silently mishandle.
    const mode = scoreMode === 'best' ? 'best' : 'cumulative';

    const result = await pool.query(
      `INSERT INTO contests (code, name, host_name, host_device_id, board_seed, board_type, duration_days, ends_at, wager_amount, wager_pool, difficulty_label, difficulty_weights, difficulty_speed_pct, score_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [code, cleanedName, cleanedHost, deviceId, seed, type, dur, endsAt, wager, wager, diff.label, diff.weights, diff.speed_pct, mode]
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

    // contest.score_mode falls back to 'cumulative' for any row that
    // predates the column (the schema default + the IFNULL-style fallback
    // here means existing contests keep their original behavior).
    const contestRow = contestResult.rows[0];
    if (!contestRow.score_mode) contestRow.score_mode = 'cumulative';
    res.json({
      ok: true,
      contest: contestRow,
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
       DO UPDATE SET display_name = EXCLUDED.display_name, left_at = NULL`,
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

// POST /api/contests/:code/leave — soft-leave: marks the row left_at so
// /contests/mine stops returning this contest (the score stays visible in
// the contest's own leaderboard per the confirm copy). Re-join via the
// usual /join flow clears left_at and the player picks up where they
// left off. Also wipes ephemeral live/watch rows so the player doesn't
// keep appearing as "in this contest right now" to other members.
app.post('/api/contests/:code/leave', requireDeviceAuth, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().slice(0, 8);
    const deviceId = req.deviceId;
    if (!code) return res.status(400).json({ error: 'bad_code' });
    if (!checkRateLimit('contest:leave', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const upd = await pool.query(
      `UPDATE contest_scores SET left_at = NOW()
        WHERE contest_code = $1 AND device_id = $2 AND left_at IS NULL
        RETURNING 1`,
      [code, deviceId]
    );
    // Belt-and-suspenders cleanup so the player doesn't linger as a live
    // entity in the contest's spectator/audience UI after leaving.
    await pool.query(
      `DELETE FROM contest_live_state WHERE contest_code = $1 AND device_id = $2`,
      [code, deviceId]
    ).catch(() => {});
    await pool.query(
      `DELETE FROM contest_watchers WHERE contest_code = $1 AND watcher_device_id = $2`,
      [code, deviceId]
    ).catch(() => {});
    res.json({ ok: true, left: upd.rows.length > 0 });
  } catch (e) {
    console.error('POST /api/contests/:code/leave', e);
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

    const contestResult = await pool.query('SELECT ends_at, score_mode FROM contests WHERE code = $1', [code]);
    if (contestResult.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (new Date(contestResult.rows[0].ends_at) < new Date()) {
      return res.status(403).json({ error: 'ended' });
    }
    const scoreMode = contestResult.rows[0].score_mode === 'best' ? 'best' : 'cumulative';

    // Per-contest cool-down: a single device must wait at least 30s between
    // game submissions, so the cumulative score can't be inflated by spamming.
    // Skip the gate when games_played === 0 — last_played_at defaults to NOW()
    // on join, which otherwise blocks a new joiner's legitimate first
    // submission for 30s after they pressed "הצטרף ושחק".
    const lastPlay = await pool.query(
      `SELECT last_played_at, games_played FROM contest_scores WHERE contest_code = $1 AND device_id = $2`,
      [code, deviceId]);
    if (lastPlay.rows.length && lastPlay.rows[0].last_played_at && (lastPlay.rows[0].games_played | 0) > 0) {
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

    // Score reducer: cumulative = sum of every submitted game (default);
    // best = the player's highest single-game score (max-of). Mode is
    // snapshotted onto the contest row at creation — changing the mode
    // later won't retroactively re-balance an in-flight contest.
    const scoreReducer = scoreMode === 'best'
      ? 'GREATEST(contest_scores.score, EXCLUDED.score)'
      : 'contest_scores.score + EXCLUDED.score';
    await pool.query(
      `INSERT INTO contest_scores (contest_code, device_id, display_name, score, highest_tier, games_played, last_played_at)
       VALUES ($1, $2, $3, $4, $5, 1, NOW())
       ON CONFLICT (contest_code, device_id)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         score = ${scoreReducer},
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
// DYNAMIC BOARDS — public read endpoint
// Returns the highest-priority active board configuration for "now".
// Result is cached in-memory for 60s; admin writes invalidate the cache.
// When no board is active OR the table doesn't exist yet, returns
// { ok: true, board: null } — clients treat null as "vanilla mode".
// ============================================================
// Per-mode caches. Each mode (dynamic / practice / daily / duel / contest /
// challenge) gets its own cache entry — invalidated together on any write.
const BOARD_MODES = ['dynamic', 'practice', 'daily', 'duel', 'contest', 'challenge'];
let _boardCacheByMode = {};   // mode -> { value, expiresAt }
let _boardsListCache = { value: undefined, expiresAt: 0 };
function invalidateBoardCache() {
  _boardCacheByMode = {};
  _boardsListCache = { value: undefined, expiresAt: 0 };
}

// Skin shop catalog cache. /api/skins/available is hot at boot and re-fetched
// every page load; admin changes are rare. 60s TTL.
let _skinsCache = { value: undefined, expiresAt: 0 };
function invalidateSkinsCache() { _skinsCache = { value: undefined, expiresAt: 0 }; }

// SVG keys the skin renderer knows about — keep aligned with the SVG dict
// in src/01-constants.js. Adding a new key requires the matching SVG path
// on the client; otherwise the tile renders blank.
const SKIN_SVG_KEYS = ['circle', 'leaf', 'flower', 'flame', 'bolt', 'star', 'diamond', 'crown'];

// Validate a skin's definition payload before write. Accepts only the shape
// the client renderer can consume — bad input on save would otherwise crash
// the merge engine for any owner of that skin.
function validateSkinDefinition(def) {
  if (!def || typeof def !== 'object') return { ok: false, error: 'definition_required' };
  const tiers = def.tiers;
  if (!Array.isArray(tiers) || tiers.length !== 8) return { ok: false, error: 'tiers_must_be_8' };
  for (let i = 0; i < 8; i++) {
    const t = tiers[i];
    if (!t || typeof t !== 'object') return { ok: false, error: `tier_${i + 1}_missing` };
    const bg = String(t.bg || '');
    const fg = String(t.fg || '');
    const svgKey = String(t.svg_key || '');
    const name = String(t.name || '');
    const emoji = String(t.emoji || '');
    if (!bg || bg.length > 300) return { ok: false, error: `tier_${i + 1}_bg_invalid` };
    // bg allowlist: #hex (3/6/8 char) OR linear-gradient(...) OR radial-gradient(...)
    if (!/^#[0-9A-Fa-f]{3,8}$/.test(bg) && !/^(linear|radial)-gradient\(/.test(bg)) {
      return { ok: false, error: `tier_${i + 1}_bg_format` };
    }
    if (!/^#[0-9A-Fa-f]{3,8}$/.test(fg)) return { ok: false, error: `tier_${i + 1}_fg_format` };
    if (!SKIN_SVG_KEYS.includes(svgKey)) return { ok: false, error: `tier_${i + 1}_svg_key_unknown` };
    if (!name || name.length > 40) return { ok: false, error: `tier_${i + 1}_name_invalid` };
    if (!emoji || emoji.length > 10) return { ok: false, error: `tier_${i + 1}_emoji_invalid` };
  }
  return { ok: true };
}

// Skin id must be lowercase letters/digits/underscore, 2-40 chars. Used as
// a CSS-class-friendly identifier across client + server.
function validateSkinId(raw) {
  const s = String(raw || '').trim();
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(s)) return null;
  return s;
}

// Allowed cell types for special_cells boards. Expand here as new types
// land (frozen / electric / locked / teleport). Client code uses the
// same list to decide what to render.
const SPECIAL_CELL_TYPES = ['gold', 'bonus', 'frozen', 'electric', 'locked', 'teleport'];  // 3B-3G

function validateBoardDefinition(type, definition) {
  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
    return { ok: false, error: 'definition_not_object' };
  }
  if (type === 'multipliers') {
    const mults = definition.multipliers;
    if (!Array.isArray(mults) || mults.length !== 4) {
      return { ok: false, error: 'multipliers_must_be_array_of_4' };
    }
    for (const m of mults) {
      const n = Number(m);
      if (!Number.isFinite(n) || n < 0.5 || n > 20) {
        return { ok: false, error: 'multiplier_out_of_range' };
      }
    }
    return { ok: true };
  }
  if (type === 'special_cells') {
    const cells = definition.cells;
    if (!Array.isArray(cells)) {
      return { ok: false, error: 'cells_must_be_array' };
    }
    if (cells.length > 24) {
      return { ok: false, error: 'too_many_cells' };  // max = full 4×6 board
    }
    // Dedupe on row,col so the same slot can't carry two types.
    const seen = new Set();
    for (const c of cells) {
      if (!c || typeof c !== 'object') return { ok: false, error: 'cell_not_object' };
      const row = Number(c.row);
      const col = Number(c.col);
      const ctype = String(c.type || '');
      if (!Number.isInteger(row) || row < 0 || row > 5) {
        return { ok: false, error: 'cell_row_out_of_range' };
      }
      if (!Number.isInteger(col) || col < 0 || col > 3) {
        return { ok: false, error: 'cell_col_out_of_range' };
      }
      if (!SPECIAL_CELL_TYPES.includes(ctype)) {
        return { ok: false, error: 'cell_type_unsupported' };
      }
      // Per-type required fields. Bonus needs an `amount` (50-10000).
      // Locked needs an `unlock_after` (1-30). Others have no extras.
      if (ctype === 'bonus') {
        const amt = Number(c.amount);
        if (!Number.isFinite(amt) || amt < 50 || amt > 10000) {
          return { ok: false, error: 'bonus_amount_out_of_range' };
        }
      }
      if (ctype === 'locked') {
        const unlock = Number(c.unlock_after);
        if (!Number.isInteger(unlock) || unlock < 1 || unlock > 30) {
          return { ok: false, error: 'locked_unlock_after_out_of_range' };
        }
      }
      const key = row + ',' + col;
      if (seen.has(key)) return { ok: false, error: 'duplicate_cell_position' };
      seen.add(key);
    }
    // Optional: theme_id (phase 4). Visual theming layer that paints
    // the board with a holiday palette + decorative floating emojis.
    // The allowlist is intentionally tight — adding a new theme means
    // adding both server-side validation AND client CSS.
    if (definition.theme_id !== undefined && definition.theme_id !== null) {
      const validThemes = ['hanukkah', 'valentine', 'yom_haatzmaut', 'passover'];
      if (!validThemes.includes(definition.theme_id)) {
        return { ok: false, error: 'bad_theme_id' };
      }
    }
    // Optional: shape_id (phase 5). Masks part of the 4×6 grid as
    // "inactive" so the playable area takes a non-rectangular shape
    // (heart, diamond, tree, pyramid). Engine treats inactive cells
    // as permanent walls — gravity stops on them, drops skip them,
    // BFS ignores them, game-over doesn't count them.
    if (definition.shape_id !== undefined && definition.shape_id !== null) {
      const validShapes = ['heart', 'diamond', 'tree', 'pyramid'];
      if (!validShapes.includes(definition.shape_id)) {
        return { ok: false, error: 'bad_shape_id' };
      }
    }
    // Optional: relocate_mode (phase 3D++ → 3D+++). Controls when and
    // how special cells reshuffle their positions during gameplay.
    //   'static'    → no movement (default)
    //   'shatter'   → only the shattered frozen cell jumps (targeted)
    //   'on_merge'  → ALL empty specials reshuffle after every merge
    //   'on_chain'  → ALL empty specials reshuffle after chains (≥2)
    if (definition.relocate_mode !== undefined) {
      const validModes = ['static', 'shatter', 'on_merge', 'on_chain'];
      if (!validModes.includes(definition.relocate_mode)) {
        return { ok: false, error: 'bad_relocate_mode' };
      }
    }
    return { ok: true };
  }
  // Future types (shape / themed / mode / vip) accept any object —
  // validation is added per-phase. Today no client-side code applies
  // them, so a bad definition is a no-op.
  return { ok: true };
}

// Validate / sanitize applies_to. Returns clean string array (never null).
// Defaults to ['dynamic'] (the original opt-in behavior).
function sanitizeAppliesTo(raw) {
  if (!Array.isArray(raw)) return ['dynamic'];
  const out = [];
  for (const m of raw) {
    if (typeof m === 'string' && BOARD_MODES.includes(m) && !out.includes(m)) {
      out.push(m);
    }
  }
  return out.length ? out : ['dynamic'];
}

// Server helper: returns the row for the highest-priority active board
// whose applies_to includes the given mode. Null if none. Used by both
// the public endpoint and the duel/contest/challenge snapshot path.
async function getActiveBoardForMode(mode) {
  if (!BOARD_MODES.includes(mode)) return null;
  try {
    const r = await pool.query(
      `SELECT id, name, type, definition, target_audience, starts_at, ends_at, applies_to
         FROM board_configurations
        WHERE is_active = true
          AND $1 = ANY(applies_to)
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at   IS NULL OR ends_at   >= NOW())
        ORDER BY priority DESC, id DESC
        LIMIT 1`,
      [mode]
    );
    return r.rows.length ? r.rows[0] : null;
  } catch (err) {
    if (err && err.code === '42P01') return null;  // table doesn't exist yet
    throw err;
  }
}

// Per-mode public endpoint. Each game mode resolves its board through
// this. 60s in-memory cache, keyed by mode, invalidated on any admin
// write to keep changes propagating fast.
app.get('/api/active-board/:mode', async (req, res) => {
  const mode = String(req.params.mode || '').toLowerCase();
  if (!BOARD_MODES.includes(mode)) {
    return res.status(400).json({ ok: false, error: 'bad_mode' });
  }
  try {
    const now = Date.now();
    const cached = _boardCacheByMode[mode];
    if (cached && cached.expiresAt > now) {
      return res.json({ ok: true, mode, board: cached.value });
    }
    const board = await getActiveBoardForMode(mode);
    _boardCacheByMode[mode] = { value: board, expiresAt: now + 60 * 1000 };
    res.json({ ok: true, mode, board });
  } catch (e) {
    console.error('GET /api/active-board/:mode', e);
    res.json({ ok: true, mode, board: null });
  }
});

// Legacy: returns the highest-priority active board across ALL modes.
// Kept so older cached clients don't 404. The list endpoint and per-mode
// endpoint above are the new contracts.
app.get('/api/active-board', async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, type, definition, target_audience, starts_at, ends_at, applies_to
         FROM board_configurations
        WHERE is_active = true
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at   IS NULL OR ends_at   >= NOW())
        ORDER BY priority DESC, id DESC
        LIMIT 1`
    );
    res.json({ ok: true, board: r.rows[0] || null });
  } catch (e) {
    if (e && e.code === '42P01') return res.json({ ok: true, board: null });
    console.error('GET /api/active-board', e);
    res.json({ ok: true, board: null });
  }
});

// Returns the available "dynamic" boards — the ones that show up in the
// player's home picker. Boards that apply ONLY to non-dynamic modes (e.g.
// admin set "this is the duel-of-the-day" without ticking dynamic) are
// excluded from the picker so the player isn't confused by boards they
// can't start manually.
// ============================================================
// Daily Special Board picker (Stage 15 — Daily mini-event boards)
// Deterministic per Asia/Jerusalem date — same board for all players today,
// rotates tomorrow. Admin can override via game_config.daily_special_override_id.
// Drives daily-board roulette ("what's special today?") — the strongest
// daily-return hook in F2P puzzle games.
// ============================================================
function _dailySpecialHash(dateStr) {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

async function loadConfigKeys(keys) {
  try {
    const r = await pool.query(
      `SELECT key, value FROM game_config WHERE key = ANY($1::text[])`,
      [keys]
    );
    const out = {};
    for (const row of r.rows) out[row.key] = row.value;
    return out;
  } catch (e) { return {}; }
}

async function pickDailySpecial(boardRows) {
  try {
    const cfg = await loadConfigKeys([
      'daily_special_enabled',
      'daily_special_xp_mult',
      'daily_special_reward_mult',
      'daily_special_override_id'
    ]);
    if (cfg.daily_special_enabled === 'false') return { enabled: false };
    if (!Array.isArray(boardRows) || boardRows.length === 0) return { enabled: false };
    const xpMult = Math.max(1, Math.min(10, parseFloat(cfg.daily_special_xp_mult || '3') || 3));
    const rewardMult = Math.max(1, Math.min(10, parseFloat(cfg.daily_special_reward_mult || '2') || 2));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const overrideId = parseInt(cfg.daily_special_override_id || '', 10);
    if (Number.isFinite(overrideId) && overrideId > 0) {
      const match = boardRows.find(function(b) { return b.id === overrideId; });
      if (match) return { enabled: true, id: overrideId, xpMult, rewardMult, date: today, isOverride: true };
    }
    const idx = _dailySpecialHash(today) % boardRows.length;
    return { enabled: true, id: boardRows[idx].id, xpMult, rewardMult, date: today, isOverride: false };
  } catch (e) {
    return { enabled: false };
  }
}

// Convenience: resolves today's special board id without going through the
// public endpoint. Used by /season/grant-xp + /earn dyn_quest to apply mults.
async function getDailySpecialForToday() {
  try {
    const r = await pool.query(
      `SELECT id FROM board_configurations
        WHERE is_active = true
          AND 'dynamic' = ANY(applies_to)
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at   IS NULL OR ends_at   >= NOW())
        ORDER BY priority DESC, id DESC
        LIMIT 25`
    );
    return await pickDailySpecial(r.rows);
  } catch (e) { return { enabled: false }; }
}

app.get('/api/boards/available', async (_req, res) => {
  try {
    const now = Date.now();
    if (_boardsListCache.value !== undefined && _boardsListCache.expiresAt > now) {
      return res.json(_boardsListCache.value);
    }
    let rows = [];
    try {
      const r = await pool.query(
        `SELECT id, name, type, definition, priority, applies_to,
                starts_at, ends_at
           FROM board_configurations
          WHERE is_active = true
            AND 'dynamic' = ANY(applies_to)
            AND (starts_at IS NULL OR starts_at <= NOW())
            AND (ends_at   IS NULL OR ends_at   >= NOW())
          ORDER BY priority DESC, id DESC
          LIMIT 25`
      );
      rows = r.rows;
    } catch (innerErr) {
      if (innerErr && innerErr.code === '42P01') {
        rows = [];
      } else {
        throw innerErr;
      }
    }
    // Decorate each board with its current top scorer + player count.
    // Done in a single ANY-array query so the response stays under 60ms
    // even with 25 active boards. Single LATERAL join on the leaderboard
    // table grouped by board_id. Soft-fails (returns the board sans
    // leader fields) if dynamic_board_scores table doesn't exist yet.
    if (rows.length > 0) {
      try {
        const ids = rows.map(function(r) { return r.id; });
        const lbR = await pool.query(
          `SELECT s.board_id,
                  s.name AS leader_name,
                  s.score AS leader_score,
                  s.tier AS leader_tier,
                  (SELECT COUNT(*) FROM dynamic_board_scores WHERE board_id = s.board_id) AS players
             FROM dynamic_board_scores s
             JOIN (
               SELECT board_id, MAX(score) AS max_score
                 FROM dynamic_board_scores
                WHERE board_id = ANY($1::int[])
                GROUP BY board_id
             ) m ON m.board_id = s.board_id AND m.max_score = s.score
            WHERE s.board_id = ANY($1::int[])`,
          [ids]
        );
        const leaderByBoard = {};
        for (let i = 0; i < lbR.rows.length; i++) {
          const lr = lbR.rows[i];
          // If a tie produces multiple rows per board, keep the first
          // (alphabetical by name from the JOIN — deterministic enough).
          if (!leaderByBoard[lr.board_id]) leaderByBoard[lr.board_id] = lr;
        }
        rows = rows.map(function(b) {
          const lr = leaderByBoard[b.id];
          if (lr) {
            return Object.assign({}, b, {
              leader_name: lr.leader_name,
              leader_score: Number(lr.leader_score),
              leader_tier: Number(lr.leader_tier),
              players: Number(lr.players)
            });
          }
          return Object.assign({}, b, { players: 0 });
        });
      } catch (lbErr) {
        // Leaderboard table doesn't exist yet OR query failed — soft-fail.
        if (!lbErr || lbErr.code !== '42P01') {
          console.warn('boards leaderboard enrich failed', lbErr && lbErr.message);
        }
      }
    }
    const dailySpecial = await pickDailySpecial(rows);
    const payload = { ok: true, boards: rows, dailySpecial };
    _boardsListCache = { value: payload, expiresAt: now + 60 * 1000 };
    res.json(payload);
  } catch (e) {
    console.error('GET /api/boards/available', e);
    res.json({ ok: true, boards: [], dailySpecial: { enabled: false } });
  }
});

// ============================================================
// Per-board global leaderboard (May 2026)
//
// One row per (board_id, device_id) — best score that device has ever
// posted on this specific dynamic board. Drives the "leaderboard chase"
// half of the addiction loop. Personal-best lives in localStorage; this
// surfaces "👑 דניאל: 89K" — a clear target on every picker card.
// ============================================================
app.post('/api/boards/:id/score', requireDeviceAuth, async (req, res) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    if (!Number.isFinite(boardId) || boardId <= 0) return res.status(400).json({ error: 'bad_board' });
    const { deviceId, name, score, tier, drops, country } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('board:score', deviceId, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    if (typeof tier !== 'number' || tier < 1 || tier > 8) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    // Drops required — same anti-cheat door as /api/score.
    const dropsN = typeof drops === 'number' && Number.isFinite(drops) && drops >= 0 ? Math.floor(drops) : null;
    if (dropsN === null) {
      return res.status(400).json({ error: 'missing_drops' });
    }
    if (challengeDropsImplausible(score, dropsN)) {
      console.warn(`[anti-cheat] board score rejected (implausible): device=${deviceId} board=${boardId} score=${score} drops=${dropsN}`);
      return res.status(400).json({ error: 'implausible_score' });
    }
    const safeName = cleanName(name);
    const safeCountry = cleanCountry(country);
    // Best-score-wins upsert. The board_id FK ensures we can't write a
    // score for a board that's been deleted (or never existed).
    try {
      await pool.query(
        `INSERT INTO dynamic_board_scores (board_id, device_id, name, score, tier, country, drops)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (board_id, device_id) DO UPDATE
           SET name = EXCLUDED.name,
               score = EXCLUDED.score,
               tier = EXCLUDED.tier,
               country = COALESCE(EXCLUDED.country, dynamic_board_scores.country),
               drops = EXCLUDED.drops,
               updated_at = NOW()
           WHERE dynamic_board_scores.score < EXCLUDED.score`,
        [boardId, deviceId, safeName, Math.floor(score), Math.floor(tier), safeCountry, dropsN]
      );
    } catch (innerErr) {
      // FK violation → board was deleted between game-start and submit. Soft-fail.
      if (innerErr && innerErr.code === '23503') {
        return res.json({ ok: true, skipped: 'board_missing' });
      }
      throw innerErr;
    }
    // Rank + total players for the over-screen "you beat X% of players" pill.
    const rankRes = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM dynamic_board_scores WHERE board_id = $1) AS total,
         (SELECT score FROM dynamic_board_scores WHERE board_id = $1 AND device_id = $2) AS my_score,
         (SELECT 1 + COUNT(*) FROM dynamic_board_scores
           WHERE board_id = $1
             AND score > (SELECT score FROM dynamic_board_scores WHERE board_id = $1 AND device_id = $2)
         ) AS rank`,
      [boardId, deviceId]
    );
    const row = rankRes.rows[0] || {};
    res.json({
      ok: true,
      rank: Number(row.rank) || null,
      total: Number(row.total) || 0,
      score: Number(row.my_score) || 0
    });
    // Side-effect: record dynamic-mode activity + pay shared-day bonus
    // to every friend who also played today. Fire-and-forget — don't
    // make the score submission depend on the friend bonus succeeding.
    if (typeof recordDynActivityAndPayShared === 'function') {
      recordDynActivityAndPayShared(deviceId).catch(function() {});
    }
  } catch (e) {
    console.error('POST /api/boards/:id/score', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.get('/api/boards/:id/leaderboard', async (req, res) => {
  try {
    const boardId = parseInt(req.params.id, 10);
    if (!Number.isFinite(boardId) || boardId <= 0) return res.status(400).json({ error: 'bad_board' });
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 20));
    let rows = [];
    try {
      const r = await pool.query(
        `SELECT device_id, name, score, tier, country, updated_at
           FROM dynamic_board_scores
          WHERE board_id = $1
          ORDER BY score DESC, updated_at ASC
          LIMIT $2`,
        [boardId, limit]
      );
      rows = r.rows;
    } catch (innerErr) {
      if (innerErr && innerErr.code === '42P01') {
        rows = [];
      } else {
        throw innerErr;
      }
    }
    let total = 0, myRank = null, myScore = 0;
    try {
      const t = await pool.query(`SELECT COUNT(*)::int AS c FROM dynamic_board_scores WHERE board_id = $1`, [boardId]);
      total = (t.rows[0] && t.rows[0].c) || 0;
    } catch (e) {}
    if (deviceId) {
      try {
        const m = await pool.query(
          `SELECT score, (1 + (SELECT COUNT(*) FROM dynamic_board_scores
                              WHERE board_id = $1 AND score > dbs.score)) AS rank
             FROM dynamic_board_scores dbs
            WHERE board_id = $1 AND device_id = $2`,
          [boardId, deviceId]
        );
        if (m.rows[0]) {
          myScore = Number(m.rows[0].score) || 0;
          myRank = Number(m.rows[0].rank) || null;
        }
      } catch (e) {}
    }
    res.json({
      ok: true,
      list: rows.map(function(r) {
        return {
          name: r.name,
          score: r.score,
          tier: r.tier,
          country: r.country,
          you: deviceId && r.device_id === deviceId
        };
      }),
      total,
      myRank,
      myScore
    });
  } catch (e) {
    console.error('GET /api/boards/:id/leaderboard', e);
    res.json({ ok: true, list: [], total: 0, myRank: null, myScore: 0 });
  }
});

// ============================================================
// Dynamic Boards — Mystery Chest (May 2026)
//
// Server rolls the dice (anti-cheat: client never gets to pick).
// Dedup + daily cap via game_config keys (TTL-purged by the
// hourly cleanup that already handles _earn:* and _gift_rate:*).
// "Boosted" pity: the first N chests each day skip the common tier
// so new players don't open their first 3 chests for 5 gems each.
// ============================================================
const CHEST_TIERS = ['common', 'uncommon', 'rare', 'legendary', 'mythic'];
function chestConfigInt(cfg, key, def) {
  if (!cfg || cfg[key] == null || cfg[key] === '') return def;
  const n = parseInt(cfg[key], 10);
  return Number.isFinite(n) ? n : def;
}
async function loadCfgMap() {
  // Tiny helper: pull the relevant chest keys in one query.
  try {
    const r = await pool.query(
      `SELECT key, value FROM game_config WHERE key LIKE 'dyn_chest_%' OR key = 'dyn_chest_enabled'`
    );
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}
app.post('/api/boards/chest/open', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    // Rate-limit: 30 chests/hour. A normal player completing one game per
    // 2-3 minutes will never hit this; cheaters spamming will.
    if (!checkRateLimit('dyn_chest', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await loadCfgMap();
    if (cfg.dyn_chest_enabled === 'false') {
      return res.json({ ok: false, reason: 'disabled' });
    }
    const dailyCap = chestConfigInt(cfg, 'dyn_chest_daily_cap', 20);
    const boostedCount = chestConfigInt(cfg, 'dyn_chest_boosted_count', 3);
    // Per-day counter via game_config dedup row.
    const today = new Date().toISOString().slice(0, 10);
    const counterKey = `_chest:${deviceId}:${today}`;
    let openedToday = 0;
    try {
      const r = await pool.query(`SELECT value FROM game_config WHERE key = $1`, [counterKey]);
      if (r.rows[0]) openedToday = parseInt(r.rows[0].value, 10) || 0;
    } catch (e) {}
    if (openedToday >= dailyCap) {
      return res.json({ ok: false, reason: 'daily_cap', dailyCap, openedToday });
    }
    // Roll tier — first N chests of the day are boosted (no common).
    const weights = {
      common:    chestConfigInt(cfg, 'dyn_chest_weight_common',    60),
      uncommon:  chestConfigInt(cfg, 'dyn_chest_weight_uncommon',  25),
      rare:      chestConfigInt(cfg, 'dyn_chest_weight_rare',      12),
      legendary: chestConfigInt(cfg, 'dyn_chest_weight_legendary', 2),
      mythic:    chestConfigInt(cfg, 'dyn_chest_weight_mythic',    1)
    };
    const isBoosted = openedToday < boostedCount;
    if (isBoosted) weights.common = 0;
    const totalW = Object.values(weights).reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalW;
    let chosenTier = 'common';
    for (const t of CHEST_TIERS) {
      roll -= weights[t];
      if (roll <= 0) { chosenTier = t; break; }
    }
    // Pick a uniform amount in the tier range.
    const minV = chestConfigInt(cfg, `dyn_chest_${chosenTier}_min`, 0);
    const maxV = chestConfigInt(cfg, `dyn_chest_${chosenTier}_max`, Math.max(minV, 1));
    const amount = Math.floor(minV + Math.random() * Math.max(0, maxV - minV + 1));
    // Atomic credit + counter bump (two queries, second is dedup-safe).
    let newBalance = null;
    try {
      const credit = await pool.query(
        `UPDATE player_profiles SET balance = balance + $1, updated_at = NOW()
          WHERE device_id = $2 RETURNING balance`,
        [amount, deviceId]
      );
      if (credit.rows[0]) newBalance = credit.rows[0].balance;
    } catch (e) {
      console.error('chest credit failed', e && e.message);
    }
    await pool.query(
      `INSERT INTO game_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [counterKey, String(openedToday + 1)]
    ).catch(err => console.warn('chest counter persist failed', err && err.message));
    return res.json({
      ok: true,
      tier: chosenTier,
      amount: amount,
      boosted: isBoosted,
      openedToday: openedToday + 1,
      dailyCap: dailyCap,
      newBalance: newBalance
    });
  } catch (e) {
    console.error('POST /api/boards/chest/open', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Dynamic Boards — Streak Freeze purchase (May 2026)
//
// Atomic deduct via the existing balance-guarded UPDATE pattern.
// Client increments its local freeze counter on successful response.
// We don't store a server-side freeze count (the protection itself
// is purely client-side — buying a freeze converts 💎 to "missed-day
// insurance"). The atomic deduction is the anti-cheat door.
// ============================================================
app.post('/api/player/streak-freeze/buy', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('streak_freeze:buy', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await pool.query(
      `SELECT key, value FROM game_config WHERE key IN ('dyn_streak_freeze_enabled','dyn_streak_freeze_price')`
    );
    const cfgMap = {};
    cfg.rows.forEach(r => { cfgMap[r.key] = r.value; });
    if (cfgMap.dyn_streak_freeze_enabled === 'false') {
      return res.json({ ok: false, reason: 'disabled' });
    }
    const price = parseInt(cfgMap.dyn_streak_freeze_price, 10) || 200;
    // Atomic guarded deduction — caller must have at least `price` gems.
    const upd = await pool.query(
      `UPDATE player_profiles SET balance = balance - $1, updated_at = NOW()
        WHERE device_id = $2 AND balance >= $1 RETURNING balance`,
      [price, deviceId]
    );
    if (!upd.rows[0]) {
      return res.json({ ok: false, reason: 'insufficient_funds', price: price });
    }
    res.json({ ok: true, price: price, newBalance: upd.rows[0].balance });
  } catch (e) {
    console.error('POST /api/player/streak-freeze/buy', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Dynamic Boards — Comeback claim (May 2026)
//
// Re-engagement reward for lapsed players. Client computes
// eligibility from its localStorage (last_played + lost_streak),
// hits this endpoint to claim. Server-side dedup via a per-week
// game_config row so the player can't farm the comeback bonus by
// faking absence — they can claim at most once per 7-day window.
// ============================================================
app.post('/api/player/comeback-claim', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, daysAway, lostStreak } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('comeback:claim', deviceId, 6, 24 * 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const daysAwayN = parseInt(daysAway, 10) || 0;
    const lostStreakN = parseInt(lostStreak, 10) || 0;
    const cfg = await pool.query(
      `SELECT key, value FROM game_config WHERE key LIKE 'dyn_comeback_%'`
    );
    const cfgMap = {};
    cfg.rows.forEach(r => { cfgMap[r.key] = r.value; });
    if (cfgMap.dyn_comeback_enabled === 'false') {
      return res.json({ ok: false, reason: 'disabled' });
    }
    const minDays    = parseInt(cfgMap.dyn_comeback_min_days,    10) || 3;
    const minStreak  = parseInt(cfgMap.dyn_comeback_min_streak,  10) || 3;
    const reward     = parseInt(cfgMap.dyn_comeback_reward,      10) || 150;
    const freezeGift = parseInt(cfgMap.dyn_comeback_freeze_gift, 10) || 1;
    if (daysAwayN < minDays || lostStreakN < minStreak) {
      return res.json({ ok: false, reason: 'not_eligible', minDays, minStreak });
    }
    // Server-side dedup: one comeback claim per device per rolling 7 days.
    const dedupKey = `_comeback:${deviceId}:${Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000))}`;
    const existing = await pool.query(`SELECT value FROM game_config WHERE key = $1`, [dedupKey]);
    if (existing.rows.length) {
      return res.json({ ok: false, reason: 'already_claimed' });
    }
    await pool.query(
      `INSERT INTO game_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [dedupKey, '1']
    );
    // Atomic credit.
    let newBalance = null;
    try {
      const credit = await pool.query(
        `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2 RETURNING balance`,
        [reward, deviceId]
      );
      if (credit.rows[0]) newBalance = credit.rows[0].balance;
    } catch (e) {
      console.error('comeback credit failed', e && e.message);
    }
    res.json({
      ok: true,
      reward: reward,
      freezeGift: freezeGift,
      newBalance: newBalance
    });
  } catch (e) {
    console.error('POST /api/player/comeback-claim', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Season Pass (May 2026)
//
// 20-tier reward track. Player earns XP from game completion,
// quests, achievements. Tiers unlock at fixed XP thresholds. Each
// tier has a 💎 reward that must be MANUALLY claimed (the F2P
// Clash Royale claim hook — "I have rewards waiting" drives
// return visits).
//
// Anti-cheat: server stores the per-game dedup list in the same
// row as the XP. Client passes a gameId on grant; server refuses
// duplicates. XP per request is capped by season_xp_max_per_game
// so a forged-meta exploit can't grant arbitrary XP.
// ============================================================
async function loadSeasonConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'season_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}
function buildSeasonTiers(cfg) {
  const tiers = [];
  for (let i = 1; i <= 20; i++) {
    const xp = parseInt(cfg['season_tier_' + i + '_xp'], 10);
    const reward = parseInt(cfg['season_tier_' + i + '_reward'], 10);
    // Premium reward — fall back to 2× the free reward when the key
    // is missing (the schema seed values match this fallback exactly).
    let premiumReward = parseInt(cfg['season_tier_' + i + '_premium_reward'], 10);
    if (!Number.isFinite(premiumReward)) premiumReward = (Number.isFinite(reward) ? reward * 2 : 0);
    if (Number.isFinite(xp) && Number.isFinite(reward)) {
      tiers.push({ tier: i, xpRequired: xp, reward: reward, premiumReward: premiumReward });
    }
  }
  return tiers;
}
function seasonTierIndexForXP(tiers, xp) {
  // Returns the highest tier number the player has unlocked (0 = none).
  let unlocked = 0;
  for (const t of tiers) {
    if (xp >= t.xpRequired) unlocked = t.tier;
    else break;
  }
  return unlocked;
}

app.get('/api/player/season/status', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.status(400).json({ error: 'bad_device' });
    const cfg = await loadSeasonConfig();
    if (cfg.season_pass_enabled === 'false') {
      return res.json({ ok: true, enabled: false });
    }
    const seasonId = cfg.season_pass_season_id || 'S1';
    const tiers = buildSeasonTiers(cfg);
    const premiumEnabled = cfg.season_pass_premium_enabled !== 'false';
    const premiumPriceGems = parseInt(cfg.season_pass_premium_price_gems || '1500', 10) || 1500;
    const premiumPriceUsd = cfg.season_pass_premium_price_usd || '4.99';
    let row = { xp: 0, claimed_tiers: [], is_premium: false, claimed_premium_tiers: [] };
    try {
      const r = await pool.query(
        `SELECT xp, claimed_tiers, is_premium, claimed_premium_tiers FROM player_season_progress
          WHERE device_id = $1 AND season_id = $2`,
        [deviceId, seasonId]
      );
      if (r.rows[0]) row = r.rows[0];
    } catch (e) {}
    const xp = Number(row.xp) || 0;
    const claimed = Array.isArray(row.claimed_tiers) ? row.claimed_tiers : [];
    const isPremium = !!row.is_premium;
    const claimedPremium = Array.isArray(row.claimed_premium_tiers) ? row.claimed_premium_tiers : [];
    const currentTier = seasonTierIndexForXP(tiers, xp);
    // Unclaimed count includes premium when the player owns the track.
    let unclaimedCount = tiers.filter(t => t.tier <= currentTier && !claimed.includes(t.tier)).length;
    if (isPremium) {
      unclaimedCount += tiers.filter(t => t.tier <= currentTier && !claimedPremium.includes(t.tier)).length;
    }
    res.json({
      ok: true,
      enabled: true,
      seasonId,
      seasonName: cfg.season_pass_name || '🌸 Season',
      endsAt: cfg.season_pass_ends_at || null,
      xp,
      currentTier,
      claimedTiers: claimed,
      // Premium track state.
      isPremium,
      claimedPremiumTiers: claimedPremium,
      premiumEnabled,
      premiumPriceGems,
      premiumPriceUsd,
      // Number of unclaimed-but-unlocked rewards. When premium is owned
      // this counts BOTH free and premium per tier — so a player who
      // crossed tier 5 with premium and claimed nothing sees 10 🎁.
      unclaimedCount,
      tiers
    });
  } catch (e) {
    console.error('GET /api/player/season/status', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/player/season/grant-xp', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, gameId, source, meta } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('season_xp', deviceId, 120, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await loadSeasonConfig();
    if (cfg.season_pass_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const seasonId = cfg.season_pass_season_id || 'S1';
    // Compute XP from validated source + meta. Client suggests but
    // server validates — bypassing this would let a cheater mint XP.
    let xpGain = 0;
    const baseFinish = parseInt(cfg.season_xp_game_finish, 10) || 10;
    const crownBonus = parseInt(cfg.season_xp_crown_bonus, 10) || 25;
    const per10k     = parseInt(cfg.season_xp_per_10k_score, 10) || 5;
    const questDone  = parseInt(cfg.season_xp_quest_done, 10) || 30;
    const achievement = parseInt(cfg.season_xp_achievement, 10) || 50;
    const maxPerGame = parseInt(cfg.season_xp_max_per_game, 10) || 100;
    if (source === 'dyn_game_finish') {
      const score = parseInt((meta && meta.score) || 0, 10) || 0;
      const tier  = parseInt((meta && meta.tier)  || 0, 10) || 0;
      xpGain += baseFinish;
      if (tier >= 8) xpGain += crownBonus;
      xpGain += Math.min(5, Math.floor(score / 10000)) * per10k;
      xpGain = Math.min(maxPerGame, xpGain);
    } else if (source === 'quest_done') {
      xpGain = questDone;
    } else if (source === 'achievement') {
      xpGain = achievement;
    } else {
      return res.json({ ok: false, reason: 'bad_source' });
    }
    if (xpGain <= 0) return res.json({ ok: false, reason: 'no_xp' });
    // Daily Special multiplier — when the player just finished a game
    // on today's special board, multiply XP. Client passes meta.boardId.
    // Server verifies the boardId IS today's special via getDailySpecialForToday.
    let dailySpecialApplied = false;
    let dailySpecialMult = 1;
    const boardId = parseInt((meta && meta.boardId) || 0, 10) || 0;
    if (boardId > 0 && (source === 'dyn_game_finish' || source === 'quest_done')) {
      try {
        const ctx = await getDailySpecialForToday();
        if (ctx && ctx.enabled && ctx.id === boardId) {
          dailySpecialMult = ctx.xpMult;
          // Cap at maxPerGame × mult so a player on the daily special can
          // earn up to ~300 XP in one game when xpMult=3 and the base
          // cap is 100. This is the explicit "today's the day to grind" payoff.
          xpGain = Math.min(maxPerGame * Math.ceil(dailySpecialMult), Math.round(xpGain * dailySpecialMult));
          dailySpecialApplied = true;
        }
      } catch (specErr) { /* soft-fail — base XP still grants */ }
    }
    // Per-game/per-quest dedup — uses gameId or a synthetic key per source.
    const dedupId = String(gameId || (source + ':' + (meta && meta.id) || '')).slice(0, 64);
    // Ensure row exists.
    await pool.query(
      `INSERT INTO player_season_progress (device_id, season_id) VALUES ($1, $2)
       ON CONFLICT (device_id, season_id) DO NOTHING`,
      [deviceId, seasonId]
    );
    // Read current state + check dedup.
    const cur = await pool.query(
      `SELECT xp, recent_game_ids FROM player_season_progress
        WHERE device_id = $1 AND season_id = $2`,
      [deviceId, seasonId]
    );
    const row = cur.rows[0] || { xp: 0, recent_game_ids: [] };
    const recent = Array.isArray(row.recent_game_ids) ? row.recent_game_ids : [];
    if (recent.includes(dedupId)) {
      return res.json({ ok: false, reason: 'already_granted', xp: Number(row.xp) || 0 });
    }
    // Append + trim to last 50 ids (keeps the JSON small).
    const newRecent = [dedupId].concat(recent).slice(0, 50);
    const newXp = (Number(row.xp) || 0) + xpGain;
    await pool.query(
      `UPDATE player_season_progress
          SET xp = $1, recent_game_ids = $2::jsonb, last_xp_at = NOW(), updated_at = NOW()
        WHERE device_id = $3 AND season_id = $4`,
      [newXp, JSON.stringify(newRecent), deviceId, seasonId]
    );
    const tiers = buildSeasonTiers(cfg);
    const oldTier = seasonTierIndexForXP(tiers, Number(row.xp) || 0);
    const newTier = seasonTierIndexForXP(tiers, newXp);
    res.json({
      ok: true,
      xpGained: xpGain,
      newXp,
      previousTier: oldTier,
      currentTier: newTier,
      leveledUp: newTier > oldTier,
      dailySpecialApplied,
      dailySpecialMult
    });
  } catch (e) {
    console.error('POST /api/player/season/grant-xp', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/player/season/claim-tier', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, tier, track } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const tierN = parseInt(tier, 10);
    if (!Number.isFinite(tierN) || tierN < 1 || tierN > 20) {
      return res.status(400).json({ error: 'bad_tier' });
    }
    // 'track' is optional — defaults to 'free' for back-compat with old clients.
    const trackKind = (track === 'premium') ? 'premium' : 'free';
    if (!checkRateLimit('season_claim', deviceId, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await loadSeasonConfig();
    if (cfg.season_pass_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const seasonId = cfg.season_pass_season_id || 'S1';
    const tiers = buildSeasonTiers(cfg);
    const tierObj = tiers.find(t => t.tier === tierN);
    if (!tierObj) return res.json({ ok: false, reason: 'tier_not_found' });
    // Read state — now includes is_premium + claimed_premium_tiers for the dual-track.
    const cur = await pool.query(
      `SELECT xp, claimed_tiers, is_premium, claimed_premium_tiers FROM player_season_progress
        WHERE device_id = $1 AND season_id = $2`,
      [deviceId, seasonId]
    );
    if (!cur.rows[0]) return res.json({ ok: false, reason: 'no_progress' });
    const xp = Number(cur.rows[0].xp) || 0;
    const claimed = Array.isArray(cur.rows[0].claimed_tiers) ? cur.rows[0].claimed_tiers : [];
    const isPremium = !!cur.rows[0].is_premium;
    const claimedPremium = Array.isArray(cur.rows[0].claimed_premium_tiers) ? cur.rows[0].claimed_premium_tiers : [];
    if (xp < tierObj.xpRequired) return res.json({ ok: false, reason: 'not_unlocked', xpRequired: tierObj.xpRequired, xp });
    // Premium-track gating.
    if (trackKind === 'premium' && !isPremium) {
      return res.json({ ok: false, reason: 'premium_required' });
    }
    // Per-track dedup.
    const targetList = trackKind === 'premium' ? claimedPremium : claimed;
    if (targetList.includes(tierN)) return res.json({ ok: false, reason: 'already_claimed' });
    const rewardAmt = trackKind === 'premium' ? tierObj.premiumReward : tierObj.reward;
    // Atomic: append tier to the right list + credit the reward.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const newList = targetList.concat([tierN]);
      const updateCol = trackKind === 'premium' ? 'claimed_premium_tiers' : 'claimed_tiers';
      await client.query(
        `UPDATE player_season_progress
            SET ${updateCol} = $1::jsonb, updated_at = NOW()
          WHERE device_id = $2 AND season_id = $3`,
        [JSON.stringify(newList), deviceId, seasonId]
      );
      const credit = await client.query(
        `UPDATE player_profiles
            SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2 RETURNING balance`,
        [rewardAmt, deviceId]
      );
      await client.query('COMMIT');
      const newBalance = credit.rows[0] ? credit.rows[0].balance : null;
      return res.json({
        ok: true,
        tier: tierN,
        track: trackKind,
        reward: rewardAmt,
        newBalance,
        claimedTiers: trackKind === 'free' ? newList : claimed,
        claimedPremiumTiers: trackKind === 'premium' ? newList : claimedPremium
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/player/season/claim-tier', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 17 — Premium Battle Pass purchase
// Atomic: deduct balance + flip is_premium in ONE transaction.
// Insufficient funds returns 200 with reason — UI shows "buy gems" hint.
// Already-premium returns 200 with reason — idempotent.
// ============================================================
app.post('/api/player/season/buy-premium', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('season_buy_premium', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await loadSeasonConfig();
    if (cfg.season_pass_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    if (cfg.season_pass_premium_enabled === 'false') return res.json({ ok: false, reason: 'premium_disabled' });
    const seasonId = cfg.season_pass_season_id || 'S1';
    const price = parseInt(cfg.season_pass_premium_price_gems || '1500', 10) || 1500;
    // Make sure the progress row exists.
    await pool.query(
      `INSERT INTO player_season_progress (device_id, season_id) VALUES ($1, $2)
       ON CONFLICT (device_id, season_id) DO NOTHING`,
      [deviceId, seasonId]
    );
    // Already-premium check.
    const cur = await pool.query(
      `SELECT is_premium FROM player_season_progress WHERE device_id = $1 AND season_id = $2`,
      [deviceId, seasonId]
    );
    if (cur.rows[0] && cur.rows[0].is_premium) {
      return res.json({ ok: false, reason: 'already_premium' });
    }
    // Atomic: deduct + flip in a transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const debit = await client.query(
        `UPDATE player_profiles
            SET balance = balance - $1, updated_at = NOW()
          WHERE device_id = $2 AND balance >= $1 RETURNING balance`,
        [price, deviceId]
      );
      if (!debit.rows[0]) {
        await client.query('ROLLBACK');
        // Read current balance so the UI can show "you have N, need M".
        const balR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
        const bal = balR.rows[0] ? Number(balR.rows[0].balance) : 0;
        return res.json({ ok: false, reason: 'insufficient_funds', price, balance: bal });
      }
      await client.query(
        `UPDATE player_season_progress
            SET is_premium = TRUE, premium_purchased_at = NOW(), updated_at = NOW()
          WHERE device_id = $1 AND season_id = $2`,
        [deviceId, seasonId]
      );
      await client.query('COMMIT');
      return res.json({
        ok: true,
        price,
        newBalance: Number(debit.rows[0].balance)
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/player/season/buy-premium', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 20 — Starter Pack
//
// The single highest-conversion offer in F2P puzzle games. Triggers
// once per device after they cross the trigger score for the first
// time. 7-day countdown. Pays out: gems + a skin + N BP tiers.
//
// State lives in starter_pack_state. Eligibility computed lazily on
// each /status call: client sends current best score, server checks
// if it crossed trigger_score and stamps eligible_at + expires_at.
// ============================================================
async function loadStarterPackConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'starter_pack_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

app.get('/api/player/starter-pack/status', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.status(400).json({ error: 'bad_device' });
    // Client passes ?score=NNN — their current best/recent score. We use
    // it for trigger eligibility but NEVER for reward calculation (the
    // server picks the reward from config).
    const reportedScore = parseInt(req.query.score || '0', 10) || 0;
    const cfg = await loadStarterPackConfig();
    if (cfg.starter_pack_enabled === 'false') {
      return res.json({ ok: true, enabled: false });
    }
    const triggerScore = parseInt(cfg.starter_pack_trigger_score || '5000', 10) || 5000;
    const expiresHours = parseInt(cfg.starter_pack_expires_hours || '168', 10) || 168;
    const seasonId = 'S1'; // For now hardcoded; later wire to season_pass_season_id.
    // Ensure row exists.
    await pool.query(
      `INSERT INTO starter_pack_state (device_id, season_id) VALUES ($1, $2)
       ON CONFLICT (device_id) DO NOTHING`,
      [deviceId, seasonId]
    );
    let row = (await pool.query(
      `SELECT eligible_at, expires_at, purchased_at, dismissed_count
         FROM starter_pack_state WHERE device_id = $1`,
      [deviceId]
    )).rows[0] || {};
    // Already purchased — short-circuit.
    if (row.purchased_at) {
      return res.json({ ok: true, enabled: true, purchased: true, purchasedAt: row.purchased_at });
    }
    // First-time eligibility check: cross the trigger score → stamp eligible_at.
    if (!row.eligible_at && reportedScore >= triggerScore) {
      const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);
      await pool.query(
        `UPDATE starter_pack_state
            SET eligible_at = NOW(), expires_at = $1, updated_at = NOW()
          WHERE device_id = $2 AND eligible_at IS NULL`,
        [expiresAt, deviceId]
      );
      row.eligible_at = new Date();
      row.expires_at = expiresAt;
    }
    if (!row.eligible_at) {
      return res.json({
        ok: true, enabled: true, available: false,
        triggerScore, currentScore: reportedScore
      });
    }
    // Check expiry.
    const now = Date.now();
    const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (expiresAtMs && now > expiresAtMs) {
      return res.json({ ok: true, enabled: true, available: false, expired: true });
    }
    // Build the offer payload.
    const priceGems = parseInt(cfg.starter_pack_price_gems || '500', 10) || 500;
    const priceUsd = cfg.starter_pack_price_usd || '1.99';
    const rewardGems = parseInt(cfg.starter_pack_reward_gems || '1500', 10) || 1500;
    const rewardBpTiers = parseInt(cfg.starter_pack_reward_bp_tiers || '3', 10) || 3;
    const rewardSkinId = cfg.starter_pack_reward_skin_id || 'fire';
    const name = cfg.starter_pack_name || '🎁 חבילת פתיחה';
    res.json({
      ok: true,
      enabled: true,
      available: true,
      name,
      expiresAt: row.expires_at,
      priceGems,
      priceUsd,
      rewardGems,
      rewardBpTiers,
      rewardSkinId,
      dismissedCount: row.dismissed_count || 0
    });
  } catch (e) {
    console.error('GET /api/player/starter-pack/status', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/player/starter-pack/dismiss', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('starter_pack_dismiss', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    await pool.query(
      `UPDATE starter_pack_state
          SET dismissed_count = dismissed_count + 1, updated_at = NOW()
        WHERE device_id = $1`,
      [deviceId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/player/starter-pack/dismiss', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/player/starter-pack/buy', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('starter_pack_buy', deviceId, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await loadStarterPackConfig();
    if (cfg.starter_pack_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    // Verify eligibility on the server (not trusting client).
    const stateR = await pool.query(
      `SELECT eligible_at, expires_at, purchased_at FROM starter_pack_state
        WHERE device_id = $1`,
      [deviceId]
    );
    const state = stateR.rows[0];
    if (!state) return res.json({ ok: false, reason: 'not_eligible' });
    if (state.purchased_at) return res.json({ ok: false, reason: 'already_purchased' });
    if (!state.eligible_at) return res.json({ ok: false, reason: 'not_eligible' });
    if (state.expires_at && new Date(state.expires_at).getTime() < Date.now()) {
      return res.json({ ok: false, reason: 'expired' });
    }
    const priceGems = parseInt(cfg.starter_pack_price_gems || '500', 10) || 500;
    const rewardGems = parseInt(cfg.starter_pack_reward_gems || '1500', 10) || 1500;
    const rewardBpTiers = parseInt(cfg.starter_pack_reward_bp_tiers || '3', 10) || 3;
    const rewardSkinId = cfg.starter_pack_reward_skin_id || 'fire';
    // Atomic: deduct price + credit reward gems + grant skin + grant BP tiers
    // (just XP — claim is still manual). All in one transaction so any
    // step's failure rolls everything back.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Net effect on balance: reward_gems - price_gems. If price > reward we'd
      // be deducting, so we use two separate UPDATEs to keep the math obvious.
      const debit = await client.query(
        `UPDATE player_profiles
            SET balance = balance - $1, updated_at = NOW()
          WHERE device_id = $2 AND balance >= $1 RETURNING balance`,
        [priceGems, deviceId]
      );
      if (!debit.rows[0]) {
        await client.query('ROLLBACK');
        const balR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
        const bal = balR.rows[0] ? Number(balR.rows[0].balance) : 0;
        return res.json({ ok: false, reason: 'insufficient_funds', price: priceGems, balance: bal });
      }
      await client.query(
        `UPDATE player_profiles
            SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2`,
        [rewardGems, deviceId]
      );
      // Grant skin (idempotent — if owned, no-op).
      if (rewardSkinId && rewardSkinId !== 'classic') {
        await client.query(
          `INSERT INTO player_skins (device_id, skin_id) VALUES ($1, $2)
           ON CONFLICT (device_id, skin_id) DO NOTHING`,
          [deviceId, rewardSkinId]
        );
      }
      // Grant BP XP (treat as immediate "lift" via xp increment). The
      // simplest implementation: add enough XP to advance ~rewardBpTiers.
      // Read current XP + tier thresholds, add the gap to reach
      // current_tier + reward_bp_tiers.
      const seasonId = 'S1';
      const cfgR = await client.query(
        `SELECT key, value FROM game_config WHERE key LIKE 'season_tier_%_xp'`
      );
      const tierXp = {};
      cfgR.rows.forEach(r => {
        const m = r.key.match(/^season_tier_(\d+)_xp$/);
        if (m) tierXp[parseInt(m[1], 10)] = parseInt(r.value, 10);
      });
      const curR = await client.query(
        `SELECT xp FROM player_season_progress WHERE device_id = $1 AND season_id = $2`,
        [deviceId, seasonId]
      );
      const curXp = curR.rows[0] ? (Number(curR.rows[0].xp) || 0) : 0;
      // Figure out the player's current tier.
      let curTier = 0;
      for (let t = 1; t <= 20; t++) {
        if (tierXp[t] && curXp >= tierXp[t]) curTier = t;
      }
      const targetTier = Math.min(20, curTier + rewardBpTiers);
      const targetXp = tierXp[targetTier] || curXp;
      const xpBoost = Math.max(0, targetXp - curXp);
      if (xpBoost > 0) {
        await client.query(
          `INSERT INTO player_season_progress (device_id, season_id, xp)
              VALUES ($1, $2, $3)
           ON CONFLICT (device_id, season_id) DO UPDATE SET xp = player_season_progress.xp + $3, updated_at = NOW()`,
          [deviceId, seasonId, xpBoost]
        );
      }
      // Stamp purchase + snapshot pack contents.
      const packContents = {
        priceGems, rewardGems, rewardBpTiers, rewardSkinId,
        xpBoost: xpBoost
      };
      await client.query(
        `UPDATE starter_pack_state
            SET purchased_at = NOW(), pack_contents = $1::jsonb, updated_at = NOW()
          WHERE device_id = $2`,
        [JSON.stringify(packContents), deviceId]
      );
      await client.query('COMMIT');
      // Read final balance for response.
      const finalR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
      const newBalance = finalR.rows[0] ? Number(finalR.rows[0].balance) : null;
      return res.json({
        ok: true,
        priceGems, rewardGems, rewardBpTiers, rewardSkinId,
        xpBoost,
        newBalance
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/player/starter-pack/buy', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 21 — Daily Deals (May 2026)
//
// One deal per day, deterministic per Asia/Jerusalem date. Admin can
// override via daily_deals_override_id. Each deal: gems / skin / BP
// tiers / chest / freezes / mega bundle. 24h countdown. One purchase
// per device per day per deal.
// ============================================================
function _dailyDealHash(dateStr) {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

async function _loadDailyDealsCfg() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'daily_deals_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

async function _pickTodaysDeal() {
  // Returns the deal row + nextMidnightAt (Asia/Jerusalem) OR null.
  try {
    const cfg = await _loadDailyDealsCfg();
    if (cfg.daily_deals_enabled === 'false') return null;
    const enabledR = await pool.query(
      `SELECT * FROM daily_deals WHERE is_enabled = TRUE ORDER BY sort_order, id`
    );
    const pool_ = enabledR.rows;
    if (!pool_.length) return null;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    // Admin override.
    const overrideId = parseInt(cfg.daily_deals_override_id || '', 10);
    let pick = null;
    if (Number.isFinite(overrideId) && overrideId > 0) {
      pick = pool_.find(d => d.id === overrideId) || null;
    }
    if (!pick) {
      const idx = _dailyDealHash(today) % pool_.length;
      pick = pool_[idx];
    }
    return { deal: pick, date: today };
  } catch (e) { return null; }
}

function _msUntilNextIsraelMidnight() {
  // Compute ms until next Asia/Jerusalem midnight, accurate to ~1s.
  const now = new Date();
  const israelNowStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
  const israelNow = new Date(israelNowStr);
  const tomorrow = new Date(israelNow);
  tomorrow.setHours(24, 0, 0, 0);
  return tomorrow.getTime() - israelNow.getTime();
}

app.get('/api/daily-deals/today', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    const picked = await _pickTodaysDeal();
    if (!picked) return res.json({ ok: true, enabled: false });
    const deal = picked.deal;
    const msLeft = _msUntilNextIsraelMidnight();
    const expiresAt = new Date(Date.now() + msLeft);
    // Check if device already purchased today.
    let purchased = false;
    if (deviceId && deviceId.length >= 8) {
      const purR = await pool.query(
        `SELECT 1 FROM daily_deal_purchases
          WHERE device_id = $1 AND deal_id = $2 AND purchase_date = $3::date`,
        [deviceId, deal.id, picked.date]
      );
      purchased = purR.rows.length > 0;
    }
    const discountPct = deal.original_value && deal.original_value > deal.price_gems
      ? Math.round(((deal.original_value - deal.price_gems) / deal.original_value) * 100)
      : null;
    res.json({
      ok: true,
      enabled: true,
      date: picked.date,
      expiresAt,
      msLeft,
      deal: {
        id: deal.id,
        slug: deal.slug,
        name: deal.name,
        description: deal.description,
        emoji: deal.emoji,
        priceGems: deal.price_gems,
        originalValue: deal.original_value,
        discountPct,
        contents: deal.contents,
        category: deal.category
      },
      purchased
    });
  } catch (e) {
    console.error('GET /api/daily-deals/today', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/daily-deals/buy', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, dealId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const dealIdN = parseInt(dealId, 10);
    if (!Number.isFinite(dealIdN) || dealIdN <= 0) {
      return res.status(400).json({ error: 'bad_deal' });
    }
    if (!checkRateLimit('daily_deal_buy', deviceId, 20, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    // Verify dealId is actually today's deal (anti-cheat — don't trust client to send any old dealId).
    const picked = await _pickTodaysDeal();
    if (!picked) return res.json({ ok: false, reason: 'disabled' });
    if (picked.deal.id !== dealIdN) {
      return res.json({ ok: false, reason: 'wrong_deal' });
    }
    const deal = picked.deal;
    const today = picked.date;
    // Already-purchased check.
    const purR = await pool.query(
      `SELECT 1 FROM daily_deal_purchases
        WHERE device_id = $1 AND deal_id = $2 AND purchase_date = $3::date`,
      [deviceId, dealIdN, today]
    );
    if (purR.rows.length) return res.json({ ok: false, reason: 'already_purchased' });
    const contents = deal.contents || {};
    const grantGems = parseInt(contents.gems || 0, 10) || 0;
    const grantBpTiers = parseInt(contents.bp_tiers || 0, 10) || 0;
    const grantChests = parseInt(contents.chest_count || 0, 10) || 0;
    const grantFreezes = parseInt(contents.streak_freezes || 0, 10) || 0;
    const grantSkin = contents.skin_id && typeof contents.skin_id === 'string' && contents.skin_id.length < 40
      ? contents.skin_id : null;
    // Atomic transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const debit = await client.query(
        `UPDATE player_profiles
            SET balance = balance - $1, updated_at = NOW()
          WHERE device_id = $2 AND balance >= $1 RETURNING balance`,
        [deal.price_gems, deviceId]
      );
      if (!debit.rows[0]) {
        await client.query('ROLLBACK');
        const balR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
        const bal = balR.rows[0] ? Number(balR.rows[0].balance) : 0;
        return res.json({ ok: false, reason: 'insufficient_funds', price: deal.price_gems, balance: bal });
      }
      if (grantGems > 0) {
        await client.query(
          `UPDATE player_profiles
              SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
            WHERE device_id = $2`,
          [grantGems, deviceId]
        );
      }
      if (grantSkin && grantSkin !== 'classic') {
        await client.query(
          `INSERT INTO player_skins (device_id, skin_id) VALUES ($1, $2)
           ON CONFLICT (device_id, skin_id) DO NOTHING`,
          [deviceId, grantSkin]
        );
      }
      // BP tiers: same XP-boost logic as starter pack.
      if (grantBpTiers > 0) {
        const cfgR = await client.query(
          `SELECT key, value FROM game_config WHERE key LIKE 'season_tier_%_xp'`
        );
        const tierXp = {};
        cfgR.rows.forEach(r => {
          const m = r.key.match(/^season_tier_(\d+)_xp$/);
          if (m) tierXp[parseInt(m[1], 10)] = parseInt(r.value, 10);
        });
        const seasonId = 'S1';
        const curR = await client.query(
          `SELECT xp FROM player_season_progress WHERE device_id = $1 AND season_id = $2`,
          [deviceId, seasonId]
        );
        const curXp = curR.rows[0] ? (Number(curR.rows[0].xp) || 0) : 0;
        let curTier = 0;
        for (let t = 1; t <= 20; t++) {
          if (tierXp[t] && curXp >= tierXp[t]) curTier = t;
        }
        const targetTier = Math.min(20, curTier + grantBpTiers);
        const xpBoost = Math.max(0, (tierXp[targetTier] || curXp) - curXp);
        if (xpBoost > 0) {
          await client.query(
            `INSERT INTO player_season_progress (device_id, season_id, xp)
                VALUES ($1, $2, $3)
             ON CONFLICT (device_id, season_id) DO UPDATE SET xp = player_season_progress.xp + $3, updated_at = NOW()`,
            [deviceId, seasonId, xpBoost]
          );
        }
      }
      // Mark purchased.
      await client.query(
        `INSERT INTO daily_deal_purchases (device_id, deal_id, purchase_date, price_paid, contents_snapshot)
             VALUES ($1, $2, $3::date, $4, $5::jsonb)`,
        [deviceId, dealIdN, today, deal.price_gems, JSON.stringify(contents)]
      );
      await client.query('COMMIT');
      const finalR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
      const newBalance = finalR.rows[0] ? Number(finalR.rows[0].balance) : null;
      return res.json({
        ok: true,
        dealId: dealIdN,
        price: deal.price_gems,
        contents,
        granted: {
          gems: grantGems, bpTiers: grantBpTiers, skinId: grantSkin,
          chests: grantChests, freezes: grantFreezes
        },
        newBalance
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/daily-deals/buy', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Admin Daily Deals CRUD endpoints live inside the
// `if (ADMIN_PATH && ADMIN_PASSWORD)` block further down in this file
// (the adminRouter is defined there).

// ============================================================
// Stage 18 — Skin Gacha (variable-reward Skinner box)
//
// 5 rarity tiers (common 60% / uncommon 25% / rare 12% / legendary
// 2.5% / mythic 0.5%) — admin-tunable. Pity system guarantees
// legendary+ at gacha_pity_threshold pulls. Daily free pull. 10x
// pull bundle with 10% discount. Featured item boosts rate within
// its rarity.
//
// Anti-cheat: server picks rarity + reward entirely. Client never
// suggests anything. All rolls logged to gacha_pulls_history for
// audit + future ML-driven balance tweaks.
// ============================================================
async function _loadGachaConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'gacha_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

async function _gachaResolveOnePull(cfg, pityCounter, isFreePull) {
  // Returns { rarity, reward, wasPity, wasFeatured }.
  // reward = { type, amount, skinId, displayName, emoji, poolId }
  const pityThreshold = parseInt(cfg.gacha_pity_threshold || '50', 10) || 50;
  const pityHit = pityCounter + 1 >= pityThreshold;
  // Pick rarity.
  let rarity;
  if (pityHit) {
    // Guaranteed legendary+, but still rolls between legendary/mythic
    // weighted by their relative weights.
    const wLeg = parseFloat(cfg.gacha_weight_legendary || '2.5') || 2.5;
    const wMyth = parseFloat(cfg.gacha_weight_mythic || '0.5') || 0.5;
    const rand = Math.random() * (wLeg + wMyth);
    rarity = rand < wMyth ? 'mythic' : 'legendary';
  } else {
    const weights = {
      common:    parseFloat(cfg.gacha_weight_common    || '60')  || 60,
      uncommon:  parseFloat(cfg.gacha_weight_uncommon  || '25')  || 25,
      rare:      parseFloat(cfg.gacha_weight_rare      || '12')  || 12,
      legendary: parseFloat(cfg.gacha_weight_legendary || '2.5') || 2.5,
      mythic:    parseFloat(cfg.gacha_weight_mythic    || '0.5') || 0.5
    };
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    rarity = 'common';
    for (const [r, w] of Object.entries(weights)) {
      if (roll < w) { rarity = r; break; }
      roll -= w;
    }
  }
  // Pick a reward from the pool at this rarity.
  const featuredId = parseInt(cfg.gacha_featured_id || '', 10);
  const featuredBoostPct = parseFloat(cfg.gacha_featured_boost_pct || '30') || 30;
  const poolR = await pool.query(
    `SELECT * FROM gacha_pool WHERE rarity = $1 AND is_enabled = TRUE`,
    [rarity]
  );
  let candidates = poolR.rows;
  if (!candidates.length) {
    // Fallback — if rarity is empty, return some gems.
    return {
      rarity,
      reward: { type: 'gems', amount: 50, displayName: '50 יהלומים', emoji: '💎', poolId: null },
      wasPity: pityHit,
      wasFeatured: false
    };
  }
  // Apply featured boost.
  let wasFeaturedOut = false;
  const adjusted = candidates.map(c => {
    let w = c.weight || 100;
    if (Number.isFinite(featuredId) && c.id === featuredId) {
      w = Math.round(w * (1 + featuredBoostPct / 100));
    }
    return { row: c, weight: w };
  });
  const total = adjusted.reduce((a, b) => a + b.weight, 0);
  let roll = Math.random() * total;
  let pick = adjusted[0];
  for (const c of adjusted) {
    if (roll < c.weight) { pick = c; break; }
    roll -= c.weight;
  }
  if (Number.isFinite(featuredId) && pick.row.id === featuredId) wasFeaturedOut = true;
  return {
    rarity,
    reward: {
      type: pick.row.reward_type,
      amount: pick.row.amount,
      skinId: pick.row.skin_id,
      displayName: pick.row.display_name,
      emoji: pick.row.emoji,
      poolId: pick.row.id
    },
    wasPity: pityHit,
    wasFeatured: wasFeaturedOut
  };
}

async function _gachaGrantReward(client, deviceId, reward) {
  // Applies the reward atomically. Caller is responsible for BEGIN/COMMIT.
  // Returns { duplicateConverted } when a skin was already owned.
  const t = reward.type;
  if (t === 'gems') {
    await client.query(
      `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE device_id = $2`,
      [reward.amount, deviceId]
    );
    return {};
  } else if (t === 'skin') {
    // Check if already owned — convert to gems if so.
    const owned = await client.query(
      `SELECT 1 FROM player_skins WHERE device_id = $1 AND skin_id = $2`,
      [deviceId, reward.skinId]
    );
    if (owned.rows.length) {
      // Duplicate — convert to gems at config-driven percentage.
      const cfgR = await client.query(`SELECT value FROM game_config WHERE key = 'gacha_dups_to_gems_pct'`);
      const pct = parseFloat((cfgR.rows[0] && cfgR.rows[0].value) || '50') || 50;
      // Estimate skin "value" from existing skin price config — fall back to a flat 200.
      const skinPriceR = await client.query(`SELECT price FROM skin_configurations WHERE skin_id = $1`, [reward.skinId]).catch(() => ({ rows: [] }));
      const skinPrice = skinPriceR.rows[0] ? Number(skinPriceR.rows[0].price) || 200 : 200;
      const gems = Math.max(20, Math.round(skinPrice * pct / 100));
      await client.query(
        `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE device_id = $2`,
        [gems, deviceId]
      );
      return { duplicateConverted: true, gems };
    }
    await client.query(
      `INSERT INTO player_skins (device_id, skin_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [deviceId, reward.skinId]
    );
    return {};
  } else if (t === 'bp_tier') {
    // Boost player's season XP by N tier-worth.
    const cfgR = await client.query(`SELECT key, value FROM game_config WHERE key LIKE 'season_tier_%_xp'`);
    const tierXp = {};
    cfgR.rows.forEach(r => {
      const m = r.key.match(/^season_tier_(\d+)_xp$/);
      if (m) tierXp[parseInt(m[1], 10)] = parseInt(r.value, 10);
    });
    const seasonId = 'S1';
    const curR = await client.query(
      `SELECT xp FROM player_season_progress WHERE device_id = $1 AND season_id = $2`,
      [deviceId, seasonId]
    );
    const curXp = curR.rows[0] ? (Number(curR.rows[0].xp) || 0) : 0;
    let curTier = 0;
    for (let t2 = 1; t2 <= 20; t2++) {
      if (tierXp[t2] && curXp >= tierXp[t2]) curTier = t2;
    }
    const targetTier = Math.min(20, curTier + (reward.amount || 1));
    const xpBoost = Math.max(0, (tierXp[targetTier] || curXp) - curXp);
    if (xpBoost > 0) {
      await client.query(
        `INSERT INTO player_season_progress (device_id, season_id, xp) VALUES ($1, $2, $3)
         ON CONFLICT (device_id, season_id) DO UPDATE SET xp = player_season_progress.xp + $3, updated_at = NOW()`,
        [deviceId, seasonId, xpBoost]
      );
    }
    return { xpBoost };
  } else if (t === 'chest' || t === 'freeze') {
    // Stored as a counter on player_profiles (or we credit gems if no counter exists).
    // For v1 — credit equivalent gems. Future: actual chest/freeze inventory.
    const gems = (t === 'chest' ? 50 : 100) * (reward.amount || 1);
    await client.query(
      `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE device_id = $2`,
      [gems, deviceId]
    );
    return { convertedToGems: gems };
  }
  return {};
}

app.get('/api/gacha/state', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    const cfg = await _loadGachaConfig();
    if (cfg.gacha_enabled === 'false') return res.json({ ok: true, enabled: false });
    const enabled = true;
    let state = { total_pulls: 0, pity_counter: 0, free_pull_claimed_date: null };
    if (deviceId && deviceId.length >= 8) {
      await pool.query(
        `INSERT INTO player_gacha_state (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [deviceId]
      );
      const r = await pool.query(
        `SELECT total_pulls, pity_counter, free_pull_claimed_date FROM player_gacha_state WHERE device_id = $1`,
        [deviceId]
      );
      if (r.rows[0]) state = r.rows[0];
    }
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const freeAvailable = (cfg.gacha_free_pull_enabled !== 'false') &&
      (!state.free_pull_claimed_date || state.free_pull_claimed_date.toISOString().slice(0, 10) !== today);
    // Pool composition + featured info.
    const poolR = await pool.query(
      `SELECT id, rarity, reward_type, amount, skin_id, display_name, emoji, is_featured, weight FROM gacha_pool WHERE is_enabled = TRUE ORDER BY
       CASE rarity WHEN 'mythic' THEN 1 WHEN 'legendary' THEN 2 WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 4 ELSE 5 END, id`
    );
    const featuredId = parseInt(cfg.gacha_featured_id || '', 10);
    const featured = Number.isFinite(featuredId) ? poolR.rows.find(p => p.id === featuredId) : null;
    res.json({
      ok: true,
      enabled,
      name: cfg.gacha_name || '🎰 גאצ׳ה',
      priceSingle: parseInt(cfg.gacha_price_single || '100', 10) || 100,
      priceTen: parseInt(cfg.gacha_price_ten || '900', 10) || 900,
      pityThreshold: parseInt(cfg.gacha_pity_threshold || '50', 10) || 50,
      pityCounter: state.pity_counter | 0,
      pityRemaining: Math.max(0, (parseInt(cfg.gacha_pity_threshold || '50', 10) || 50) - (state.pity_counter | 0)),
      totalPulls: state.total_pulls | 0,
      freeAvailable,
      featured: featured ? {
        id: featured.id, rarity: featured.rarity,
        rewardType: featured.reward_type, amount: featured.amount, skinId: featured.skin_id,
        displayName: featured.display_name, emoji: featured.emoji
      } : null,
      pool: poolR.rows,
      weights: {
        common: parseFloat(cfg.gacha_weight_common || '60') || 60,
        uncommon: parseFloat(cfg.gacha_weight_uncommon || '25') || 25,
        rare: parseFloat(cfg.gacha_weight_rare || '12') || 12,
        legendary: parseFloat(cfg.gacha_weight_legendary || '2.5') || 2.5,
        mythic: parseFloat(cfg.gacha_weight_mythic || '0.5') || 0.5
      },
      showOnHome: cfg.gacha_show_on_home !== 'false'
    });
  } catch (e) {
    console.error('GET /api/gacha/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

async function _doGachaPull(deviceId, multiplier, isFree) {
  // Internal: runs a pull (or N pulls) atomically. Returns { ok, results, newBalance, pullsLeft }.
  const cfg = await _loadGachaConfig();
  if (cfg.gacha_enabled === 'false') return { ok: false, reason: 'disabled' };
  const priceSingle = parseInt(cfg.gacha_price_single || '100', 10) || 100;
  const priceTen = parseInt(cfg.gacha_price_ten || '900', 10) || 900;
  const totalPrice = isFree ? 0 : (multiplier === 10 ? priceTen : priceSingle * multiplier);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Ensure state row.
    await client.query(
      `INSERT INTO player_gacha_state (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );
    // Free-pull dedup.
    if (isFree) {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      const checkR = await client.query(
        `SELECT free_pull_claimed_date FROM player_gacha_state WHERE device_id = $1`,
        [deviceId]
      );
      const lastDate = checkR.rows[0] && checkR.rows[0].free_pull_claimed_date
        ? checkR.rows[0].free_pull_claimed_date.toISOString().slice(0, 10)
        : null;
      if (lastDate === today) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'free_already_claimed' };
      }
    } else if (totalPrice > 0) {
      // Atomic balance debit.
      const debit = await client.query(
        `UPDATE player_profiles SET balance = balance - $1, updated_at = NOW()
          WHERE device_id = $2 AND balance >= $1 RETURNING balance`,
        [totalPrice, deviceId]
      );
      if (!debit.rows[0]) {
        await client.query('ROLLBACK');
        const balR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
        const bal = balR.rows[0] ? Number(balR.rows[0].balance) : 0;
        return { ok: false, reason: 'insufficient_funds', price: totalPrice, balance: bal };
      }
    }
    // Read current pity counter.
    const stateR = await client.query(
      `SELECT pity_counter, total_pulls FROM player_gacha_state WHERE device_id = $1`,
      [deviceId]
    );
    let pity = stateR.rows[0] ? (stateR.rows[0].pity_counter | 0) : 0;
    let totalPulls = stateR.rows[0] ? (stateR.rows[0].total_pulls | 0) : 0;
    const results = [];
    for (let i = 0; i < multiplier; i++) {
      const roll = await _gachaResolveOnePull(cfg, pity, isFree);
      const wasLegendaryOrMythic = roll.rarity === 'legendary' || roll.rarity === 'mythic';
      pity = wasLegendaryOrMythic ? 0 : pity + 1;
      totalPulls += 1;
      const grantInfo = await _gachaGrantReward(client, deviceId, roll.reward);
      // Insert pull history.
      await client.query(
        `INSERT INTO gacha_pulls_history (device_id, pull_index, rarity, reward_type, amount, skin_id, display_name, emoji, was_pity, was_featured, was_free)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [deviceId, totalPulls, roll.rarity, roll.reward.type, roll.reward.amount, roll.reward.skinId,
         roll.reward.displayName, roll.reward.emoji, roll.wasPity, roll.wasFeatured, !!isFree]
      );
      results.push({
        rarity: roll.rarity,
        reward: roll.reward,
        wasPity: roll.wasPity,
        wasFeatured: roll.wasFeatured,
        ...grantInfo
      });
    }
    // Save updated state.
    if (isFree) {
      await client.query(
        `UPDATE player_gacha_state
            SET total_pulls = $1, pity_counter = $2, free_pull_claimed_date = (NOW() AT TIME ZONE 'Asia/Jerusalem')::date, last_pull_at = NOW(), updated_at = NOW()
          WHERE device_id = $3`,
        [totalPulls, pity, deviceId]
      );
    } else {
      await client.query(
        `UPDATE player_gacha_state
            SET total_pulls = $1, pity_counter = $2, last_pull_at = NOW(), updated_at = NOW()
          WHERE device_id = $3`,
        [totalPulls, pity, deviceId]
      );
    }
    await client.query('COMMIT');
    const balR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
    const newBalance = balR.rows[0] ? Number(balR.rows[0].balance) : null;
    return {
      ok: true,
      results,
      newBalance,
      pityCounter: pity,
      pityRemaining: Math.max(0, (parseInt(cfg.gacha_pity_threshold || '50', 10) || 50) - pity),
      totalPulls
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

app.post('/api/gacha/pull', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, count, free } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const n = count === 10 ? 10 : 1;
    const isFree = !!free && n === 1;  // free pull only valid for single
    if (!checkRateLimit('gacha_pull', deviceId, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const result = await _doGachaPull(deviceId, n, isFree);
    res.json(result);
  } catch (e) {
    console.error('POST /api/gacha/pull', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.get('/api/gacha/history', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, history: [] });
    const r = await pool.query(
      `SELECT pull_index, rarity, reward_type, amount, skin_id, display_name, emoji, was_pity, was_featured, was_free, pulled_at
         FROM gacha_pulls_history WHERE device_id = $1 ORDER BY pulled_at DESC LIMIT 50`,
      [deviceId]
    );
    res.json({ ok: true, history: r.rows });
  } catch (e) {
    console.error('GET /api/gacha/history', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 19 — Lives / Energy System
// DEFAULT OFF. When enabled: dynamic-board games cost 1 life each.
// Daily/practice/contests/duels/challenges are NOT gated.
// Lives regen automatically over time, or via gems / ad watch.
// ============================================================
async function _loadLivesConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'lives_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

async function _computeLivesNow(deviceId, cfg) {
  // Reads state, applies time-based regen, returns the live values.
  // Caller may write back via _saveLives if it consumed any.
  await pool.query(
    `INSERT INTO player_lives_state (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [deviceId]
  );
  const r = await pool.query(
    `SELECT current_lives, max_lives, last_regen_at, total_lives_spent, total_ads_watched, total_gems_spent
       FROM player_lives_state WHERE device_id = $1`,
    [deviceId]
  );
  const row = r.rows[0] || { current_lives: 5, max_lives: 5, last_regen_at: new Date() };
  const maxLives = parseInt(cfg.lives_max || '5', 10) || 5;
  const regenMin = parseInt(cfg.lives_regen_minutes || '30', 10) || 30;
  let curLives = Math.min(maxLives, Number(row.current_lives) || 0);
  let lastRegen = row.last_regen_at ? new Date(row.last_regen_at) : new Date();
  // Compute how many regen ticks elapsed.
  if (curLives < maxLives) {
    const minutesElapsed = (Date.now() - lastRegen.getTime()) / (60 * 1000);
    const regens = Math.floor(minutesElapsed / regenMin);
    if (regens > 0) {
      const added = Math.min(regens, maxLives - curLives);
      curLives = Math.min(maxLives, curLives + added);
      // Advance lastRegen by the consumed ticks.
      lastRegen = new Date(lastRegen.getTime() + regens * regenMin * 60 * 1000);
      // Persist updated state immediately (idempotent).
      await pool.query(
        `UPDATE player_lives_state
            SET current_lives = $1, max_lives = $2, last_regen_at = $3, updated_at = NOW()
          WHERE device_id = $4`,
        [curLives, maxLives, lastRegen, deviceId]
      );
    }
  } else {
    // Already at max — bump lastRegen forward so next consume starts fresh.
    if (lastRegen.getTime() < Date.now() - regenMin * 60 * 1000) {
      lastRegen = new Date();
      await pool.query(
        `UPDATE player_lives_state SET last_regen_at = NOW(), updated_at = NOW() WHERE device_id = $1`,
        [deviceId]
      );
    }
  }
  // Time until next regen (when not full).
  let msUntilNext = 0;
  if (curLives < maxLives) {
    const nextRegenAt = lastRegen.getTime() + regenMin * 60 * 1000;
    msUntilNext = Math.max(0, nextRegenAt - Date.now());
  }
  return {
    currentLives: curLives,
    maxLives,
    regenMinutes: regenMin,
    msUntilNextRegen: msUntilNext,
    totalLivesSpent: row.total_lives_spent || 0,
    totalAdsWatched: row.total_ads_watched || 0,
    totalGemsSpent: row.total_gems_spent || 0
  };
}

app.get('/api/player/lives/state', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    const cfg = await _loadLivesConfig();
    if (cfg.lives_enabled !== 'true') return res.json({ ok: true, enabled: false });
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, enabled: true, currentLives: 0, maxLives: parseInt(cfg.lives_max || '5', 10) });
    const state = await _computeLivesNow(deviceId, cfg);
    res.json({
      ok: true,
      enabled: true,
      ...state,
      refillPriceGems: parseInt(cfg.lives_refill_price_gems || '50', 10) || 50,
      adRefillCount: parseInt(cfg.lives_ad_refill_count || '1', 10) || 1,
      perGame: parseInt(cfg.lives_per_game_dynamic || '1', 10) || 1
    });
  } catch (e) {
    console.error('GET /api/player/lives/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/player/lives/consume', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, count } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('lives_consume', deviceId, 200, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadLivesConfig();
    if (cfg.lives_enabled !== 'true') return res.json({ ok: true, enabled: false, currentLives: 999 });
    const n = Math.max(1, Math.min(10, parseInt(count || '1', 10) || 1));
    // Apply regen first.
    const beforeState = await _computeLivesNow(deviceId, cfg);
    if (beforeState.currentLives < n) {
      return res.json({ ok: false, reason: 'insufficient_lives', currentLives: beforeState.currentLives, needed: n, msUntilNextRegen: beforeState.msUntilNextRegen });
    }
    // Atomic decrement — guarded by current_lives >= n.
    const r = await pool.query(
      `UPDATE player_lives_state
          SET current_lives = current_lives - $1,
              total_lives_spent = total_lives_spent + $1,
              updated_at = NOW(),
              last_regen_at = CASE WHEN current_lives = max_lives THEN NOW() ELSE last_regen_at END
        WHERE device_id = $2 AND current_lives >= $1
        RETURNING current_lives, last_regen_at, max_lives`,
      [n, deviceId]
    );
    if (!r.rows[0]) {
      return res.json({ ok: false, reason: 'insufficient_lives', currentLives: beforeState.currentLives });
    }
    const regenMin = parseInt(cfg.lives_regen_minutes || '30', 10) || 30;
    const newLast = new Date(r.rows[0].last_regen_at);
    const msUntilNext = r.rows[0].current_lives < r.rows[0].max_lives
      ? Math.max(0, newLast.getTime() + regenMin * 60 * 1000 - Date.now())
      : 0;
    res.json({
      ok: true,
      enabled: true,
      currentLives: r.rows[0].current_lives,
      maxLives: r.rows[0].max_lives,
      msUntilNextRegen: msUntilNext
    });
  } catch (e) {
    console.error('POST /api/player/lives/consume', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/player/lives/refill-gems', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('lives_refill_gems', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadLivesConfig();
    if (cfg.lives_enabled !== 'true') return res.json({ ok: false, reason: 'disabled' });
    const price = parseInt(cfg.lives_refill_price_gems || '50', 10) || 50;
    const maxLives = parseInt(cfg.lives_max || '5', 10) || 5;
    // Already at max?
    const state = await _computeLivesNow(deviceId, cfg);
    if (state.currentLives >= maxLives) return res.json({ ok: false, reason: 'already_full' });
    // Atomic transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const debit = await client.query(
        `UPDATE player_profiles SET balance = balance - $1, updated_at = NOW()
          WHERE device_id = $2 AND balance >= $1 RETURNING balance`,
        [price, deviceId]
      );
      if (!debit.rows[0]) {
        await client.query('ROLLBACK');
        const balR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
        const bal = balR.rows[0] ? Number(balR.rows[0].balance) : 0;
        return res.json({ ok: false, reason: 'insufficient_funds', price, balance: bal });
      }
      await client.query(
        `UPDATE player_lives_state
            SET current_lives = max_lives,
                total_gems_spent = total_gems_spent + $1,
                last_regen_at = NOW(),
                updated_at = NOW()
          WHERE device_id = $2`,
        [price, deviceId]
      );
      await client.query('COMMIT');
      return res.json({
        ok: true,
        currentLives: maxLives,
        maxLives,
        msUntilNextRegen: 0,
        newBalance: Number(debit.rows[0].balance)
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/player/lives/refill-gems', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/player/lives/refill-ad', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, gameId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('lives_refill_ad', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadLivesConfig();
    if (cfg.lives_enabled !== 'true') return res.json({ ok: false, reason: 'disabled' });
    const adCount = parseInt(cfg.lives_ad_refill_count || '1', 10) || 1;
    const maxLives = parseInt(cfg.lives_max || '5', 10) || 5;
    // Per-game dedup so the same ad can't be claimed multiple times.
    const dedupKey = '_lives_ad:' + deviceId + ':' + (gameId || Date.now()).toString().slice(0, 32);
    const dedupCheck = await pool.query(
      `SELECT 1 FROM game_config WHERE key = $1`, [dedupKey]
    );
    if (dedupCheck.rows.length) return res.json({ ok: false, reason: 'already_claimed' });
    await pool.query(
      `INSERT INTO game_config (key, value) VALUES ($1, NOW()::text) ON CONFLICT DO NOTHING`,
      [dedupKey]
    );
    const r = await pool.query(
      `UPDATE player_lives_state
          SET current_lives = LEAST(max_lives, current_lives + $1),
              total_ads_watched = total_ads_watched + 1,
              updated_at = NOW()
        WHERE device_id = $2
        RETURNING current_lives, max_lives, last_regen_at`,
      [adCount, deviceId]
    );
    if (!r.rows[0]) return res.json({ ok: false, reason: 'no_state' });
    const regenMin = parseInt(cfg.lives_regen_minutes || '30', 10) || 30;
    const newLast = new Date(r.rows[0].last_regen_at);
    const msUntilNext = r.rows[0].current_lives < r.rows[0].max_lives
      ? Math.max(0, newLast.getTime() + regenMin * 60 * 1000 - Date.now())
      : 0;
    res.json({
      ok: true,
      currentLives: r.rows[0].current_lives,
      maxLives: r.rows[0].max_lives,
      msUntilNextRegen: msUntilNext,
      refilled: adCount
    });
  } catch (e) {
    console.error('POST /api/player/lives/refill-ad', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 26 — Live Ops Calendar + Daily Checklist
// Aggregator endpoint returns N days of events from MULTIPLE sources:
// - calendar_events (admin custom events)
// - tournaments (existing)
// - Daily Special (computed per day deterministically)
// - season_pass end date
// Plus a "today's checklist" view: 5 to-do items the player should
// complete each day (the completionist hook).
// ============================================================
async function _loadCalendarConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key IN ('calendar_enabled','checklist_enabled','calendar_show_days','season_pass_ends_at','daily_special_enabled')`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

app.get('/api/calendar/upcoming', async (req, res) => {
  try {
    const cfg = await _loadCalendarConfig();
    if (cfg.calendar_enabled === 'false') return res.json({ ok: true, enabled: false });
    const days = Math.max(1, Math.min(60, parseInt(req.query.days || cfg.calendar_show_days || '30', 10) || 30));
    const events = [];
    // 1. Custom admin events.
    try {
      const r = await pool.query(
        `SELECT id, event_date, title, description, emoji, category, starts_at, ends_at, sort_order
           FROM calendar_events
          WHERE is_enabled = TRUE
            AND event_date >= (NOW() AT TIME ZONE 'Asia/Jerusalem')::date
            AND event_date <= (NOW() AT TIME ZONE 'Asia/Jerusalem')::date + ($1 || ' days')::interval
          ORDER BY event_date, sort_order, id`,
        [String(days)]
      );
      r.rows.forEach(row => {
        events.push({
          source: 'custom',
          date: row.event_date.toISOString().slice(0, 10),
          title: row.title,
          description: row.description,
          emoji: row.emoji || '📅',
          category: row.category || 'general',
          startsAt: row.starts_at,
          endsAt: row.ends_at
        });
      });
    } catch (e) {}
    // 2. Tournaments — both live and upcoming within window.
    try {
      const r = await pool.query(
        `SELECT id, name, description, starts_at, ends_at, prize_pool, status
           FROM tournaments
          WHERE starts_at <= (NOW() AT TIME ZONE 'Asia/Jerusalem')::date + ($1 || ' days')::interval
            AND (ends_at >= NOW() OR status = 'live')
          ORDER BY starts_at`,
        [String(days)]
      );
      r.rows.forEach(row => {
        events.push({
          source: 'tournament',
          date: new Date(row.starts_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }),
          title: '🏆 ' + (row.name || 'טורניר'),
          description: row.description || '',
          emoji: '🏆',
          category: 'tournament',
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          tournamentId: row.id,
          status: row.status
        });
      });
    } catch (e) {}
    // 3. Daily Special — compute for each upcoming day.
    if (cfg.daily_special_enabled !== 'false') {
      try {
        const boardsR = await pool.query(
          `SELECT id, name FROM board_configurations
            WHERE is_active = true
              AND 'dynamic' = ANY(applies_to)
              AND (starts_at IS NULL OR starts_at <= NOW() + INTERVAL '${days} days')
              AND (ends_at   IS NULL OR ends_at   >= NOW())
            ORDER BY priority DESC, id DESC
            LIMIT 25`
        );
        const boards = boardsR.rows;
        if (boards.length > 0) {
          // Compute daily special for each day in window using the same hash logic.
          for (let i = 0; i < days; i++) {
            const d = new Date();
            d.setDate(d.getDate() + i);
            const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
            // _dailySpecialHash defined elsewhere in this file.
            let h = 2166136261;
            for (let j = 0; j < dateStr.length; j++) {
              h ^= dateStr.charCodeAt(j);
              h = Math.imul(h, 16777619);
            }
            const idx = (h >>> 0) % boards.length;
            events.push({
              source: 'daily_special',
              date: dateStr,
              title: '🌟 הלוח של היום: ' + boards[idx].name,
              description: '×3 XP + ×2 פרסים',
              emoji: '🌟',
              category: 'daily_special',
              boardId: boards[idx].id
            });
          }
        }
      } catch (e) {}
    }
    // 4. Season pass end.
    if (cfg.season_pass_ends_at) {
      try {
        const endsAt = new Date(cfg.season_pass_ends_at);
        if (!isNaN(endsAt.getTime()) && endsAt > new Date()) {
          const daysUntil = Math.ceil((endsAt - new Date()) / (24 * 60 * 60 * 1000));
          if (daysUntil <= days) {
            events.push({
              source: 'season_end',
              date: endsAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }),
              title: '🎖 סוף עונת Battle Pass',
              description: 'אסוף את כל הפרסים שמגיעים לך לפני שייעלמו',
              emoji: '🎖',
              category: 'season_end'
            });
          }
        }
      } catch (e) {}
    }
    // Sort by date, then by source priority.
    const sourcePriority = { tournament: 1, season_end: 2, custom: 3, daily_special: 4 };
    events.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (sourcePriority[a.source] || 99) - (sourcePriority[b.source] || 99);
    });
    // Group by date for the client's calendar view.
    const byDate = {};
    events.forEach(e => {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    });
    res.json({
      ok: true,
      enabled: true,
      days,
      eventsByDate: byDate,
      eventsCount: events.length
    });
  } catch (e) {
    console.error('GET /api/calendar/upcoming', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Daily checklist — what the player should do today.
// 5 to-do items: free gacha pull, daily special, daily deal, quest, streak.
app.get('/api/checklist/today', async (req, res) => {
  try {
    const cfg = await _loadCalendarConfig();
    if (cfg.checklist_enabled === 'false') return res.json({ ok: true, enabled: false });
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, enabled: true, items: [] });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const items = [];
    // 1. Free gacha pull (if gacha enabled + not claimed today)
    try {
      const gachaCfg = await pool.query(`SELECT value FROM game_config WHERE key IN ('gacha_enabled','gacha_free_pull_enabled')`);
      const m = {};
      gachaCfg.rows.forEach(r => { m[r.key === 'gacha_enabled' ? 'enabled' : 'free'] = r.value; });
      if (m.enabled === 'true' && m.free !== 'false') {
        const stateR = await pool.query(
          `SELECT free_pull_claimed_date FROM player_gacha_state WHERE device_id = $1`,
          [deviceId]
        );
        const claimedToday = stateR.rows[0] && stateR.rows[0].free_pull_claimed_date &&
          stateR.rows[0].free_pull_claimed_date.toISOString().slice(0, 10) === today;
        items.push({
          key: 'gacha_free',
          title: '🎰 פול חינם בגאצ׳ה',
          done: !!claimedToday,
          action: 'open_gacha'
        });
      }
    } catch (e) {}
    // 2. Daily Special (if enabled + not played today)
    try {
      const dsCfg = await pool.query(`SELECT value FROM game_config WHERE key = 'daily_special_enabled'`);
      if (!dsCfg.rows[0] || dsCfg.rows[0].value !== 'false') {
        // We can't easily check "did the player play today's special" without
        // a hook into dynamic_board_scores filtered to today. For v1 we
        // mark it as undone — the home banner will show it cleared via
        // the existing markDailySpecialPlayed localStorage flag.
        items.push({
          key: 'daily_special',
          title: '🌟 שחק את הלוח של היום (×3 XP)',
          done: false, // client overrides from localStorage
          action: 'open_dynamic_boards'
        });
      }
    } catch (e) {}
    // 3. Daily Deal (if enabled + not bought today)
    try {
      const ddCfg = await pool.query(`SELECT value FROM game_config WHERE key = 'daily_deals_enabled'`);
      if (ddCfg.rows[0] && ddCfg.rows[0].value === 'true') {
        // Check purchase for today.
        const purR = await pool.query(
          `SELECT 1 FROM daily_deal_purchases WHERE device_id = $1 AND purchase_date = $2::date LIMIT 1`,
          [deviceId, today]
        );
        items.push({
          key: 'daily_deal',
          title: '🔥 בדוק את דיל היום',
          done: purR.rows.length > 0,
          action: 'open_daily_deal'
        });
      }
    } catch (e) {}
    // 4. Daily quest (any quest completed today)
    try {
      // Quest completions are tracked via the _earn dedup keys.
      const q = await pool.query(
        `SELECT 1 FROM game_config WHERE key LIKE $1 LIMIT 1`,
        [`_earn:${deviceId}:dyn_quest:${today}:%`]
      );
      items.push({
        key: 'quest',
        title: '🎯 השלם משימה יומית',
        done: q.rows.length > 0,
        action: 'open_dynamic_boards'
      });
    } catch (e) {}
    // 5. Maintain streak — done if player played any game today.
    try {
      const sR = await pool.query(
        `SELECT 1 FROM daily_scores WHERE device_id = $1 AND date = $2 LIMIT 1`,
        [deviceId, today]
      );
      // Also check difficulty_scores + dynamic_board_scores (broader signal).
      const altR = sR.rows.length === 0
        ? await pool.query(
            `SELECT 1 FROM difficulty_scores WHERE device_id = $1 AND date = $2 LIMIT 1
             UNION ALL
             SELECT 1 FROM dynamic_board_scores WHERE device_id = $1
                AND updated_at >= (NOW() AT TIME ZONE 'Asia/Jerusalem')::date LIMIT 1`,
            [deviceId, today]
          ).catch(() => ({ rows: [] }))
        : { rows: [{ ok: 1 }] };
      items.push({
        key: 'streak',
        title: '🔥 שמור על הרצף — שחק לפחות משחק אחד היום',
        done: sR.rows.length > 0 || altR.rows.length > 0,
        action: 'start_game'
      });
    } catch (e) {}
    const doneCount = items.filter(i => i.done).length;
    res.json({
      ok: true,
      enabled: true,
      date: today,
      items,
      doneCount,
      totalCount: items.length,
      allDone: items.length > 0 && doneCount === items.length
    });
  } catch (e) {
    console.error('GET /api/checklist/today', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 28 — Pet / Mascot (Tamagotchi)
// A flower-pet that grows with the player. 4 evolution stages by level,
// 4 moods by time-since-last-visit. Daily pet (free, +gems) + feed
// (gems, +xp). XP also granted server-side on game finish.
// ============================================================
async function _loadPetConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'pet_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

function _petComputeMood(lastVisitedAt) {
  // 4 mood states based on hours since last visit.
  if (!lastVisitedAt) return 'happy';
  const hoursAgo = (Date.now() - new Date(lastVisitedAt).getTime()) / (60 * 60 * 1000);
  if (hoursAgo < 24)  return 'happy';   // 😊
  if (hoursAgo < 48)  return 'neutral'; // 😐
  if (hoursAgo < 72)  return 'sad';     // 😢
  return 'crying';                       // 😭
}

function _petComputeStage(level) {
  // 4 evolution stages.
  if (level >= 16) return { id: 'king',    emoji: '🌺', label: 'מלך פריחה' };
  if (level >= 11) return { id: 'bloom',   emoji: '🌸', label: 'פריחה מלאה' };
  if (level >= 6)  return { id: 'sapling', emoji: '🌿', label: 'שתיל' };
  return { id: 'sprout', emoji: '🌱', label: 'נבט' };
}

function _petLevelFromXp(xp, xpPerLevel, maxLevel) {
  const lvl = Math.min(maxLevel, Math.max(1, Math.floor(xp / xpPerLevel) + 1));
  return lvl;
}

app.get('/api/pet/state', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    const cfg = await _loadPetConfig();
    if (cfg.pet_enabled === 'false') return res.json({ ok: true, enabled: false });
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, enabled: true, needsDevice: true });
    // Lazy-create the pet row on first call.
    await pool.query(
      `INSERT INTO player_pet (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );
    const r = await pool.query(
      `SELECT pet_name, level, xp, last_visited_at, last_fed_at, last_petted_at, last_petted_date,
              feeds_today, feeds_today_date, total_fed_count, total_pet_count
         FROM player_pet WHERE device_id = $1`,
      [deviceId]
    );
    const row = r.rows[0] || {};
    const xpPerLevel = parseInt(cfg.pet_xp_per_level || '100', 10) || 100;
    const maxLevel = parseInt(cfg.pet_max_level || '20', 10) || 20;
    const feedsPerDay = parseInt(cfg.pet_feeds_per_day_max || '3', 10) || 3;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const feedsToday = (row.feeds_today_date && row.feeds_today_date.toISOString().slice(0, 10) === today)
      ? (row.feeds_today | 0) : 0;
    const pettedToday = row.last_petted_date && row.last_petted_date.toISOString().slice(0, 10) === today;
    const xp = row.xp | 0;
    const level = _petLevelFromXp(xp, xpPerLevel, maxLevel);
    const stage = _petComputeStage(level);
    const mood = _petComputeMood(row.last_visited_at);
    const xpIntoLevel = xp - (level - 1) * xpPerLevel;
    const xpToNext = level < maxLevel ? xpPerLevel - xpIntoLevel : 0;
    res.json({
      ok: true,
      enabled: true,
      name: row.pet_name || null,
      needsName: !row.pet_name,
      level,
      xp,
      xpPerLevel,
      xpIntoLevel,
      xpToNext,
      maxLevel,
      stage,
      mood,
      lastVisitedAt: row.last_visited_at,
      pettedToday,
      feedsToday,
      feedsPerDay,
      canPet: !pettedToday,
      canFeed: feedsToday < feedsPerDay,
      feedPrice: parseInt(cfg.pet_feed_price_gems || '10', 10) || 10,
      feedXpReward: parseInt(cfg.pet_feed_xp_reward || '50', 10) || 50,
      dailyPetReward: parseInt(cfg.pet_daily_pet_reward_gems || '20', 10) || 20,
      totalFedCount: row.total_fed_count | 0,
      totalPetCount: row.total_pet_count | 0
    });
  } catch (e) {
    console.error('GET /api/pet/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/pet/name', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, name } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const cleanName = String(name || '').trim().slice(0, 40);
    if (cleanName.length < 1) return res.json({ ok: false, reason: 'name_too_short' });
    if (!checkRateLimit('pet_name', deviceId, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    await pool.query(
      `INSERT INTO player_pet (device_id, pet_name) VALUES ($1, $2)
       ON CONFLICT (device_id) DO UPDATE SET pet_name = $2, updated_at = NOW()`,
      [deviceId, cleanName]
    );
    res.json({ ok: true, name: cleanName });
  } catch (e) {
    console.error('POST /api/pet/name', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/pet/pet', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('pet_pet', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadPetConfig();
    if (cfg.pet_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const reward = parseInt(cfg.pet_daily_pet_reward_gems || '20', 10) || 20;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    // Lazy-create row.
    await pool.query(
      `INSERT INTO player_pet (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );
    // Check + update + grant in one transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const checkR = await client.query(
        `SELECT last_petted_date FROM player_pet WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      const lastDate = checkR.rows[0] && checkR.rows[0].last_petted_date
        ? checkR.rows[0].last_petted_date.toISOString().slice(0, 10) : null;
      if (lastDate === today) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'already_petted_today' });
      }
      await client.query(
        `UPDATE player_pet
            SET last_petted_at = NOW(),
                last_petted_date = $1::date,
                last_visited_at = NOW(),
                total_pet_count = total_pet_count + 1,
                updated_at = NOW()
          WHERE device_id = $2`,
        [today, deviceId]
      );
      // Make sure profile exists.
      await client.query(
        `INSERT INTO player_profiles (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [deviceId]
      );
      const credit = await client.query(
        `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2 RETURNING balance`,
        [reward, deviceId]
      );
      await client.query('COMMIT');
      const newBalance = credit.rows[0] ? Number(credit.rows[0].balance) : null;
      res.json({ ok: true, reward, newBalance });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/pet/pet', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/pet/feed', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('pet_feed', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadPetConfig();
    if (cfg.pet_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const price = parseInt(cfg.pet_feed_price_gems || '10', 10) || 10;
    const xpReward = parseInt(cfg.pet_feed_xp_reward || '50', 10) || 50;
    const feedsPerDay = parseInt(cfg.pet_feeds_per_day_max || '3', 10) || 3;
    const xpPerLevel = parseInt(cfg.pet_xp_per_level || '100', 10) || 100;
    const maxLevel = parseInt(cfg.pet_max_level || '20', 10) || 20;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    await pool.query(
      `INSERT INTO player_pet (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Check today's feed count.
      const checkR = await client.query(
        `SELECT feeds_today, feeds_today_date, xp FROM player_pet WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      const row = checkR.rows[0] || {};
      const lastDate = row.feeds_today_date ? row.feeds_today_date.toISOString().slice(0, 10) : null;
      const feedsToday = (lastDate === today) ? (row.feeds_today | 0) : 0;
      if (feedsToday >= feedsPerDay) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'daily_limit_reached', feedsToday, feedsPerDay });
      }
      // Atomic balance deduct.
      const debit = await client.query(
        `UPDATE player_profiles SET balance = balance - $1, updated_at = NOW()
          WHERE device_id = $2 AND balance >= $1 RETURNING balance`,
        [price, deviceId]
      );
      if (!debit.rows[0]) {
        await client.query('ROLLBACK');
        const balR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
        const bal = balR.rows[0] ? Number(balR.rows[0].balance) : 0;
        return res.json({ ok: false, reason: 'insufficient_funds', price, balance: bal });
      }
      const newXp = (row.xp | 0) + xpReward;
      const newLevel = _petLevelFromXp(newXp, xpPerLevel, maxLevel);
      const newStage = _petComputeStage(newLevel);
      const oldLevel = _petLevelFromXp(row.xp | 0, xpPerLevel, maxLevel);
      const leveledUp = newLevel > oldLevel;
      await client.query(
        `UPDATE player_pet
            SET xp = $1,
                level = $2,
                feeds_today = $3,
                feeds_today_date = $4::date,
                last_fed_at = NOW(),
                last_visited_at = NOW(),
                total_fed_count = total_fed_count + 1,
                updated_at = NOW()
          WHERE device_id = $5`,
        [newXp, newLevel, feedsToday + 1, today, deviceId]
      );
      await client.query('COMMIT');
      res.json({
        ok: true,
        newXp,
        newLevel,
        leveledUp,
        stage: newStage,
        newBalance: Number(debit.rows[0].balance),
        feedsToday: feedsToday + 1,
        feedsPerDay
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/pet/feed', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/pet/grant-xp', requireDeviceAuth, async (req, res) => {
  // Granted from the client after each finished game. Rate-limited generously.
  try {
    const { deviceId, gameId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('pet_grant_xp', deviceId, 200, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadPetConfig();
    if (cfg.pet_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const xpPerGame = parseInt(cfg.pet_xp_per_game || '15', 10) || 15;
    const xpPerLevel = parseInt(cfg.pet_xp_per_level || '100', 10) || 100;
    const maxLevel = parseInt(cfg.pet_max_level || '20', 10) || 20;
    // Per-gameId dedup so the same game doesn't grant twice.
    if (gameId) {
      const dedupKey = '_pet_xp:' + deviceId + ':' + String(gameId).slice(0, 32);
      const dup = await pool.query(`SELECT 1 FROM game_config WHERE key = $1`, [dedupKey]);
      if (dup.rows.length) return res.json({ ok: false, reason: 'already_granted' });
      await pool.query(
        `INSERT INTO game_config (key, value) VALUES ($1, NOW()::text) ON CONFLICT DO NOTHING`,
        [dedupKey]
      );
    }
    await pool.query(
      `INSERT INTO player_pet (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );
    const cur = await pool.query(`SELECT xp FROM player_pet WHERE device_id = $1`, [deviceId]);
    const curXp = cur.rows[0] ? (cur.rows[0].xp | 0) : 0;
    const newXp = curXp + xpPerGame;
    const oldLevel = _petLevelFromXp(curXp, xpPerLevel, maxLevel);
    const newLevel = _petLevelFromXp(newXp, xpPerLevel, maxLevel);
    const leveledUp = newLevel > oldLevel;
    await pool.query(
      `UPDATE player_pet SET xp = $1, level = $2, updated_at = NOW() WHERE device_id = $3`,
      [newXp, newLevel, deviceId]
    );
    res.json({ ok: true, newXp, newLevel, leveledUp, xpGained: xpPerGame });
  } catch (e) {
    console.error('POST /api/pet/grant-xp', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 25 — Limited-time Bundles (themed event packs)
// Multi-day premium bundles with countdown + theme color. Stronger
// FOMO than Daily Deals because window is longer (3-30 days) and
// design is theme-specific (Hanukkah / Valentine / Black Friday).
// ============================================================
async function _loadBundlesConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'bundles_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

app.get('/api/bundles/active', async (req, res) => {
  try {
    const cfg = await _loadBundlesConfig();
    if (cfg.bundles_enabled === 'false') return res.json({ ok: true, enabled: false });
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    const r = await pool.query(
      `SELECT id, slug, name, description, emoji, theme_color, decoration_emoji,
              price_gems, original_value, contents, starts_at, ends_at,
              max_purchases_per_device, sort_order
         FROM limited_bundles
        WHERE is_enabled = TRUE
          AND starts_at <= NOW()
          AND ends_at >= NOW()
        ORDER BY sort_order, id`
    );
    // Decorate with purchase count per device.
    let purchases = {};
    if (deviceId && deviceId.length >= 8 && r.rows.length > 0) {
      const ids = r.rows.map(x => x.id);
      try {
        const purR = await pool.query(
          `SELECT bundle_id, COUNT(*) AS cnt FROM limited_bundle_purchases
            WHERE device_id = $1 AND bundle_id = ANY($2::int[])
            GROUP BY bundle_id`,
          [deviceId, ids]
        );
        purR.rows.forEach(row => { purchases[row.bundle_id] = parseInt(row.cnt, 10) || 0; });
      } catch (e) {}
    }
    const bundles = r.rows.map(row => {
      const purchased = purchases[row.id] || 0;
      const remaining = Math.max(0, (row.max_purchases_per_device || 1) - purchased);
      const discountPct = row.original_value && row.original_value > row.price_gems
        ? Math.round(((row.original_value - row.price_gems) / row.original_value) * 100)
        : null;
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        emoji: row.emoji,
        themeColor: row.theme_color,
        decorationEmoji: row.decoration_emoji,
        priceGems: row.price_gems,
        originalValue: row.original_value,
        discountPct,
        contents: row.contents,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        maxPurchases: row.max_purchases_per_device || 1,
        purchasesByMe: purchased,
        remainingForMe: remaining,
        canBuy: remaining > 0
      };
    });
    res.json({ ok: true, enabled: true, bundles });
  } catch (e) {
    console.error('GET /api/bundles/active', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/bundles/buy', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, bundleId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const bundleIdN = parseInt(bundleId, 10);
    if (!Number.isFinite(bundleIdN) || bundleIdN <= 0) return res.status(400).json({ error: 'bad_bundle' });
    if (!checkRateLimit('bundle_buy', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadBundlesConfig();
    if (cfg.bundles_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    // Look up bundle + verify active window.
    const bR = await pool.query(
      `SELECT id, slug, name, price_gems, contents, starts_at, ends_at,
              max_purchases_per_device, is_enabled
         FROM limited_bundles WHERE id = $1`,
      [bundleIdN]
    );
    const bundle = bR.rows[0];
    if (!bundle || !bundle.is_enabled) return res.json({ ok: false, reason: 'not_found' });
    const now = new Date();
    if (new Date(bundle.starts_at) > now) return res.json({ ok: false, reason: 'not_started' });
    if (new Date(bundle.ends_at) < now) return res.json({ ok: false, reason: 'expired' });
    // Check existing purchase count.
    const purR = await pool.query(
      `SELECT COUNT(*) AS cnt FROM limited_bundle_purchases WHERE device_id = $1 AND bundle_id = $2`,
      [deviceId, bundleIdN]
    );
    const existing = parseInt(purR.rows[0].cnt, 10) || 0;
    if (existing >= (bundle.max_purchases_per_device || 1)) {
      return res.json({ ok: false, reason: 'limit_reached' });
    }
    const contents = bundle.contents || {};
    const grantGems = parseInt(contents.gems || 0, 10) || 0;
    const grantBpTiers = parseInt(contents.bp_tiers || 0, 10) || 0;
    const grantChests = parseInt(contents.chest_count || 0, 10) || 0;
    const grantFreezes = parseInt(contents.streak_freezes || 0, 10) || 0;
    const grantSkin = contents.skin_id && typeof contents.skin_id === 'string' && contents.skin_id.length < 40
      ? contents.skin_id : null;
    // Atomic transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const debit = await client.query(
        `UPDATE player_profiles
            SET balance = balance - $1, updated_at = NOW()
          WHERE device_id = $2 AND balance >= $1 RETURNING balance`,
        [bundle.price_gems, deviceId]
      );
      if (!debit.rows[0]) {
        await client.query('ROLLBACK');
        const balR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
        const bal = balR.rows[0] ? Number(balR.rows[0].balance) : 0;
        return res.json({ ok: false, reason: 'insufficient_funds', price: bundle.price_gems, balance: bal });
      }
      if (grantGems > 0) {
        await client.query(
          `UPDATE player_profiles
              SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
            WHERE device_id = $2`,
          [grantGems, deviceId]
        );
      }
      if (grantSkin && grantSkin !== 'classic') {
        await client.query(
          `INSERT INTO player_skins (device_id, skin_id) VALUES ($1, $2)
           ON CONFLICT (device_id, skin_id) DO NOTHING`,
          [deviceId, grantSkin]
        );
      }
      if (grantBpTiers > 0) {
        // Reuse the BP XP boost pattern used by gacha + starter pack.
        const cfgR = await client.query(
          `SELECT key, value FROM game_config WHERE key LIKE 'season_tier_%_xp'`
        );
        const tierXp = {};
        cfgR.rows.forEach(r => {
          const m = r.key.match(/^season_tier_(\d+)_xp$/);
          if (m) tierXp[parseInt(m[1], 10)] = parseInt(r.value, 10);
        });
        const seasonId = 'S1';
        const curR = await client.query(
          `SELECT xp FROM player_season_progress WHERE device_id = $1 AND season_id = $2`,
          [deviceId, seasonId]
        );
        const curXp = curR.rows[0] ? (Number(curR.rows[0].xp) || 0) : 0;
        let curTier = 0;
        for (let t2 = 1; t2 <= 20; t2++) {
          if (tierXp[t2] && curXp >= tierXp[t2]) curTier = t2;
        }
        const targetTier = Math.min(20, curTier + grantBpTiers);
        const xpBoost = Math.max(0, (tierXp[targetTier] || curXp) - curXp);
        if (xpBoost > 0) {
          await client.query(
            `INSERT INTO player_season_progress (device_id, season_id, xp)
                VALUES ($1, $2, $3)
             ON CONFLICT (device_id, season_id) DO UPDATE SET xp = player_season_progress.xp + $3, updated_at = NOW()`,
            [deviceId, seasonId, xpBoost]
          );
        }
      }
      await client.query(
        `INSERT INTO limited_bundle_purchases (device_id, bundle_id, price_paid, contents_snapshot)
             VALUES ($1, $2, $3, $4::jsonb)`,
        [deviceId, bundleIdN, bundle.price_gems, JSON.stringify(contents)]
      );
      await client.query('COMMIT');
      const finalR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
      const newBalance = finalR.rows[0] ? Number(finalR.rows[0].balance) : null;
      return res.json({
        ok: true,
        bundleId: bundleIdN,
        price: bundle.price_gems,
        contents,
        granted: {
          gems: grantGems, bpTiers: grantBpTiers, skinId: grantSkin,
          chests: grantChests, freezes: grantFreezes
        },
        newBalance
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/bundles/buy', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 16 — Achievement-driven Cross-Leaderboard
// Global ranking by # achievements unlocked, not by score.
// Rewards completionists / breadth-players.
// ============================================================
async function _loadAchLbConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'ach_leaderboard_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

// Unlock one achievement (idempotent — UNIQUE index handles dupes).
app.post('/api/achievements/unlock', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, key } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const cleanKey = String(key || '').slice(0, 120);
    if (!cleanKey || !/^[a-z0-9_:-]+$/i.test(cleanKey)) {
      return res.status(400).json({ error: 'bad_key' });
    }
    if (!checkRateLimit('ach_unlock', deviceId, 200, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    // INSERT ... ON CONFLICT DO NOTHING — idempotent.
    const r = await pool.query(
      `INSERT INTO player_achievements (device_id, achievement_key)
           VALUES ($1, $2)
       ON CONFLICT (device_id, achievement_key) DO NOTHING
       RETURNING id`,
      [deviceId, cleanKey]
    );
    res.json({ ok: true, key: cleanKey, isNew: r.rows.length > 0 });
  } catch (e) {
    console.error('POST /api/achievements/unlock', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Bulk sync — client sends ALL its localStorage achievements on boot.
// Server upserts all (UNIQUE index dedups). Used to backfill old players
// who unlocked achievements before this stage shipped.
app.post('/api/achievements/sync', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, keys } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.json({ ok: true, synced: 0 });
    }
    if (!checkRateLimit('ach_sync', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    // Filter + clamp.
    const clean = keys
      .map(k => String(k || '').slice(0, 120))
      .filter(k => k && /^[a-z0-9_:-]+$/i.test(k))
      .slice(0, 500);  // cap to 500 keys per sync
    if (!clean.length) return res.json({ ok: true, synced: 0 });
    // Bulk insert with ON CONFLICT.
    const values = clean.map((_, i) => `($1, $${i + 2})`).join(', ');
    const params = [deviceId, ...clean];
    await pool.query(
      `INSERT INTO player_achievements (device_id, achievement_key)
           VALUES ${values}
       ON CONFLICT (device_id, achievement_key) DO NOTHING`,
      params
    );
    res.json({ ok: true, synced: clean.length });
  } catch (e) {
    console.error('POST /api/achievements/sync', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Leaderboard — top N players by achievement count.
app.get('/api/achievements/leaderboard', async (req, res) => {
  try {
    const cfg = await _loadAchLbConfig();
    if (cfg.ach_leaderboard_enabled === 'false') return res.json({ ok: true, enabled: false });
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit || '50', 10) || 50));
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    // Aggregate count + last-unlocked for sort.
    const r = await pool.query(
      `SELECT pa.device_id,
              COUNT(*) AS ach_count,
              MAX(pa.unlocked_at) AS last_unlocked_at,
              COALESCE(pp.display_name, ds.name, 'אנונימי') AS name,
              pp.country AS country,
              pp.player_code AS player_code
         FROM player_achievements pa
         LEFT JOIN player_profiles pp ON pp.device_id = pa.device_id
         LEFT JOIN LATERAL (
           SELECT name FROM daily_scores
            WHERE device_id = pa.device_id
            ORDER BY date DESC LIMIT 1
         ) ds ON true
         GROUP BY pa.device_id, pp.display_name, ds.name, pp.country, pp.player_code
         ORDER BY ach_count DESC, last_unlocked_at ASC
         LIMIT $1`,
      [limit]
    );
    let myRow = null;
    let myRank = null;
    if (deviceId && deviceId.length >= 8) {
      // My count.
      const meR = await pool.query(
        `SELECT COUNT(*) AS cnt FROM player_achievements WHERE device_id = $1`,
        [deviceId]
      );
      const myCount = parseInt(meR.rows[0].cnt, 10) || 0;
      if (myCount > 0) {
        // My rank = number of players with MORE achievements + 1.
        const rankR = await pool.query(
          `SELECT COUNT(*) + 1 AS rank
             FROM (
               SELECT device_id, COUNT(*) AS c
                 FROM player_achievements
                 GROUP BY device_id
                 HAVING COUNT(*) > $1
             ) sub`,
          [myCount]
        );
        myRank = parseInt(rankR.rows[0].rank, 10) || null;
        const meDetails = await pool.query(
          `SELECT COALESCE(pp.display_name, ds.name, 'אנונימי') AS name,
                  pp.country, pp.player_code,
                  MAX(pa.unlocked_at) AS last_unlocked_at
             FROM player_achievements pa
             LEFT JOIN player_profiles pp ON pp.device_id = pa.device_id
             LEFT JOIN LATERAL (
               SELECT name FROM daily_scores
                WHERE device_id = pa.device_id
                ORDER BY date DESC LIMIT 1
             ) ds ON true
            WHERE pa.device_id = $1
            GROUP BY pp.display_name, ds.name, pp.country, pp.player_code`,
          [deviceId]
        );
        if (meDetails.rows[0]) {
          myRow = {
            ach_count: myCount,
            rank: myRank,
            name: meDetails.rows[0].name,
            country: meDetails.rows[0].country,
            player_code: meDetails.rows[0].player_code,
            last_unlocked_at: meDetails.rows[0].last_unlocked_at,
            is_me: true
          };
        }
      }
    }
    res.json({
      ok: true,
      enabled: true,
      list: r.rows.map((row, idx) => ({
        rank: idx + 1,
        ach_count: parseInt(row.ach_count, 10),
        name: row.name,
        country: row.country,
        player_code: row.player_code,
        last_unlocked_at: row.last_unlocked_at,
        is_me: row.device_id === deviceId
      })),
      myRank,
      me: myRow,
      total: r.rows.length
    });
  } catch (e) {
    console.error('GET /api/achievements/leaderboard', e);
    res.status(500).json({ error: 'internal' });
  }
});

// My count summary (for the home tile).
app.get('/api/achievements/me', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, count: 0 });
    const r = await pool.query(
      `SELECT COUNT(*) AS cnt, MAX(unlocked_at) AS last_unlocked_at
         FROM player_achievements WHERE device_id = $1`,
      [deviceId]
    );
    const count = parseInt(r.rows[0].cnt, 10) || 0;
    let rank = null;
    if (count > 0) {
      const rankR = await pool.query(
        `SELECT COUNT(*) + 1 AS rank
           FROM (
             SELECT device_id, COUNT(*) AS c
               FROM player_achievements
               GROUP BY device_id
               HAVING COUNT(*) > $1
           ) sub`,
        [count]
      );
      rank = parseInt(rankR.rows[0].rank, 10) || null;
    }
    res.json({ ok: true, count, rank, lastUnlockedAt: r.rows[0].last_unlocked_at });
  } catch (e) {
    console.error('GET /api/achievements/me', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 29 — Tile Collection Album (Genshin-style)
// For each (board, tier) cell, track if the player has reached that
// tier on that board. Completion rewards: full board (all 8 tiers) +
// full tier (all boards). Activates completionist drive.
// ============================================================
async function _loadAlbumConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'album_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

// Record collection: player reached tier T on board B. Idempotent (PK).
// Client should call after each game-over with the highest tier reached.
app.post('/api/album/record', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, boardId, maxTier } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const bId = parseInt(boardId, 10);
    const mt = parseInt(maxTier, 10);
    if (!Number.isFinite(bId) || bId <= 0) return res.status(400).json({ error: 'bad_board' });
    if (!Number.isFinite(mt) || mt < 1 || mt > 8) return res.status(400).json({ error: 'bad_tier' });
    if (!checkRateLimit('album_record', deviceId, 200, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadAlbumConfig();
    if (cfg.album_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    // Insert all tiers 1..mt (collecting tier T means you've also collected lower).
    // Multi-row INSERT with ON CONFLICT DO NOTHING for idempotency.
    const values = [];
    const params = [deviceId, bId];
    for (let t = 1; t <= mt; t++) {
      values.push(`($1, $2, $${params.length + 1})`);
      params.push(t);
    }
    const r = await pool.query(
      `INSERT INTO player_tile_collection (device_id, board_id, tier)
           VALUES ${values.join(', ')}
       ON CONFLICT (device_id, board_id, tier) DO NOTHING
       RETURNING tier`,
      params
    );
    res.json({
      ok: true,
      newTiers: r.rows.map(x => x.tier),
      maxRecorded: mt
    });
  } catch (e) {
    console.error('POST /api/album/record', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Get full state: collection per board + claim status + claimable rewards.
app.get('/api/album/state', async (req, res) => {
  try {
    const cfg = await _loadAlbumConfig();
    if (cfg.album_enabled === 'false') return res.json({ ok: true, enabled: false });
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, enabled: true, needsDevice: true });
    // List active boards (cap to 50). board_configurations has no emoji
    // column — we just use name + id. Client can map id to emoji if needed.
    const boardsR = await pool.query(
      `SELECT id, name FROM board_configurations
        WHERE is_active = true AND 'dynamic' = ANY(applies_to)
        ORDER BY id LIMIT 50`
    ).catch(() => ({ rows: [] }));
    // Collected tiles for this device.
    const collR = await pool.query(
      `SELECT board_id, tier, first_collected_at
         FROM player_tile_collection WHERE device_id = $1`,
      [deviceId]
    );
    const collByBoard = {};
    collR.rows.forEach(row => {
      if (!collByBoard[row.board_id]) collByBoard[row.board_id] = {};
      collByBoard[row.board_id][row.tier] = true;
    });
    // Claims.
    const claimsR = await pool.query(
      `SELECT claim_type, target_id FROM player_collection_claims WHERE device_id = $1`,
      [deviceId]
    );
    const claimedBoards = new Set();
    const claimedTiers = new Set();
    claimsR.rows.forEach(row => {
      if (row.claim_type === 'board_complete') claimedBoards.add(row.target_id);
      else if (row.claim_type === 'tier_complete') claimedTiers.add(row.target_id);
    });
    // Build state per board.
    var totalCells = 0;
    var collectedCells = 0;
    var unclaimedBoardCount = 0;
    var unclaimedTierCount = 0;
    const boards = boardsR.rows.map(b => {
      const c = collByBoard[b.id] || {};
      const tiers = [];
      let count = 0;
      for (let t = 1; t <= 8; t++) {
        var has = !!c[t];
        tiers.push({ tier: t, collected: has });
        if (has) count++;
        totalCells++;
        if (has) collectedCells++;
      }
      const isComplete = count === 8;
      const isClaimed = claimedBoards.has(b.id);
      if (isComplete && !isClaimed) unclaimedBoardCount++;
      return {
        id: b.id,
        name: b.name,
        tiers,
        collectedCount: count,
        isComplete,
        canClaim: isComplete && !isClaimed,
        claimed: isClaimed
      };
    });
    // Tier completion: across ALL boards.
    const tiers = [];
    for (let t = 1; t <= 8; t++) {
      const fullCount = boards.filter(b => b.tiers[t - 1].collected).length;
      const isComplete = fullCount === boards.length && boards.length > 0;
      const isClaimed = claimedTiers.has(t);
      if (isComplete && !isClaimed) unclaimedTierCount++;
      tiers.push({
        tier: t,
        collectedOn: fullCount,
        totalBoards: boards.length,
        isComplete,
        canClaim: isComplete && !isClaimed,
        claimed: isClaimed
      });
    }
    res.json({
      ok: true,
      enabled: true,
      boards,
      tiers,
      totalCells,
      collectedCells,
      pct: totalCells > 0 ? Math.round((collectedCells / totalCells) * 100) : 0,
      unclaimedBoardCount,
      unclaimedTierCount,
      unclaimedCount: unclaimedBoardCount + unclaimedTierCount,
      rewardPerBoard: parseInt(cfg.album_reward_per_board_complete || '500', 10) || 500,
      rewardPerTier: parseInt(cfg.album_reward_per_tier_complete || '200', 10) || 200
    });
  } catch (e) {
    console.error('GET /api/album/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Atomic claim a completion reward.
app.post('/api/album/claim', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, claimType, targetId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (claimType !== 'board_complete' && claimType !== 'tier_complete') {
      return res.status(400).json({ error: 'bad_claim_type' });
    }
    const tId = parseInt(targetId, 10);
    if (!Number.isFinite(tId) || tId <= 0) return res.status(400).json({ error: 'bad_target' });
    if (!checkRateLimit('album_claim', deviceId, 50, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadAlbumConfig();
    if (cfg.album_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    // Verify eligibility server-side.
    let eligible = false;
    if (claimType === 'board_complete') {
      const r = await pool.query(
        `SELECT COUNT(*) AS cnt FROM player_tile_collection
          WHERE device_id = $1 AND board_id = $2`,
        [deviceId, tId]
      );
      eligible = (parseInt(r.rows[0].cnt, 10) || 0) >= 8;
    } else if (claimType === 'tier_complete') {
      if (tId < 1 || tId > 8) return res.json({ ok: false, reason: 'bad_tier' });
      const boardsR = await pool.query(
        `SELECT id FROM board_configurations
          WHERE is_active = true AND 'dynamic' = ANY(applies_to)`
      );
      const totalBoards = boardsR.rows.length;
      if (totalBoards === 0) return res.json({ ok: false, reason: 'no_boards' });
      const collR = await pool.query(
        `SELECT COUNT(*) AS cnt FROM player_tile_collection
          WHERE device_id = $1 AND tier = $2 AND board_id = ANY($3::int[])`,
        [deviceId, tId, boardsR.rows.map(b => b.id)]
      );
      eligible = (parseInt(collR.rows[0].cnt, 10) || 0) >= totalBoards;
    }
    if (!eligible) return res.json({ ok: false, reason: 'not_complete' });
    const reward = claimType === 'board_complete'
      ? (parseInt(cfg.album_reward_per_board_complete || '500', 10) || 500)
      : (parseInt(cfg.album_reward_per_tier_complete || '200', 10) || 200);
    // Atomic claim + credit.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertR = await client.query(
        `INSERT INTO player_collection_claims (device_id, claim_type, target_id, reward_gems)
             VALUES ($1, $2, $3, $4)
         ON CONFLICT (device_id, claim_type, target_id) DO NOTHING
         RETURNING id`,
        [deviceId, claimType, tId, reward]
      );
      if (!insertR.rows[0]) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'already_claimed' });
      }
      const credit = await client.query(
        `UPDATE player_profiles
            SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2 RETURNING balance`,
        [reward, deviceId]
      );
      await client.query('COMMIT');
      return res.json({
        ok: true,
        claimType,
        targetId: tId,
        reward,
        newBalance: credit.rows[0] ? Number(credit.rows[0].balance) : null
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/album/claim', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 30 — Lifetime Progression (Call of Duty Prestige)
// XP is COMPUTED from aggregate of existing player activity. No new
// XP grants needed — existing players are rewarded retroactively for
// their accumulated history.
// ============================================================
async function _loadLifetimeConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'lifetime_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

// Compute lifetime XP from aggregate of existing activity.
async function _computeLifetimeXp(deviceId) {
  // Each component is a separate query, all wrapped in catch — we want
  // the calculation to work even if some tables don't exist yet.
  let totalXp = 0;
  // 1. Games played × 10. Use daily_scores + difficulty_scores + dynamic.
  try {
    const r = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM daily_scores WHERE device_id = $1) +
         (SELECT COUNT(*) FROM difficulty_scores WHERE device_id = $1) +
         (SELECT COUNT(*) FROM dynamic_board_scores WHERE device_id = $1)
         AS games`,
      [deviceId]
    );
    const games = parseInt(r.rows[0].games, 10) || 0;
    totalXp += games * 10;
  } catch (e) {}
  // 2. Achievements × 75
  try {
    const r = await pool.query(`SELECT COUNT(*) AS c FROM player_achievements WHERE device_id = $1`, [deviceId]);
    totalXp += (parseInt(r.rows[0].c, 10) || 0) * 75;
  } catch (e) {}
  // 3. Total gems earned / 2 (from player_profiles.total_earned)
  try {
    const r = await pool.query(`SELECT total_earned FROM player_profiles WHERE device_id = $1`, [deviceId]);
    if (r.rows[0]) totalXp += Math.floor((Number(r.rows[0].total_earned) || 0) / 2);
  } catch (e) {}
  // 4. Album cells × 25
  try {
    const r = await pool.query(`SELECT COUNT(*) AS c FROM player_tile_collection WHERE device_id = $1`, [deviceId]);
    totalXp += (parseInt(r.rows[0].c, 10) || 0) * 25;
  } catch (e) {}
  // 5. Gacha pulls × 5
  try {
    const r = await pool.query(`SELECT total_pulls FROM player_gacha_state WHERE device_id = $1`, [deviceId]);
    if (r.rows[0]) totalXp += (Number(r.rows[0].total_pulls) || 0) * 5;
  } catch (e) {}
  // 6. Pet level × 50 (mature pet = invested player)
  try {
    const r = await pool.query(`SELECT level FROM player_pet WHERE device_id = $1`, [deviceId]);
    if (r.rows[0]) totalXp += (Number(r.rows[0].level) || 0) * 50;
  } catch (e) {}
  // 7. Season pass tier × 100
  try {
    const r = await pool.query(`SELECT xp FROM player_season_progress WHERE device_id = $1`, [deviceId]);
    if (r.rows[0]) {
      // Approximate tier from XP using the standard curve. Cap at 20.
      const sxp = parseInt(r.rows[0].xp, 10) || 0;
      // Rough: tier ~= sqrt(sxp / 40)
      const approxTier = Math.min(20, Math.floor(Math.sqrt(sxp / 40)));
      totalXp += approxTier * 100;
    }
  } catch (e) {}
  // 8. Friends count × 200
  try {
    const r = await pool.query(
      `SELECT COUNT(*) AS c FROM friendships
        WHERE (device_a = $1 OR device_b = $1) AND bonus_paid = TRUE`,
      [deviceId]
    );
    totalXp += (parseInt(r.rows[0].c, 10) || 0) * 200;
  } catch (e) {}
  return totalXp;
}

function _lifetimeTitleForLevel(level, prestige) {
  // Series of unlock thresholds. Each milestone awards a Hebrew title.
  if (prestige >= 5) return '🌟 אגדה אינסופית';
  if (prestige >= 3) return '🔥 אלוף נצחי';
  if (prestige >= 1) return '✨ מקצוען';
  if (level >= 75)   return '⚡ מומחה';
  if (level >= 50)   return '🏆 מאסטר';
  if (level >= 25)   return '🎯 ותיק';
  if (level >= 10)   return '🌱 מתחיל-פלוס';
  return '🌱 מתחיל';
}

app.get('/api/lifetime/state', async (req, res) => {
  try {
    const cfg = await _loadLifetimeConfig();
    if (cfg.lifetime_enabled === 'false') return res.json({ ok: true, enabled: false });
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, enabled: true, needsDevice: true });
    // Ensure row exists.
    await pool.query(
      `INSERT INTO player_lifetime_state (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );
    // Get prestige state.
    const stateR = await pool.query(
      `SELECT prestige_count, last_prestige_at, cosmetic_unlocks, current_title
         FROM player_lifetime_state WHERE device_id = $1`,
      [deviceId]
    );
    const state = stateR.rows[0] || {};
    const prestigeCount = Math.max(0, Math.min(10, parseInt(state.prestige_count, 10) || 0));
    // Compute current XP (recomputed every call — cheap aggregate).
    const totalXp = await _computeLifetimeXp(deviceId);
    // XP since last prestige is what counts toward "level".
    // We can't easily track "XP since last prestige" without snapshotting
    // at prestige time. So: lifetimeXp - (prestige_count * 100 * xp_per_level)
    const xpPerLevel = parseInt(cfg.lifetime_xp_per_level || '500', 10) || 500;
    const xpUsedByPrestige = prestigeCount * 100 * xpPerLevel;
    const xpThisRun = Math.max(0, totalXp - xpUsedByPrestige);
    const level = Math.min(100, Math.max(1, Math.floor(xpThisRun / xpPerLevel) + 1));
    const xpIntoLevel = xpThisRun - (level - 1) * xpPerLevel;
    const xpToNext = level < 100 ? xpPerLevel - xpIntoLevel : 0;
    const canPrestige = level >= 100 && prestigeCount < 10;
    const title = _lifetimeTitleForLevel(level, prestigeCount);
    res.json({
      ok: true,
      enabled: true,
      totalXp,
      level,
      xpThisRun,
      xpIntoLevel,
      xpToNext,
      xpPerLevel,
      maxLevel: 100,
      prestigeCount,
      maxPrestige: 10,
      canPrestige,
      title,
      prestigeReward: parseInt(cfg.lifetime_prestige_reward || '5000', 10) || 5000,
      pct: level < 100 ? Math.round((xpIntoLevel / xpPerLevel) * 100) : 100
    });
  } catch (e) {
    console.error('GET /api/lifetime/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Atomic prestige claim — only valid when level >= 100.
app.post('/api/lifetime/prestige', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('lifetime_prestige', deviceId, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadLifetimeConfig();
    if (cfg.lifetime_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    // Verify eligibility server-side.
    await pool.query(
      `INSERT INTO player_lifetime_state (device_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );
    const stateR = await pool.query(
      `SELECT prestige_count FROM player_lifetime_state WHERE device_id = $1`,
      [deviceId]
    );
    const currentPrestige = parseInt((stateR.rows[0] || {}).prestige_count, 10) || 0;
    if (currentPrestige >= 10) return res.json({ ok: false, reason: 'max_prestige' });
    const totalXp = await _computeLifetimeXp(deviceId);
    const xpPerLevel = parseInt(cfg.lifetime_xp_per_level || '500', 10) || 500;
    const xpUsedByPrestige = currentPrestige * 100 * xpPerLevel;
    const xpThisRun = Math.max(0, totalXp - xpUsedByPrestige);
    if (xpThisRun < 100 * xpPerLevel) {
      return res.json({ ok: false, reason: 'not_at_max_level' });
    }
    const reward = parseInt(cfg.lifetime_prestige_reward || '5000', 10) || 5000;
    // Atomic claim + credit.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE player_lifetime_state
            SET prestige_count = prestige_count + 1,
                last_prestige_at = NOW(),
                updated_at = NOW()
          WHERE device_id = $1 AND prestige_count = $2`,
        [deviceId, currentPrestige]
      );
      const credit = await client.query(
        `UPDATE player_profiles
            SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2 RETURNING balance`,
        [reward, deviceId]
      );
      await client.query('COMMIT');
      res.json({
        ok: true,
        newPrestige: currentPrestige + 1,
        reward,
        newBalance: credit.rows[0] ? Number(credit.rows[0].balance) : null
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/lifetime/prestige', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 31 — Smart Notifications scheduler
// Periodic scan: for each subscribed device, compute the highest-
// priority "send now?" signal. Send ONE personalized push if
// cooldown elapsed AND current hour is in the allowed window
// (Asia/Jerusalem). 8 possible reasons, ranked by emotional impact.
// ============================================================
async function _loadSmartPushConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'smart_push_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

// Build a personalized push for ONE device. Returns null when there's
// nothing pressing to send.
async function _pickSmartPushFor(deviceId, cfg) {
  // Pull a few aggregate signals in parallel.
  const queries = await Promise.allSettled([
    // 0. Player profile + display name
    pool.query(`SELECT pp.display_name, pp.balance FROM player_profiles pp WHERE pp.device_id = $1`, [deviceId]),
    // 1. Pet mood
    pool.query(`SELECT pet_name, level, last_visited_at FROM player_pet WHERE device_id = $1`, [deviceId]),
    // 2. Streak (read from daily_scores last play date — proxy)
    pool.query(`SELECT MAX(date) AS last_date FROM daily_scores WHERE device_id = $1`, [deviceId]),
    // 3. Season pass unclaimed tiers count
    pool.query(`SELECT xp, claimed_tiers FROM player_season_progress WHERE device_id = $1`, [deviceId]),
    // 4. Friends played today, you didn't
    pool.query(
      `SELECT pp.display_name AS friend_name
         FROM friendships f
         JOIN player_daily_dyn_activity a ON
           a.device_id = CASE WHEN f.device_a = $1 THEN f.device_b ELSE f.device_a END
           AND a.played_date = (NOW() AT TIME ZONE 'Asia/Jerusalem')::date
         LEFT JOIN player_profiles pp ON pp.device_id = a.device_id
        WHERE ($1 = f.device_a OR $1 = f.device_b)
          AND NOT EXISTS (SELECT 1 FROM player_daily_dyn_activity my
                         WHERE my.device_id = $1
                           AND my.played_date = (NOW() AT TIME ZONE 'Asia/Jerusalem')::date)
        LIMIT 1`,
      [deviceId]
    ),
    // 5. Tournament ending in 1-3 hours
    pool.query(
      `SELECT name FROM tournaments
        WHERE status = 'live'
          AND ends_at BETWEEN NOW() AND NOW() + INTERVAL '3 hours'
        LIMIT 1`
    ),
    // 6. Daily Special not played today (we know if dynamic_board_scores has nothing for today)
    // We just signal "play today's special" if hasn't played any dynamic game today.
    pool.query(
      `SELECT 1 FROM dynamic_board_scores
        WHERE device_id = $1
          AND updated_at >= (NOW() AT TIME ZONE 'Asia/Jerusalem')::date
        LIMIT 1`,
      [deviceId]
    ),
    // 7. Days since last play (for comeback detection)
    pool.query(
      `SELECT GREATEST(
         COALESCE(EXTRACT(EPOCH FROM (NOW() - MAX(date)::timestamp))::int / 86400, 999),
         0
       ) AS days_since FROM daily_scores WHERE device_id = $1`,
      [deviceId]
    )
  ]);
  const [profileR, petR, streakR, seasonR, friendR, tourneyR, todayPlayR, comebackR] = queries;
  const profile = (profileR.status === 'fulfilled' && profileR.value.rows[0]) || {};
  const playerName = (profile.display_name || '').toString().slice(0, 20);
  // Ranked signals — pick the highest-emotion ONE.
  // Priority order: pet crying > streak danger > tournament > friend > comeback > BP > daily special > daily play
  // 1. Pet crying (highest emotion — guilt)
  if (petR.status === 'fulfilled' && petR.value.rows[0]) {
    const pet = petR.value.rows[0];
    const hoursAgo = pet.last_visited_at
      ? (Date.now() - new Date(pet.last_visited_at).getTime()) / 3600000
      : 999;
    if (hoursAgo >= 48) {
      const petName = (pet.pet_name || 'הפרח שלך').toString().slice(0, 20);
      return {
        reason: 'pet_crying',
        title: '😢 ' + petName + ' עצוב',
        body: petName + ' מחכה לך כבר ' + Math.floor(hoursAgo / 24) + ' ימים. בוא לבקר!',
        url: '/'
      };
    }
  }
  // 2. Tournament ending soon
  if (tourneyR.status === 'fulfilled' && tourneyR.value.rows[0]) {
    return {
      reason: 'tournament_ending',
      title: '🏆 ' + tourneyR.value.rows[0].name + ' נגמר בקרוב!',
      body: 'הטורניר מסתיים תוך 3 שעות — תפוס מקום בעוד מאוחר מדי',
      url: '/'
    };
  }
  // 3. Friend played today, you didn't
  if (friendR.status === 'fulfilled' && friendR.value.rows[0]) {
    const friendName = (friendR.value.rows[0].friend_name || 'חבר שלך').toString().slice(0, 20);
    return {
      reason: 'friend_played',
      title: '👥 ' + friendName + ' שיחק היום',
      body: 'שחק היום כדי שתקבלו את הבונוס המשותף — 100💎 לשניכם',
      url: '/'
    };
  }
  // 4. Streak danger (last play yesterday, not today)
  if (streakR.status === 'fulfilled' && streakR.value.rows[0]) {
    const lastDate = streakR.value.rows[0].last_date;
    if (lastDate) {
      const lastIso = lastDate.toISOString().slice(0, 10);
      const todayIsr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      const yesterdayIsr = (function() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      })();
      if (lastIso === yesterdayIsr) {
        return {
          reason: 'streak_danger',
          title: '🔥 שמור על הרצף שלך!',
          body: (playerName ? playerName + ', שיחקת אתמול אבל עוד לא היום' : 'שיחקת אתמול אבל עוד לא היום') + ' — אל תאבד את הרצף',
          url: '/'
        };
      }
    }
  }
  // 5. BP unclaimed tiers (5+ rewards waiting)
  if (seasonR.status === 'fulfilled' && seasonR.value.rows[0]) {
    const sxp = parseInt(seasonR.value.rows[0].xp, 10) || 0;
    const claimedArr = Array.isArray(seasonR.value.rows[0].claimed_tiers) ? seasonR.value.rows[0].claimed_tiers : [];
    // Approximate current tier from xp (rough, won't be exact but close enough).
    const approxTier = Math.min(20, Math.floor(Math.sqrt(sxp / 40)));
    const unclaimed = approxTier - claimedArr.length;
    if (unclaimed >= 5) {
      return {
        reason: 'bp_unclaimed',
        title: '🎖 יש לך ' + unclaimed + ' פרסי Battle Pass לקבל',
        body: 'תפתח את האפליקציה ותאסוף את כל הפרסים שמחכים לך',
        url: '/'
      };
    }
  }
  // 6. Comeback (3+ days away)
  if (comebackR.status === 'fulfilled' && comebackR.value.rows[0]) {
    const daysSince = parseInt(comebackR.value.rows[0].days_since, 10) || 0;
    if (daysSince >= 3 && daysSince <= 30) {
      return {
        reason: 'comeback',
        title: '👋 ברוך שובך!',
        body: 'שמחים לראות אותך חזרה. יש לוחות חדשים + פרסי קאמבק ממתינים',
        url: '/'
      };
    }
  }
  // 7. Daily special not played today (after 14:00 Israel time)
  if (todayPlayR.status === 'fulfilled' && !todayPlayR.value.rows.length) {
    const israelHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }), 10);
    if (israelHour >= 14) {
      return {
        reason: 'daily_special',
        title: '🌟 הלוח של היום מחכה',
        body: 'משחק אחד = ×3 XP. תפיסה מהירה לפני שהיום נגמר',
        url: '/'
      };
    }
  }
  // Nothing pressing to send.
  return null;
}

// Periodic scheduler: scan all subscribed devices, pick + send one push each.
async function _runSmartPushScan() {
  try {
    const cfg = await _loadSmartPushConfig();
    if (cfg.smart_push_enabled === 'false') return;
    // Hour gate (Asia/Jerusalem).
    const startHour = parseInt(cfg.smart_push_hour_start || '9', 10) || 9;
    const endHour = parseInt(cfg.smart_push_hour_end || '22', 10) || 22;
    const israelHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }), 10);
    if (israelHour < startHour || israelHour >= endHour) {
      // Quiet hours — skip this scan.
      return;
    }
    const cooldownHours = parseInt(cfg.smart_push_cooldown_hours || '12', 10) || 12;
    const batchSize = Math.min(2000, parseInt(cfg.smart_push_batch_size || '500', 10) || 500);
    // Find subscribed devices whose last push was more than cooldown hours ago
    // (or never had a push sent). Skip ones we tried in the last 30 min.
    const candidatesR = await pool.query(
      `SELECT DISTINCT ps.device_id
         FROM push_subscriptions ps
         LEFT JOIN player_push_state pps ON pps.device_id = ps.device_id
        WHERE (pps.last_sent_at IS NULL OR pps.last_sent_at < NOW() - ($1 || ' hours')::interval)
          AND (pps.last_scan_at IS NULL OR pps.last_scan_at < NOW() - INTERVAL '25 minutes')
        LIMIT $2`,
      [String(cooldownHours), batchSize]
    ).catch(() => ({ rows: [] }));
    const candidates = candidatesR.rows;
    if (!candidates.length) return;
    let sentCount = 0;
    let scannedCount = 0;
    for (const c of candidates) {
      scannedCount++;
      try {
        const push = await _pickSmartPushFor(c.device_id, cfg);
        // Always mark as scanned to spread the load on next tick.
        await pool.query(
          `INSERT INTO player_push_state (device_id, last_scan_at) VALUES ($1, NOW())
           ON CONFLICT (device_id) DO UPDATE SET last_scan_at = NOW(), updated_at = NOW()`,
          [c.device_id]
        );
        if (!push) continue;
        await sendPushToDevice(c.device_id, {
          title: push.title,
          body: push.body,
          tag: 'smart-' + push.reason,
          data: { url: push.url || '/', reason: push.reason }
        });
        await pool.query(
          `UPDATE player_push_state
              SET last_sent_at = NOW(),
                  last_send_reason = $1,
                  total_sent = total_sent + 1,
                  updated_at = NOW()
            WHERE device_id = $2`,
          [push.reason, c.device_id]
        );
        sentCount++;
      } catch (e) {
        // Per-device failures don't abort the scan.
      }
    }
    if (sentCount > 0) {
      console.log(`[smart-push] scan: ${sentCount}/${scannedCount} sent`);
    }
  } catch (e) {
    console.error('[smart-push] scan error', e.message);
  }
}

// Start the scheduler on boot. Runs every smart_push_scan_minutes minutes.
function _startSmartPushScheduler() {
  // Initial delay 60s so server fully boots before first scan.
  setTimeout(async function tick() {
    try {
      const cfg = await _loadSmartPushConfig();
      const scanMin = Math.max(10, parseInt(cfg.smart_push_scan_minutes || '30', 10) || 30);
      await _runSmartPushScan();
      setTimeout(tick, scanMin * 60 * 1000);
    } catch (e) {
      // On error, retry in 30 min.
      setTimeout(tick, 30 * 60 * 1000);
    }
  }, 60 * 1000);
  console.log('[smart-push] scheduler started — first scan in 60s');
}
// Kick it off (web-push must already be configured; if not, sends become no-ops).
_startSmartPushScheduler();

// Admin/debug endpoint: preview what would be sent for a device right now.
app.get('/api/smart-push/preview', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.status(400).json({ error: 'bad_device' });
    const cfg = await _loadSmartPushConfig();
    const push = await _pickSmartPushFor(deviceId, cfg);
    res.json({ ok: true, push: push || null });
  } catch (e) {
    console.error('GET /api/smart-push/preview', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 32 — Replay Sharing
// Returns share config (threshold + brand text + URL) and logs
// share events for viral telemetry.
// ============================================================
async function _loadReplayConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'replay_share_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

app.get('/api/replay/config', async (_req, res) => {
  try {
    const cfg = await _loadReplayConfig();
    if (cfg.replay_share_enabled === 'false') return res.json({ ok: true, enabled: false });
    res.json({
      ok: true,
      enabled: true,
      minScore: parseInt(cfg.replay_share_min_score || '10000', 10) || 10000,
      shareText: cfg.replay_share_text_hebrew || '🌸 שברתי שיא ב-BLOOM! הגעתי ל-{score} נקודות. נסה לשבור אותי 👉 {url}',
      brandText: cfg.replay_share_brand_text || 'BLOOM · משחק מיזוג ממכר',
      gameUrl: cfg.replay_share_game_url || 'https://bloom-web-production-f3bd.up.railway.app'
    });
  } catch (e) {
    console.error('GET /api/replay/config', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/replay/track-share', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, score, tier, mode, sharedVia, isNewBest } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const sc = parseInt(score, 10);
    if (!Number.isFinite(sc) || sc < 0 || sc > 10000000) {
      return res.status(400).json({ error: 'bad_score' });
    }
    const ALLOWED_VIA = ['whatsapp', 'native', 'twitter', 'copy_link', 'save_image'];
    if (sharedVia && !ALLOWED_VIA.includes(sharedVia)) {
      return res.status(400).json({ error: 'bad_via' });
    }
    if (!checkRateLimit('replay_track', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    await pool.query(
      `INSERT INTO replay_shares (device_id, score, tier, mode, shared_via, is_new_best)
           VALUES ($1, $2, $3, $4, $5, $6)`,
      [deviceId, sc, parseInt(tier, 10) || null, (mode || '').toString().slice(0, 20),
       sharedVia || null, !!isNewBest]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/replay/track-share', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 27 — Guilds / Clans
// Peer-pressure retention. Daily collective goal + shared reward.
// 6-char code-based join (similar to contests).
// ============================================================
async function _loadGuildConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'guild_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

function _genGuildCode() {
  // 6 chars, alphanumeric uppercase. Easy to share verbally.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Create a guild — costs gems (anti-spam).
app.post('/api/guilds/create', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, name, emoji, description } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const cleanName = String(name || '').trim().slice(0, 60);
    if (cleanName.length < 2) return res.status(400).json({ error: 'name_too_short' });
    if (!checkRateLimit('guild_create', deviceId, 3, 24 * 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadGuildConfig();
    if (cfg.guild_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const cost = parseInt(cfg.guild_create_cost_gems || '500', 10) || 500;
    const maxMembers = parseInt(cfg.guild_max_members || '30', 10) || 30;
    // Already in a guild?
    const existR = await pool.query(`SELECT guild_id FROM guild_members WHERE device_id = $1`, [deviceId]);
    if (existR.rows.length) return res.json({ ok: false, reason: 'already_in_guild' });
    // Generate unique code (retry on collision).
    let code = null;
    for (let i = 0; i < 5; i++) {
      const candidate = _genGuildCode();
      const checkR = await pool.query(`SELECT 1 FROM guilds WHERE code = $1`, [candidate]);
      if (!checkR.rows.length) { code = candidate; break; }
    }
    if (!code) return res.status(500).json({ error: 'code_gen_failed' });
    // Atomic: deduct gems + create guild + add creator as leader.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const debit = await client.query(
        `UPDATE player_profiles SET balance = balance - $1, updated_at = NOW()
          WHERE device_id = $2 AND balance >= $1 RETURNING balance`,
        [cost, deviceId]
      );
      if (!debit.rows[0]) {
        await client.query('ROLLBACK');
        const balR = await pool.query(`SELECT balance FROM player_profiles WHERE device_id = $1`, [deviceId]);
        const bal = balR.rows[0] ? Number(balR.rows[0].balance) : 0;
        return res.json({ ok: false, reason: 'insufficient_funds', price: cost, balance: bal });
      }
      const gR = await client.query(
        `INSERT INTO guilds (code, name, emoji, description, creator_device_id, member_count, max_members)
             VALUES ($1, $2, $3, $4, $5, 1, $6) RETURNING *`,
        [code, cleanName, (emoji || '🛡').toString().slice(0, 10),
         (description || '').toString().slice(0, 300), deviceId, maxMembers]
      );
      await client.query(
        `INSERT INTO guild_members (guild_id, device_id, role) VALUES ($1, $2, 'leader')`,
        [gR.rows[0].id, deviceId]
      );
      await client.query('COMMIT');
      res.json({
        ok: true,
        guild: gR.rows[0],
        newBalance: Number(debit.rows[0].balance)
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/guilds/create', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Join a guild by code.
app.post('/api/guilds/join', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, code } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const cleanCode = String(code || '').toUpperCase().trim().slice(0, 8);
    if (cleanCode.length < 4) return res.status(400).json({ error: 'bad_code' });
    if (!checkRateLimit('guild_join', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    // Already in a guild?
    const existR = await pool.query(`SELECT guild_id FROM guild_members WHERE device_id = $1`, [deviceId]);
    if (existR.rows.length) return res.json({ ok: false, reason: 'already_in_guild' });
    // Find guild + check capacity.
    const gR = await pool.query(`SELECT id, member_count, max_members FROM guilds WHERE code = $1`, [cleanCode]);
    if (!gR.rows[0]) return res.json({ ok: false, reason: 'guild_not_found' });
    if (gR.rows[0].member_count >= gR.rows[0].max_members) {
      return res.json({ ok: false, reason: 'guild_full' });
    }
    // Atomic: insert + bump member_count.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO guild_members (guild_id, device_id) VALUES ($1, $2)
         ON CONFLICT (guild_id, device_id) DO NOTHING`,
        [gR.rows[0].id, deviceId]
      );
      await client.query(
        `UPDATE guilds SET member_count = member_count + 1, updated_at = NOW()
          WHERE id = $1 AND member_count < max_members`,
        [gR.rows[0].id]
      );
      await client.query('COMMIT');
      res.json({ ok: true, guildId: gR.rows[0].id });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/guilds/join', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Leave the guild.
app.post('/api/guilds/leave', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('guild_leave', deviceId, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const memR = await pool.query(`SELECT guild_id, role FROM guild_members WHERE device_id = $1`, [deviceId]);
    if (!memR.rows[0]) return res.json({ ok: false, reason: 'not_in_guild' });
    const guildId = memR.rows[0].guild_id;
    const isLeader = memR.rows[0].role === 'leader';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM guild_members WHERE guild_id = $1 AND device_id = $2`, [guildId, deviceId]);
      const remR = await client.query(`SELECT COUNT(*) AS c FROM guild_members WHERE guild_id = $1`, [guildId]);
      const remaining = parseInt(remR.rows[0].c, 10) || 0;
      if (remaining === 0) {
        // Last member out — delete the guild.
        await client.query(`DELETE FROM guilds WHERE id = $1`, [guildId]);
      } else {
        await client.query(
          `UPDATE guilds SET member_count = $1, updated_at = NOW() WHERE id = $2`,
          [remaining, guildId]
        );
        // If the leader left, promote oldest member to leader.
        if (isLeader) {
          await client.query(
            `UPDATE guild_members SET role = 'leader'
              WHERE guild_id = $1 AND device_id = (
                SELECT device_id FROM guild_members WHERE guild_id = $1
                  ORDER BY joined_at ASC LIMIT 1
              )`,
            [guildId]
          );
        }
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/guilds/leave', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Get my guild state — members + today's progress + my claim status.
app.get('/api/guilds/mine', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    const cfg = await _loadGuildConfig();
    if (cfg.guild_enabled === 'false') return res.json({ ok: true, enabled: false });
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, enabled: true, guild: null });
    const memR = await pool.query(
      `SELECT g.*, gm.role, gm.total_score_contrib, gm.total_crowns_contrib
         FROM guild_members gm
         JOIN guilds g ON g.id = gm.guild_id
        WHERE gm.device_id = $1`,
      [deviceId]
    );
    if (!memR.rows[0]) return res.json({ ok: true, enabled: true, guild: null });
    const g = memR.rows[0];
    // Get all members.
    const membersR = await pool.query(
      `SELECT gm.device_id, gm.role, gm.joined_at, gm.total_score_contrib, gm.total_crowns_contrib,
              COALESCE(pp.display_name, 'אנונימי') AS name, pp.country, pp.player_code
         FROM guild_members gm
         LEFT JOIN player_profiles pp ON pp.device_id = gm.device_id
        WHERE gm.guild_id = $1
        ORDER BY gm.total_score_contrib DESC LIMIT 50`,
      [g.id]
    );
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    // Ensure today's progress row exists.
    const goalTarget = parseInt(cfg.guild_daily_goal_crowns || '30', 10) || 30;
    await pool.query(
      `INSERT INTO guild_daily_progress (guild_id, date, goal_target) VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, date) DO NOTHING`,
      [g.id, today, goalTarget]
    );
    const progR = await pool.query(
      `SELECT goal_target, goal_progress, is_complete, completed_at
         FROM guild_daily_progress WHERE guild_id = $1 AND date = $2::date`,
      [g.id, today]
    );
    const progress = progR.rows[0] || { goal_target: goalTarget, goal_progress: 0, is_complete: false };
    // My claim status.
    const claimR = await pool.query(
      `SELECT reward_gems FROM guild_member_claims
        WHERE guild_id = $1 AND device_id = $2 AND date = $3::date`,
      [g.id, deviceId, today]
    );
    const myClaimed = claimR.rows.length > 0;
    res.json({
      ok: true,
      enabled: true,
      guild: {
        id: g.id, code: g.code, name: g.name, emoji: g.emoji, description: g.description,
        memberCount: g.member_count, maxMembers: g.max_members,
        totalScoreAlltime: g.total_score_alltime,
        myRole: g.role,
        myScoreContrib: g.total_score_contrib,
        myCrownsContrib: g.total_crowns_contrib
      },
      members: membersR.rows.map(m => ({
        deviceId: m.device_id, name: m.name, role: m.role, country: m.country,
        playerCode: m.player_code, joinedAt: m.joined_at,
        scoreContrib: parseInt(m.total_score_contrib, 10) || 0,
        crownsContrib: parseInt(m.total_crowns_contrib, 10) || 0,
        isMe: m.device_id === deviceId
      })),
      todayProgress: {
        target: parseInt(progress.goal_target, 10) || goalTarget,
        progress: parseInt(progress.goal_progress, 10) || 0,
        isComplete: !!progress.is_complete,
        canClaim: !!progress.is_complete && !myClaimed,
        claimed: myClaimed,
        rewardPerMember: parseInt(cfg.guild_daily_reward_per_member || '200', 10) || 200
      }
    });
  } catch (e) {
    console.error('GET /api/guilds/mine', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Auto-contribute from game-over when player reaches crown (tier 8).
// Server validates membership; client just sends the score+crowns.
app.post('/api/guilds/contribute', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, score, crowns } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    const sc = parseInt(score, 10) || 0;
    const cr = parseInt(crowns, 10) || 0;
    if (cr < 0 || cr > 24) return res.status(400).json({ error: 'bad_crowns' });
    if (sc < 0 || sc > 10000000) return res.status(400).json({ error: 'bad_score' });
    if (!checkRateLimit('guild_contribute', deviceId, 100, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const memR = await pool.query(`SELECT guild_id FROM guild_members WHERE device_id = $1`, [deviceId]);
    if (!memR.rows[0]) return res.json({ ok: false, reason: 'not_in_guild' });
    const guildId = memR.rows[0].guild_id;
    const cfg = await _loadGuildConfig();
    const goalTarget = parseInt(cfg.guild_daily_goal_crowns || '30', 10) || 30;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    // Atomic: bump member counters + bump daily progress + bump guild alltime.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE guild_members
            SET total_score_contrib = total_score_contrib + $1,
                total_crowns_contrib = total_crowns_contrib + $2
          WHERE guild_id = $3 AND device_id = $4`,
        [sc, cr, guildId, deviceId]
      );
      await client.query(
        `UPDATE guilds SET total_score_alltime = total_score_alltime + $1, updated_at = NOW()
          WHERE id = $2`,
        [sc, guildId]
      );
      // Bump daily progress (insert if missing).
      await client.query(
        `INSERT INTO guild_daily_progress (guild_id, date, goal_target, goal_progress)
             VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id, date) DO UPDATE
            SET goal_progress = guild_daily_progress.goal_progress + $4`,
        [guildId, today, goalTarget, cr]
      );
      // Check if just completed.
      const progR = await client.query(
        `SELECT goal_target, goal_progress, is_complete
           FROM guild_daily_progress WHERE guild_id = $1 AND date = $2::date`,
        [guildId, today]
      );
      let justCompleted = false;
      if (progR.rows[0] && !progR.rows[0].is_complete &&
          progR.rows[0].goal_progress >= progR.rows[0].goal_target) {
        await client.query(
          `UPDATE guild_daily_progress
              SET is_complete = TRUE, completed_at = NOW()
            WHERE guild_id = $1 AND date = $2::date`,
          [guildId, today]
        );
        justCompleted = true;
      }
      // Stage 37 — Guild Wars contribution (best-effort, same txn).
      const warContribId = await _maybeContributeToWar(guildId, deviceId, sc, client);
      await client.query('COMMIT');
      res.json({
        ok: true,
        guildId,
        newProgress: progR.rows[0] ? progR.rows[0].goal_progress : cr,
        goal: progR.rows[0] ? progR.rows[0].goal_target : goalTarget,
        justCompleted,
        warContribId
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/guilds/contribute', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Claim the daily completion reward (atomic, once per member per day).
app.post('/api/guilds/claim-daily', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('guild_claim', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadGuildConfig();
    if (cfg.guild_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const memR = await pool.query(`SELECT guild_id FROM guild_members WHERE device_id = $1`, [deviceId]);
    if (!memR.rows[0]) return res.json({ ok: false, reason: 'not_in_guild' });
    const guildId = memR.rows[0].guild_id;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    // Verify daily goal is complete server-side.
    const progR = await pool.query(
      `SELECT is_complete FROM guild_daily_progress WHERE guild_id = $1 AND date = $2::date`,
      [guildId, today]
    );
    if (!progR.rows[0] || !progR.rows[0].is_complete) {
      return res.json({ ok: false, reason: 'goal_not_complete' });
    }
    const reward = parseInt(cfg.guild_daily_reward_per_member || '200', 10) || 200;
    // Atomic claim.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertR = await client.query(
        `INSERT INTO guild_member_claims (guild_id, device_id, date, reward_gems)
             VALUES ($1, $2, $3::date, $4)
         ON CONFLICT (guild_id, device_id, date) DO NOTHING
         RETURNING id`,
        [guildId, deviceId, today, reward]
      );
      if (!insertR.rows[0]) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'already_claimed' });
      }
      const credit = await client.query(
        `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2 RETURNING balance`,
        [reward, deviceId]
      );
      await client.query('COMMIT');
      res.json({ ok: true, reward, newBalance: credit.rows[0] ? Number(credit.rows[0].balance) : null });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/guilds/claim-daily', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Top guilds leaderboard — by all-time total score.
app.get('/api/guilds/leaderboard', async (req, res) => {
  try {
    const cfg = await _loadGuildConfig();
    if (cfg.guild_enabled === 'false') return res.json({ ok: true, enabled: false });
    const limit = Math.min(50, Math.max(10, parseInt(req.query.limit || '20', 10) || 20));
    const r = await pool.query(
      `SELECT id, code, name, emoji, member_count, max_members, total_score_alltime
         FROM guilds
        WHERE is_public = TRUE
        ORDER BY total_score_alltime DESC, member_count DESC
        LIMIT $1`,
      [limit]
    );
    res.json({
      ok: true,
      enabled: true,
      guilds: r.rows.map((g, idx) => ({
        rank: idx + 1,
        id: g.id, code: g.code, name: g.name, emoji: g.emoji,
        memberCount: g.member_count, maxMembers: g.max_members,
        totalScoreAlltime: parseInt(g.total_score_alltime, 10) || 0
      }))
    });
  } catch (e) {
    console.error('GET /api/guilds/leaderboard', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 38 — Trophy Road (May 2026)
// Clash Royale pattern. Trophies go UP on good plays, DOWN on
// bad ones (with a configurable floor + new-player protection).
// Player progresses through visual "arenas" + claims milestone
// rewards at specific trophy thresholds (one-time per device).
// ============================================================
async function _loadTrophyConfig() {
  const r = await pool.query(
    `SELECT key, value FROM game_config WHERE key LIKE 'trophies_%'`
  );
  const cfg = {};
  for (const row of r.rows) cfg[row.key] = row.value;
  return cfg;
}

// Server-authoritative arena ladder. Same id/emoji/label as the
// client-side mirror in src/34-trophy-road.js — keep in sync.
const TROPHY_ARENAS = [
  { id: 'sprout',   minTrophies: 0,     emoji: '🌱', label: 'נבט',           color: '#7EC9B0' },
  { id: 'forest',   minTrophies: 50,    emoji: '🌳', label: 'יער הקסם',       color: '#5A8F3A' },
  { id: 'village',  minTrophies: 200,   emoji: '🏘',  label: 'הכפר',          color: '#C9A56F' },
  { id: 'castle',   minTrophies: 600,   emoji: '🏰', label: 'הטירה',         color: '#9C7BD8' },
  { id: 'volcano',  minTrophies: 1500,  emoji: '🌋', label: 'הר הגעש',       color: '#E04A2E' },
  { id: 'ice',      minTrophies: 3000,  emoji: '❄️', label: 'היכל הקרח',     color: '#5FAEE0' },
  { id: 'galaxy',   minTrophies: 6000,  emoji: '🌌', label: 'הגלקסיה',       color: '#7A4FC9' },
  { id: 'legend',   minTrophies: 12000, emoji: '⚡', label: 'היכל האגדה',    color: '#FFD93D' }
];

function _trophyArenaFor(trophies) {
  let curr = TROPHY_ARENAS[0];
  for (const a of TROPHY_ARENAS) {
    if (trophies >= a.minTrophies) curr = a;
    else break;
  }
  return curr;
}

function _trophyMilestones(cfg) {
  const out = [];
  for (let i = 1; i <= 10; i++) {
    const at = parseInt(cfg['trophies_milestone_' + i + '_at'], 10);
    const gems = parseInt(cfg['trophies_milestone_' + i + '_gems'], 10);
    if (Number.isFinite(at) && Number.isFinite(gems) && at > 0) {
      out.push({ index: i, at, gems });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// Calculate trophy delta for a finished game. Read-only.
function _calcTrophyChange(opts, cfg) {
  // opts: { score, tier, isNewBest, isPracticeOrDaily, currentTrophies }
  const minGain = parseInt(cfg.trophies_min_score_to_gain || '500', 10);
  const minLose = parseInt(cfg.trophies_min_score_to_lose || '100', 10);
  const winBase = parseInt(cfg.trophies_per_win_base || '15', 10);
  const lossBase = parseInt(cfg.trophies_per_loss_base || '-8', 10);
  const crownBonus = parseInt(cfg.trophies_per_crown_bonus || '40', 10);
  const pbBonus = parseInt(cfg.trophies_per_personal_best || '25', 10);
  const protectUnder = parseInt(cfg.trophies_protect_under || '50', 10);
  const safeFloor = parseInt(cfg.trophies_safe_floor || '0', 10);
  const score = opts.score | 0;
  const tier = opts.tier | 0;
  const breakdown = [];
  let delta = 0;
  if (score >= minGain) {
    delta += winBase; breakdown.push({ reason: 'win', amount: winBase });
    if (tier >= 8) { delta += crownBonus; breakdown.push({ reason: 'crown', amount: crownBonus }); }
    if (opts.isNewBest) { delta += pbBonus; breakdown.push({ reason: 'personal_best', amount: pbBonus }); }
  } else if (score < minLose) {
    // Loss-protection: new players (under N trophies) don't lose.
    if (opts.currentTrophies < protectUnder) {
      breakdown.push({ reason: 'loss_protected', amount: 0 });
    } else {
      delta += lossBase; breakdown.push({ reason: 'loss', amount: lossBase });
    }
  } else {
    breakdown.push({ reason: 'neutral', amount: 0 });
  }
  // Clamp: never drop below safeFloor.
  const projected = opts.currentTrophies + delta;
  if (projected < safeFloor) delta = safeFloor - opts.currentTrophies;
  return { delta, breakdown };
}

app.get('/api/trophies/state', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    if (deviceId.length < 8) return res.status(400).json({ error: 'bad_device' });
    const cfg = await _loadTrophyConfig();
    if (cfg.trophies_enabled === 'false') return res.json({ ok: true, enabled: false });
    const r = await pool.query(
      `SELECT trophies, trophies_lifetime, highest_trophies, current_arena_id, claimed_milestones,
              total_games, total_wins, last_change, last_change_at
         FROM player_trophies WHERE device_id = $1`,
      [deviceId]
    );
    const row = r.rows[0] || { trophies: 0, trophies_lifetime: 0, highest_trophies: 0, current_arena_id: 'sprout', claimed_milestones: [], total_games: 0, total_wins: 0, last_change: 0, last_change_at: null };
    const arena = _trophyArenaFor(row.trophies);
    // Next arena
    const nextArena = TROPHY_ARENAS.find(a => a.minTrophies > row.trophies) || null;
    const milestones = _trophyMilestones(cfg);
    const claimed = Array.isArray(row.claimed_milestones) ? row.claimed_milestones : [];
    const unclaimedMilestones = milestones.filter(m => row.trophies >= m.at && claimed.indexOf(m.index) < 0);
    res.json({
      ok: true,
      enabled: true,
      trophies: row.trophies,
      lifetime: Number(row.trophies_lifetime),
      highest: row.highest_trophies,
      arena: arena,
      nextArena: nextArena ? { ...nextArena, gap: nextArena.minTrophies - row.trophies } : null,
      arenas: TROPHY_ARENAS,
      milestones: milestones.map(m => ({ ...m, claimed: claimed.indexOf(m.index) >= 0, ready: row.trophies >= m.at })),
      claimedCount: claimed.length,
      unclaimedCount: unclaimedMilestones.length,
      stats: {
        games: row.total_games, wins: row.total_wins,
        winrate: row.total_games > 0 ? Math.round(row.total_wins / row.total_games * 100) : 0
      },
      lastChange: row.last_change, lastChangeAt: row.last_change_at
    });
  } catch (e) {
    console.error('GET /api/trophies/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Granted automatically when /api/score (daily) or /api/score/practice
// fires — see hooks below. Also a direct endpoint so admin / future
// modes can call it explicitly with a custom reason.
app.post('/api/trophies/grant-from-game', requireDeviceAuth, async (req, res) => {
  try {
    const deviceId = req.deviceId;
    if (!checkRateLimit('trophy_grant', deviceId, 200, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadTrophyConfig();
    if (cfg.trophies_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const { score, tier, isNewBest, source, gameId } = req.body || {};
    const result = await _trophyGrantFromGame(deviceId, {
      score: parseInt(score, 10) || 0,
      tier: parseInt(tier, 10) || 0,
      isNewBest: !!isNewBest,
      source: String(source || 'unknown').slice(0, 30),
      gameId: String(gameId || '').slice(0, 64)
    }, cfg);
    res.json(result);
  } catch (e) {
    console.error('POST /api/trophies/grant-from-game', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Shared helper — called by the explicit endpoint AND inline from /api/score.
// Returns { ok, delta, before, after, arena, leveledArena, breakdown }.
// Per-game dedup via _trophy:<deviceId>:<gameId> game_config key so a
// repeat submit (network retry, multi-mode write) doesn't double-grant.
async function _trophyGrantFromGame(deviceId, opts, cfg) {
  // Skip on bot/skin-trial — we never set their trophies.
  if (opts.gameId) {
    const dedupKey = '_trophy:' + deviceId + ':' + opts.gameId;
    const dr = await pool.query(`SELECT value FROM game_config WHERE key = $1`, [dedupKey]);
    if (dr.rows[0]) return { ok: false, reason: 'already_granted' };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lazy insert
    await client.query(
      `INSERT INTO player_trophies (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING`,
      [deviceId]
    );
    const sr = await client.query(
      `SELECT trophies, current_arena_id FROM player_trophies WHERE device_id = $1 FOR UPDATE`,
      [deviceId]
    );
    const cur = sr.rows[0];
    const before = cur.trophies;
    const calc = _calcTrophyChange({ ...opts, currentTrophies: before }, cfg);
    const after = before + calc.delta;
    const newArenaObj = _trophyArenaFor(after);
    const leveledArena = newArenaObj.id !== cur.current_arena_id;
    const isWin = calc.delta > 0;
    await client.query(
      `UPDATE player_trophies
          SET trophies = $2,
              trophies_lifetime = trophies_lifetime + GREATEST(0, $3),
              highest_trophies = GREATEST(highest_trophies, $2),
              current_arena_id = $4,
              total_games = total_games + 1,
              total_wins = total_wins + $5,
              last_change = $3,
              last_change_at = NOW()
        WHERE device_id = $1`,
      [deviceId, after, calc.delta, newArenaObj.id, isWin ? 1 : 0]
    );
    await client.query(
      `INSERT INTO trophy_history (device_id, change_amount, before_trophies, after_trophies, reason, meta)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [deviceId, calc.delta, before, after, opts.source, JSON.stringify({ score: opts.score, tier: opts.tier, breakdown: calc.breakdown })]
    );
    // Mark dedup key (best-effort)
    if (opts.gameId) {
      try {
        await client.query(
          `INSERT INTO game_config (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO NOTHING`,
          ['_trophy:' + deviceId + ':' + opts.gameId, '1']
        );
      } catch (e) {}
    }
    await client.query('COMMIT');
    return {
      ok: true,
      delta: calc.delta,
      before,
      after,
      arena: newArenaObj,
      leveledArena,
      breakdown: calc.breakdown
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

app.post('/api/trophies/claim-milestone', requireDeviceAuth, async (req, res) => {
  try {
    const deviceId = req.deviceId;
    const { milestoneIndex } = req.body || {};
    const idx = parseInt(milestoneIndex, 10);
    if (!idx || idx < 1 || idx > 10) return res.status(400).json({ error: 'bad_milestone' });
    if (!checkRateLimit('trophy_claim', deviceId, 20, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadTrophyConfig();
    if (cfg.trophies_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const milestones = _trophyMilestones(cfg);
    const milestone = milestones.find(m => m.index === idx);
    if (!milestone) return res.json({ ok: false, reason: 'unknown_milestone' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sr = await client.query(
        `SELECT trophies, claimed_milestones FROM player_trophies WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      if (!sr.rows[0]) { await client.query('ROLLBACK'); return res.json({ ok: false, reason: 'no_state' }); }
      const cur = sr.rows[0];
      if (cur.trophies < milestone.at) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'not_reached', needed: milestone.at, have: cur.trophies });
      }
      const claimed = Array.isArray(cur.claimed_milestones) ? cur.claimed_milestones : [];
      if (claimed.indexOf(idx) >= 0) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'already_claimed' });
      }
      claimed.push(idx);
      await client.query(
        `UPDATE player_trophies SET claimed_milestones = $2::jsonb WHERE device_id = $1`,
        [deviceId, JSON.stringify(claimed)]
      );
      const cr = await client.query(
        `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2 RETURNING balance`,
        [milestone.gems, deviceId]
      );
      await client.query('COMMIT');
      res.json({ ok: true, reward: milestone.gems, newBalance: cr.rows[0] ? Number(cr.rows[0].balance) : null, milestone });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/trophies/claim-milestone', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 37 — Guild Wars (clan-vs-clan competition, May 2026)
// Auto-matched weekly head-to-head between two guilds. Every
// game played by a member contributes to their guild's war pool.
// Winner takes the larger gem reward; loser still gets consolation.
// Clash Royale pattern — boosted guild retention 3-5x.
// ============================================================
async function _activeWarForGuild(guildId) {
  // Returns the active war row for a guild, or null.
  const r = await pool.query(
    `SELECT * FROM guild_wars
      WHERE (guild_a_id = $1 OR guild_b_id = $1)
        AND status = 'active'
        AND ends_at > NOW()
      ORDER BY id DESC LIMIT 1`,
    [guildId]
  );
  return r.rows[0] || null;
}

async function _maybeContributeToWar(guildId, deviceId, score, client) {
  // Called inside the existing /guilds/contribute transaction so we never
  // pay out without recording activity. Best-effort — if no active war,
  // silently no-ops. Uses the supplied client so we stay in the same txn.
  try {
    const warR = await client.query(
      `SELECT id, guild_a_id, guild_b_id, ends_at
         FROM guild_wars
        WHERE (guild_a_id = $1 OR guild_b_id = $1)
          AND status = 'active'
          AND ends_at > NOW()
        ORDER BY id DESC LIMIT 1
        FOR UPDATE`,
      [guildId]
    );
    if (!warR.rows[0]) return null;
    const war = warR.rows[0];
    const isA = (war.guild_a_id === guildId);
    const scoreCol = isA ? 'guild_a_score' : 'guild_b_score';
    const gamesCol = isA ? 'guild_a_games' : 'guild_b_games';
    await client.query(
      `UPDATE guild_wars SET ${scoreCol} = ${scoreCol} + $1, ${gamesCol} = ${gamesCol} + 1 WHERE id = $2`,
      [score, war.id]
    );
    await client.query(
      `INSERT INTO guild_war_contributions (war_id, device_id, guild_id, score_contribution, games_count, last_contrib_at)
       VALUES ($1, $2, $3, $4, 1, NOW())
       ON CONFLICT (war_id, device_id) DO UPDATE
         SET score_contribution = guild_war_contributions.score_contribution + EXCLUDED.score_contribution,
             games_count = guild_war_contributions.games_count + 1,
             last_contrib_at = NOW()`,
      [war.id, deviceId, guildId, score]
    );
    return war.id;
  } catch (e) {
    console.warn('[guild war contribute] silent fail', e.message);
    return null;
  }
}

async function _finalizeGuildWar(warId) {
  // Idempotent. Picks winner, credits each contributing member.
  try {
    const r = await pool.query(
      `SELECT * FROM guild_wars WHERE id = $1`,
      [warId]
    );
    const war = r.rows[0];
    if (!war || war.status === 'finalized') return;
    if (war.ends_at > new Date()) return; // not ended yet
    const cfg = await _loadGuildConfig();
    const winnerReward = parseInt(cfg.guild_wars_winner_reward_per_member || '500', 10) || 500;
    const loserReward = parseInt(cfg.guild_wars_loser_reward_per_member || '100', 10) || 100;
    const minGames = parseInt(cfg.guild_wars_min_games_to_claim || '1', 10) || 1;
    // Winner determination
    let winnerId = null;
    if (Number(war.guild_a_score) > Number(war.guild_b_score)) winnerId = war.guild_a_id;
    else if (Number(war.guild_b_score) > Number(war.guild_a_score)) winnerId = war.guild_b_id;
    // Tie → both get loser reward (no winner)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE guild_wars SET status = 'finalized', winner_guild_id = $1, finalized_at = NOW()
          WHERE id = $2 AND status = 'active'`,
        [winnerId, warId]
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    // Send push notifications to all contributing members (best-effort, async).
    setImmediate(async () => {
      try {
        const contribs = await pool.query(
          `SELECT device_id, guild_id, games_count FROM guild_war_contributions WHERE war_id = $1 AND games_count >= $2`,
          [warId, minGames]
        );
        for (const c of contribs.rows) {
          const isWinner = winnerId && (c.guild_id === winnerId);
          const reward = isWinner ? winnerReward : loserReward;
          const title = isWinner ? '🏆 ניצחתם במלחמת קלאנים!' : '⚔️ מלחמת הקלאנים הסתיימה';
          const body = isWinner ? `הקלאן שלך ניצח! +${reward}💎 מחכים לאסוף.` : `+${reward}💎 פרס נחמה מחכה לאסוף.`;
          try { sendPushToDevice(c.device_id, { title, body, url: '/?action=guild', tag: 'guild-war-' + warId }); } catch (e) {}
        }
      } catch (e) { console.warn('[guild war push]', e.message); }
    });
  } catch (e) {
    console.error('_finalizeGuildWar', e);
  }
}

async function _runGuildWarMatchmaker() {
  // Pair active guilds into wars. Triggered weekly (Sunday 00:00 Asia/Jerusalem)
  // OR on-demand via admin endpoint.
  try {
    const cfg = await _loadGuildConfig();
    if (cfg.guild_wars_enabled === 'false') return { matched: 0 };
    const minActive = parseInt(cfg.guild_wars_min_members_active || '3', 10) || 3;
    const durationDays = parseInt(cfg.guild_wars_duration_days || '7', 10) || 7;
    // Find all guilds that DON'T have an active war + have enough active members.
    const gR = await pool.query(
      `SELECT g.id, g.member_count, g.total_score_alltime
         FROM guilds g
         LEFT JOIN guild_wars w ON (
           (w.guild_a_id = g.id OR w.guild_b_id = g.id) AND w.status = 'active' AND w.ends_at > NOW()
         )
        WHERE w.id IS NULL
          AND g.member_count >= $1
        ORDER BY g.total_score_alltime DESC`,
      [minActive]
    );
    const eligible = gR.rows;
    if (eligible.length < 2) return { matched: 0 };
    // Pair adjacent guilds (similar power level → fair matches).
    let matched = 0;
    const starts = new Date();
    const ends = new Date(starts.getTime() + durationDays * 86400000);
    for (let i = 0; i + 1 < eligible.length; i += 2) {
      const a = eligible[i];
      const b = eligible[i + 1];
      await pool.query(
        `INSERT INTO guild_wars (guild_a_id, guild_b_id, starts_at, ends_at)
         VALUES ($1, $2, $3, $4)`,
        [a.id, b.id, starts.toISOString(), ends.toISOString()]
      );
      matched++;
    }
    return { matched };
  } catch (e) {
    console.error('_runGuildWarMatchmaker', e);
    return { matched: 0 };
  }
}

app.get('/api/guilds/war', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    if (deviceId.length < 8) return res.status(400).json({ error: 'bad_device' });
    const cfg = await _loadGuildConfig();
    if (cfg.guild_wars_enabled === 'false') return res.json({ ok: true, enabled: false });
    const memR = await pool.query(`SELECT guild_id FROM guild_members WHERE device_id = $1`, [deviceId]);
    if (!memR.rows[0]) return res.json({ ok: true, enabled: true, inGuild: false });
    const guildId = memR.rows[0].guild_id;
    // Auto-finalize any expired wars for this guild before reading state.
    const expiredR = await pool.query(
      `SELECT id FROM guild_wars
        WHERE (guild_a_id = $1 OR guild_b_id = $1) AND status = 'active' AND ends_at <= NOW()`,
      [guildId]
    );
    for (const row of expiredR.rows) await _finalizeGuildWar(row.id);
    // Active war
    const war = await _activeWarForGuild(guildId);
    let activeWar = null;
    if (war) {
      const otherGuildId = (war.guild_a_id === guildId) ? war.guild_b_id : war.guild_a_id;
      const otherR = await pool.query(`SELECT id, code, name, emoji, member_count FROM guilds WHERE id = $1`, [otherGuildId]);
      const myR = await pool.query(`SELECT id, code, name, emoji, member_count FROM guilds WHERE id = $1`, [guildId]);
      const myContribR = await pool.query(
        `SELECT score_contribution, games_count FROM guild_war_contributions WHERE war_id = $1 AND device_id = $2`,
        [war.id, deviceId]
      );
      const myContrib = myContribR.rows[0] || { score_contribution: 0, games_count: 0 };
      // Top contributors
      const topR = await pool.query(
        `SELECT gwc.device_id, gwc.score_contribution, gwc.games_count,
                COALESCE(pp.display_name, 'אנונימי') AS name
           FROM guild_war_contributions gwc
           LEFT JOIN player_profiles pp ON pp.device_id = gwc.device_id
          WHERE gwc.war_id = $1 AND gwc.guild_id = $2
          ORDER BY gwc.score_contribution DESC LIMIT 10`,
        [war.id, guildId]
      );
      activeWar = {
        id: war.id,
        myGuild: { ...myR.rows[0], score: Number(war.guild_a_id === guildId ? war.guild_a_score : war.guild_b_score), games: war.guild_a_id === guildId ? war.guild_a_games : war.guild_b_games },
        otherGuild: { ...otherR.rows[0], score: Number(war.guild_a_id === guildId ? war.guild_b_score : war.guild_a_score), games: war.guild_a_id === guildId ? war.guild_b_games : war.guild_a_games },
        startsAt: war.starts_at,
        endsAt: war.ends_at,
        msLeft: Math.max(0, new Date(war.ends_at).getTime() - Date.now()),
        myContribution: { score: Number(myContrib.score_contribution), games: myContrib.games_count },
        topContributors: topR.rows.map(r => ({ deviceId: r.device_id, name: r.name, score: Number(r.score_contribution), games: r.games_count }))
      };
    }
    // Unclaimed reward — most recent finalized war I haven't claimed
    const unclaimedR = await pool.query(
      `SELECT gw.id, gw.winner_guild_id, gw.guild_a_id, gw.guild_b_id, gw.finalized_at, gwc.games_count, gwc.guild_id
         FROM guild_wars gw
         JOIN guild_war_contributions gwc ON gwc.war_id = gw.id
         LEFT JOIN guild_war_claims gcl ON gcl.war_id = gw.id AND gcl.device_id = $1
        WHERE gw.status = 'finalized'
          AND gwc.device_id = $1
          AND gwc.games_count >= COALESCE((SELECT value::int FROM game_config WHERE key='guild_wars_min_games_to_claim'), 1)
          AND gcl.war_id IS NULL
        ORDER BY gw.finalized_at DESC LIMIT 1`,
      [deviceId]
    );
    let unclaimed = null;
    if (unclaimedR.rows[0]) {
      const u = unclaimedR.rows[0];
      const isWinner = u.winner_guild_id && (u.guild_id === u.winner_guild_id);
      const rewardKey = isWinner ? 'guild_wars_winner_reward_per_member' : 'guild_wars_loser_reward_per_member';
      const reward = parseInt(cfg[rewardKey] || (isWinner ? '500' : '100'), 10);
      unclaimed = { warId: u.id, isWinner, reward, finalizedAt: u.finalized_at };
    }
    res.json({ ok: true, enabled: true, inGuild: true, activeWar, unclaimed });
  } catch (e) {
    console.error('GET /api/guilds/war', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/guilds/war/claim', requireDeviceAuth, async (req, res) => {
  try {
    const deviceId = req.deviceId;
    const { warId } = req.body || {};
    const wid = parseInt(warId, 10);
    if (!wid) return res.status(400).json({ error: 'bad_war_id' });
    if (!checkRateLimit('guild_war_claim', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadGuildConfig();
    const minGames = parseInt(cfg.guild_wars_min_games_to_claim || '1', 10) || 1;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Verify eligibility: war finalized + I contributed enough games + haven't claimed.
      const eligR = await client.query(
        `SELECT gw.winner_guild_id, gw.guild_a_id, gw.guild_b_id, gwc.games_count, gwc.guild_id
           FROM guild_wars gw
           JOIN guild_war_contributions gwc ON gwc.war_id = gw.id
          WHERE gw.id = $1 AND gw.status = 'finalized' AND gwc.device_id = $2
          FOR UPDATE`,
        [wid, deviceId]
      );
      if (!eligR.rows[0]) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'not_eligible' });
      }
      const e = eligR.rows[0];
      if (e.games_count < minGames) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'min_games' });
      }
      const isWinner = e.winner_guild_id && (e.guild_id === e.winner_guild_id);
      const reward = isWinner
        ? (parseInt(cfg.guild_wars_winner_reward_per_member || '500', 10) || 500)
        : (parseInt(cfg.guild_wars_loser_reward_per_member || '100', 10) || 100);
      // Atomic claim insert + balance credit. Insert-or-fail handles double-claim.
      const insR = await client.query(
        `INSERT INTO guild_war_claims (war_id, device_id, claimed_at, reward_gems)
           VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (war_id, device_id) DO NOTHING
         RETURNING device_id`,
        [wid, deviceId, reward]
      );
      if (!insR.rows[0]) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'already_claimed' });
      }
      const crR = await client.query(
        `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2 RETURNING balance`,
        [reward, deviceId]
      );
      await client.query('COMMIT');
      res.json({ ok: true, isWinner, reward, newBalance: crR.rows[0] ? Number(crR.rows[0].balance) : null });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/guilds/war/claim', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Periodic matchmaker — runs every 6 hours, opportunistically pairs eligible guilds.
// The "Sunday only" rule is approximated: we just keep pairing whenever fresh guilds
// exist without an active war. This is simpler than scheduling exact day-of-week
// and naturally handles cohorts created later in the week.
let _guildWarMatchmakerStarted = false;
function _startGuildWarMatchmaker() {
  if (_guildWarMatchmakerStarted) return;
  _guildWarMatchmakerStarted = true;
  setInterval(async () => {
    try { await _runGuildWarMatchmaker(); } catch (e) {}
  }, 6 * 60 * 60 * 1000);
  // Initial run after a short delay so DB is ready.
  setTimeout(() => { _runGuildWarMatchmaker().catch(() => {}); }, 90 * 1000);
}
_startGuildWarMatchmaker();

// ============================================================
// Stage 33 — Rivalry System
// Auto-pairs players close in lifetime XP into 24h rivalries.
// Personal competition with named opponent + deadline = high engagement.
// ============================================================
async function _loadRivalConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'rival_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

// Scheduler tick — finds players close in lifetime XP, creates rivalries.
async function _runRivalryMatchmaker() {
  try {
    const cfg = await _loadRivalConfig();
    if (cfg.rival_enabled === 'false') return;
    const thresholdPct = parseFloat(cfg.rival_threshold_pct || '10') || 10;
    const durationHours = parseInt(cfg.rival_duration_hours || '24', 10) || 24;
    // Find recent active players (have played in last 7 days) WITHOUT an
    // active rivalry. Lifetime XP is computed per-call; here we approximate
    // via daily_scores (cheaper than recomputing for everyone).
    // Pull candidates: top 200 players ordered by best score recently.
    const candidatesR = await pool.query(
      `SELECT DISTINCT ds.device_id,
              (SELECT MAX(score) FROM daily_scores WHERE device_id = ds.device_id) AS best_score
         FROM daily_scores ds
        WHERE ds.date > NOW() - INTERVAL '7 days'
          AND NOT EXISTS (
            SELECT 1 FROM player_rivalries pr
             WHERE pr.device_id = ds.device_id
               AND pr.resolved = FALSE
               AND pr.expires_at > NOW()
          )
        ORDER BY best_score DESC NULLS LAST
        LIMIT 200`
    ).catch(() => ({ rows: [] }));
    const candidates = candidatesR.rows.filter(c => c.best_score && c.best_score > 0);
    if (candidates.length < 2) return;
    // Pair adjacent players in the sorted list — closest by score = potential rivalry.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
    let pairsCreated = 0;
    for (let i = 0; i < candidates.length - 1; i++) {
      const me = candidates[i];
      const them = candidates[i + 1];
      if (!them) break;
      const myScore = Number(me.best_score) || 0;
      const theirScore = Number(them.best_score) || 0;
      if (myScore <= 0 || theirScore <= 0) continue;
      // Within threshold %?
      const delta = Math.abs(myScore - theirScore);
      const pct = (delta / Math.max(myScore, theirScore)) * 100;
      if (pct > thresholdPct) continue;
      // Compute lifetime XP for both (cheap aggregate — reuses stage 30 logic).
      const myXp = await _computeLifetimeXp(me.device_id);
      const theirXp = await _computeLifetimeXp(them.device_id);
      // Create RECIPROCAL rivalries (both sides see each other).
      try {
        await pool.query(
          `INSERT INTO player_rivalries (device_id, rival_device_id, my_xp_at_decl, rival_xp_at_decl, expires_at)
             VALUES ($1, $2, $3, $4, $5), ($2, $1, $4, $3, $5)`,
          [me.device_id, them.device_id, myXp, theirXp, expiresAt]
        );
        pairsCreated++;
        // Skip the next iteration so we don't double-pair them.
        i++;
      } catch (insErr) {
        // Race or constraint — skip.
      }
      if (pairsCreated >= 50) break; // cap per scan
    }
    if (pairsCreated > 0) console.log(`[rivalry] matchmaker: ${pairsCreated} pairs created`);
  } catch (e) {
    console.error('[rivalry] matchmaker error', e.message);
  }
}

// Start scheduler — runs every 4 hours.
function _startRivalryScheduler() {
  setTimeout(async function tick() {
    try {
      await _runRivalryMatchmaker();
      setTimeout(tick, 4 * 60 * 60 * 1000);
    } catch (e) {
      setTimeout(tick, 30 * 60 * 1000);
    }
  }, 90 * 1000); // first tick after 90s boot delay
  console.log('[rivalry] scheduler started — first match in 90s');
}
_startRivalryScheduler();

// Get my active rivalry — fresh XP for both me + my rival.
app.get('/api/rival/state', async (req, res) => {
  try {
    const cfg = await _loadRivalConfig();
    if (cfg.rival_enabled === 'false') return res.json({ ok: true, enabled: false });
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, enabled: true, rivalry: null });
    // Find newest unresolved unexpired rivalry.
    const r = await pool.query(
      `SELECT id, rival_device_id, my_xp_at_decl, rival_xp_at_decl,
              declared_at, expires_at, viewed_by_player
         FROM player_rivalries
        WHERE device_id = $1 AND resolved = FALSE AND expires_at > NOW()
        ORDER BY declared_at DESC LIMIT 1`,
      [deviceId]
    );
    if (!r.rows[0]) return res.json({ ok: true, enabled: true, rivalry: null });
    const rivalry = r.rows[0];
    // Get rival's name + country.
    const rivalProfileR = await pool.query(
      `SELECT COALESCE(pp.display_name, ds.name, 'יריב אנונימי') AS name,
              pp.country, pp.player_code
         FROM (SELECT $1::text AS device_id) x
         LEFT JOIN player_profiles pp ON pp.device_id = x.device_id
         LEFT JOIN LATERAL (
           SELECT name FROM daily_scores
            WHERE device_id = x.device_id
            ORDER BY date DESC LIMIT 1
         ) ds ON true`,
      [rivalry.rival_device_id]
    );
    const rivalProfile = rivalProfileR.rows[0] || { name: 'יריב אנונימי' };
    // Compute fresh lifetime XP for both.
    const [myXp, rivalXp] = await Promise.all([
      _computeLifetimeXp(deviceId),
      _computeLifetimeXp(rivalry.rival_device_id)
    ]);
    const delta = myXp - rivalXp;  // positive = I'm ahead
    // Auto-mark as viewed.
    if (!rivalry.viewed_by_player) {
      await pool.query(
        `UPDATE player_rivalries SET viewed_by_player = TRUE WHERE id = $1`,
        [rivalry.id]
      ).catch(() => {});
    }
    res.json({
      ok: true,
      enabled: true,
      rivalry: {
        id: rivalry.id,
        rivalName: rivalProfile.name,
        rivalCountry: rivalProfile.country,
        rivalCode: rivalProfile.player_code,
        myXp,
        rivalXp,
        delta,
        myXpAtDecl: Number(rivalry.my_xp_at_decl) || 0,
        rivalXpAtDecl: Number(rivalry.rival_xp_at_decl) || 0,
        xpGainSinceDecl: myXp - (Number(rivalry.my_xp_at_decl) || 0),
        rivalXpGainSinceDecl: rivalXp - (Number(rivalry.rival_xp_at_decl) || 0),
        declaredAt: rivalry.declared_at,
        expiresAt: rivalry.expires_at,
        msUntilExpiry: Math.max(0, new Date(rivalry.expires_at).getTime() - Date.now()),
        isNew: !rivalry.viewed_by_player
      },
      winReward: parseInt(cfg.rival_win_reward_gems || '150', 10) || 150
    });
  } catch (e) {
    console.error('GET /api/rival/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Auto-resolve expired or completed rivalries. Called from client on
// home mount or game-over. Server-side check is the source of truth.
app.post('/api/rival/resolve', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('rival_resolve', deviceId, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadRivalConfig();
    const winReward = parseInt(cfg.rival_win_reward_gems || '150', 10) || 150;
    // Find unresolved rivalries for this device.
    const r = await pool.query(
      `SELECT id, rival_device_id, my_xp_at_decl, rival_xp_at_decl, expires_at
         FROM player_rivalries
        WHERE device_id = $1 AND resolved = FALSE`,
      [deviceId]
    );
    let resolved = [];
    for (const row of r.rows) {
      const expired = new Date(row.expires_at).getTime() < Date.now();
      const myXp = await _computeLifetimeXp(deviceId);
      const rivalXp = await _computeLifetimeXp(row.rival_device_id);
      const myGain = myXp - (Number(row.my_xp_at_decl) || 0);
      const rivalGain = rivalXp - (Number(row.rival_xp_at_decl) || 0);
      let outcome = null;
      let rewardGranted = 0;
      if (expired) {
        // Pick winner by XP gain since declaration.
        if (myGain > rivalGain) outcome = 'won';
        else if (myGain < rivalGain) outcome = 'lost';
        else outcome = 'tied';
      } else {
        // Early-resolve only if I OVERTOOK my rival (myXp > rivalXp + 0 buffer
        // AND I gained more than they did). This rewards proactive play.
        if (myGain > rivalGain && myGain >= 200) {
          outcome = 'won';
        }
      }
      if (!outcome) continue;
      // Atomic: mark resolved + grant reward if won.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE player_rivalries SET resolved = TRUE, outcome = $1, resolved_at = NOW()
            WHERE id = $2 AND resolved = FALSE`,
          [outcome, row.id]
        );
        if (outcome === 'won') {
          await client.query(
            `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
              WHERE device_id = $2`,
            [winReward, deviceId]
          );
          rewardGranted = winReward;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      resolved.push({ id: row.id, outcome, rewardGranted });
    }
    res.json({ ok: true, resolved });
  } catch (e) {
    console.error('POST /api/rival/resolve', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Stage 34 — Weekly Leagues
// 5 tiers based on lifetime XP gained THIS week. Reset every Sunday.
// Brawl Stars pattern: week-over-week competitive structure.
// ============================================================
async function _loadLeagueConfig() {
  try {
    const r = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'league_%'`);
    const out = {};
    r.rows.forEach(row => { out[row.key] = row.value; });
    return out;
  } catch (e) { return {}; }
}

// Asia/Jerusalem week-start (Sunday) as YYYY-MM-DD.
function _currentWeekStartISO() {
  const israelNowStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
  const d = new Date(israelNowStr);
  // Sunday = 0 in JS. Roll back to most-recent Sunday.
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function _leagueForGain(gain, cfg) {
  // Tiers: bronze < silver < gold < diamond < master
  const thrSilver  = parseInt(cfg.league_threshold_silver  || '500',   10) || 500;
  const thrGold    = parseInt(cfg.league_threshold_gold    || '2000',  10) || 2000;
  const thrDiamond = parseInt(cfg.league_threshold_diamond || '10000', 10) || 10000;
  const thrMaster  = parseInt(cfg.league_threshold_master  || '50000', 10) || 50000;
  if (gain >= thrMaster)  return { id: 'master',   emoji: '👑', label: 'Master',   color: '#A855F7' };
  if (gain >= thrDiamond) return { id: 'diamond',  emoji: '💎', label: 'Diamond',  color: '#3B82F6' };
  if (gain >= thrGold)    return { id: 'gold',     emoji: '🥇', label: 'Gold',     color: '#F59E0B' };
  if (gain >= thrSilver)  return { id: 'silver',   emoji: '🥈', label: 'Silver',   color: '#94A3B8' };
  return { id: 'bronze', emoji: '🥉', label: 'Bronze', color: '#B45309' };
}

function _nextLeagueThreshold(gain, cfg) {
  // Returns the gap to the next tier, or null if at Master.
  const thrSilver  = parseInt(cfg.league_threshold_silver  || '500',   10) || 500;
  const thrGold    = parseInt(cfg.league_threshold_gold    || '2000',  10) || 2000;
  const thrDiamond = parseInt(cfg.league_threshold_diamond || '10000', 10) || 10000;
  const thrMaster  = parseInt(cfg.league_threshold_master  || '50000', 10) || 50000;
  if (gain < thrSilver)  return { target: thrSilver,  gap: thrSilver - gain,   tier: 'silver' };
  if (gain < thrGold)    return { target: thrGold,    gap: thrGold - gain,     tier: 'gold' };
  if (gain < thrDiamond) return { target: thrDiamond, gap: thrDiamond - gain,  tier: 'diamond' };
  if (gain < thrMaster)  return { target: thrMaster,  gap: thrMaster - gain,   tier: 'master' };
  return null;
}

app.get('/api/league/state', async (req, res) => {
  try {
    const cfg = await _loadLeagueConfig();
    if (cfg.league_enabled === 'false') return res.json({ ok: true, enabled: false });
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.json({ ok: true, enabled: true, needsDevice: true });
    const weekStart = _currentWeekStartISO();
    const currentXp = await _computeLifetimeXp(deviceId);
    // Get-or-insert the week's snapshot. If first time this week, snapshot
    // = current XP (so this week's gain starts at 0).
    await pool.query(
      `INSERT INTO player_weekly_xp (device_id, week_start, xp_at_week_start)
           VALUES ($1, $2::date, $3)
       ON CONFLICT (device_id, week_start) DO NOTHING`,
      [deviceId, weekStart, currentXp]
    );
    const stateR = await pool.query(
      `SELECT xp_at_week_start, best_league_seen, reward_claimed
         FROM player_weekly_xp
        WHERE device_id = $1 AND week_start = $2::date`,
      [deviceId, weekStart]
    );
    const state = stateR.rows[0] || { xp_at_week_start: currentXp };
    const weeklyGain = Math.max(0, currentXp - (Number(state.xp_at_week_start) || 0));
    const league = _leagueForGain(weeklyGain, cfg);
    const next = _nextLeagueThreshold(weeklyGain, cfg);
    // Save best_league_seen if upgraded.
    const tierOrder = ['bronze', 'silver', 'gold', 'diamond', 'master'];
    const currentIdx = tierOrder.indexOf(league.id);
    const bestIdx = state.best_league_seen ? tierOrder.indexOf(state.best_league_seen) : -1;
    let leveledUp = false;
    if (currentIdx > bestIdx) {
      leveledUp = true;
      await pool.query(
        `UPDATE player_weekly_xp SET best_league_seen = $1
          WHERE device_id = $2 AND week_start = $3::date`,
        [league.id, deviceId, weekStart]
      );
    }
    // Reward — looks at LAST week's snapshot (if there is one), unclaimed.
    const prevWeekStart = (function() {
      const d = new Date(weekStart);
      d.setDate(d.getDate() - 7);
      return d.toISOString().slice(0, 10);
    })();
    const lastWeekR = await pool.query(
      `SELECT best_league_seen, reward_claimed, xp_at_week_start
         FROM player_weekly_xp
        WHERE device_id = $1 AND week_start = $2::date`,
      [deviceId, prevWeekStart]
    );
    let unclaimedReward = null;
    if (lastWeekR.rows[0] && !lastWeekR.rows[0].reward_claimed) {
      const lastTier = lastWeekR.rows[0].best_league_seen || 'bronze';
      const rewardKey = 'league_reward_' + lastTier + '_gems';
      const rewardAmt = parseInt(cfg[rewardKey] || '50', 10) || 50;
      unclaimedReward = { tier: lastTier, gems: rewardAmt };
    }
    res.json({
      ok: true,
      enabled: true,
      weekStart,
      weeklyGain,
      league,
      next,
      progressPct: next ? Math.min(100, Math.round((1 - next.gap / (next.target - (currentIdx > 0 ? parseInt(cfg['league_threshold_' + tierOrder[currentIdx]] || '0', 10) || 0 : 0))) * 100)) : 100,
      leveledUp,
      unclaimedReward
    });
  } catch (e) {
    console.error('GET /api/league/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/league/claim', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('league_claim', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadLeagueConfig();
    if (cfg.league_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const weekStart = _currentWeekStartISO();
    const prevWeekStart = (function() {
      const d = new Date(weekStart);
      d.setDate(d.getDate() - 7);
      return d.toISOString().slice(0, 10);
    })();
    // Look up last week's row.
    const lastR = await pool.query(
      `SELECT best_league_seen, reward_claimed
         FROM player_weekly_xp
        WHERE device_id = $1 AND week_start = $2::date`,
      [deviceId, prevWeekStart]
    );
    if (!lastR.rows[0]) return res.json({ ok: false, reason: 'no_last_week' });
    if (lastR.rows[0].reward_claimed) return res.json({ ok: false, reason: 'already_claimed' });
    const tier = lastR.rows[0].best_league_seen || 'bronze';
    const rewardKey = 'league_reward_' + tier + '_gems';
    const rewardAmt = parseInt(cfg[rewardKey] || '50', 10) || 50;
    // Atomic: mark claimed + credit.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query(
        `UPDATE player_weekly_xp SET reward_claimed = TRUE
          WHERE device_id = $1 AND week_start = $2::date AND reward_claimed = FALSE
          RETURNING device_id`,
        [deviceId, prevWeekStart]
      );
      if (!upd.rows[0]) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'race_already_claimed' });
      }
      const credit = await client.query(
        `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2 RETURNING balance`,
        [rewardAmt, deviceId]
      );
      await client.query('COMMIT');
      res.json({ ok: true, tier, reward: rewardAmt, newBalance: credit.rows[0] ? Number(credit.rows[0].balance) : null });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/league/claim', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Daily Spin Wheel — stage 36 (May 2026)
//
// One spin per device per day. Server rolls the wheel + grants
// atomically. Streak (consecutive days spun) multiplies gem
// rewards up to a cap. The wheel has 12 admin-tunable segments.
// Anti-cheat: server picks the segment, never trusts client.
// ============================================================
async function _loadSpinConfig() {
  // Pulls the master toggle + bonus settings + all 12 segment definitions.
  const r = await pool.query(
    `SELECT key, value FROM game_config WHERE key LIKE 'daily_spin_%'`
  );
  const cfg = {};
  for (const row of r.rows) cfg[row.key] = row.value;
  return cfg;
}

function _spinSegments(cfg) {
  const segs = [];
  for (let i = 1; i <= 12; i++) {
    const label  = cfg['daily_spin_seg_' + i + '_label'];
    const emoji  = cfg['daily_spin_seg_' + i + '_emoji'];
    const type   = cfg['daily_spin_seg_' + i + '_type'];
    const amount = parseFloat(cfg['daily_spin_seg_' + i + '_amount']) || 0;
    const weight = parseFloat(cfg['daily_spin_seg_' + i + '_weight']) || 0;
    const color  = cfg['daily_spin_seg_' + i + '_color'];
    if (!label || !type || weight <= 0) continue;
    segs.push({ index: i, label, emoji, type, amount, weight, color });
  }
  return segs;
}

function _spinPickSegment(segs) {
  // Weighted random pick.
  const total = segs.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const s of segs) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return segs[segs.length - 1];
}

function _spinTodayISO() {
  // Asia/Jerusalem date string.
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const jeru = new Date(utc + 3 * 3600000);
  return jeru.toISOString().slice(0, 10);
}

function _spinYesterdayISO() {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const jeru = new Date(utc + 3 * 3600000);
  jeru.setUTCDate(jeru.getUTCDate() - 1);
  return jeru.toISOString().slice(0, 10);
}

app.get('/api/spin/state', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').slice(0, 64);
    if (deviceId.length < 8) return res.status(400).json({ error: 'bad_device' });
    const cfg = await _loadSpinConfig();
    if (cfg.daily_spin_enabled === 'false') return res.json({ ok: true, enabled: false });
    const segs = _spinSegments(cfg);
    const r = await pool.query(
      `SELECT last_spin_date, current_streak, longest_streak, total_spins, total_gems_won, last_reward
         FROM daily_spin_state WHERE device_id = $1`,
      [deviceId]
    );
    const today = _spinTodayISO();
    let row = r.rows[0] || { last_spin_date: null, current_streak: 0, longest_streak: 0, total_spins: 0, total_gems_won: 0, last_reward: null };
    const lastDateStr = row.last_spin_date ? new Date(row.last_spin_date).toISOString().slice(0, 10) : null;
    const canSpin = !lastDateStr || lastDateStr !== today;
    res.json({
      ok: true,
      enabled: true,
      canSpin,
      lastSpinDate: lastDateStr,
      currentStreak: row.current_streak || 0,
      longestStreak: row.longest_streak || 0,
      totalSpins: row.total_spins || 0,
      totalGemsWon: Number(row.total_gems_won || 0),
      lastReward: row.last_reward || null,
      segments: segs.map(function(s) { return { index: s.index, label: s.label, emoji: s.emoji, type: s.type, amount: s.amount, color: s.color, weight: s.weight }; }),
      streakBonusPct: parseInt(cfg.daily_spin_streak_bonus_pct || '10', 10),
      streakBonusMaxPct: parseInt(cfg.daily_spin_streak_max_pct || '200', 10)
    });
  } catch (e) {
    console.error('GET /api/spin/state', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/spin/today', requireDeviceAuth, async (req, res) => {
  try {
    const deviceId = req.deviceId;
    if (!checkRateLimit('spin_today', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await _loadSpinConfig();
    if (cfg.daily_spin_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const segs = _spinSegments(cfg);
    if (!segs.length) return res.json({ ok: false, reason: 'no_segments' });

    const today = _spinTodayISO();
    const yesterday = _spinYesterdayISO();
    const bonusPct = parseInt(cfg.daily_spin_streak_bonus_pct || '10', 10);
    const bonusMaxPct = parseInt(cfg.daily_spin_streak_max_pct || '200', 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lazy-insert state row.
      const sr = await client.query(
        `INSERT INTO daily_spin_state (device_id, last_spin_date, current_streak, longest_streak, total_spins, total_gems_won)
         VALUES ($1, NULL, 0, 0, 0, 0)
         ON CONFLICT (device_id) DO NOTHING
         RETURNING device_id`,
        [deviceId]
      );
      // Lock the row for the rest of the txn.
      const st = await client.query(
        `SELECT last_spin_date, current_streak, longest_streak, total_spins, total_gems_won
           FROM daily_spin_state WHERE device_id = $1 FOR UPDATE`,
        [deviceId]
      );
      const cur = st.rows[0];
      const lastDateStr = cur.last_spin_date ? new Date(cur.last_spin_date).toISOString().slice(0, 10) : null;
      if (lastDateStr === today) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, reason: 'already_spun_today' });
      }
      // Streak: continued (yesterday) or reset (anything else).
      let newStreak;
      if (lastDateStr === yesterday) newStreak = (cur.current_streak || 0) + 1;
      else newStreak = 1;
      const newLongest = Math.max(cur.longest_streak || 0, newStreak);
      // Roll a segment.
      const picked = _spinPickSegment(segs);
      // Streak bonus only applies to gem-type rewards.
      const streakBonusPct = Math.min((newStreak - 1) * bonusPct, bonusMaxPct);
      let finalAmount = picked.amount;
      if (picked.type === 'gems' || picked.type === 'jackpot') {
        finalAmount = Math.round(picked.amount * (1 + streakBonusPct / 100));
      }
      // Grant the reward.
      let granted = { type: picked.type, amount: finalAmount, segment: picked.index, label: picked.label, emoji: picked.emoji, color: picked.color, streakBonusPct };
      let newBalance = null;
      if (picked.type === 'gems' || picked.type === 'jackpot') {
        const cr = await client.query(
          `UPDATE player_profiles
             SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
           WHERE device_id = $2
           RETURNING balance`,
          [finalAmount, deviceId]
        );
        newBalance = cr.rows[0] ? Number(cr.rows[0].balance) : null;
      } else if (picked.type === 'bp_xp') {
        // Pump BP XP via existing season_pass tile-advance mechanic.
        // For simplicity: bump player_season_progress.xp by finalAmount.
        await client.query(
          `INSERT INTO player_season_progress (device_id, season_id, xp, claimed_tiers, recent_game_ids)
             VALUES ($1, COALESCE((SELECT value FROM game_config WHERE key='season_id'), 's1'), $2, '[]'::jsonb, '[]'::jsonb)
             ON CONFLICT (device_id, season_id) DO UPDATE SET xp = player_season_progress.xp + EXCLUDED.xp`,
          [deviceId, finalAmount]
        );
      } else if (picked.type === 'freeze') {
        // Bump streak-freeze count. Server doesn't track freezes directly —
        // they live in localStorage on the client. We pass back the amount
        // and the client increments its own counter.
        // (No server-side counter to update.)
      } else if (picked.type === 'chest') {
        // We grant a "bonus chest" gem-equivalent (gachas/chests aren't a
        // pure server table). For v1, simply credit the average chest value.
        const chestAvg = parseInt(cfg.dyn_chest_uncommon_max || '30', 10);
        const cr = await client.query(
          `UPDATE player_profiles
             SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
           WHERE device_id = $2
           RETURNING balance`,
          [chestAvg, deviceId]
        );
        granted.amount = chestAvg;
        granted.type = 'gems';
        granted.note = 'chest_equiv';
        newBalance = cr.rows[0] ? Number(cr.rows[0].balance) : null;
      }
      // Update state.
      const gemDelta = (granted.type === 'gems' || granted.type === 'jackpot') ? granted.amount : 0;
      await client.query(
        `UPDATE daily_spin_state
           SET last_spin_date = $2::date,
               current_streak = $3,
               longest_streak = $4,
               total_spins    = total_spins + 1,
               total_gems_won = total_gems_won + $5,
               last_reward    = $6::jsonb,
               last_spin_at   = NOW()
         WHERE device_id = $1`,
        [deviceId, today, newStreak, newLongest, gemDelta, JSON.stringify(granted)]
      );
      await client.query('COMMIT');
      res.json({
        ok: true,
        reward: granted,
        currentStreak: newStreak,
        longestStreak: newLongest,
        newBalance
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('POST /api/spin/today', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Live Tournaments — stage 12 (May 2026)
//
// Scheduled prime-time events with a fixed window + top-N prize
// pool. Any dynamic-board game played within the window submits
// the player's BEST score. After end_at, the next fetch of
// /tournaments lazily finalizes — top-N receive their prize, the
// row's status flips to 'finalized'. No cron needed.
//
// Anti-cheat: best-score-wins upsert (same as daily_scores), drops
// validation, server-side rank computation at finalize time.
// ============================================================
async function maybeFinalizeTournament(tournamentId) {
  // Lazy-finalize a tournament whose ends_at has passed. Idempotent —
  // safe to call multiple times. Top-N players have their prizes
  // credited to balance + recorded in tournament_scores.prize_claimed.
  try {
    const t = await pool.query(
      `SELECT id, prize_pool, status, ends_at FROM tournaments WHERE id = $1`,
      [tournamentId]
    );
    if (!t.rows.length) return false;
    const row = t.rows[0];
    if (row.status === 'finalized') return true;
    if (new Date(row.ends_at) > new Date()) return false;
    const pool_ = Array.isArray(row.prize_pool) ? row.prize_pool : [];
    if (!pool_.length) {
      await pool.query(`UPDATE tournaments SET status = 'finalized', finalized_at = NOW() WHERE id = $1`, [tournamentId]);
      return true;
    }
    // Order top players by score desc. Tie-breaker: earliest score wins
    // (rewards consistency, not late-game catch-up).
    const lb = await pool.query(
      `SELECT device_id, score, updated_at
         FROM tournament_scores
        WHERE tournament_id = $1
          AND (prize_claimed IS NULL)
        ORDER BY score DESC, updated_at ASC
        LIMIT $2`,
      [tournamentId, pool_.length]
    );
    // Credit each top-N player.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < lb.rows.length; i++) {
        const player = lb.rows[i];
        const tier = pool_[i] || {};
        const reward = parseInt(tier.reward, 10) || 0;
        if (reward <= 0) continue;
        await client.query(
          `UPDATE tournament_scores SET prize_claimed = $1 WHERE tournament_id = $2 AND device_id = $3`,
          [reward, tournamentId, player.device_id]
        );
        await client.query(
          `UPDATE player_profiles
              SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
            WHERE device_id = $2`,
          [reward, player.device_id]
        );
        // Push notification to the winner.
        if (typeof sendPushToDevice === 'function') {
          sendPushToDevice(player.device_id, {
            title: '🏆 זכית בטורניר!',
            body: 'מקום ' + (i + 1) + ' · ' + reward + '💎 נכנסו לחשבון',
            tag: 'tournament-prize-' + tournamentId,
            data: { url: '/' }
          }).catch(function() {});
        }
      }
      await client.query(
        `UPDATE tournaments SET status = 'finalized', finalized_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [tournamentId]
      );
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('maybeFinalizeTournament', tournamentId, e.message);
    return false;
  }
}

// GET /api/tournaments — lists active + upcoming + recent.
// Lazily finalizes any that ended without being finalized yet.
app.get('/api/tournaments', async (req, res) => {
  try {
    const cfg = await pool.query(`SELECT value FROM game_config WHERE key = 'tournament_enabled'`);
    if (cfg.rows[0] && cfg.rows[0].value === 'false') {
      return res.json({ ok: true, enabled: false, tournaments: [] });
    }
    // Pull tournaments that are live OR upcoming OR ended within the last 7 days.
    const r = await pool.query(
      `SELECT id, name, description, starts_at, ends_at, prize_pool, status, finalized_at
         FROM tournaments
        WHERE ends_at >= NOW() - INTERVAL '7 days'
        ORDER BY starts_at ASC
        LIMIT 25`
    );
    // Lazy-finalize any that ended but aren't marked finalized yet.
    const toFinalize = r.rows.filter(t => new Date(t.ends_at) <= new Date() && t.status !== 'finalized');
    for (const t of toFinalize) {
      await maybeFinalizeTournament(t.id);
    }
    // Re-fetch if anything was finalized.
    let rows = r.rows;
    if (toFinalize.length) {
      const r2 = await pool.query(
        `SELECT id, name, description, starts_at, ends_at, prize_pool, status, finalized_at
           FROM tournaments
          WHERE ends_at >= NOW() - INTERVAL '7 days'
          ORDER BY starts_at ASC
          LIMIT 25`
      );
      rows = r2.rows;
    }
    // Derive a normalised state label for the client.
    const enriched = rows.map(t => ({
      ...t,
      isLive:    new Date(t.starts_at) <= new Date() && new Date(t.ends_at) > new Date(),
      isUpcoming: new Date(t.starts_at) > new Date(),
      isEnded:   new Date(t.ends_at) <= new Date()
    }));
    res.json({ ok: true, enabled: true, tournaments: enriched });
  } catch (e) {
    console.error('GET /api/tournaments', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

// GET /api/tournaments/:id/leaderboard — top 50 + my rank.
app.get('/api/tournaments/:id/leaderboard', async (req, res) => {
  try {
    const tid = parseInt(req.params.id, 10);
    if (!Number.isFinite(tid)) return res.status(400).json({ error: 'bad_id' });
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    const t = await pool.query(`SELECT id, name, ends_at FROM tournaments WHERE id = $1`, [tid]);
    if (!t.rows.length) return res.status(404).json({ error: 'not_found' });
    const top = await pool.query(
      `SELECT device_id, name, score, tier, country, games_played, prize_claimed
         FROM tournament_scores
        WHERE tournament_id = $1
        ORDER BY score DESC, updated_at ASC
        LIMIT 50`,
      [tid]
    );
    let myRank = null, myScore = 0;
    if (deviceId) {
      try {
        const m = await pool.query(
          `SELECT score, (1 + (SELECT COUNT(*) FROM tournament_scores
                              WHERE tournament_id = $1 AND score > ts.score)) AS rank
             FROM tournament_scores ts
            WHERE tournament_id = $1 AND device_id = $2`,
          [tid, deviceId]
        );
        if (m.rows[0]) { myScore = Number(m.rows[0].score) || 0; myRank = Number(m.rows[0].rank) || null; }
      } catch (e) {}
    }
    const totalRow = await pool.query(`SELECT COUNT(*)::int AS c FROM tournament_scores WHERE tournament_id = $1`, [tid]);
    res.json({
      ok: true,
      tournament: t.rows[0],
      list: top.rows.map(r => ({
        name: r.name, score: r.score, tier: r.tier, country: r.country,
        games: r.games_played, prizeClaimed: r.prize_claimed,
        you: deviceId && r.device_id === deviceId
      })),
      total: (totalRow.rows[0] && totalRow.rows[0].c) || 0,
      myRank, myScore
    });
  } catch (e) {
    console.error('GET /api/tournaments/:id/leaderboard', e);
    res.status(500).json({ error: 'internal' });
  }
});

// POST /api/tournaments/:id/score — submit a dynamic-board game score.
// Best-score-wins upsert (mirroring the daily_scores pattern).
// Window-enforced: rejects scores outside the [starts_at, ends_at) window.
app.post('/api/tournaments/:id/score', requireDeviceAuth, async (req, res) => {
  try {
    const tid = parseInt(req.params.id, 10);
    if (!Number.isFinite(tid)) return res.status(400).json({ error: 'bad_id' });
    const { deviceId, name, score, tier, drops, country } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      return res.status(400).json({ error: 'bad_device' });
    }
    if (!checkRateLimit('tournament_score', deviceId, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const s = parseInt(score, 10);
    if (!Number.isFinite(s) || s < 0 || s > 10_000_000) return res.status(400).json({ error: 'bad_score' });
    const t = parseInt(tier, 10);
    if (!Number.isFinite(t) || t < 1 || t > 8) return res.status(400).json({ error: 'bad_tier' });
    const dropsN = typeof drops === 'number' && Number.isFinite(drops) && drops >= 0 ? Math.floor(drops) : null;
    if (dropsN === null) return res.status(400).json({ error: 'missing_drops' });
    if (challengeDropsImplausible(s, dropsN)) {
      console.warn(`[anti-cheat] tournament score rejected: device=${deviceId} tournament=${tid} score=${s} drops=${dropsN}`);
      return res.status(400).json({ error: 'implausible_score' });
    }
    // Verify tournament window.
    const tour = await pool.query(
      `SELECT starts_at, ends_at, status FROM tournaments WHERE id = $1`, [tid]
    );
    if (!tour.rows.length) return res.status(404).json({ error: 'not_found' });
    const now = new Date();
    const startsAt = new Date(tour.rows[0].starts_at);
    const endsAt = new Date(tour.rows[0].ends_at);
    if (now < startsAt) return res.json({ ok: false, reason: 'not_started' });
    if (now >= endsAt) return res.json({ ok: false, reason: 'ended' });
    const safeName = cleanName(name);
    const safeCountry = cleanCountry(country);
    await pool.query(
      `INSERT INTO tournament_scores (tournament_id, device_id, name, score, tier, country, games_played)
       VALUES ($1, $2, $3, $4, $5, $6, 1)
       ON CONFLICT (tournament_id, device_id) DO UPDATE
         SET name = EXCLUDED.name,
             score = GREATEST(tournament_scores.score, EXCLUDED.score),
             tier  = CASE WHEN EXCLUDED.score > tournament_scores.score THEN EXCLUDED.tier ELSE tournament_scores.tier END,
             country = COALESCE(EXCLUDED.country, tournament_scores.country),
             games_played = tournament_scores.games_played + 1,
             updated_at = NOW()`,
      [tid, deviceId, safeName, s, t, safeCountry]
    );
    // Mark the tournament 'live' if it was still 'scheduled'.
    if (tour.rows[0].status === 'scheduled') {
      await pool.query(`UPDATE tournaments SET status = 'live', updated_at = NOW() WHERE id = $1`, [tid]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/tournaments/:id/score', e);
    res.status(500).json({ error: 'internal' });
  }
});

// ============================================================
// Friends Invite + Shared Streak — stage 13 (May 2026)
//
// Viral acquisition + recurring social retention. A invites B via
// WhatsApp/native share (URL contains ?ref=BLOOM-XXXX). When B
// opens the URL or pastes the code, the server pairs the devices,
// gives both a one-time signup bonus, and starts tracking shared-
// play days. Every day BOTH play a dynamic game → both get a
// recurring bonus.
//
// Anti-abuse:
// - Can't friend yourself.
// - Each device has a hard cap (friends_max_per_device).
// - Signup bonus is one-time per friendship (bonus_paid flag).
// - Shared-day bonus is once per (a, b, date) tuple.
// - Friendships are stored symmetrically (device_a < device_b lex).
// ============================================================
function orderDevicePair(d1, d2) {
  return d1 < d2 ? [d1, d2] : [d2, d1];
}

// Resolve a BLOOM-XXXX code to a device_id.
async function resolveDeviceFromCode(code) {
  if (typeof code !== 'string') return null;
  const clean = code.toUpperCase().replace(/^BLOOM-?/, '').replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!clean) return null;
  try {
    const r = await pool.query(
      `SELECT device_id FROM player_profiles WHERE player_code = $1 OR player_code = $2`,
      [clean, 'BLOOM-' + clean]
    );
    return r.rows[0] ? r.rows[0].device_id : null;
  } catch (e) { return null; }
}

// POST /api/friends/invite — body: { deviceId, friendCode } OR { deviceId, friendDeviceId }
// Pairs the two devices + grants the signup bonus to BOTH (once).
app.post('/api/friends/invite', requireDeviceAuth, async (req, res) => {
  try {
    const { deviceId, friendCode, friendDeviceId } = req.body || {};
    if (typeof deviceId !== 'string' || deviceId.length < 8) return res.status(400).json({ error: 'bad_device' });
    if (!checkRateLimit('friends_invite', deviceId, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const cfg = await pool.query(`SELECT key, value FROM game_config WHERE key LIKE 'friends_%'`);
    const cfgMap = {};
    cfg.rows.forEach(r => { cfgMap[r.key] = r.value; });
    if (cfgMap.friends_enabled === 'false') return res.json({ ok: false, reason: 'disabled' });
    const signupBonus = parseInt(cfgMap.friends_signup_bonus, 10) || 200;
    const maxFriends = parseInt(cfgMap.friends_max_per_device, 10) || 50;
    // Resolve target device.
    let targetDevice = friendDeviceId;
    if (!targetDevice && friendCode) {
      targetDevice = await resolveDeviceFromCode(friendCode);
    }
    if (!targetDevice) return res.json({ ok: false, reason: 'friend_not_found' });
    if (targetDevice === deviceId) return res.json({ ok: false, reason: 'cant_self_friend' });
    // Verify both devices exist as profiles.
    const both = await pool.query(
      `SELECT device_id FROM player_profiles WHERE device_id = ANY($1::text[])`,
      [[deviceId, targetDevice]]
    );
    if (both.rows.length < 2) return res.json({ ok: false, reason: 'profile_missing' });
    // Check both devices' friend counts.
    const myCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM friendships WHERE device_a = $1 OR device_b = $1`,
      [deviceId]
    );
    if ((myCount.rows[0].c || 0) >= maxFriends) {
      return res.json({ ok: false, reason: 'max_friends_reached', cap: maxFriends });
    }
    const [a, b] = orderDevicePair(deviceId, targetDevice);
    // Idempotent insert. If already exists, return ok with no bonus.
    const existing = await pool.query(
      `SELECT bonus_paid FROM friendships WHERE device_a = $1 AND device_b = $2`,
      [a, b]
    );
    if (existing.rows.length) {
      return res.json({ ok: true, alreadyFriends: true, bonusPaid: existing.rows[0].bonus_paid });
    }
    // Insert + grant bonus in a transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO friendships (device_a, device_b, initiator, bonus_paid) VALUES ($1, $2, $3, true)`,
        [a, b, deviceId]
      );
      // Credit both.
      await client.query(
        `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2`,
        [signupBonus, a]
      );
      await client.query(
        `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
          WHERE device_id = $2`,
        [signupBonus, b]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    // Push notification to the friend (B) that A added them.
    if (typeof sendPushToDevice === 'function') {
      const inviterDevice = deviceId === a ? a : b;
      const inviteeDevice = inviterDevice === a ? b : a;
      const inviterName = await pool.query(
        `SELECT display_name FROM player_profiles WHERE device_id = $1`, [inviterDevice]);
      const friendName = (inviterName.rows[0] && inviterName.rows[0].display_name) || 'חבר חדש';
      sendPushToDevice(inviteeDevice, {
        title: '👥 חבר חדש הצטרף!',
        body: friendName + ' הוסיף אותך — שניכם קיבלתם ' + signupBonus + '💎',
        tag: 'friend-added',
        data: { url: '/' }
      }).catch(function() {});
    }
    res.json({ ok: true, signupBonus });
  } catch (e) {
    console.error('POST /api/friends/invite', e);
    res.status(500).json({ error: 'internal' });
  }
});

// GET /api/friends/list?deviceId= — list of friends + their last-played-dyn date.
app.get('/api/friends/list', async (req, res) => {
  try {
    const deviceId = (req.query.deviceId || '').toString().slice(0, 64);
    if (!deviceId || deviceId.length < 8) return res.status(400).json({ error: 'bad_device' });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const r = await pool.query(
      `SELECT
         f.device_a, f.device_b, f.created_at,
         CASE WHEN f.device_a = $1 THEN pb.display_name ELSE pa.display_name END AS friend_name,
         CASE WHEN f.device_a = $1 THEN pb.player_code  ELSE pa.player_code  END AS friend_code,
         CASE WHEN f.device_a = $1 THEN f.device_b ELSE f.device_a END AS friend_device,
         CASE WHEN f.device_a = $1 THEN ab.date     ELSE aa.date     END AS friend_last_active
       FROM friendships f
       LEFT JOIN player_profiles pa ON pa.device_id = f.device_a
       LEFT JOIN player_profiles pb ON pb.device_id = f.device_b
       LEFT JOIN player_daily_dyn_activity aa ON aa.device_id = f.device_a AND aa.date = $2
       LEFT JOIN player_daily_dyn_activity ab ON ab.device_id = f.device_b AND ab.date = $2
       WHERE f.device_a = $1 OR f.device_b = $1
       ORDER BY f.created_at DESC
       LIMIT 100`,
      [deviceId, today]
    );
    // Did *I* play today? (Affects the "shared today?" pill.)
    const myAct = await pool.query(
      `SELECT 1 FROM player_daily_dyn_activity WHERE device_id = $1 AND date = $2`,
      [deviceId, today]
    );
    const iPlayedToday = myAct.rows.length > 0;
    res.json({
      ok: true,
      iPlayedToday,
      friends: r.rows.map(row => ({
        deviceId: row.friend_device,
        name: row.friend_name || 'אנונימי',
        code: row.friend_code ? ('BLOOM-' + row.friend_code) : null,
        playedToday: !!row.friend_last_active,
        createdAt: row.created_at
      }))
    });
  } catch (e) {
    console.error('GET /api/friends/list', e);
    res.status(500).json({ error: 'internal' });
  }
});

// Helper called from dynamic game-over: records that this device played a
// dynamic game today AND triggers the shared-day bonus for every friend
// who has ALSO played today (one-time per (a, b, date)).
async function recordDynActivityAndPayShared(deviceId) {
  try {
    const cfg = await pool.query(
      `SELECT value FROM game_config WHERE key IN ('friends_enabled', 'friends_shared_day_bonus')`
    );
    const cfgMap = {};
    cfg.rows.forEach(r => { cfgMap[r.key] = r.value; });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    // Always upsert activity (independent of friends feature toggle).
    await pool.query(
      `INSERT INTO player_daily_dyn_activity (device_id, date, game_count) VALUES ($1, $2, 1)
       ON CONFLICT (device_id, date) DO UPDATE
         SET game_count = player_daily_dyn_activity.game_count + 1`,
      [deviceId, today]
    );
    if (cfgMap.friends_enabled === 'false') return;
    const sharedBonus = parseInt(cfgMap.friends_shared_day_bonus, 10) || 100;
    // Find every friend who played today AND we haven't paid the shared
    // bonus for the (us, friend, today) tuple yet.
    const candidates = await pool.query(
      `SELECT f.device_a, f.device_b,
              CASE WHEN f.device_a = $1 THEN f.device_b ELSE f.device_a END AS friend_device
         FROM friendships f
        WHERE (f.device_a = $1 OR f.device_b = $1)
          AND EXISTS (
            SELECT 1 FROM player_daily_dyn_activity a
             WHERE a.date = $2
               AND a.device_id = CASE WHEN f.device_a = $1 THEN f.device_b ELSE f.device_a END
          )
          AND NOT EXISTS (
            SELECT 1 FROM friendship_shared_days sd
             WHERE sd.device_a = f.device_a AND sd.device_b = f.device_b AND sd.date = $2
          )`,
      [deviceId, today]
    );
    for (const row of candidates.rows) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Mark this shared day so we don't double-pay.
        await client.query(
          `INSERT INTO friendship_shared_days (device_a, device_b, date) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [row.device_a, row.device_b, today]
        );
        // Pay both.
        await client.query(
          `UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
            WHERE device_id = ANY($2::text[])`,
          [sharedBonus, [row.device_a, row.device_b]]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.warn('shared-day bonus failed for pair', row.device_a, row.device_b, err.message);
      } finally {
        client.release();
      }
    }
  } catch (e) {
    console.error('recordDynActivityAndPayShared', e.message);
  }
}

// Hook the activity recorder into the existing dynamic-board score
// submission. Don't expose a separate endpoint — it's a server-side
// concern triggered by the existing /api/boards/:id/score flow below.
// (We patch that endpoint to also call recordDynActivityAndPayShared.)

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

  // ============================================================
  // Dynamic Boards admin CRUD. Every mutating route writes to
  // admin_actions and invalidates the public /api/active-board cache.
  // ============================================================
  adminRouter.get('/api/boards', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, name, type, definition, is_active, starts_at, ends_at,
                target_audience, priority, applies_to, created_at, updated_at
           FROM board_configurations
          ORDER BY is_active DESC, priority DESC, id DESC`
      );
      res.json({ ok: true, boards: r.rows });
    } catch (e) {
      console.error('admin GET /boards', e);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.post('/api/boards', async (req, res) => {
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim().slice(0, 80);
      const type = String(b.type || '').trim();
      const definition = b.definition || {};
      const allowed = ['multipliers', 'special_cells', 'shape', 'themed', 'mode', 'vip'];
      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!allowed.includes(type)) return res.status(400).json({ error: 'bad_type' });
      const v = validateBoardDefinition(type, definition);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const isActive   = !!b.is_active;
      const startsAt   = b.starts_at ? new Date(b.starts_at) : null;
      const endsAt     = b.ends_at   ? new Date(b.ends_at)   : null;
      const audience   = String(b.target_audience || 'all').slice(0, 32);
      const priority   = Math.max(0, Math.min(1000, parseInt(b.priority || 0, 10) || 0));
      const appliesTo  = sanitizeAppliesTo(b.applies_to);
      const r = await pool.query(
        `INSERT INTO board_configurations
           (name, type, definition, is_active, starts_at, ends_at, target_audience, priority, applies_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [name, type, JSON.stringify(definition), isActive, startsAt, endsAt, audience, priority, appliesTo]
      );
      invalidateBoardCache();
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
         VALUES ('board_create', 'board', $1, $2)`,
        [String(r.rows[0].id), JSON.stringify({ name, type, isActive, priority, appliesTo })]
      ).catch(() => {});
      res.json({ ok: true, board: r.rows[0] });
    } catch (e) {
      console.error('admin POST /boards', e);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.patch('/api/boards/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad_id' });
      const b = req.body || {};
      const current = await pool.query(`SELECT * FROM board_configurations WHERE id = $1`, [id]);
      if (!current.rows.length) return res.status(404).json({ error: 'not_found' });
      const row = current.rows[0];
      const patch = {
        name:            b.name            !== undefined ? String(b.name).trim().slice(0, 80)       : row.name,
        type:            b.type            !== undefined ? String(b.type).trim()                    : row.type,
        definition:      b.definition      !== undefined ? b.definition                             : row.definition,
        is_active:       b.is_active       !== undefined ? !!b.is_active                            : row.is_active,
        starts_at:       b.starts_at       !== undefined ? (b.starts_at ? new Date(b.starts_at) : null) : row.starts_at,
        ends_at:         b.ends_at         !== undefined ? (b.ends_at   ? new Date(b.ends_at)   : null) : row.ends_at,
        target_audience: b.target_audience !== undefined ? String(b.target_audience).slice(0, 32)   : row.target_audience,
        priority:        b.priority        !== undefined ? Math.max(0, Math.min(1000, parseInt(b.priority, 10) || 0)) : row.priority,
        applies_to:      b.applies_to      !== undefined ? sanitizeAppliesTo(b.applies_to)          : (row.applies_to || ['dynamic']),
      };
      const allowed = ['multipliers', 'special_cells', 'shape', 'themed', 'mode', 'vip'];
      if (!allowed.includes(patch.type)) return res.status(400).json({ error: 'bad_type' });
      const v = validateBoardDefinition(patch.type, patch.definition);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const r = await pool.query(
        `UPDATE board_configurations
            SET name=$1, type=$2, definition=$3, is_active=$4,
                starts_at=$5, ends_at=$6, target_audience=$7, priority=$8,
                applies_to=$9, updated_at=NOW()
          WHERE id=$10
          RETURNING *`,
        [patch.name, patch.type, JSON.stringify(patch.definition), patch.is_active,
         patch.starts_at, patch.ends_at, patch.target_audience, patch.priority, patch.applies_to, id]
      );
      invalidateBoardCache();
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
         VALUES ('board_update', 'board', $1, $2)`,
        [String(id), JSON.stringify(b)]
      ).catch(() => {});
      res.json({ ok: true, board: r.rows[0] });
    } catch (e) {
      console.error('admin PATCH /boards/:id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.delete('/api/boards/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad_id' });
      const r = await pool.query(`DELETE FROM board_configurations WHERE id = $1 RETURNING name`, [id]);
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      invalidateBoardCache();
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
         VALUES ('board_delete', 'board', $1, $2)`,
        [String(id), JSON.stringify({ name: r.rows[0].name })]
      ).catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      console.error('admin DELETE /boards/:id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ============================================================
  // Skin Configurations admin CRUD (May 2026)
  // Lets the admin add, edit, enable/disable, and price any skin
  // in the shop without a redeploy. Every mutating route invalidates
  // _skinsCache and writes to admin_actions.
  // ============================================================
  adminRouter.get('/api/skins', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT s.id, s.skin_id, s.name, s.price, s.is_enabled, s.is_sellable,
                s.definition, s.special_class, s.sort_order, s.created_at, s.updated_at,
                COUNT(ps.skin_id)::int AS owner_count
           FROM skin_configurations s
           LEFT JOIN player_skins ps ON ps.skin_id = s.skin_id
          GROUP BY s.id
          ORDER BY s.sort_order ASC, s.id ASC`
      );
      res.json({ ok: true, skins: r.rows });
    } catch (e) {
      console.error('admin GET /skins', e);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.post('/api/skins', async (req, res) => {
    try {
      const b = req.body || {};
      const skinId = validateSkinId(b.skin_id);
      if (!skinId) return res.status(400).json({ error: 'bad_skin_id' });
      const name = String(b.name || '').trim().slice(0, 80);
      if (!name) return res.status(400).json({ error: 'name_required' });
      const price = Math.max(0, Math.min(100000, parseInt(b.price, 10) || 0));
      const isEnabled  = b.is_enabled  !== undefined ? !!b.is_enabled  : true;
      const isSellable = b.is_sellable !== undefined ? !!b.is_sellable : true;
      const sortOrder  = Math.max(0, Math.min(10000, parseInt(b.sort_order, 10) || 100));
      const specialClass = b.special_class ? String(b.special_class).trim().slice(0, 40) : null;
      const definition = b.definition || {};
      const v = validateSkinDefinition(definition);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const exists = await pool.query(`SELECT 1 FROM skin_configurations WHERE skin_id = $1`, [skinId]);
      if (exists.rows.length) return res.status(409).json({ error: 'skin_id_taken' });
      const r = await pool.query(
        `INSERT INTO skin_configurations
           (skin_id, name, price, is_enabled, is_sellable, definition, special_class, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         RETURNING *`,
        [skinId, name, price, isEnabled, isSellable, JSON.stringify(definition), specialClass, sortOrder]
      );
      invalidateSkinsCache();
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
         VALUES ('skin_create', 'skin', $1, $2)`,
        [skinId, JSON.stringify({ name, price, isEnabled, isSellable, sortOrder })]
      ).catch(() => {});
      res.json({ ok: true, skin: r.rows[0] });
    } catch (e) {
      console.error('admin POST /skins', e);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.patch('/api/skins/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad_id' });
      const current = await pool.query(`SELECT * FROM skin_configurations WHERE id = $1`, [id]);
      if (!current.rows.length) return res.status(404).json({ error: 'not_found' });
      const row = current.rows[0];
      const b = req.body || {};
      const patch = {
        name:          b.name          !== undefined ? String(b.name).trim().slice(0, 80) : row.name,
        price:         b.price         !== undefined ? Math.max(0, Math.min(100000, parseInt(b.price, 10) || 0)) : row.price,
        is_enabled:    b.is_enabled    !== undefined ? !!b.is_enabled  : row.is_enabled,
        is_sellable:   b.is_sellable   !== undefined ? !!b.is_sellable : row.is_sellable,
        definition:    b.definition    !== undefined ? b.definition    : row.definition,
        special_class: b.special_class !== undefined ? (b.special_class ? String(b.special_class).trim().slice(0, 40) : null) : row.special_class,
        sort_order:    b.sort_order    !== undefined ? Math.max(0, Math.min(10000, parseInt(b.sort_order, 10) || 100)) : row.sort_order,
      };
      if (!patch.name) return res.status(400).json({ error: 'name_required' });
      const v = validateSkinDefinition(patch.definition);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const r = await pool.query(
        `UPDATE skin_configurations
            SET name=$1, price=$2, is_enabled=$3, is_sellable=$4,
                definition=$5::jsonb, special_class=$6, sort_order=$7, updated_at=NOW()
          WHERE id=$8
          RETURNING *`,
        [patch.name, patch.price, patch.is_enabled, patch.is_sellable,
         JSON.stringify(patch.definition), patch.special_class, patch.sort_order, id]
      );
      invalidateSkinsCache();
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
         VALUES ('skin_update', 'skin', $1, $2)`,
        [row.skin_id, JSON.stringify({ patch: Object.keys(b) })]
      ).catch(() => {});
      res.json({ ok: true, skin: r.rows[0] });
    } catch (e) {
      console.error('admin PATCH /skins/:id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.delete('/api/skins/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad_id' });
      const current = await pool.query(`SELECT skin_id, name FROM skin_configurations WHERE id = $1`, [id]);
      if (!current.rows.length) return res.status(404).json({ error: 'not_found' });
      const owners = await pool.query(
        `SELECT COUNT(*)::int AS n FROM player_skins WHERE skin_id = $1`,
        [current.rows[0].skin_id]);
      // Block delete if anyone owns it — admin should is_enabled=false instead.
      // Override via ?force=1 in case admin really wants to nuke (data lost for owners).
      if (owners.rows[0].n > 0 && req.query.force !== '1') {
        return res.status(409).json({ error: 'has_owners', owner_count: owners.rows[0].n });
      }
      await pool.query(`DELETE FROM skin_configurations WHERE id = $1`, [id]);
      if (req.query.force === '1') {
        await pool.query(`DELETE FROM player_skins WHERE skin_id = $1`, [current.rows[0].skin_id]);
      }
      invalidateSkinsCache();
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
         VALUES ('skin_delete', 'skin', $1, $2)`,
        [current.rows[0].skin_id, JSON.stringify({ name: current.rows[0].name, forced: req.query.force === '1' })]
      ).catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      console.error('admin DELETE /skins/:id', e);
      res.status(500).json({ error: 'server' });
    }
  });

  // ============================================================
  // Push notifications — admin broadcast (May 2026)
  //
  // Three endpoints:
  //   GET  /api/push/status     — current subscriber count + configured?
  //   POST /api/push/test       — send a test push to a single device
  //   POST /api/push/broadcast  — send to all subscribed devices
  //
  // The broadcast endpoint iterates push_subscriptions in chunks of
  // 200 to avoid huge memory spikes on big lists. Stale endpoints
  // are removed by the existing sendPushToDevice cleanup logic
  // (410 Gone responses delete the row).
  // ============================================================
  // ============================================================
  // Admin — Tournament CRUD (May 2026)
  // ============================================================
  adminRouter.get('/api/tournaments', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, name, description, starts_at, ends_at, prize_pool, status, finalized_at, created_at,
                (SELECT COUNT(*) FROM tournament_scores WHERE tournament_id = tournaments.id)::int AS players
         FROM tournaments
        ORDER BY starts_at DESC LIMIT 100`
      );
      res.json({ ok: true, tournaments: r.rows });
    } catch (e) {
      console.error('admin tournaments list', e.message);
      res.status(500).json({ error: 'server' });
    }
  });
  adminRouter.post('/api/tournaments', async (req, res) => {
    try {
      const { name, description, starts_at, ends_at, prize_pool } = req.body || {};
      if (!name || !starts_at || !ends_at) return res.status(400).json({ error: 'missing_fields' });
      if (new Date(starts_at) >= new Date(ends_at)) return res.status(400).json({ error: 'bad_window' });
      // Validate prize_pool — array of {rank, reward} with reward 0-100K.
      let validPool = [];
      if (Array.isArray(prize_pool)) {
        validPool = prize_pool
          .map(p => ({ rank: parseInt(p.rank, 10), reward: parseInt(p.reward, 10) }))
          .filter(p => p.rank >= 1 && p.rank <= 100 && p.reward >= 0 && p.reward <= 100000)
          .sort((a, b) => a.rank - b.rank);
      }
      const r = await pool.query(
        `INSERT INTO tournaments (name, description, starts_at, ends_at, prize_pool)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
        [String(name).slice(0, 80), String(description || '').slice(0, 300), starts_at, ends_at, JSON.stringify(validPool)]
      );
      await pool.query(
        `INSERT INTO admin_actions (action, details, created_at) VALUES ('tournament_create', $1, NOW())`,
        [JSON.stringify({ id: r.rows[0].id, name: r.rows[0].name })]
      ).catch(() => {});
      res.json({ ok: true, tournament: r.rows[0] });
    } catch (e) {
      console.error('admin tournament create', e.message);
      res.status(500).json({ error: 'server' });
    }
  });
  adminRouter.patch('/api/tournaments/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
      const cur = await pool.query(`SELECT * FROM tournaments WHERE id = $1`, [id]);
      if (!cur.rows.length) return res.status(404).json({ error: 'not_found' });
      const body = req.body || {};
      const updates = [];
      const params = [];
      let idx = 1;
      if (body.name != null) { updates.push(`name = $${idx++}`); params.push(String(body.name).slice(0, 80)); }
      if (body.description != null) { updates.push(`description = $${idx++}`); params.push(String(body.description).slice(0, 300)); }
      if (body.ends_at != null) { updates.push(`ends_at = $${idx++}`); params.push(body.ends_at); }
      if (body.starts_at != null) { updates.push(`starts_at = $${idx++}`); params.push(body.starts_at); }
      if (body.prize_pool != null && Array.isArray(body.prize_pool)) {
        const validPool = body.prize_pool
          .map(p => ({ rank: parseInt(p.rank, 10), reward: parseInt(p.reward, 10) }))
          .filter(p => p.rank >= 1 && p.rank <= 100 && p.reward >= 0 && p.reward <= 100000)
          .sort((a, b) => a.rank - b.rank);
        updates.push(`prize_pool = $${idx++}::jsonb`); params.push(JSON.stringify(validPool));
      }
      if (!updates.length) return res.json({ ok: true, tournament: cur.rows[0] });
      updates.push(`updated_at = NOW()`);
      params.push(id);
      const r = await pool.query(
        `UPDATE tournaments SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
      );
      await pool.query(
        `INSERT INTO admin_actions (action, details, created_at) VALUES ('tournament_update', $1, NOW())`,
        [JSON.stringify({ id, body })]
      ).catch(() => {});
      res.json({ ok: true, tournament: r.rows[0] });
    } catch (e) {
      console.error('admin tournament update', e.message);
      res.status(500).json({ error: 'server' });
    }
  });
  adminRouter.delete('/api/tournaments/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
      await pool.query(`DELETE FROM tournaments WHERE id = $1`, [id]);
      await pool.query(
        `INSERT INTO admin_actions (action, details, created_at) VALUES ('tournament_delete', $1, NOW())`,
        [JSON.stringify({ id })]
      ).catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      console.error('admin tournament delete', e.message);
      res.status(500).json({ error: 'server' });
    }
  });
  adminRouter.post('/api/tournaments/:id/finalize', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const ok = await maybeFinalizeTournament(id);
      res.json({ ok });
    } catch (e) {
      console.error('admin tournament finalize', e.message);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.get('/api/push/status', async (_req, res) => {
    try {
      const r = await pool.query(`SELECT COUNT(*)::int AS c FROM push_subscriptions`);
      const cfg = await pool.query(`SELECT value FROM game_config WHERE key = 'push_enabled'`);
      res.json({
        ok: true,
        configured: _webpushConfigured,
        enabled: !cfg.rows[0] || cfg.rows[0].value !== 'false',
        subscriberCount: (r.rows[0] && r.rows[0].c) || 0,
        vapidPublic: _webpushConfigured ? VAPID_PUBLIC_KEY : null
      });
    } catch (e) {
      console.error('admin push/status', e.message);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.post('/api/push/test', async (req, res) => {
    try {
      if (!_webpushConfigured) return res.json({ ok: false, reason: 'not_configured' });
      const { deviceId, title, body, url } = req.body || {};
      if (!deviceId) return res.status(400).json({ error: 'missing_device' });
      const payload = {
        title: String(title || '🧪 בדיקת התראה').slice(0, 80),
        body:  String(body  || 'אם אתה רואה את זה — התראות עובדות!').slice(0, 200),
        data: { url: url || '/' }
      };
      const sent = await sendPushToDevice(deviceId, payload);
      res.json({ ok: true, attempted: !!sent });
    } catch (e) {
      console.error('admin push/test', e.message);
      res.status(500).json({ error: 'server' });
    }
  });

  adminRouter.post('/api/push/broadcast', async (req, res) => {
    try {
      if (!_webpushConfigured) return res.json({ ok: false, reason: 'not_configured' });
      const cfg = await pool.query(`SELECT value FROM game_config WHERE key = 'push_enabled'`);
      if (cfg.rows[0] && cfg.rows[0].value === 'false') {
        return res.json({ ok: false, reason: 'disabled' });
      }
      const { title, body, url, tag, requireInteraction } = req.body || {};
      const cleanTitle = String(title || '').trim().slice(0, 80);
      const cleanBody  = String(body  || '').trim().slice(0, 200);
      if (!cleanTitle || !cleanBody) {
        return res.status(400).json({ error: 'missing_title_or_body' });
      }
      const cleanUrl = (url && typeof url === 'string') ? url.slice(0, 200) : '/';
      const cleanTag = (tag && typeof tag === 'string') ? tag.slice(0, 50) : 'bloom-admin-' + Date.now();
      // Pull subscribers in batches so memory stays bounded.
      const batchSize = 200;
      let totalAttempted = 0;
      let totalSucceeded = 0;
      let totalFailed = 0;
      let offset = 0;
      while (true) {
        const batch = await pool.query(
          `SELECT DISTINCT device_id FROM push_subscriptions
           ORDER BY device_id LIMIT $1 OFFSET $2`,
          [batchSize, offset]
        );
        if (!batch.rows.length) break;
        // Fire pushes in parallel within the batch.
        const promises = batch.rows.map(function(row) {
          return sendPushToDevice(row.device_id, {
            title: cleanTitle,
            body: cleanBody,
            tag: cleanTag,
            requireInteraction: !!requireInteraction,
            data: { url: cleanUrl }
          })
            .then(function() { totalSucceeded++; })
            .catch(function() { totalFailed++; });
        });
        await Promise.all(promises);
        totalAttempted += batch.rows.length;
        offset += batchSize;
        if (batch.rows.length < batchSize) break;
      }
      // Audit trail.
      try {
        await pool.query(
          `INSERT INTO admin_actions (action, details, created_at)
           VALUES ($1, $2, NOW())`,
          ['push_broadcast', JSON.stringify({
            title: cleanTitle, body: cleanBody, url: cleanUrl,
            attempted: totalAttempted, succeeded: totalSucceeded, failed: totalFailed
          })]
        );
      } catch (e) {}
      res.json({
        ok: true,
        attempted: totalAttempted,
        succeeded: totalSucceeded,
        failed: totalFailed
      });
    } catch (e) {
      console.error('admin push/broadcast', e.message);
      res.status(500).json({ error: 'server' });
    }
  });

  // ============================================================
  // Admin: Daily Deals CRUD (stage 21)
  // ============================================================
  adminRouter.get('/api/daily-deals', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT d.*,
                (SELECT COUNT(*) FROM daily_deal_purchases WHERE deal_id = d.id) AS total_purchases,
                (SELECT COUNT(*) FROM daily_deal_purchases WHERE deal_id = d.id AND purchase_date = (NOW() AT TIME ZONE 'Asia/Jerusalem')::date) AS today_purchases
           FROM daily_deals d
          ORDER BY sort_order, id`
      );
      res.json({ ok: true, deals: r.rows });
    } catch (e) {
      console.error('GET admin/daily-deals', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.post('/api/daily-deals', async (req, res) => {
    try {
      const { slug, name, description, emoji, price_gems, original_value, contents, category, is_enabled, sort_order } = req.body || {};
      if (!slug || !name || !Number.isFinite(parseInt(price_gems, 10))) {
        return res.status(400).json({ error: 'missing_fields' });
      }
      const r = await pool.query(
        `INSERT INTO daily_deals (slug, name, description, emoji, price_gems, original_value, contents, category, is_enabled, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
         RETURNING *`,
        [
          slug.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40),
          String(name).slice(0, 80),
          description || null,
          emoji || null,
          parseInt(price_gems, 10),
          original_value ? parseInt(original_value, 10) : null,
          JSON.stringify(contents || {}),
          category || null,
          is_enabled !== false,
          parseInt(sort_order, 10) || 100
        ]
      );
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
           VALUES ('daily_deal_create', 'daily_deal', $1, $2)`,
        [String(r.rows[0].id), JSON.stringify({ slug: r.rows[0].slug, name })]
      ).catch(() => {});
      res.json({ ok: true, deal: r.rows[0] });
    } catch (e) {
      if (e.code === '23505') return res.status(400).json({ error: 'slug_exists' });
      console.error('POST admin/daily-deals', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.patch('/api/daily-deals/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, description, emoji, price_gems, original_value, contents, category, is_enabled, sort_order } = req.body || {};
      const updates = [];
      const vals = [];
      let p = 1;
      if (name !== undefined)           { updates.push(`name = $${p++}`); vals.push(String(name).slice(0, 80)); }
      if (description !== undefined)    { updates.push(`description = $${p++}`); vals.push(description); }
      if (emoji !== undefined)          { updates.push(`emoji = $${p++}`); vals.push(emoji); }
      if (price_gems !== undefined)     { updates.push(`price_gems = $${p++}`); vals.push(parseInt(price_gems, 10)); }
      if (original_value !== undefined) { updates.push(`original_value = $${p++}`); vals.push(original_value ? parseInt(original_value, 10) : null); }
      if (contents !== undefined)       { updates.push(`contents = $${p++}::jsonb`); vals.push(JSON.stringify(contents)); }
      if (category !== undefined)       { updates.push(`category = $${p++}`); vals.push(category); }
      if (is_enabled !== undefined)     { updates.push(`is_enabled = $${p++}`); vals.push(!!is_enabled); }
      if (sort_order !== undefined)     { updates.push(`sort_order = $${p++}`); vals.push(parseInt(sort_order, 10) || 100); }
      if (!updates.length) return res.json({ ok: false, reason: 'no_changes' });
      updates.push(`updated_at = NOW()`);
      vals.push(id);
      const r = await pool.query(
        `UPDATE daily_deals SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`,
        vals
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
           VALUES ('daily_deal_patch', 'daily_deal', $1, $2)`,
        [String(id), JSON.stringify({ fields: Object.keys(req.body || {}) })]
      ).catch(() => {});
      res.json({ ok: true, deal: r.rows[0] });
    } catch (e) {
      console.error('PATCH admin/daily-deals/:id', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.delete('/api/daily-deals/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = await pool.query(`DELETE FROM daily_deals WHERE id = $1 RETURNING slug`, [id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
           VALUES ('daily_deal_delete', 'daily_deal', $1, $2)`,
        [String(id), JSON.stringify({ slug: r.rows[0].slug })]
      ).catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      console.error('DELETE admin/daily-deals/:id', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  // ============================================================
  // Admin: Skin Gacha pool CRUD (stage 18)
  // ============================================================
  adminRouter.get('/api/gacha/pool', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT g.*,
                (SELECT COUNT(*) FROM gacha_pulls_history WHERE
                  (g.skin_id IS NOT NULL AND skin_id = g.skin_id)
                  OR (g.skin_id IS NULL AND reward_type = g.reward_type AND amount = g.amount)
                ) AS total_pulled
           FROM gacha_pool g
          ORDER BY
            CASE rarity WHEN 'mythic' THEN 1 WHEN 'legendary' THEN 2 WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 4 ELSE 5 END,
            id`
      );
      const stats = await pool.query(
        `SELECT rarity, COUNT(*) AS cnt FROM gacha_pulls_history GROUP BY rarity`
      );
      const statsMap = {};
      stats.rows.forEach(r => { statsMap[r.rarity] = parseInt(r.cnt, 10); });
      res.json({ ok: true, pool: r.rows, stats: statsMap });
    } catch (e) {
      console.error('GET admin/gacha/pool', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.post('/api/gacha/pool', async (req, res) => {
    try {
      const { rarity, reward_type, amount, skin_id, display_name, emoji, weight, is_enabled } = req.body || {};
      const allowedRarity = ['common', 'uncommon', 'rare', 'legendary', 'mythic'];
      if (!allowedRarity.includes(rarity)) return res.status(400).json({ error: 'bad_rarity' });
      if (!reward_type) return res.status(400).json({ error: 'missing_reward_type' });
      const r = await pool.query(
        `INSERT INTO gacha_pool (rarity, reward_type, amount, skin_id, display_name, emoji, weight, is_enabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [rarity, reward_type, amount || null, skin_id || null, display_name || null, emoji || null,
         parseInt(weight, 10) || 100, is_enabled !== false]
      );
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
           VALUES ('gacha_pool_create', 'gacha_pool', $1, $2)`,
        [String(r.rows[0].id), JSON.stringify({ rarity, reward_type })]
      ).catch(() => {});
      res.json({ ok: true, entry: r.rows[0] });
    } catch (e) {
      console.error('POST admin/gacha/pool', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.patch('/api/gacha/pool/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const fields = ['rarity', 'reward_type', 'amount', 'skin_id', 'display_name', 'emoji', 'weight', 'is_enabled'];
      const updates = [];
      const vals = [];
      let p = 1;
      fields.forEach(f => {
        if (req.body[f] !== undefined) {
          updates.push(`${f} = $${p++}`);
          vals.push(req.body[f]);
        }
      });
      if (!updates.length) return res.json({ ok: false, reason: 'no_changes' });
      updates.push(`updated_at = NOW()`);
      vals.push(id);
      const r = await pool.query(
        `UPDATE gacha_pool SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`,
        vals
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
           VALUES ('gacha_pool_patch', 'gacha_pool', $1, $2)`,
        [String(id), JSON.stringify({ fields: Object.keys(req.body || {}) })]
      ).catch(() => {});
      res.json({ ok: true, entry: r.rows[0] });
    } catch (e) {
      console.error('PATCH admin/gacha/pool/:id', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.delete('/api/gacha/pool/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = await pool.query(`DELETE FROM gacha_pool WHERE id = $1 RETURNING rarity`, [id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
           VALUES ('gacha_pool_delete', 'gacha_pool', $1, $2)`,
        [String(id), JSON.stringify({ rarity: r.rows[0].rarity })]
      ).catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      console.error('DELETE admin/gacha/pool/:id', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  // ============================================================
  // Admin: Calendar events CRUD (stage 26)
  // ============================================================
  adminRouter.get('/api/calendar/events', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, event_date, title, description, emoji, category, starts_at, ends_at, is_enabled, sort_order
           FROM calendar_events
          ORDER BY event_date, sort_order, id`
      );
      res.json({ ok: true, events: r.rows });
    } catch (e) {
      console.error('GET admin/calendar/events', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.post('/api/calendar/events', async (req, res) => {
    try {
      const { event_date, title, description, emoji, category, starts_at, ends_at, is_enabled, sort_order } = req.body || {};
      if (!event_date || !title) return res.status(400).json({ error: 'missing_fields' });
      const r = await pool.query(
        `INSERT INTO calendar_events (event_date, title, description, emoji, category, starts_at, ends_at, is_enabled, sort_order)
           VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [event_date, String(title).slice(0, 120), description || null, emoji || null,
         category || null, starts_at || null, ends_at || null,
         is_enabled !== false, parseInt(sort_order, 10) || 100]
      );
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
           VALUES ('calendar_create', 'calendar_event', $1, $2)`,
        [String(r.rows[0].id), JSON.stringify({ title, event_date })]
      ).catch(() => {});
      res.json({ ok: true, event: r.rows[0] });
    } catch (e) {
      console.error('POST admin/calendar/events', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.patch('/api/calendar/events/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const fields = ['event_date', 'title', 'description', 'emoji', 'category', 'starts_at', 'ends_at', 'is_enabled', 'sort_order'];
      const updates = [];
      const vals = [];
      let p = 1;
      fields.forEach(f => {
        if (req.body[f] !== undefined) {
          updates.push(`${f} = $${p++}`);
          vals.push(req.body[f]);
        }
      });
      if (!updates.length) return res.json({ ok: false, reason: 'no_changes' });
      updates.push(`updated_at = NOW()`);
      vals.push(id);
      const r = await pool.query(
        `UPDATE calendar_events SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`,
        vals
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
      res.json({ ok: true, event: r.rows[0] });
    } catch (e) {
      console.error('PATCH admin/calendar/events/:id', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.delete('/api/calendar/events/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = await pool.query(`DELETE FROM calendar_events WHERE id = $1 RETURNING title`, [id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
      res.json({ ok: true });
    } catch (e) {
      console.error('DELETE admin/calendar/events/:id', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  // ============================================================
  // Admin: Limited-time Bundles CRUD (stage 25)
  // ============================================================
  adminRouter.get('/api/bundles', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT b.*,
                (SELECT COUNT(*) FROM limited_bundle_purchases WHERE bundle_id = b.id) AS total_purchases,
                (SELECT COALESCE(SUM(price_paid), 0) FROM limited_bundle_purchases WHERE bundle_id = b.id) AS total_revenue
           FROM limited_bundles b
          ORDER BY sort_order, id`
      );
      res.json({ ok: true, bundles: r.rows });
    } catch (e) {
      console.error('GET admin/bundles', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.post('/api/bundles', async (req, res) => {
    try {
      const { slug, name, description, emoji, theme_color, decoration_emoji,
              price_gems, original_value, contents, starts_at, ends_at,
              is_enabled, max_purchases_per_device, sort_order } = req.body || {};
      if (!slug || !name || !Number.isFinite(parseInt(price_gems, 10)) || !starts_at || !ends_at) {
        return res.status(400).json({ error: 'missing_fields' });
      }
      const r = await pool.query(
        `INSERT INTO limited_bundles (slug, name, description, emoji, theme_color, decoration_emoji,
                                       price_gems, original_value, contents, starts_at, ends_at,
                                       is_enabled, max_purchases_per_device, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          slug.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40),
          String(name).slice(0, 120), description || null, emoji || null,
          theme_color || '#A855F7', decoration_emoji || null,
          parseInt(price_gems, 10), original_value ? parseInt(original_value, 10) : null,
          JSON.stringify(contents || {}), starts_at, ends_at,
          is_enabled !== false, parseInt(max_purchases_per_device, 10) || 1,
          parseInt(sort_order, 10) || 100
        ]
      );
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
           VALUES ('bundle_create', 'bundle', $1, $2)`,
        [String(r.rows[0].id), JSON.stringify({ slug: r.rows[0].slug, name })]
      ).catch(() => {});
      res.json({ ok: true, bundle: r.rows[0] });
    } catch (e) {
      if (e.code === '23505') return res.status(400).json({ error: 'slug_exists' });
      console.error('POST admin/bundles', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.patch('/api/bundles/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const fields = ['name', 'description', 'emoji', 'theme_color', 'decoration_emoji',
                      'price_gems', 'original_value', 'contents', 'starts_at', 'ends_at',
                      'is_enabled', 'max_purchases_per_device', 'sort_order'];
      const updates = [];
      const vals = [];
      let p = 1;
      fields.forEach(f => {
        if (req.body[f] !== undefined) {
          if (f === 'contents') {
            updates.push(`${f} = $${p++}::jsonb`);
            vals.push(JSON.stringify(req.body[f]));
          } else {
            updates.push(`${f} = $${p++}`);
            vals.push(req.body[f]);
          }
        }
      });
      if (!updates.length) return res.json({ ok: false, reason: 'no_changes' });
      updates.push(`updated_at = NOW()`);
      vals.push(id);
      const r = await pool.query(
        `UPDATE limited_bundles SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`,
        vals
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
           VALUES ('bundle_patch', 'bundle', $1, $2)`,
        [String(id), JSON.stringify({ fields: Object.keys(req.body || {}) })]
      ).catch(() => {});
      res.json({ ok: true, bundle: r.rows[0] });
    } catch (e) {
      console.error('PATCH admin/bundles/:id', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.delete('/api/bundles/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = await pool.query(`DELETE FROM limited_bundles WHERE id = $1 RETURNING slug`, [id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
      res.json({ ok: true });
    } catch (e) {
      console.error('DELETE admin/bundles/:id', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  // ============================================================
  // Admin: Smart Push status + recent sends + manual scan trigger (stage 31)
  // ============================================================
  adminRouter.get('/api/smart-push/status', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM player_push_state WHERE last_sent_at IS NOT NULL) AS total_devices_ever,
           (SELECT COUNT(*) FROM player_push_state WHERE last_sent_at > NOW() - INTERVAL '24 hours') AS sent_24h,
           (SELECT COUNT(*) FROM player_push_state WHERE last_sent_at > NOW() - INTERVAL '7 days') AS sent_7d,
           (SELECT COUNT(*) FROM push_subscriptions) AS subscribers`
      );
      const recentR = await pool.query(
        `SELECT pps.device_id, pps.last_send_reason, pps.last_sent_at, pps.total_sent,
                COALESCE(pp.display_name, 'אנונימי') AS name
           FROM player_push_state pps
           LEFT JOIN player_profiles pp ON pp.device_id = pps.device_id
          WHERE pps.last_sent_at IS NOT NULL
          ORDER BY pps.last_sent_at DESC LIMIT 30`
      );
      const reasonStatsR = await pool.query(
        `SELECT last_send_reason AS reason, COUNT(*) AS cnt
           FROM player_push_state
           WHERE last_send_reason IS NOT NULL
             AND last_sent_at > NOW() - INTERVAL '7 days'
           GROUP BY last_send_reason
           ORDER BY cnt DESC`
      );
      res.json({
        ok: true,
        stats: r.rows[0],
        recent: recentR.rows,
        reasonBreakdown: reasonStatsR.rows
      });
    } catch (e) {
      console.error('GET admin/smart-push/status', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.post('/api/smart-push/scan-now', async (_req, res) => {
    try {
      // Fire-and-forget manual scan.
      _runSmartPushScan().catch(() => {});
      res.json({ ok: true, message: 'Scan triggered in background' });
    } catch (e) {
      console.error('POST admin/smart-push/scan-now', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  // ============================================================
  // Admin: Replay Sharing telemetry (stage 32)
  // ============================================================
  adminRouter.get('/api/replay/stats', async (_req, res) => {
    try {
      const overallR = await pool.query(
        `SELECT
           COUNT(*) AS total_shares,
           COUNT(*) FILTER (WHERE shared_at > NOW() - INTERVAL '24 hours') AS shares_24h,
           COUNT(*) FILTER (WHERE shared_at > NOW() - INTERVAL '7 days') AS shares_7d,
           COUNT(DISTINCT device_id) AS unique_sharers
         FROM replay_shares`
      );
      const viaR = await pool.query(
        `SELECT shared_via AS via, COUNT(*) AS cnt
           FROM replay_shares
           WHERE shared_at > NOW() - INTERVAL '7 days' AND shared_via IS NOT NULL
           GROUP BY shared_via ORDER BY cnt DESC`
      );
      const topSharersR = await pool.query(
        `SELECT rs.device_id, COUNT(*) AS share_count, MAX(rs.score) AS best_shared_score,
                COALESCE(pp.display_name, 'אנונימי') AS name
           FROM replay_shares rs
           LEFT JOIN player_profiles pp ON pp.device_id = rs.device_id
          WHERE rs.shared_at > NOW() - INTERVAL '30 days'
          GROUP BY rs.device_id, pp.display_name
          ORDER BY share_count DESC LIMIT 20`
      );
      res.json({
        ok: true,
        stats: overallR.rows[0],
        viaBreakdown: viaR.rows,
        topSharers: topSharersR.rows
      });
    } catch (e) {
      console.error('GET admin/replay/stats', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  // ============================================================
  // Admin: Guilds list + stats + force-delete (stage 27)
  // ============================================================
  adminRouter.get('/api/guilds', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT g.*,
                (SELECT COALESCE(SUM(goal_progress), 0) FROM guild_daily_progress WHERE guild_id = g.id) AS total_progress_alltime,
                (SELECT COUNT(*) FROM guild_daily_progress WHERE guild_id = g.id AND is_complete = TRUE) AS days_complete
           FROM guilds g
          ORDER BY g.total_score_alltime DESC LIMIT 100`
      );
      res.json({ ok: true, guilds: r.rows });
    } catch (e) {
      console.error('GET admin/guilds', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.delete('/api/guilds/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const r = await pool.query(`DELETE FROM guilds WHERE id = $1 RETURNING name`, [id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
      await pool.query(
        `INSERT INTO admin_actions (action, target_type, target_id, details)
           VALUES ('guild_delete', 'guild', $1, $2)`,
        [String(id), JSON.stringify({ name: r.rows[0].name })]
      ).catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      console.error('DELETE admin/guilds/:id', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  // ============================================================
  // Admin: Rivalry stats + manual matchmaker (stage 33)
  // ============================================================
  adminRouter.get('/api/rivalries/stats', async (_req, res) => {
    try {
      const overallR = await pool.query(
        `SELECT
           COUNT(*) AS total_ever,
           COUNT(*) FILTER (WHERE resolved = FALSE AND expires_at > NOW()) AS active_now,
           COUNT(*) FILTER (WHERE resolved = TRUE AND outcome = 'won' AND resolved_at > NOW() - INTERVAL '7 days') AS wins_7d,
           COUNT(*) FILTER (WHERE resolved = TRUE AND outcome = 'lost' AND resolved_at > NOW() - INTERVAL '7 days') AS losses_7d,
           COUNT(*) FILTER (WHERE resolved = TRUE AND outcome = 'tied' AND resolved_at > NOW() - INTERVAL '7 days') AS ties_7d
         FROM player_rivalries`
      );
      const recentR = await pool.query(
        `SELECT pr.declared_at, pr.outcome, pr.resolved,
                COALESCE(pp1.display_name, 'אנונימי') AS my_name,
                COALESCE(pp2.display_name, 'אנונימי') AS rival_name
           FROM player_rivalries pr
           LEFT JOIN player_profiles pp1 ON pp1.device_id = pr.device_id
           LEFT JOIN player_profiles pp2 ON pp2.device_id = pr.rival_device_id
          ORDER BY pr.declared_at DESC LIMIT 30`
      );
      res.json({ ok: true, stats: overallR.rows[0], recent: recentR.rows });
    } catch (e) {
      console.error('GET admin/rivalries/stats', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  adminRouter.post('/api/rivalries/match-now', async (_req, res) => {
    try {
      _runRivalryMatchmaker().catch(() => {});
      res.json({ ok: true, message: 'Matchmaker triggered in background' });
    } catch (e) {
      console.error('POST admin/rivalries/match-now', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  // ============================================================
  // 🛡⚔️ Stage 37 — Guild Wars admin
  // ============================================================
  adminRouter.get('/api/guild-wars', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT gw.id, gw.status, gw.starts_at, gw.ends_at, gw.guild_a_score, gw.guild_b_score,
                gw.guild_a_games, gw.guild_b_games, gw.winner_guild_id, gw.finalized_at,
                ga.name AS guild_a_name, ga.emoji AS guild_a_emoji,
                gb.name AS guild_b_name, gb.emoji AS guild_b_emoji
           FROM guild_wars gw
           JOIN guilds ga ON ga.id = gw.guild_a_id
           JOIN guilds gb ON gb.id = gw.guild_b_id
          ORDER BY
            CASE gw.status WHEN 'active' THEN 0 ELSE 1 END,
            gw.created_at DESC
          LIMIT 100`
      );
      res.json({ ok: true, wars: r.rows });
    } catch (e) {
      console.error('GET admin/guild-wars', e);
      res.status(500).json({ error: 'internal' });
    }
  });
  adminRouter.post('/api/guild-wars/match-now', async (_req, res) => {
    try {
      const result = await _runGuildWarMatchmaker();
      res.json({ ok: true, matched: result.matched });
    } catch (e) {
      console.error('POST admin/guild-wars/match-now', e);
      res.status(500).json({ error: 'internal' });
    }
  });
  adminRouter.post('/api/guild-wars/:id/finalize', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'bad_id' });
      // Force-end early then finalize.
      await pool.query(`UPDATE guild_wars SET ends_at = NOW() WHERE id = $1 AND status = 'active'`, [id]);
      await _finalizeGuildWar(id);
      await logAdminAction('guild_war.finalize', 'guild_wars', String(id), {});
      res.json({ ok: true });
    } catch (e) {
      console.error('POST admin/guild-wars/finalize', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  // ============================================================
  // 🏆 Stage 38 — Trophy Road stats
  // ============================================================
  adminRouter.get('/api/trophies/stats', async (_req, res) => {
    try {
      const overR = await pool.query(
        `SELECT
           COUNT(*) AS players,
           COALESCE(MAX(trophies), 0) AS max_trophies,
           COALESCE(AVG(trophies)::int, 0) AS avg_trophies,
           COALESCE(SUM(total_games), 0) AS total_games,
           COALESCE(SUM(total_wins), 0) AS total_wins
         FROM player_trophies WHERE trophies > 0`
      );
      const topR = await pool.query(
        `SELECT pt.device_id, pt.trophies, pt.current_arena_id, pt.total_games, pt.total_wins,
                COALESCE(pp.display_name, 'אנונימי') AS name
           FROM player_trophies pt
           LEFT JOIN player_profiles pp ON pp.device_id = pt.device_id
          ORDER BY pt.trophies DESC LIMIT 30`
      );
      res.json({ ok: true, stats: overR.rows[0], leaderboard: topR.rows });
    } catch (e) {
      console.error('GET admin/trophies/stats', e);
      res.status(500).json({ error: 'internal' });
    }
  });

  // ============================================================
  // 🎡 Stage 36 — Daily Spin Wheel stats
  // ============================================================
  adminRouter.get('/api/spin/stats', async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT
           COUNT(*) AS players_ever,
           COALESCE(SUM(total_spins), 0) AS total_spins,
           COALESCE(SUM(total_gems_won), 0) AS total_gems_won,
           COALESCE(MAX(longest_streak), 0) AS longest_streak,
           COUNT(*) FILTER (WHERE last_spin_at > NOW() - INTERVAL '7 days') AS active_7d
         FROM daily_spin_state`
      );
      res.json({ ok: true, stats: r.rows[0] });
    } catch (e) {
      console.error('GET admin/spin/stats', e);
      res.status(500).json({ error: 'internal' });
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
// NOTE: This is a fallback for the legacy code path. The current buy-skin
// implementation reads from the skin_configurations DB table (admin-managed).
// When a skin is in the DB it wins; this map covers the case where a player
// somehow ends up requesting a legacy id before the DB table is seeded.
const SKIN_PRICES = {
  classic: 0,
  ocean:   200,
  candy:   200,
  space:   300,
  fire:    300,
  gold:    500,
  aurora:  300
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
      'comeback': 'comeback_reward',
      // Dynamic-board reward actions (May 2026) — bypass the event_gift
      // [min,max] clamp. Server reads the actual reward amount from
      // dyn_*_reward_<id> config keys, validates the id against an
      // allowlist (anti-cheat), and pays the full configured amount.
      // Without these, a quest that promises +100💎 would silently get
      // clamped to event_gift_credits_max (typically 10💎) in payment.
      'dyn_quest': '_dyn_quest_',
      'dyn_ach': '_dyn_ach_',
      'dyn_streak_milestone': '_dyn_streak_milestone_',
      // T2.5 — Daily Checklist all-done bonus. Server re-checks allDone
      // before paying so a tampered client can't claim without finishing.
      'daily_checklist_complete': 'checklist_all_done_reward'
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
      const META_DEDUP_ACTIONS = new Set(['score_milestone', 'dyn_quest', 'dyn_ach', 'dyn_streak_milestone']);
      let validatedMeta = null;
      if (action === 'score_milestone' && meta && typeof meta === 'object') {
        const m = parseInt(meta.milestone, 10);
        const ALLOWED_MILESTONES = [10000, 25000, 50000, 100000, 250000, 500000, 1000000];
        if (ALLOWED_MILESTONES.includes(m)) validatedMeta = { milestone: m };
      }
      // Dynamic quest dedup — one claim per quest per Asia/Jerusalem day.
      if (action === 'dyn_quest' && meta && typeof meta === 'object') {
        const ALLOWED_QUESTS = ['play2','play3','score10k','score30k','score75k','tier7','tier8','theme','shape','beatself','beatleader'];
        const qid = typeof meta.quest_id === 'string' ? meta.quest_id : '';
        if (ALLOWED_QUESTS.includes(qid)) validatedMeta = { quest_id: qid };
      }
      // Dynamic achievement dedup — once per achievement per scope. The
      // achievement table includes per-board entries (scope='board') which
      // can be unlocked per-board, so the dedup uses board_id too. Cross
      // achievements (scope='cross') have a single global slot.
      if (action === 'dyn_ach' && meta && typeof meta === 'object') {
        const ALLOWED_PER_BOARD = ['played','crown','score10','score50','score100'];
        const ALLOWED_CROSS = ['pioneer5','pioneer10','crown5','all_themes','all_shapes','leaderboard1'];
        const aid = typeof meta.ach_id === 'string' ? meta.ach_id : '';
        const scope = meta.scope === 'cross' ? 'cross' : 'board';
        const bid = parseInt(meta.board_id, 10) || 0;
        if (scope === 'cross' && ALLOWED_CROSS.includes(aid)) {
          validatedMeta = { ach_id: aid, scope: 'cross' };
        } else if (scope === 'board' && ALLOWED_PER_BOARD.includes(aid) && bid > 0) {
          validatedMeta = { ach_id: aid, scope: 'board', board_id: bid };
        }
      }
      // Dynamic streak milestone — once per milestone per streak run.
      // Dedup key includes the milestone number so each of the 6 tiers
      // can fire once per current streak. A new streak (after reset)
      // clears milestonesClaimed on the client; the dedup expires per
      // day so re-claiming on a fresh streak works after ≥1 day passes.
      if (action === 'dyn_streak_milestone' && meta && typeof meta === 'object') {
        const ALLOWED_MS = [3, 7, 14, 30, 60, 100];
        const m = parseInt(meta.milestone, 10);
        if (ALLOWED_MS.includes(m)) validatedMeta = { milestone: m };
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
    } else if (action === 'score_milestone') {
      // Tiered reward, picked from a per-milestone config key. The dedup
      // path above already validated meta.milestone against ALLOWED_MILESTONES,
      // so we can trust validatedMeta.milestone here. If the tiered key
      // is missing/zero, fall back to the legacy flat score_milestone_reward.
      let mt = validatedMeta && validatedMeta.milestone;
      let r = 0;
      if (mt) {
        const tierRow = await pool.query('SELECT value FROM game_config WHERE key = $1', ['score_milestone_reward_' + mt]);
        r = parseInt((tierRow.rows[0] || {}).value, 10) || 0;
      }
      if (r <= 0) {
        const cfgRow = await pool.query(`SELECT value FROM game_config WHERE key = 'score_milestone_reward'`);
        r = parseInt((cfgRow.rows[0] || {}).value, 10) || 0;
      }
      reward = r;
    } else if (action === 'dyn_quest' && validatedMeta) {
      // Quest reward — server reads dyn_quest_reward_<id>. The client
      // never names an amount; the id is validated against an allowlist
      // in the dedup pass above. Bypasses the event_gift clamp entirely.
      const r = await pool.query('SELECT value FROM game_config WHERE key = $1', ['dyn_quest_reward_' + validatedMeta.quest_id]);
      reward = parseInt((r.rows[0] || {}).value, 10) || 0;
      // Daily Special multiplier — if the quest was completed on today's
      // special board, multiply the reward. Client passes meta.boardId.
      const dqBoardId = parseInt((meta && meta.boardId) || 0, 10) || 0;
      if (reward > 0 && dqBoardId > 0) {
        try {
          const ctx = await getDailySpecialForToday();
          if (ctx && ctx.enabled && ctx.id === dqBoardId) {
            reward = Math.round(reward * ctx.rewardMult);
          }
        } catch (specErr) { /* soft-fail */ }
      }
    } else if (action === 'dyn_ach' && validatedMeta) {
      // Achievement reward — same pattern. Cross + per-board share the
      // dyn_ach_reward_<id> namespace because ach_ids are unique across
      // the two scopes (per-board: played/crown/score10/... ; cross:
      // pioneer5/all_themes/...).
      const r = await pool.query('SELECT value FROM game_config WHERE key = $1', ['dyn_ach_reward_' + validatedMeta.ach_id]);
      reward = parseInt((r.rows[0] || {}).value, 10) || 0;
    } else if (action === 'dyn_streak_milestone' && validatedMeta) {
      const r = await pool.query('SELECT value FROM game_config WHERE key = $1', ['dyn_streak_reward_' + validatedMeta.milestone]);
      reward = parseInt((r.rows[0] || {}).value, 10) || 0;
    } else if (action === 'daily_login') {
      // Tiered by streak. Client passes meta.streak — capped to a sane
      // range so a forged streak can't inflate the payout to absurdity.
      // The dedup above guarantees one claim per device per day.
      const streak = Math.max(1, Math.min(400, parseInt((meta && meta.streak) || 1, 10) || 1));
      let tierKey;
      if (streak >= 30)     tierKey = 'daily_login_reward_streak_30';
      else if (streak >= 7) tierKey = 'daily_login_reward_streak_7';
      else if (streak >= 3) tierKey = 'daily_login_reward_streak_3';
      else                  tierKey = 'daily_login_reward';
      const cfgRow = await pool.query('SELECT value FROM game_config WHERE key = $1', [tierKey]);
      let base = parseInt((cfgRow.rows[0] || {}).value, 10) || 0;
      // Belt-and-suspenders: if the tier key is missing/zero, fall back
      // to the base flat reward so the player still gets something.
      if (base <= 0 && tierKey !== 'daily_login_reward') {
        const fb = await pool.query(`SELECT value FROM game_config WHERE key = 'daily_login_reward'`);
        base = parseInt((fb.rows[0] || {}).value, 10) || 25;
      }
      reward = base;
      // ============================================================
      // Stage 14 — multiplier stack. Adds bonuses for the dynamic-board
      // streak + a friend who shared playing yesterday. Each is admin-
      // tunable + the total is capped at daily_login_mult_max_pct% of
      // the base (default 400% = 4x) for safety.
      // ============================================================
      const dynStreakRaw = parseInt((meta && meta.dynStreak) || 0, 10) || 0;
      const dynStreak = Math.max(0, Math.min(400, dynStreakRaw));
      const friendSharedRaw = !!(meta && meta.friendSharedYesterday);
      // Pull multiplier config in parallel.
      const cfgM = await pool.query(
        `SELECT key, value FROM game_config WHERE key LIKE 'daily_login_mult_%'`
      );
      const cfgMap = {};
      cfgM.rows.forEach(r => { cfgMap[r.key] = r.value; });
      const dynPct    = parseInt(cfgMap.daily_login_mult_dyn_streak_pct, 10) || 0;
      const dynMin    = parseInt(cfgMap.daily_login_mult_dyn_streak_min, 10) || 3;
      const friendPct = parseInt(cfgMap.daily_login_mult_friend_shared_pct, 10) || 0;
      const maxPct    = parseInt(cfgMap.daily_login_mult_max_pct, 10) || 300;
      // Build breakdown so the client can render it transparently.
      const breakdown = [
        { label: 'base', tier: tierKey, factor: 1.0, contribution: base }
      ];
      let totalPct = 100; // base = 100%
      if (dynStreak >= dynMin && dynPct > 0) {
        totalPct += dynPct;
        breakdown.push({ label: 'dyn_streak', dynStreak, factor: 1 + (dynPct / 100), contribution: Math.floor(base * dynPct / 100) });
      }
      if (friendSharedRaw && friendPct > 0) {
        totalPct += friendPct;
        breakdown.push({ label: 'friend_shared', factor: 1 + (friendPct / 100), contribution: Math.floor(base * friendPct / 100) });
      }
      // Apply cap.
      if (totalPct > maxPct) totalPct = maxPct;
      reward = Math.floor(base * totalPct / 100);
      // Stash breakdown so the response includes it (closure variable —
      // we'll attach to res.json below).
      res.locals = res.locals || {};
      res.locals.dailyLoginBreakdown = {
        base,
        baseTier: tierKey,
        totalPct,
        cappedAtPct: totalPct === maxPct,
        breakdown,
        finalReward: reward
      };
    } else if (action === 'daily_checklist_complete') {
      // T2.5 — re-verify allDone server-side. We re-run a lightweight
      // version of the GET /api/checklist/today logic. Refuse if not
      // genuinely complete (reason='checklist_not_complete').
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
        // (1) Gacha free pull claimed today.
        const gR = await pool.query(
          `SELECT 1 FROM player_gacha_state WHERE device_id = $1 AND free_pull_claimed_date::text = $2 LIMIT 1`,
          [deviceId, today]
        ).catch(() => ({ rows: [] }));
        const gachaClaimed = gR.rows.length > 0;
        // (2) Daily Deal purchased today.
        const ddR = await pool.query(
          `SELECT 1 FROM daily_deal_purchases WHERE device_id = $1 AND purchase_date = $2::date LIMIT 1`,
          [deviceId, today]
        ).catch(() => ({ rows: [] }));
        const dealBought = ddR.rows.length > 0;
        // (3) Daily quest claimed today (LIKE pattern on _earn dedup keys).
        const qR = await pool.query(
          `SELECT 1 FROM game_config WHERE key LIKE $1 LIMIT 1`,
          [`_earn:${deviceId}:dyn_quest:${today}:%`]
        ).catch(() => ({ rows: [] }));
        const questClaimed = qR.rows.length > 0;
        // (4) Played a game today (any source).
        const sR1 = await pool.query(
          `SELECT 1 FROM daily_scores WHERE device_id = $1 AND date = $2 LIMIT 1`,
          [deviceId, today]
        ).catch(() => ({ rows: [] }));
        const sR2 = sR1.rows.length === 0
          ? await pool.query(
              `SELECT 1 FROM difficulty_scores WHERE device_id = $1 AND date = $2 LIMIT 1`,
              [deviceId, today]
            ).catch(() => ({ rows: [] }))
          : { rows: [{ ok: 1 }] };
        const streakDone = sR1.rows.length > 0 || sR2.rows.length > 0;
        // (5) "Daily special played" — purely client-tracked in
        // localStorage. Client passes meta.dailySpecialDone=true. We
        // trust the flag (the rest of the checklist is server-verified
        // so a forged meta gives the cheater at most this single item;
        // doesn't change the outcome since allFive needs the other 4).
        const dailySpecialDone = !!(meta && meta.dailySpecialDone);
        const allFive = gachaClaimed && dealBought && questClaimed && streakDone && dailySpecialDone;
        if (!allFive) {
          return res.json({ ok: false, reason: 'checklist_not_complete' });
        }
      } catch (e) {
        return res.json({ ok: false, reason: 'verify_failed' });
      }
      const cfgRow = await pool.query('SELECT value FROM game_config WHERE key = $1', [configKey]);
      reward = parseInt((cfgRow.rows[0] || {}).value, 10) || 0;
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
    const responseBody = { ok: true, action, reward, xpGain, newBalance: newBal, level: newLevel, leveledUp };
    // Stage 14 — attach daily_login multiplier breakdown if the handler stashed it.
    if (res.locals && res.locals.dailyLoginBreakdown) {
      responseBody.breakdown = res.locals.dailyLoginBreakdown;
    }
    res.json(responseBody);
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

    // Push notification to the recipient — fire-and-forget.
    sendPushToDevice(recipient.device_id, {
      title: '🎁 מתנה!',
      body: (sender.display_name || 'מישהו') + ' שלח/ה לך ' + amt + '💎' +
            (safeMessage ? ' · "' + safeMessage.slice(0, 60) + '"' : ''),
      tag: 'gift-' + recipient.device_id + '-' + Date.now(),
      data: { url: '/', kind: 'gift', amount: amt }
    });
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

// GET /api/skins/available — public skin catalog used by the shop at boot.
// Returns only enabled skins so admin can hide one without deleting it.
// Each row also reports is_sellable separately: when false, existing owners
// still see the skin in their list (and can equip it), but the shop's buy
// button is greyed out with "currently unavailable" copy.
app.get('/api/skins/available', async (_req, res) => {
  try {
    const now = Date.now();
    if (_skinsCache.value !== undefined && _skinsCache.expiresAt > now) {
      return res.json(_skinsCache.value);
    }
    const r = await pool.query(
      `SELECT skin_id, name, price, is_sellable, definition, special_class, sort_order
         FROM skin_configurations
        WHERE is_enabled = TRUE
        ORDER BY sort_order ASC, id ASC`
    );
    const payload = { ok: true, skins: r.rows };
    _skinsCache = { value: payload, expiresAt: now + 60 * 1000 };
    res.json(payload);
  } catch (e) {
    console.error('GET /api/skins/available', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/player/buy-skin — purchase a skin with credits.
// Price comes from skin_configurations (admin-managed, server-authoritative).
// Records ownership in player_skins in the SAME transaction as the balance
// deduction, so a player can never end up debited without the skin (or with
// the skin but not debited). If the player already owns the skin, returns
// ok:true cost:0 alreadyOwned:true without re-charging.
// Skins disabled or marked unsellable by the admin reject with explicit reasons.
app.post('/api/player/buy-skin', requireDeviceAuth, async (req, res) => {
  const { deviceId, skinId } = req.body || {};
  if (!deviceId || !skinId) return res.status(400).json({ error: 'missing_params' });
  try {
    const skinRow = await pool.query(
      `SELECT price, is_enabled, is_sellable FROM skin_configurations WHERE skin_id = $1`,
      [skinId]);
    if (!skinRow.rows.length) {
      // Fallback for the legacy hardcoded map — accepts the historical 7 ids
      // in case the DB seed hasn't run yet (e.g. fresh dev environment).
      if (!Object.prototype.hasOwnProperty.call(SKIN_PRICES, skinId)) {
        return res.json({ ok: false, reason: 'invalid_skin' });
      }
    } else {
      if (!skinRow.rows[0].is_enabled) return res.json({ ok: false, reason: 'skin_disabled' });
      if (!skinRow.rows[0].is_sellable) return res.json({ ok: false, reason: 'not_sellable' });
    }
    const cost = skinRow.rows.length
      ? (skinRow.rows[0].price | 0)
      : (SKIN_PRICES[skinId] | 0);
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
  // Accept any string id; let the DB validate against the skin_configurations
  // catalog so admin-added skins also work for the migration. Cap the array
  // length to bound abuse; the SKIN_PRICES legacy map still works as fallback.
  const raw = skins.filter(s => typeof s === 'string' && s.length > 0 && s.length < 64).slice(0, 50);
  let valid = [];
  try {
    if (raw.length) {
      const known = await pool.query(
        `SELECT skin_id FROM skin_configurations WHERE skin_id = ANY($1::text[])`,
        [raw]);
      const dbSet = new Set(known.rows.map(r => r.skin_id));
      valid = raw.filter(s => dbSet.has(s) || Object.prototype.hasOwnProperty.call(SKIN_PRICES, s));
    }
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

    // Snapshot the active duel-board (if any) onto the duel row so both
    // players play under identical multipliers, even if admin changes
    // the active duel-board mid-duel. Same pattern as difficulty.
    let boardMults = null;
    let boardName  = null;
    try {
      const duelBoard = await getActiveBoardForMode('duel');
      if (duelBoard && duelBoard.type === 'multipliers' &&
          duelBoard.definition && Array.isArray(duelBoard.definition.multipliers)) {
        boardMults = JSON.stringify(duelBoard.definition.multipliers);
        boardName  = duelBoard.name || null;
      }
    } catch (boardErr) {
      // Snapshot is best-effort. A failure here means the duel just runs
      // vanilla — better than blocking duel creation on a board lookup.
    }

    const r = await pool.query(
      `INSERT INTO duels (challenger_device, challenger_name, challenger_code, opponent_code, opponent_device, opponent_name, amount, board_seed, expires_at, difficulty_label, difficulty_weights, difficulty_speed_pct, board_multipliers, board_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [deviceId, challenger.rows[0].display_name, challenger.rows[0].player_code, opponentCode, opponent.rows[0].device_id, opponent.rows[0].display_name, bet, seed, expiresAt, diff.label, diff.weights, diff.speed_pct, boardMults, boardName]);

    // Return the FULL row so the challenger can start their game immediately
    // (Bug 3 fix). The frontend needs difficulty_weights, opponent_name, and
    // board_seed to kick off startDuelGame without waiting for opponent accept.
    res.json({ ok: true, duel: r.rows[0], duelId: r.rows[0].id, seed, amount: bet, expiresAt, difficulty: diff.label });

    // Push notification to the opponent — fire-and-forget, never blocks
    // the response. The opponent's device buzzes with the challenge
    // even if BLOOM isn't open.
    sendPushToDevice(opponent.rows[0].device_id, {
      title: '⚔️ אתגר חדש!',
      body: (challenger.rows[0].display_name || 'מישהו') + ' אתגר/ה אותך לדו-קרב' +
            (bet > 0 ? ' · הימור ' + bet + '💎' : ''),
      tag: 'duel-invite-' + r.rows[0].id,
      data: { url: '/?action=duels', kind: 'duel_invite', duelId: r.rows[0].id }
    });
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
      // Push the challenger so they know their duel timed out even
      // if they aren't currently in BLOOM. Fire-and-forget.
      if (row.challenger_device) {
        sendPushToDevice(row.challenger_device, {
          title: '⏰ פג תוקף',
          body: 'הדו-קרב שלך פג תוקף ללא תגובה' +
                (bet > 0 ? ' · קיבלת חזרה ' + bet + '💎' : ''),
          tag: 'duel-expire-' + row.id,
          data: { url: '/?action=duels', kind: 'duel_expired', duelId: row.id }
        });
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
    // Notify the challenger that their challenge was declined.
    sendPushToDevice(duel.challenger_device, {
      title: '🤷 נדחית',
      body: (duel.opponent_name || duel.opponent_code || 'היריב') + ' סירב/ה לדו-קרב' +
            ((duel.amount | 0) > 0 ? ' · קיבלת חזרה ' + duel.amount + '💎' : ''),
      tag: 'duel-declined-' + duelId,
      data: { url: '/?action=duels', kind: 'duel_declined', duelId }
    });
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
      // Anti-cheat hide rule, now scoped to pre-accept only:
      //   • status='pending': opponent hasn't accepted yet → they could
      //     still /decline to refund their (yet-to-be-deducted) wager
      //     based on what they peek at. Keep hiding the challenger's
      //     score from them in this window.
      //   • status='accepted' (or later non-settled state): both
      //     players have already committed. The mid-game in-progress
      //     player NEEDS to see the opponent's final score as their
      //     target — hiding it broke the live-opponent HUD, where the
      //     player who's still playing would never see the opponent's
      //     score even after the opponent finished.
      // Anyone else (spectator, random fetcher) still gets nothing.
      if (d.status === 'pending' && iAmOpponent) {
        // Opponent hasn't accepted yet → could decline based on peek.
        d.challenger_score = null;
      }
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
          // Push both players — the one who's IN the app sees the
          // result overlay normally, but the one who'd left gets a
          // surprise "your duel is over!" buzz on their device.
          sendPushToDevice(u.challenger_device, {
            title: '🤝 תיקו!',
            body: 'הדו-קרב מול ' + (u.opponent_name || 'יריב') + ' הסתיים בתיקו · ההימור הוחזר',
            tag: 'duel-result-' + duelId,
            data: { url: '/?action=duels', kind: 'duel_tie', duelId }
          });
          sendPushToDevice(u.opponent_device, {
            title: '🤝 תיקו!',
            body: 'הדו-קרב מול ' + (u.challenger_name || 'יריב') + ' הסתיים בתיקו · ההימור הוחזר',
            tag: 'duel-result-' + duelId,
            data: { url: '/?action=duels', kind: 'duel_tie', duelId }
          });
          // Echo both scores so the second-to-play client can render
          // "vs <opponent score>" immediately (no need to wait for the
          // poller which only fires on the 'waiting' path).
          return res.json({
            ok: true,
            result: 'tie',
            refunded: true,
            yourScore: s,
            opponentScore: isChallenger ? u.opponent_score : u.challenger_score
          });
        }
        if (prize > 0) {
          await client.query(`UPDATE player_profiles SET balance = balance + $1, total_earned = total_earned + $1 WHERE device_id = $2`, [prize, winner]);
        }
        await client.query(`UPDATE duels SET status = 'settled', winner_device = $1 WHERE id = $2 AND status IN ('pending','accepted')`, [winner, duelId]);
        await client.query('COMMIT');
        // Include both scores in the response so the second-to-play
        // client renders the actual opponent score (instead of "...")
        // without waiting for the poll path that only fires on 'waiting'.
        res.json({
          ok: true,
          result: 'settled',
          winner: winner === deviceId ? 'you' : 'opponent',
          prize,
          yourScore: s,
          opponentScore: isChallenger ? u.opponent_score : u.challenger_score
        });
        // Push both players with personalised win/lose copy.
        const winnerIsChall = (winner === u.challenger_device);
        const challWin = winnerIsChall;
        sendPushToDevice(u.challenger_device, {
          title: challWin ? '🏆 ניצחת!' : '😔 הפסדת',
          body: challWin
            ? 'ניצחת את ' + (u.opponent_name || 'היריב') + (prize > 0 ? ' · +' + prize + '💎 פרס' : '')
            : (u.opponent_name || 'היריב') + ' ניצח/ה אותך הפעם',
          tag: 'duel-result-' + duelId,
          data: { url: '/?action=duels', kind: 'duel_result', duelId, winner: challWin ? 'you' : 'opponent' }
        });
        sendPushToDevice(u.opponent_device, {
          title: !challWin ? '🏆 ניצחת!' : '😔 הפסדת',
          body: !challWin
            ? 'ניצחת את ' + (u.challenger_name || 'היריב') + (prize > 0 ? ' · +' + prize + '💎 פרס' : '')
            : (u.challenger_name || 'היריב') + ' ניצח/ה אותך הפעם',
          tag: 'duel-result-' + duelId,
          data: { url: '/?action=duels', kind: 'duel_result', duelId, winner: !challWin ? 'you' : 'opponent' }
        });
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

// ============================================================
// WEB PUSH endpoints
// ============================================================
// GET /api/push/vapid-public — the public VAPID key the client
// needs to subscribe. Public is safe to expose. Returns null if
// push isn't configured server-side, so the client can skip the
// permission prompt cleanly.
app.get('/api/push/vapid-public', (_req, res) => {
  res.json({ key: _webpushConfigured ? VAPID_PUBLIC_KEY : null });
});

// POST /api/push/subscribe — client sends its PushSubscription
// after the browser grants permission. We store it keyed by
// (device_id, endpoint) so re-subscribes on the same device
// just refresh the keys instead of creating duplicate rows.
app.post('/api/push/subscribe', requireDeviceAuth, async (req, res) => {
  const deviceId = req.deviceId;
  const { endpoint, keys } = req.body || {};
  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ ok: false, reason: 'missing_endpoint' });
  }
  if (!keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ ok: false, reason: 'missing_keys' });
  }
  const ua = (req.headers['user-agent'] || '').toString().slice(0, 300);
  try {
    await pool.query(
      `INSERT INTO push_subscriptions
         (device_id, endpoint, p256dh_key, auth_key, user_agent, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (device_id, endpoint) DO UPDATE
         SET p256dh_key = EXCLUDED.p256dh_key,
             auth_key   = EXCLUDED.auth_key,
             user_agent = EXCLUDED.user_agent,
             last_used_at = NOW()`,
      [deviceId, endpoint, keys.p256dh, keys.auth, ua]);
    res.json({ ok: true });
  } catch (e) {
    console.error('push/subscribe', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/push/unsubscribe — explicit teardown when the user
// revokes notification permission or chooses to opt out.
app.post('/api/push/unsubscribe', requireDeviceAuth, async (req, res) => {
  const deviceId = req.deviceId;
  const { endpoint } = req.body || {};
  try {
    if (endpoint) {
      await pool.query(
        `DELETE FROM push_subscriptions WHERE device_id = $1 AND endpoint = $2`,
        [deviceId, endpoint]);
    } else {
      // No endpoint = wipe all subscriptions for this device.
      await pool.query(`DELETE FROM push_subscriptions WHERE device_id = $1`, [deviceId]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('push/unsubscribe', e.message);
    res.status(500).json({ error: 'server' });
  }
});

// POST /api/push/test — for QA only. Sends a test push to the
// requester's own subscriptions. Useful for verifying the SW + VAPID
// + subscription chain works end-to-end.
app.post('/api/push/test', requireDeviceAuth, async (req, res) => {
  await sendPushToDevice(req.deviceId, {
    title: '🌸 BLOOM',
    body: 'התראות מיידיות פעילות!',
    tag: 'test',
    data: { url: '/', kind: 'test' }
  });
  res.json({ ok: true });
});

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
