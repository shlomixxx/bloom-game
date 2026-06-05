# פרומפט ל-Cursor — BLOOM v2 + רולאאוט חלקי + איסוף משוב

**לפני שמעתיקים:** צרף לצ'אט של Cursor את הקובץ `bloom-demo.html`.
ואז העתק את כל הטקסט שמתחת לקו אל Cursor.

---

אתה עובד על ה-repo bloom-game (Express + Vanilla JS + Postgres, deploy על Railway,
schema.sql רץ idempotent ב-boot). המטרה: להטמיע את המשחק מהקובץ המצורף (bloom-demo.html)
כגרסה "v2" אופציונלית, מאחורי feature flag, כך שאוכל:
(1) להגיש אותה לחלק מהשחקנים, (2) לשלוח קישור בטא לטסטרים נבחרים, ו-(3) לאסוף מהם
חוות דעת בתוך המשחק. אסור לשנות את המשחק הקיים ("classic") — v2 מבודד לחלוטין,
וברירת המחדל כבויה. אם הדגל כבוי, כל השחקנים חייבים לקבל classic בדיוק כמו היום.

## שלב 1 — קרא את ה-repo וזהה
1. קובץ ה-entry של הלקוח ופונקציית האתחול של המשחק הנוכחי.
2. ה-API והפיילואד לשמירת ניקוד/רצף/לוח תוצאות (שם הראוט והשדות המדויקים).
3. ה-middleware של אימות האדמין + קבצי לוח האדמין.
4. מיקום schema.sql ואיך הוא נטען ב-boot.
5. אם יש מנגנון identity לשחקן (user id / session) — אתר אותו; אם אין, נשתמש ב-cookie אנונימי.

## שלב 2 — מסד נתונים (הוסף ל-schema.sql, idempotent)
```sql
CREATE TABLE IF NOT EXISTS feature_flags (
  key          TEXT PRIMARY KEY,
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,   -- רולאאוט אקראי דולק/כבוי
  rollout_pct  INTEGER NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  beta_enabled BOOLEAN NOT NULL DEFAULT FALSE,   -- קישור בטא פעיל/לא
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO feature_flags (key, enabled, rollout_pct, beta_enabled)
VALUES ('game_v2', FALSE, 0, FALSE)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS feedback (
  id          BIGSERIAL PRIMARY KEY,
  variant     TEXT NOT NULL,
  user_id     TEXT,                    -- nullable לאנונימי
  rating      SMALLINT,                -- 1 = 👍 , -1 = 👎
  comment     TEXT,
  score       INTEGER,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
> אין פעולת DB ידנית — נוצר לבד ב-deploy הבא.

## שלב 3 — שרת
### א. GET /api/flags/game_v2 (ציבורי) → { enabled, rollout_pct, beta_enabled, variant }
קבע uid: משתמש מחובר אם קיים; אחרת cookie קבוע `bb_uid` (צור UUID אם חסר).
קבע variant לפי הסדר הזה (העליון מנצח):
1. **אדמין override:** אם המבקש אדמין ויש query/cookie `bb_force=v2|classic` → השתמש בו.
2. **בטא:** אם `beta_enabled` וגם (query `?beta=v2` או cookie `bb_beta=v2`) → 'v2',
   ושמור cookie `bb_beta=v2` (sticky). `?beta=classic` מנקה את ה-cookie.
3. **רולאאוט אקראי:** אם `enabled` וגם `hash(uid) % 100 < rollout_pct` → 'v2'.
4. אחרת → 'classic'.
hash דטרמיניסטי פשוט:
```js
function bucket(id){ let h=0; const s=String(id);
  for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h%100; }
```

### ב. POST /api/admin/flags/game_v2 (מאחורי אימות אדמין קיים)
body: `{ enabled, rollout_pct, beta_enabled }` → UPDATE feature_flags ... WHERE key='game_v2'.

### ג. POST /api/feedback (ציבורי, לשחקני v2)
body: `{ rating, comment, score }`. שמור שורה ב-feedback עם variant (מה-cookie/uid),
user_id אם קיים, user_agent, created_at. הגבל אורך comment (~500 תווים) ו-rate-limit בסיסי.

### ד. GET /api/admin/feedback (מאחורי אימות אדמין)
החזר: ספירת 👍, ספירת 👎, ו-50 התגובות האחרונות (rating, comment, score, created_at).

## שלב 4 — מודולריזציה של הקובץ המצורף
- העבר את ה-`<style>` ל-`/public/css/game-v2.css`, **וכל הסלקטורים שם ימוקמו תחת `#bloom-v2-root`**
  (scoping) כדי לא להתנגש ב-CSS של classic. משתני ה-:root אפשר להשאיר גלובליים.
- העבר את ה-`<script>` ל-`/public/js/game-v2.js`, עטוף כ-`export function start(root){ ... }`
  שמזריק את ה-markup של `#app` לתוך `root`, מאתחל שם, **ומסיר את בלוק ה-TEST HOOKS**.
- הוסף ל-index `<div id="bloom-v2-root"></div>` ואת ה-loader (שלב 5).

## שלב 5 — Loader בלקוח (לפני אתחול המשחק)
```js
const f = await fetch('/api/flags/game_v2',{credentials:'include'}).then(r=>r.json());
window.__variant = f.variant;
if (window.gtag)    gtag('set', { bloom_variant: f.variant });
if (window.clarity) clarity('set', 'bloom_variant', f.variant);

if (f.variant === 'v2') {
  await loadCss('/css/game-v2.css');
  const m = await import('/js/game-v2.js');
  m.start(document.getElementById('bloom-v2-root'));
} else {
  startClassicGame();   // האתחול הקיים — אל תשנה אותו
}
```

## שלב 6 — חיבור הניקוד (seam יחיד)
ב-`endGame()` של v2, לפני/אחרי ה-overlay, קרא ל-**API שמירת הניקוד הקיים** (זה שמצאת בשלב 1.2),
עם `mode:'v2'`. ודא שלוחות תוצאות/פרופילים/קונטסטים/ג'קפוט ממשיכים לעבוד עם v2.

## שלב 7 — וידג'ט משוב (רק ב-v2) — זה הלב של הבקשה
- כפתור קטן וקבוע בתוך v2: pill "💬 משוב" בפינה (לא חוסם משחק).
- בנוסף, **אחרי game-over שני** באותו סשן, הצג פנייה עדינה פעם אחת:
  "נהנית מהגרסה החדשה?" עם 👍 / 👎 + שדה טקסט אופציונלי (שורה אחת) + "שלח".
  אל תנדנד: סמן ב-`localStorage('bloom_v2_feedback_done')` אחרי שליחה/דחייה.
  (זה האתר האמיתי, localStorage מותר כאן — בניגוד לארטיפקט.)
- בשליחה: POST ל-/api/feedback עם {rating, comment, score נוכחי}. הצג "תודה!" קצר.

## שלב 8 — אדמין UI
- כרטיס "Game v2": toggle ל-`enabled`, סליידר/מספר 0–100 ל-`rollout_pct`,
  toggle ל-`beta_enabled`, **הצגת קישור הבטא** (`https://<DOMAIN>/?beta=v2`) עם כפתור העתקה,
  וכפתור Save שקורא ל-POST של שלב 3.ב.
- פאנל "משוב v2": ספירת 👍/👎 ורשימת התגובות האחרונות (מ-3.ד).

## אילוצים
- אל תיגע בלוגיקת classic. v2 מבודד. הדגל ברירת מחדל OFF (enabled=false, 0%, beta_enabled=false).
- כל endpoints הכתיבה/אדמין מאחורי אימות האדמין הקיים. `bb_force` מכובד רק לאדמין.
- שמור schema.sql idempotent.

## סיום (לפי הקונבנציות שלי)
- עדכן `README.md` ו-`CLAUDE.md`: המנגנון, הדגל, קישור הבטא, וטבלת feedback.
- בצע git commit + push. Railway יעשה auto-deploy.
- דווח לי: hash הקומיט, סיכום קצר של מה שהשתנה, וסטטוס ה-live URL.

## QA — בדוק בעצמך לפני שתסיים
- [ ] enabled=false, beta_enabled=false → כולם מקבלים classic; העמוד הקיים תקין.
- [ ] enabled=true, rollout_pct=100 → כולם מקבלים v2; הלוח נטען ומשחקי.
- [ ] אותו שחקן מקבל את אותה גרסה בכל רענון (sticky).
- [ ] קישור `?beta=v2` (כש-beta_enabled=true) מכניס שחקן רגיל ל-v2 ונשאר דביק; `?beta=classic` מחזיר.
- [ ] override של אדמין עובד; שחקן רגיל לא יכול לכפות v2 כשהכל כבוי.
- [ ] סיום משחק ב-v2 שומר ניקוד דרך ה-API הקיים ומופיע בלוח התוצאות.
- [ ] משוב 👍/👎 + תגובה נשמרים ומופיעים בפאנל האדמין; לא מנדנד אחרי שליחה.
- [ ] CSS של v2 לא משבש את classic.
- [ ] POST של הדגל ושל feedback-admin נכשלים ללא הרשאת אדמין.
