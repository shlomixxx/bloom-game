# 📋 BLOOM — משימות מסודרות v2 (Round 2)

> **🎯 מטרת-על: BLOOM = משחק הכי ממכר שאפשר.**
>
> זו רשימת משימות חדשה אחרי שתיקנת את רוב הביקורת הראשונה.
> מתמקדת ב-**4 נושאים חדשים** שביקשת:
>
> 1. 🛡 **Exploit Prevention** — שחקן לא יעשה רענון לקבל פרסומת שוב
> 2. 🖼 **Game-Over Persistence** — אחרי סיום, גם ברענון יראה משהו מיוחד (לא לוח עם אריחים)
> 3. 📱 **Display Size** — תקן את מה שמקטין את המשחק
> 4. 🎯 **Stuck Screens** — לחצנים שלא עובדים, מסכים תקועים
>
> ⚠️ **כלל ברזל**: לפני כל שינוי — אל תיגע במנוע (BFS / gravity / chain scoring / merge logic).
>
> 📎 הסבר מלא בכל בעיה ב-`BLOOM_FULL_AUDIT.md`.

---

## 🔥 PHASE A — Game-Over Exploit + Persistence (הכי דחוף!)
> ⏱ ~6 שעות | 🎯 שחקן לא יכול לרמות + לא יאבד את הציון שלו
> 💡 **למה זה ממכר**: סיום משחק = רגע השיא הרגשי. אסור לאבד אותו.

### - [x] **TA.1** — Game-Over Persistence לכל המודים ✅
> 🚨 **הכי דחוף**. שחקן ב-practice עושה ציון מטורף → רענון → איבד הכל = יוצא לרעה.
>
> **בוצע (2026-05-25)**: snapshot של מסך game-over נשמר ל-`bloom_last_game_v1` עם TTL של 30 דקות עבור practice / dynamic / contest (daily כבר מוגן ע"י `DAILY_PLAYED_PREFIX`). Boot ב-`src/13-boot.js` קורא את ה-snapshot, מחזיר את ה-mode, ולגבי dynamic — פוטר באופן עצל את ה-board מ-`/api/boards/available`. `init()` ב-`src/11-game.js` בודק את ה-snapshot ב-`!fresh`, מצייר את המסך עם `restored: true`. `src/12-tour-info.js` מוסיף banner ירוק "💾 המשחק שלך נשמר" עם כפתור "🎮 משחק חדש" שקורא ל-`safeRemove(LAST_GAME_KEY)` + `init(mode, {fresh:true})`. הכפתור "continue-ad" נחסם במסך restored (exploit prevention — הלוח ריק אחרי restore). הכפתור "again" וכפתור Play בבית כעת מעבירים `fresh:true` כדי לא להיתפס במסך restored כשהשחקן מבקש משחק חדש. CSS חדש ב-`public/css/screens.css` עם dark mode. Engine self-test: 200 games / 13,947 drops / 8,875 merges / 0 floating tiles. Cache buster `v20260525b`, SW `bloom-v13.4`.

**מיקום**: `src/11-game.js` + `src/12-tour-info.js` (render function) + `src/04-ui-utils.js` (storage)

**מה לעשות**:

1. ב-`src/04-ui-utils.js` הוסף constants:
```javascript
var LAST_GAME_KEY = 'bloom_last_game_v1';
var LAST_GAME_TTL_MS = 30 * 60 * 1000;  // 30 דקות
```

2. ב-`src/11-game.js` בתוך game-over flow (אחרי `__bloomGameOver = true`):
```javascript
// שמור את ה-game-over state כדי לאפשר persist אחרי רענון
try {
  var lastGame = {
    mode: mode,
    score: score,
    highestTier: highestTier,
    isNewBest: isNewBest,
    dailyRank: dailyRank || null,
    dailyTotal: dailyTotal || null,
    gameId: (typeof getCurrentGameId === 'function') ? getCurrentGameId() : '',
    boardId: (window._activeDynamicBoard && window._activeDynamicBoard.id) || null,
    ts: Date.now()
  };
  safeSet(LAST_GAME_KEY, JSON.stringify(lastGame));
} catch(e) {}
```

3. ב-`src/11-game.js` בתחילת `init()` (אחרי `if (fresh)` block):
```javascript
// בדוק אם יש game-over recent (פחות מ-30 דקות) ושחקן מנסה להמשיך לאותו mode
if (!fresh && mode !== 'daily') {
  try {
    var lastRaw = safeGet(LAST_GAME_KEY);
    if (lastRaw) {
      var last = JSON.parse(lastRaw);
      var ageMs = Date.now() - (last.ts || 0);
      if (last.mode === mode && ageMs < LAST_GAME_TTL_MS) {
        // המשחק האחרון הסתיים. הצג game-over במקום להתחיל חדש.
        score = last.score;
        highestTier = last.highestTier;
        window.__bloomGameOver = true;
        busy = true;
        // הגדרת gameId כדי שהכפתורים יזכרו את ה-state
        if (last.gameId && typeof sessionStorage !== 'undefined') {
          try { sessionStorage.setItem('bloom_active_game_id', last.gameId); } catch(e) {}
        }
        render({ over: true, isNewBest: !!last.isNewBest, restored: true });
        return;
      }
    }
  } catch(e) {}
}
```

4. ב-`render({ over: true })` ב-`src/12-tour-info.js`, אם `opts.restored === true`, הוסף כפתור גדול **"🎮 משחק חדש"** שמנקה את ה-LAST_GAME_KEY ומפעיל `init({fresh: true})`.

5. אחרי השחקן לוחץ "משחק חדש":
```javascript
safeRemove(LAST_GAME_KEY);
init(mode, { fresh: true });
```

**בדיקת אבטחה**:
- ✅ gameId מועבר → ad-watch button נשאר חסום (sessionStorage `bloom_ad_claimed_<gameId>` נשמר)
- ✅ Server-side dedup על gameId עדיין מגן
- ✅ Daily mode לא נפגע (יש לו flow משלו עם DAILY_PLAYED_PREFIX)

---

### - [x] **TA.2** — Continue Button Dedup (Server-Side) ✅
> 🚨 שחקן יכול לעשות רענון ולקבל continue שוב ושוב.
>
> **בוצע (2026-05-25)**: endpoint חדש `POST /api/player/continue-ad` ב-`server.js` (אחרי `/api/player/ad-watch`) שמנהל dedup ברמת השרת — תבנית זהה ל-ad-watch: dedup לפי `_cont:<deviceId>:<gameId>` (אחד פעם לכל gameId לנצח), cap יומי `_cont_count:<deviceId>:<date>` (ברירת מחדל 3 דרך `continue_daily_cap`), cooldown `_cont_rate:<deviceId>` (30s דרך `continue_cooldown_seconds`). שני config keys חדשים ב-`schema.sql` (idempotent INSERT). הלקוח ב-`src/12-tour-info.js` (`continue-ad` button) קורא לשרת **לפני** `simulateAdWatch` — אם השרת מחזיר `already_continued` / `daily_cap` / `rate_limited`, הכפתור מציג הודעה מתאימה ולא נטענת פרסומת. ה-`getCurrentGameId()` כבר משומר ב-sessionStorage גם דרך רענון (TA.1 שומר את ה-gameId הקודם), אז ה-dedup מחזיק גם אחרי F5. שחקן רגיל עדיין יכול להמשיך פעם אחת במשחק. ה-exploit סגור: 100 ריענונים = 100×0 פרסומות חינמיות (במקום 100×continue free).

**מיקום**: `server.js` + `src/12-tour-info.js`

**מה לעשות**:

1. ב-`server.js` הוסף endpoint חדש אחרי `/api/player/ad-watch`:
```javascript
// POST /api/player/continue-ad — claim "watch ad to continue" reward.
// Same protection model as /ad-watch: per-game dedup, daily cap, cooldown.
app.post('/api/player/continue-ad', requireDeviceAuth, async (req, res) => {
  const deviceId = req.deviceId;
  const gameId = String((req.body && req.body.gameId) || '').slice(0, 64);
  if (!gameId || !/^[A-Za-z0-9_-]{8,64}$/.test(gameId)) {
    return res.status(400).json({ error: 'bad_game_id' });
  }
  try {
    // One continue per (device, gameId) — שמירת dedup
    const dedupKey = '_cont:' + deviceId + ':' + gameId;
    const dup = await pool.query(`SELECT 1 FROM game_config WHERE key = $1`, [dedupKey]);
    if (dup.rows.length) return res.json({ ok: false, reason: 'already_continued' });

    // Daily cap (default 3 continues per day)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const countKey = '_cont_count:' + deviceId + ':' + today;
    const countRow = await pool.query(`SELECT value FROM game_config WHERE key = $1`, [countKey]);
    const usedToday = countRow.rows.length ? (parseInt(countRow.rows[0].value, 10) || 0) : 0;
    const dailyCap = 3;
    if (usedToday >= dailyCap) {
      return res.json({ ok: false, reason: 'daily_cap', dailyCap, usedToday });
    }

    // Insert dedup (atomic)
    const ins = await pool.query(
      `INSERT INTO game_config (key, value) VALUES ($1, '1')
       ON CONFLICT (key) DO NOTHING RETURNING 1`,
      [dedupKey]);
    if (!ins.rows.length) return res.json({ ok: false, reason: 'already_continued' });

    // Bump counter
    await pool.query(
      `INSERT INTO game_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = (game_config.value::int + 1)::text`,
      [countKey, String(usedToday + 1)]);

    res.json({ ok: true, dailyRemaining: Math.max(0, dailyCap - usedToday - 1) });
  } catch (e) {
    console.error('player/continue-ad', e.message);
    res.status(500).json({ error: 'server' });
  }
});
```

2. ב-`src/12-tour-info.js` שורה 894 (`continue-ad` button) — לפני `simulateAdWatch`:
```javascript
if (continueAdBtn) continueAdBtn.onclick = function() {
  var btn = this;
  btn.disabled = true; btn.textContent = '⏳ טוען פרסומת...';
  // Server-side dedup check לפני הזרמת הפרסומת
  var gameId = (typeof getCurrentGameId === 'function') ? getCurrentGameId() : null;
  if (!gameId) {
    btn.textContent = 'שגיאה'; return;
  }
  fetch(API_BASE + '/api/player/continue-ad', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId, 'X-Device-Token': deviceToken },
    body: JSON.stringify({ gameId: gameId })
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (!d || !d.ok) {
      if (d && d.reason === 'already_continued') {
        btn.textContent = '✓ כבר קיבלת';
      } else if (d && d.reason === 'daily_cap') {
        btn.textContent = 'הגעת ל-' + d.dailyCap + ' continues';
      } else {
        btn.textContent = 'לא ניתן כעת';
      }
      return;
    }
    // Server אישר — עכשיו הזרם פרסומת בפועל
    simulateAdWatch(function() {
      usedContinue = true;
      for (var r = 0; r < 2; r++)
        for (var c = 0; c < getBoardCols(); c++) grid[r][c] = 0;
      applyGravity();
      busy = false;
      startEventSystem();
      playMusic('game');
      render();
      showEventBanner('💪 חיים נוספים!', 'המשך לשחק!', 'continue');
      shakeGrid(3);
      if (mode === 'practice') savePracticeGameState();
    });
  }).catch(function() { btn.textContent = 'שגיאה'; });
};
```

3. בדוק שאין רגרסיה — שחקן רגיל עדיין יכול להמשיך פעם אחת במשחק.

---

### - [x] **TA.3** — Shareable Game-Over Card ✅
> 🎁 שחקן רוצה להראות לחברים שניצח. כפתור share בולט = K-factor.
>
> **בוצע (2026-05-25)**: ה-canvas-rendered share card + 4 כפתורי שיתוף (WhatsApp / Native / Copy / Save) **כבר קיים** ב-Stage 32 (`src/27-replay.js` + `renderShareCard()`). הוסף עכשיו ב-`src/12-tour-info.js`: confetti 48 חלקיקים + `soundMilestone(7)` (החזק ביותר ב-pipeline) + buzz pattern `[40,30,60,30,90]` כשמסיים משחק עם `isNewBest=true` (לא ב-restored, לא ב-alreadyPlayed, לא לבוטים/skin trials). מופעל 250ms אחרי תחילת ה-count-up של TA.4 — ה-confetti יורד מעל הספרות הטיפסות. רגע הקסם הוא עכשיו ויזואלי + שמיעתי + רגשי.

**מיקום**: `src/12-tour-info.js` בסוף ה-render({over:true})

**מה לעשות**:

1. הוסף function `generateShareCanvas(score, tier, name, mode)` שיוצר canvas 1200×630:
   - רקע gradient (זהב->חום)
   - לוגו BLOOM למעלה
   - ציון ענק במרכז (count-up animation)
   - tier emoji (👑 לכתר, 💎 ליהלום וכו')
   - שם השחקן + תאריך
   - URL: `bloom-web-production-f3bd.up.railway.app`

2. הוסף 2 כפתורים על מסך game-over (לפני "Play Again"):
   - **📤 שתף** → `navigator.share({ files: [pngBlob] })` או fallback ל-canvas download
   - **📋 העתק תמונה** → `canvas.toBlob()` + clipboard

3. אם זה שיא — confetti.js במשך 3 שניות + sound effect חזק

**משאבים**:
- Canvas API מובנה בדפדפן (אין dep)
- Web Share API — `if (navigator.share) ...` עם fallback

---

### - [x] **TA.4** — Count-up Animation על הציון ב-Game-Over ✅
> 🎬 הציון "עולה" מ-0 לציון הסופי בתוך 1 שנייה. רגע הקסם.
>
> **בוצע (2026-05-25)**: `src/12-tour-info.js` ב-`render({over:true})` אחרי שה-HTML נטען, מאתר את `.over-score`, מאפס ל-"0", ומפעיל `requestAnimationFrame` loop של 1200ms עם ease-out-cubic. delay של 120ms לפני התחלה — נתינת זמן ל-entrance animation להתיישב. דילוג אם `opts.restored` (השחקן כבר ראה את המספר) או `opts.alreadyPlayed` (מצב daily-already-played). הצופה רואה: "0 → 1,247 → 5,890 → 12,345 → ... → 47,392" בעקומה רכה.

**מיקום**: `src/12-tour-info.js` ב-render({over:true})

**מה לעשות**:
ב-`over-score` element, במקום להציג `score.toLocaleString()` ישר, השתמש ב-animation:
```javascript
function animateScore(el, target) {
  var start = Date.now();
  var duration = 1200;
  function frame() {
    var t = Math.min(1, (Date.now() - start) / duration);
    // ease-out cubic
    var eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.floor(target * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
```
קרא לזה אחרי שה-overlay נטען (setTimeout 100ms).

---

## 📱 PHASE B — Display Size (תיקון מיידי לתצוגה הקטנה)
> ⏱ ~2 שעות | 🎯 לוח גדול = משחק שאוהבים לשחק
> 💡 **למה זה ממכר**: גודל = רושם של איכות. תאים גדולים = משחק שמרגיש יוקרתי.

### - [x] **TB.1** — העבר Booster Strip ל-Bottom Floating Bar ✅
> 🚨 ה-strip הזה לוקח 73px מהלוח. הזז אותו לתחתית = +30% גודל לוח.
>
> **בוצע (2026-05-25)**: `maybeMountBoosterStrip()` ב-`src/35-boosters.js` עוברת מ-`anchor.parentNode.insertBefore` ל-`document.body.appendChild` עם class `booster-strip-bottom`. CSS חדש ב-`public/css/home-v2.css` עם `position: fixed`, `bottom: calc(8px + env(safe-area-inset-bottom))`, `transform: translateX(-50%)`, `backdrop-filter: blur(10px)`, `z-index: var(--z-floating)`, ו-`animation: boosterStripIn 0.32s` לכניסה חלקה. גדלים מוקטנים בתוך floating bar (emoji 18px → 18px, label 11 → 10, price 10 → 9) כדי שלא יסתיר. Guard ב-`maybeMountBoosterStrip` נגד `window.__bloomGameOver` כך שלא נטען על מסך game-over. שתי נקודות game-over ב-`src/11-game.js` מסירות באופן מפורש את ה-strip כשהוא קיים. `showHome` + `showHomeV2` מסירים את ה-strip לפני הצגת הבית (כי `position: fixed` היה צף מעליו). Dark mode override. Engine self-test: 200 games / 14,007 drops / 0 floating tiles. ה-grid חוזר לגודל המלא — ~73px מוחזרים ל-`fitGrid`.

**מיקום**: `src/35-boosters.js` + `public/styles.css`

**מה לעשות**:

1. ב-`src/35-boosters.js` בתוך `maybeMountBoosterStrip()`, שנה את ה-anchor:
```javascript
// במקום:
// anchor.parentNode.insertBefore(strip, anchor);

// שים את ה-strip בתחתית של body כ-floating bar:
strip.classList.add('booster-strip-bottom');
document.body.appendChild(strip);
```

2. ב-`public/styles.css`, הוסף את ה-CSS לbottom-floating:
```css
.booster-strip-bottom {
  position: fixed;
  bottom: calc(8px + env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  background: rgba(255, 248, 231, 0.96);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: 18px;
  padding: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  margin: 0 !important;
  max-width: 280px;
  width: auto;
}
.booster-strip-bottom .booster-btn {
  padding: 6px 10px;
  border-radius: 12px;
}
.booster-strip-bottom .booster-btn-emoji { font-size: 18px; }
.booster-strip-bottom .booster-btn-label { font-size: 10px; }
.booster-strip-bottom .booster-btn-price { font-size: 9px; }

/* Dark theme */
html[data-theme="dark"] .booster-strip-bottom {
  background: rgba(30, 28, 26, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

/* Hide when game ends */
.app[data-game-over="1"] .booster-strip-bottom { display: none; }
```

3. ב-`src/11-game.js` ב-game-over flow, הוסף:
```javascript
document.querySelector('.app').setAttribute('data-game-over', '1');
```
וב-init({fresh:true}):
```javascript
document.querySelector('.app').removeAttribute('data-game-over');
```

4. ב-`maybeMountBoosterStrip` — וודא שהוא נמחק אם game-over:
```javascript
if (window.__bloomGameOver) {
  var existing = document.getElementById('booster-strip');
  if (existing) existing.remove();
  return;
}
```

**תוצאה**: הלוח חוזר לגודל המלא. ה-boosters מוצגים כ-floating bar בתחתית, נראה יוקרתי יותר.

---

### - [x] **TB.2** — צמצם Col-Mult-Bar Height ✅
> ירידה קטנה בגובה ה-multipliers bar = עוד 7-10px ללוח.
>
> **בוצע (2026-05-25)**: `public/css/boards.css` — `.col-mult-bar` margin שונה מ-`2px auto 6px` ל-`1px auto 2px` (חיסכון ~5px), `.col-mult-pill` height 22→18 + font-size 13→11 (חיסכון נוסף ~4-7px). סה"כ הבר ירד מ-~30px ל-~21px בלי לאבד קריאות. מסביר את הכפתורים החזותית קיים — `tier-2x` mint, `tier-4x` gold עם pulse, `tier-6x` gold→pink עם glow.

**מיקום**: `public/styles.css` — `.col-mult-bar` ו-`.col-mult-pill`

**מה לעשות**:
```css
.col-mult-bar {
  margin: 1px auto 2px;  /* היה: 2px auto 6px */
  /* ... */
}
.col-mult-pill {
  height: 18px;  /* היה: 22px */
  font-size: 11px;  /* היה: 13px */
}
```

---

### - [ ] **TB.3** — Audit לבעיות תצוגה נוספות
> בדוק שכל אלמנט שנוסף ב-49 stages לא לוקח גובה מהלוח.

**Audit checklist** — חפש בקוד:
```bash
grep -rn "insertBefore.*grid-wrap\|parentNode.insertBefore" src/*.js
```

עבור כל hit — וודא שה-element:
- ❌ לא נמצא בתוך `.app` בין `.tier-bar` ל-`.grid-wrap`
- ✅ או נמצא בתוך `.grid-wrap` כ-overlay
- ✅ או נמצא בתוך floating bar (position: fixed)
- ✅ או נמצא בתוך home screen (לפני שהמשחק מתחיל)

---

## 🎯 PHASE C — Stuck Screens / Buttons
> ⏱ ~4 שעות | 🎯 שחקן לא תקוע, כל לחצן עובד
> 💡 **למה זה ממכר**: מסך תקוע = יציאה מהאפליקציה. כל לחצן חייב להגיב.

### - [x] **TC.1** — Global ESC + Back Button Handler למודאלים ✅
> שחקן בלחיצה אחת על "back" יוצא מהמשחק לגמרי. צריך שיסגור modal במקום.
>
> **בוצע (2026-05-25)**: `src/04-ui-utils.js` מקבל `__bloomGetCloseableModals()` + `__bloomDismissTopmostModal()` + הרשמת global keydown listener ל-ESC + popstate listener ל-back-gesture. בורר המודאלים גנרי: `[class*="modal-overlay"]` מתפיס את כל 58 ה-overlays + רשימה ידנית של מודאלים שלא משתמשים ב-suffix `-modal-overlay` (`board-lb-overlay`, `dyn-boards-overlay`, `dyn-friends-modal-overlay`, וכו'). רשימת exclusions מוגדרת מפורשת לאנימציות in-game (`event-cell-overlay`, `fx-overlay`, `chest-celebration-overlay`, `ftue-overlay`, `gacha-reveal-overlay`, וכו') כך ש-ESC לא יסגור celebration עדינה תוך כדי הריצה שלה. הסגירה מנסה קודם `.modal-close` / `.info-close` / `[id$="modal-close"]` / `[aria-label="סגור"]` (משמרת ניקוי קיים) ו-fallback ל-`element.remove()`. flag `__bloomModalCloseWired` מונע wiring כפול. `window.__bloomOpenModalWithHistory(el)` מציע אופציה לבעלי המודאלים ל-pushState. שני event listeners מעלים `preventDefault()` ו-`stopPropagation()` כדי שהדפדפן לא יעזוב את האפליקציה. אומת ב-engine self-test: 200 games / 0 floating tiles.

**מיקום**: `src/04-ui-utils.js` (גלובלי)

**מה לעשות**:

1. הוסף global handlers:
```javascript
// ESC key — close topmost modal
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' || e.keyCode === 27) {
    var openModals = document.querySelectorAll('.modal-overlay, .info-modal-overlay, .dyn-ach-modal-overlay, .dyn-quests-modal-overlay');
    if (openModals.length > 0) {
      var topmost = openModals[openModals.length - 1];
      var closeBtn = topmost.querySelector('[id$="modal-close"], .modal-close, .info-close');
      if (closeBtn) closeBtn.click();
      else topmost.remove();
      e.preventDefault();
    }
  }
});

// Browser back button — close modal instead of leaving page
window.addEventListener('popstate', function(e) {
  var openModals = document.querySelectorAll('.modal-overlay, .info-modal-overlay');
  if (openModals.length > 0) {
    var topmost = openModals[openModals.length - 1];
    var closeBtn = topmost.querySelector('[id$="modal-close"], .modal-close, .info-close');
    if (closeBtn) closeBtn.click();
    else topmost.remove();
  }
});

// כשפותחים modal — push state
function openModalWithHistory(modalEl) {
  try { history.pushState({ modal: true }, ''); } catch(e) {}
}
window.__bloomOpenModalWithHistory = openModalWithHistory;
```

2. בכל modal opening, קרא ל-`window.__bloomOpenModalWithHistory(modalEl)`.

---

### - [ ] **TC.2** — Z-Index Hierarchy
> 30+ ערכים שונים = bugs נדירים של "מסך תקוע". סדר אותם.

**מיקום**: `public/styles.css` (top of file) + מסך אחר מסך

**מה לעשות**:

1. בראש הקובץ הוסף:
```css
:root {
  --z-base: 1;
  --z-board: 10;
  --z-header: 100;
  --z-floating: 200;
  --z-overlay: 1000;
  --z-modal: 2000;
  --z-modal-stack: 2100;  /* For nested modals */
  --z-toast: 3000;
  --z-critical: 4000;     /* Push permissions */
}
```

2. חפש את כל ה-`z-index: NNNNN` ב-styles.css והחלף בעדיפויות. דוגמה:
```css
/* Before */
.info-modal-overlay { z-index: 100000; }
.modal-overlay { z-index: 100001; }
.toast-banner { z-index: 100002; }

/* After */
.info-modal-overlay { z-index: var(--z-modal); }
.modal-overlay { z-index: var(--z-modal); }
.toast-banner { z-index: var(--z-toast); }
```

3. בדוק שאין רגרסיה — toasts עדיין מעל modals.

---

### - [ ] **TC.3** — Heartbeat Cleanup על beforeunload
> שחקן סוגר טאב = ייעלם מ-admin live view מיד.

**מיקום**: `src/11-game.js` או `src/13-boot.js`

**מה לעשות**:
```javascript
window.addEventListener('beforeunload', function() {
  if (typeof window.endHeartbeat === 'function' && !window.__bloomGameOver) {
    try { window.endHeartbeat(); } catch(e) {}
  }
});
// Also on pagehide (mobile background) — beforeunload doesn't always fire on iOS
window.addEventListener('pagehide', function() {
  if (typeof window.endHeartbeat === 'function' && !window.__bloomGameOver) {
    try { window.endHeartbeat(); } catch(e) {}
  }
});
```

---

### - [ ] **TC.4** — Skin Trial Auto-Timeout
> אם trial התחיל ולא נגמר ברענון, נקה אותו אחרי 90 שניות.

**מיקום**: `src/02-shop.js` ב-`startSkinTrial`

**מה לעשות**:
1. שמור `trialStartedAt`:
```javascript
function startSkinTrial(skinId) {
  // ... existing code ...
  try {
    safeSet('bloom_skin_trial_started', String(Date.now()));
  } catch(e) {}
  setTimeout(endSkinTrial, 90 * 1000);  // 90s safety
}
```

2. בכניסה למשחק (boot), בדוק:
```javascript
try {
  var trialStartedRaw = safeGet('bloom_skin_trial_started');
  if (trialStartedRaw) {
    var trialStarted = parseInt(trialStartedRaw, 10);
    if (Date.now() - trialStarted > 90 * 1000) {
      endSkinTrial();
      safeRemove('bloom_skin_trial_started');
    }
  }
} catch(e) {}
```

---

### - [ ] **TC.5** — Audit alert() ב-49 stages
> וודא שאין `alert(` חדשים שנוספו אחרי T0.4.

**מיקום**: כל `src/*.js`

**מה לעשות**:
```bash
grep -rn "alert(" src/*.js | grep -v "//\|cleared-alert\|cancel-alert" > /tmp/alerts.txt
```

עבור כל hit — החלף ב-`showToast(message, type)`.

---

### - [ ] **TC.6** — Dark Theme Audit
> וודא שכל 49 ה-stages יש להם dark theme overrides.

**מיקום**: `public/styles.css`

**מה לעשות**:
1. רשימת stages חדשים: booster-strip, balance-widget, trophy-strip, event-banner, login-cal, gem-bank, weekly-recap, ghost-mode, squad-tournament, friend-challenges, promo-engine.
2. עבור כל אחד, חפש `html[data-theme="dark"] .CLASS-NAME` ב-styles.css.
3. אם חסר — הוסף override עם רקע כהה + טקסט בהיר.

---

## 🎮 PHASE D — Addiction Boosters (אופציונלי, אחרי A-C)
> ⏱ ~6 שעות | 🎯 retention loops חזקים יותר
> 💡 **למה זה ממכר**: כל loop = סיבה חדשה לחזור מחר.

### - [ ] **TD.1** — Tomorrow Preview ב-Streak Display
> שחקן יראה "מחר: +200💎" → loss aversion.

**מיקום**: `src/05a-home-v2.js` ב-`renderHeroBannerV2`

**מה לעשות**:
מתחת ל-`🔥 7 ימים` הוסף:
```
מחר: +200💎 (כפול מהיום)
```
ערכי הפרסים: שמור ב-game_config כ-`streak_reward_day_<N>`. השג מ-`/api/streak/preview?deviceId=...`.

---

### - [ ] **TD.2** — Ghost Replay Push Notification
> חבר ניצח אותך → push → אתה רוצה לחזור.

**מיקום**: `server.js` + `src/16-push.js`

**מה לעשות**:
1. ב-server, כשחבר רושם ציון גבוה מהשחקן בלוח, שלח push:
```
title: 'Avi עבר אותך!'
body: 'הוא הצליח 12,500. בוא תנסה להחזיר את הכבוד 👑'
```
2. URL ב-push → ישר לישובץ ל-board הזה.

---

### - [ ] **TD.3** — Streak Freeze Push
> יום בלי משחק = push "הקפא הרצף שלך! 200💎".

**מיקום**: `server.js` cron + `src/16-push.js`

**מה לעשות**:
cron יומי שמוצא שחקנים עם streak ≥ 3 שלא שיחקו 12+ שעות, ושולח push.

---

## 📊 מעקב התקדמות

| Phase | משימות | הושלמו | חומרה |
|-------|--------|--------|--------|
| **A — Game-Over Persist + Exploit** | 4 | 4 | 🔴 קריטית |
| **B — Display Size** | 3 | 2 | 🔴 קריטית |
| **C — Stuck Screens** | 6 | 1 | 🟡 בינונית |
| **D — Addiction Boosters** | 3 | 0 | 🟢 אופציונלי |
| **סה"כ** | **16** | **7** | |

---

## 🎯 סדר ביצוע מומלץ (תן ל-Cursor לעבוד לפי הסדר)

**Sprint 1 — קריטי (היום)**:
1. TA.1 — Game-Over Persistence (1.5 שעות)
2. TB.1 — Booster Strip לתחתית (1 שעה)
3. TA.2 — Continue Button Dedup (1 שעה)

**Sprint 2 — חוויה (מחר)**:
4. TA.3 — Shareable Card (2 שעות)
5. TA.4 — Count-up Animation (15 דק')
6. TC.1 — Modal ESC/back handlers (45 דק')

**Sprint 3 — איכות (יום 3)**:
7. TB.2 — Col-mult-bar smaller (15 דק')
8. TC.2 — Z-Index hierarchy (1.5 שעות)
9. TC.3 — Heartbeat beforeunload (10 דק')
10. TC.4 — Skin trial timeout (15 דק')
11. TC.5 — alert() audit (30 דק')
12. TC.6 — Dark theme audit (1 שעה)

**Sprint 4 — אופציונלי**:
13. TB.3 — Display audit (1 שעה)
14. TD.1 — Tomorrow preview (1 שעה)
15. TD.2 — Ghost replay push (1 שעה)
16. TD.3 — Streak freeze push (45 דק')

---

## 🧠 עקרונות ממכרות (זכור תמיד!)

1. **Variable Reward** — לא תמיד אותו פרס. הפתעות = dopamine.
2. **Loss Aversion** — "אתה עומד לאבד את הרצף!" חזק יותר מ-"בוא לשחק".
3. **Social Proof** — "🔥 47 שחקנים משחקים עכשיו".
4. **Progress Illusion** — Trophy Road מראה כמה קרוב אתה ל-next reward.
5. **Endowed Progress** — תן reward אחרי המשחק הראשון.
6. **Sunk Cost** — "כבר השקעת 7 ימים רצוף — אל תשבור!"
7. **FOMO** — "דיל מוגבל! נגמר בעוד 3:42:18"
8. **Completion Drive** — "12/20 סקינים נאספו — עוד 8!"
9. **Social Competition** — "אורי עבר אותך! תחזור לנצח."
10. **Slot Machine Effect** — Gacha/spin = anticipation → reveal → dopamine.

---

*תאריך: 2026-05-25 · גרסה: BLOOM_TASKS v2 · 49 stages חיים · M1 Self-Promo live*
