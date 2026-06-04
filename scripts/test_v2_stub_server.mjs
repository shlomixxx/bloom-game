// Throwaway stub server for the Game-v2 browser integration test.
// Serves public/ statically + faithful stubs of the 3 endpoints the v2 loader
// touches. NOT used in production — local verification only.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../public/', import.meta.url).pathname;
const PORT = process.env.STUB_PORT ? parseInt(process.env.STUB_PORT, 10) : 3010;

// Mutable flag state — flip via GET /__set?enabled=&pct=&beta=
let FLAG = { enabled: true, rollout_pct: 100, beta_enabled: false };
let lastScore = null;          // last POST /api/score/practice body
let scorePosts = [];
let feedbackPosts = [];        // POST /api/feedback bodies

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};
function v2Bucket(id){ let h=0; const s=String(id||''); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h%100; }

function readBody(req){ return new Promise(r=>{ let b=''; req.on('data',c=>b+=c); req.on('end',()=>r(b)); }); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const json = (o, code=200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };

  if (p === '/__set') { FLAG.enabled = u.searchParams.get('enabled') === 'true'; FLAG.rollout_pct = Math.max(0,Math.min(100,parseInt(u.searchParams.get('pct')||'0',10)||0)); FLAG.beta_enabled = u.searchParams.get('beta') === 'true'; return json({ ok:true, FLAG }); }
  if (p === '/__last_score') return json({ lastScore, count: scorePosts.length, scorePosts });
  if (p === '/__feedback') return json({ count: feedbackPosts.length, feedbackPosts });

  if (p === '/api/flags/game_v2') {
    function readCookie(name){ const c=req.headers.cookie||''; const m=c.match(new RegExp('(?:^|;\\s*)'+name+'=([^;]*)')); return m?decodeURIComponent(m[1]):''; }
    const uid = u.searchParams.get('deviceId') || 'anon';
    let variant = 'classic';
    if (FLAG.enabled && v2Bucket(uid) < FLAG.rollout_pct) variant = 'v2';
    const betaQ = u.searchParams.get('beta');
    let betaCookie = readCookie('bb_beta');
    const setCookies = [];
    if (betaQ === 'classic') { setCookies.push('bb_beta=; Max-Age=0; Path=/; SameSite=Lax'); betaCookie=''; }
    else if (betaQ === 'v2' && FLAG.beta_enabled) { setCookies.push('bb_beta=v2; Max-Age=15552000; Path=/; SameSite=Lax'); betaCookie='v2'; }
    if (FLAG.beta_enabled && betaCookie === 'v2') variant = 'v2';
    const force = u.searchParams.get('force'); const key = u.searchParams.get('force_key');
    if ((force==='v2'||force==='classic') && key === 'TESTKEY') variant = force;
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(200);
    return res.end(JSON.stringify({ enabled: FLAG.enabled, rollout_pct: FLAG.rollout_pct, beta_enabled: FLAG.beta_enabled, variant }));
  }
  if (p === '/api/register' && req.method === 'POST') return json({ ok:true, token: 'stub-token-123' });
  if (p === '/api/feedback' && req.method === 'POST') {
    const body = await readBody(req); let parsed=null; try{ parsed=JSON.parse(body); }catch(e){}
    feedbackPosts.push(parsed);
    return json({ ok:true });
  }
  if (p === '/api/score/practice' && req.method === 'POST') {
    const body = await readBody(req); let parsed=null; try{ parsed=JSON.parse(body); }catch(e){}
    lastScore = parsed; scorePosts.push(parsed);
    return json({ ok:true, rank: 1, total: 1 });
  }
  // Any other API call (classic makes many) → benign empty OK so the shell renders.
  if (p.startsWith('/api/')) return json({ ok:false, stub:true });

  // Static files from public/
  let rel = p === '/' ? 'index.html' : p.replace(/^\//,'').split('?')[0];
  const full = normalize(join(ROOT, rel));
  if (!full.startsWith(normalize(ROOT))) { res.writeHead(403); return res.end('no'); }
  if (!existsSync(full)) { res.writeHead(404); return res.end('not found'); }
  try {
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (e) { res.writeHead(500); res.end('err'); }
});
server.listen(PORT, () => console.log('[stub] listening on ' + PORT));
