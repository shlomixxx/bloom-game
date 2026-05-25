# 🔍 BLOOM — דוח ביקורת מקיף + משימות תיקון

**תאריך:** 15 מאי 2026
**נבדק:** קוד מקור מלא מ-GitHub (`shlomixxx/bloom-game`)
**היקף:** Frontend (6,667 שורות), Backend (2,179 שורות), DB Schema, SW, PWA Manifest

---

## סיכום מנהלים

המשחק בנוי יפה מאוד — קוד נקי, ארכיטקטורה פשוטה וחכמה (single-file frontend, Express backend קטן). המנגנון פועל, ה-UX מלוטש, ויש תכנון מוצר רציני (daily challenge, contests, challenges, spectating, admin dashboard). עם זאת, יש **בעיות אבטחה קריטיות** שצריך לטפל בהן לפני שפש ציבורי משמעותי נכנס, וכן באגים ושיפורים שיעזרו לייצב את המוצר.

---

## 🔴 קריטי — אבטחה (תקן עכשיו)

### 1. אין אימות צד-שרת של ניקוד (Anti-Cheat)
**מיקום:** `server.js` שורות 182-225, `public/index.html` שורות 5977-6066
**בעיה:** כל הלוגיקה של המשחק רצה בצד הלקוח. שחקן יכול לשלוח POST ל-`/api/score` עם כל ניקוד שירצה. ב-daily challenge אין שום בדיקת אנטי-צ'יט (בניגוד ל-challenges שיש שם לפחות drops heuristic + z-score).
**השפעה:** טבלת המובילים יכולה להתמלא בציונים מזויפים.
**תיקון עם Claude:**
```
פתח את server.js. ב-POST /api/score הוסף:
1. בדיקת drops/score ratio (כמו challengeDropsImplausible)
2. שמירת drops_count בטבלת daily_scores
3. הוספת שדה drops ל-body validation
4. flagging של ניקוד חשוד (z-score > 3 מול ממוצע יומי)
```

### 2. deviceId ניתן לזיוף — אין אימות זהות אמיתי
**מיקום:** `public/index.html` שורה 3967-3978 (UUID generation), כל endpoint בשרת
**בעיה:** הזהות מבוססת על UUID ב-localStorage. כל אחד יכול:
- לשלוח requests עם deviceId מזויף
- להיכנס ל-challenges מכמה "מכשירים"
- לדרוס ציונים של שחקנים אחרים (כי ה-upsert בודק רק score > old)
**השפעה:** ניצול לא ויראלי של challenges עם פרסים, זיוף טבלאות.
**תיקון עם Claude:**
```
שני שלבים:
שלב 1 (מהיר): הוסף HMAC signing — השרת מנפיק token ב-/api/register 
שהלקוח שולח בכל request. לא bullet-proof אבל מרתיע.
שלב 2 (ארוך טווח): הוסף fingerprinting (canvas hash, WebGL, screen res)
כ-secondary signal לזיהוי multi-account.
```

### 3. SSL Certificate Verification מנוטרל
**מיקום:** `db.js` שורה 10
**בעיה:** `rejectUnauthorized: false` — הקוד לא מאמת את תעודת ה-SSL של ה-DB. פותח פתח להתקפת Man-in-the-Middle.
**תיקון עם Claude:**
```
ב-db.js, שנה את שורה 10 ל:
ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: true }
אם Railway דורש cert מותאם, הוסף ca: process.env.PGSSLCERT
ובדוק שה-DATABASE_URL של Railway תומך ב-SSL תקין.
```

### 4. אין Security Headers
**מיקום:** `server.js` שורות 1-8
**בעיה:** אין CSP, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security.
**תיקון עם Claude:**
```
התקן helmet: npm install helmet
בתחילת server.js הוסף:
import helmet from 'helmet';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  },
  frameguard: { action: 'deny' }
}));
```

### 5. `window.BloomDebug` חשוף בפרודקשן
**מיקום:** `public/index.html` שורות 6639-6660
**בעיה:** ה-API הפנימי למשחק חשוף לכל מבקר. שחקן יכול לקרוא `BloomDebug.drop()` מה-console, או לכתוב סקריפט אוטומטי.
**תיקון עם Claude:**
```
עטוף את window.BloomDebug בתנאי:
const params = new URLSearchParams(window.location.search);
if (params.has('bot') || params.has('botui')) {
  window.BloomDebug = { ... };
}
```

---

## 🟠 גבוה — באגים פונקציונליים

### 6. Race Condition ב-beat type winner assignment
**מיקום:** `server.js` שורות 1296-1305
**בעיה:** ב-`/api/challenges/:slug/complete` עבור סוג `beat`, הקצאת winner_rank לא עטופה ב-transaction (בניגוד ל-`race` ו-`first_to_tier` שעוברות `maybeGrabWinnerSlot` עם FOR UPDATE lock). שני שחקנים שמסיימים בו-זמנית יכולים לקבל אותו winner_rank.
**תיקון עם Claude:**
```
ב-server.js, שנה את הקוד של beat type (שורות 1296-1305) להשתמש 
ב-maybeGrabWinnerSlot עם BEGIN/COMMIT כמו ב-race type.
או לחלופין: עטוף ב-transaction ושלוף COUNT + UPDATE אטומית.
```

### 7. Daily Challenge מוגן רק ע"י localStorage
**מיקום:** `public/index.html` שורה 5381-5393
**בעיה:** שחקן יכול לנקות localStorage, לפתוח incognito, או לשנות את `bloom_daily_YYYY-MM-DD` — ולשחק שוב ביומי. הציון העליון יישמר בשרת (upsert), אבל הוא מקבל אינסוף ניסיונות.
**תיקון עם Claude:**
```
הוסף בדיקה בצד השרת: ב-POST /api/score, בדוק אם כבר יש שורה 
ל-(date, device_id). אם כן, דחה עם status 409.
זה לא מונע לחלוטין (deviceId spoofable), אבל מוסיף שכבת הגנה.
```

### 8. Best Score מתעדכן מכל המודים
**מיקום:** `public/index.html` שורה 6005
**בעיה:** `if (score > best) { best = score; localStorage.setItem(BEST_KEY, ...) }` — פועל גם באימון חופשי. שחקן שמשיג ציון גבוה באימון רואה אותו כ"שיא" אישי, אבל זה לא הציון היומי שלו.
**תיקון עם Claude:**
```
שנה את שורה 6005 ל:
if (score > best && mode !== 'practice') {
  best = score;
  localStorage.setItem(BEST_KEY, String(best));
}
או: שמור best_daily ו-best_practice בנפרד.
```

### 9. "בוא נתחיל" ו"אני יודע לשחק" עושים אותו דבר
**מיקום:** `public/index.html` שורות 2893-2894
**בעיה:** שני הכפתורים מצביעים על אותה פונקציית `enter`. "בוא נתחיל" צריך לפתוח טוטוריאל, "דלג" צריך להיכנס ישירות.
**תיקון עם Claude:**
```
שנה את onclick של home-start ל:
document.getElementById('home-start').onclick = function() {
  ensureAudio();
  if (!hasSeenTour()) { showTour({ onDone: enter }); }
  else { enter(); }
};
```

---

## 🟡 בינוני — שיפורים טכניים

### 10. Ephemeral Tables גדלות ללא הגבלה
**מיקום:** `schema.sql` שורות 81-108 (`contest_live_state`, `contest_watchers`)
**בעיה:** אין cleanup cron לשורות ישנות. הטבלאות רק גדלות.
**תיקון עם Claude:**
```
הוסף cleanup בשרת (setInterval כל שעה):
setInterval(async () => {
  await pool.query(`DELETE FROM contest_live_state 
    WHERE updated_at < NOW() - INTERVAL '1 hour'`);
  await pool.query(`DELETE FROM contest_watchers 
    WHERE updated_at < NOW() - INTERVAL '1 hour'`);
}, 60 * 60 * 1000);
```

### 11. Duplicate Manifest Link
**מיקום:** `public/index.html` שורות 18-19
**בעיה:** `<link rel="manifest">` מופיע פעמיים.
**תיקון:** מחק את שורה 19.

### 12. Service Worker Cache Name קבוע
**מיקום:** `public/sw.js` שורה 4
**בעיה:** `CACHE_NAME = 'bloom-v1-2026-05-14'` — צריך לעדכן ידנית בכל deploy. שחקנים עם SW ישן רואים גרסה ישנה.
**תיקון עם Claude:**
```
אפשרות 1: הוסף build step שמכניס hash לקובץ.
אפשרות 2: בserver.js, הגש את sw.js דינמית עם version מ-package.json.
אפשרות 3: הוסף סקריפט npm run build שמחליף את ה-CACHE_NAME.
```

### 13. קבצי MP3 כפולים ב-root
**מיקום:** שורש הריפו (3 קבצי mp3)
**בעיה:** `410574__manuelgraf__*.mp3` קיימים גם ב-root וגם ב-`public/` (עם שמות שונים). הקבצים ב-root הם 768KB שלא משרתים שום מטרה.
**תיקון:** מחק את 3 קבצי ה-MP3 מה-root.

### 14. Rate Limit Store חשוף ל-Memory Bloat
**מיקום:** `server.js` שורות 136-159
**בעיה:** ה-`rateLimitStore` הוא `Map` in-memory שמנוקה כל 5 דקות. תחת DDoS, המפה יכולה לגדול מאוד בין ניקויים.
**תיקון עם Claude:**
```
הוסף hard cap:
const MAX_RATE_LIMIT_KEYS = 50000;
function checkRateLimit(bucket, deviceId, maxRequests, windowMs) {
  if (rateLimitStore.size > MAX_RATE_LIMIT_KEYS) rateLimitStore.clear();
  // ... rest of logic
}
```

### 15. PWA Manifest חסר maskable icon
**מיקום:** `public/manifest.json`
**בעיה:** אין אייקון עם `"purpose": "maskable"` — באנדרואיד האייקון לא מותאם לצורת Adaptive Icons.
**תיקון עם Claude:**
```
הוסף למערך icons:
{
  "src": "/assets/icon-512.png",
  "sizes": "512x512",
  "type": "image/png",
  "purpose": "maskable"
}
```

### 16. Error Handling ב-init() לתחרויות
**מיקום:** `public/index.html` שורות 5414-5421
**בעיה:** אם `fetchContest()` נכשל, `activeContestData` נשאר stale והמשחק משתמש ב-board seed שגוי.
**תיקון עם Claude:**
```
הוסף catch:
const data = await fetchContest(activeContestCode).catch(() => null);
if (!data || !data.contest) {
  // Show error toast to user
  mode = 'practice';
  rng = Math.random;
  updateModeBar();
  return;
}
```

---

## 🔵 נמוך — שיפורי UX/Quality

### 17. אין CORS protection
**מיקום:** `server.js`
**בעיה:** כל אתר יכול לקרוא ל-API של BLOOM. מאפשר script injection מאתרים חיצוניים.
**תיקון עם Claude:**
```
npm install cors
import cors from 'cors';
app.use(cors({ origin: 'https://bloom-web-production-f3bd.up.railway.app' }));
```

### 18. Grid Scroll על מכשירים קטנים
**מיקום:** `public/index.html` שורות 309-323 (CSS `.grid-wrap`)
**בעיה:** `overflow-y: auto` — על מכשירים קטנים מאוד (iPhone SE), הלוח עלול לגלול, מה שפוגע בחוויית המשחק.
**תיקון עם Claude:**
```
הוסף @media query שמקטין את padding ואת הכפתורים 
עבור מסכים קטנים מ-667px height.
גם: שקול overflow-y: hidden + fitGrid אגרסיבי יותר.
```

### 19. Inline onclick ב-createBackButton
**מיקום:** `public/index.html` שורה 2956
**בעיה:** `onclick="..."` כ-string ב-HTML — דפוס שברי שסותר CSP.
**תיקון עם Claude:**
```
שנה את createBackButton לקבל callback ישירות:
function createBackButton(id) {
  return '<button class="contest-back-btn" id="' + id + '" ...>';
}
ואחרי innerHTML, חבר את ה-onclick עם addEventListener.
```

### 20. Overlay Scroll Fade חותך כפתורים
**מיקום:** `public/index.html` שורות 441-446
**בעיה:** `mask-image: linear-gradient(...)` ב-`.overlay` מטשטש את התחתית — כולל כפתורי שיתוף ו"שחק שוב" לפני גלילה.
**תיקון עם Claude:**
```
הוסף padding-bottom גדול יותר ל-.overlay (למשל 30px), 
או הגדל את ה-calc מ-14px ל-30px כדי שהכפתורים יהיו תמיד מעל ל-fade.
```

### 21. DB Connection Pool ללא הגדרות
**מיקום:** `db.js` שורות 8-11
**בעיה:** אין `max`, `min`, `idleTimeoutMillis`, `connectionTimeoutMillis` — משתמש בברירות מחדל של pg (max: 10).
**תיקון עם Claude:**
```
export const pool = new Pool({
  connectionString,
  ssl: ...,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});
```

### 22. אין Graceful Shutdown
**מיקום:** `server.js` שורות 2174-2179
**בעיה:** אין handler ל-SIGTERM/SIGINT. ב-Railway, deploy חדש שולח SIGTERM — connections פתוחים נקטעים באמצע.
**תיקון עם Claude:**
```
const server = app.listen(port, ...);
process.on('SIGTERM', () => {
  console.log('[bloom] shutting down gracefully');
  server.close(() => {
    pool.end(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000);
});
```

---

## 📋 סדר עדיפויות לביצוע

| # | משימה | חומרה | מאמץ |
|---|--------|--------|------|
| 1 | Anti-cheat בסיסי לניקוד (#1) | 🔴 קריטי | 2-3 שעות |
| 2 | SSL verification (#3) | 🔴 קריטי | 10 דקות |
| 3 | Security headers (#4) | 🔴 קריטי | 15 דקות |
| 4 | הסתרת BloomDebug (#5) | 🔴 קריטי | 5 דקות |
| 5 | Beat winner race fix (#6) | 🟠 גבוה | 30 דקות |
| 6 | Daily double-play server check (#7) | 🟠 גבוה | 30 דקות |
| 7 | Best score separation (#8) | 🟠 גבוה | 15 דקות |
| 8 | Fix duplicate buttons (#9) | 🟠 גבוה | 10 דקות |
| 9 | Ephemeral cleanup (#10) | 🟡 בינוני | 15 דקות |
| 10 | Duplicate manifest (#11) | 🟡 בינוני | 1 דקה |
| 11 | MP3 duplicates (#13) | 🟡 בינוני | 1 דקה |
| 12 | Graceful shutdown (#22) | 🟡 בינוני | 15 דקות |
| 13 | CORS protection (#17) | 🔵 נמוך | 10 דקות |
| 14 | SW cache versioning (#12) | 🔵 נמוך | 30 דקות |
| 15 | Rate limit cap (#14) | 🔵 נמוך | 5 דקות |
| 16 | Maskable icon (#15) | 🔵 נמוך | 5 דקות |
| 17 | DB pool config (#21) | 🔵 נמוך | 5 דקות |
| 18 | HMAC device auth (#2) | 🔵 phase 2 | 4-6 שעות |

---

## 💪 מה שעובד מעולה

- **מנוע המיזוג** — BFS group detection, gravity, chain reactions — כתוב נקי ונכון
- **ניקוד** — פורמולה חכמה עם tier weighting ו-chain multipliers שמתגמלת שחקנים מיומנים
- **Daily deterministic seed** — mulberry32 PRNG עם seed מבוסס-תאריך ישראלי — אלגנטי
- **Spectator mode** — live grid broadcasting עם heartbeat כל שניה, audience awareness badge
- **Admin dashboard** — DAU/WAU/MAU, retention cohorts, funnel, heatmap, z-score outlier detection
- **Audio system** — Web Audio API עם gapless looping, cross-fade, separate volume sliders
- **PWA** — manifest, SW, apple-mobile-web-app-capable, offline-first architecture
- **Anti-cheat ב-challenges** — drops heuristic + z-score, FOR UPDATE locks לwinner slots
- **Code quality** — escapeHtml בכל מקום שצריך, rate limiting בכל endpoint, input validation

---

*הופק אוטומטית ע"י Claude Opus · מבוסס על ניתוח קוד מקור מלא*
