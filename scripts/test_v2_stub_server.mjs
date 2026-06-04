// Throwaway stub server for the Game-v2 browser integration test.
// Serves public/ statically + faithful stubs of the 3 endpoints the v2 loader
// touches. NOT used in production — local verification only.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../public/', import.meta.url).pathname;
const PORT = process.env.STUB_PORT ? parseInt(process.env.STUB_PORT, 10) : 3010;

// Mutable flag state — flip via GET /__set?enabled=&pct=
let FLAG = { enabled: true, rollout_pct: 100 };
let lastScore = null;          // last POST /api/score/practice body
let scorePosts = [];

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

  if (p === '/__set') { FLAG.enabled = u.searchParams.get('enabled') === 'true'; FLAG.rollout_pct = Math.max(0,Math.min(100,parseInt(u.searchParams.get('pct')||'0',10)||0)); return json({ ok:true, FLAG }); }
  if (p === '/__last_score') return json({ lastScore, count: scorePosts.length, scorePosts });

  if (p === '/api/flags/game_v2') {
    const uid = u.searchParams.get('deviceId') || 'anon';
    let variant = 'classic';
    if (FLAG.enabled && v2Bucket(uid) < FLAG.rollout_pct) variant = 'v2';
    const force = u.searchParams.get('force'); const key = u.searchParams.get('force_key');
    if (FLAG.enabled && (force==='v2'||force==='classic') && key === 'TESTKEY') variant = force;
    return json({ enabled: FLAG.enabled, rollout_pct: FLAG.rollout_pct, variant });
  }
  if (p === '/api/register' && req.method === 'POST') return json({ ok:true, token: 'stub-token-123' });
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
