# BLOOM — תוכנית אדמין, דמו, ומונטיזציה

מסמך תכנון. **לא קוד שעוד נכתב.** מטרה: לתת לך תמונה ברורה של מה כדאי לבנות, מתי, ובאיזה סדר — לפי השלב העסקי של BLOOM.

---

## 0. עיקרון מנחה

CLAUDE.md שלך אומר: **retention beats revenue**. כל פיצ'ר בעמוד הזה צריך לעבור את הסינון הזה:

> "האם זה יעזור לי להגיע ל-40% חזרה לסשן שני, או רק להרגיש 'מקצוען' עם דשבורד יפה?"

אם התשובה היא השנייה — דחה.

---

## 1. מה מומלץ עכשיו, מה אחר כך, מה רחוק

### 🔴 עכשיו (1-3 שעות עבודה כל אחד)

| # | פיצ'ר | למה דחוף | קושי |
|---|-------|----------|------|
| A | **דשבורד מספרים בסיסי** — DAU/WAU, # תחרויות פעילות, גרף ניקוד יומי | אתה לא יכול לנהל מה שאתה לא מודד | קל |
| B | **הגנת ראוטי אדמין** — סיסמה ב-env, HTTP Basic Auth | בלי זה כל הרחבה היא חור אבטחה | קל |
| C | **סקריפט יצירת דמו** — 10 שחקנים מזויפים שמשחקים בתחרויות | בדיקות, screenshots לחנויות, הדגמה למשקיעים | קל |

### 🟡 בקרוב (אחרי 50+ שחקנים אמיתיים)

| # | פיצ'ר | למה לחכות |
|---|-------|-----------|
| D | **מודרציה — מחק שחקן/תחרות** | עד 50 משתמשים, `psql` ידני מספיק |
| E | **ניהול תחרויות** (בטל, הארך, שנה שם) | יקרה רק כשמשתמש יבקש |
| F | **דיווחי שחקנים** (abuse report) | אין לך עדיין שיתוף חברתי שיוצר בעיות |
| G | **דשבורד retention מתקדם** (cohort analysis) | רק כשיש מספיק נתונים שזה משקף משהו |

### 🟢 רחוק (רק אחרי שhit ה-40% retention יעד)

| # | פיצ'ר | למה לחכות |
|---|-------|-----------|
| H | **תשלומים — Stripe Checkout** (remove ads, skin packs) | מונטיזציה לפני retention = להמשיך לדמם דליים |
| I | **AdMob — מודעות מתגמלות** | דורש app stores; אין טעם בלי iOS/Android |
| J | **אנליטיקה צד שלישי** (PostHog/Mixpanel) | המספרים שלך בDB מספיקים עד שיש >1k DAU |
| K | **HMAC-signed scores** (anti-cheat) | אין משמעות לרמייה כשאין פרסים |

---

## 2. ספציפיקציה — מה בונים עכשיו (A+B+C)

### A. דשבורד מספרים בסיסי

**Route חדש**: `GET /admin/` (מוגן ב-Basic Auth)

**מציג**:
- **היום** — # שחקנים ייחודיים שהפילו לפחות חלק 1, # תחרויות פעילות, # תחרויות חדשות.
- **רטנשן** — אחוז שחקנים מ-7 ימים אחורה שחזרו אתמול.
- **טופ 10 ניקודים יומיים** — שם, ניקוד, תאריך.
- **תחרויות פעילות** — קוד, שם, # משתתפים, ניקוד מוביל, ימים שנותרו.

**SQL לדוגמה**:
```sql
-- DAU (יום אחרון)
SELECT COUNT(DISTINCT device_id) FROM daily_scores
WHERE date = CURRENT_DATE;

-- חזרה לסשן שני (proxy: שיחק 2+ ימים שונים בשבוע)
SELECT
  COUNT(DISTINCT device_id) FILTER (WHERE days_played >= 2) * 100.0
  / NULLIF(COUNT(DISTINCT device_id), 0) AS retention_pct
FROM (
  SELECT device_id, COUNT(DISTINCT date) AS days_played
  FROM daily_scores
  WHERE date >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY device_id
) t;
```

**טכנולוגיה**: עוד HTML אחד ב-`public/admin.html`. אותו stack — vanilla JS, fetch ל-`/admin/api/*`. **בלי dependencies חדשות**.

### B. הגנת admin

```js
// server.js
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).send('Admin not configured');
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="bloom-admin"');
    return res.status(401).send('Auth required');
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const [, pass] = decoded.split(':');
  if (pass !== ADMIN_PASSWORD) return res.status(403).send('Bad password');
  next();
}

app.use('/admin', requireAdmin);
app.use('/admin/api', requireAdmin);
```

**ב-Railway**: הוסף משתנה `ADMIN_PASSWORD=<password long random>` במשתני השרות. **לא תקוף ב-git**.

### C. סקריפט משתמשי דמו

**קובץ חדש**: `scripts/seed_demo.js` (לא נטען מהשרת — להפעלה ידנית).

```js
// node scripts/seed_demo.js
// יוצר 10 דמו עם ניקודים מפוזרים על 7 ימים אחרונים
const names = ['דני', 'מיכל', 'יוסי', 'נועה', 'אריק', 'תמר', 'גיל', 'רונית', 'אבי', 'שירה'];
for (let i = 0; i < names.length; i++) {
  const deviceId = `demo-${String(i).padStart(2, '0')}-${'x'.repeat(20)}`;
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const score = Math.floor(Math.random() * 5000) + 500;
    const tier = Math.min(8, Math.floor(score / 700) + 1);
    await fetch(BASE + '/api/score', { method: 'POST', headers: ..., body: ... });
  }
}
```

**שימושים**:
- צילומי מסך ל-App Store / Play Store
- בדיקות UI עם לוח מלא
- הדגמות למשקיעים / חברים
- בדיקת קריסה של ה-UI על 50+ שחקנים בתחרות

---

## 3. ספציפיקציה — מה בונים אחר כך (D-G)

### D. מודרציה
- `POST /admin/api/devices/:id/ban` — מסמן שורת מכשיר כ-banned ב-DB (צריך לוודא שהאפליקציה לא תקבל ממכשירים אלה).
- `DELETE /admin/api/contests/:code` — מסיר תחרות + cascade.
- `POST /admin/api/scores/:id/reset` — מאפס ניקוד יומי בודד.

### E. ניהול תחרויות
- שינוי `ends_at`, השם, status (active/paused/ended).
- צפייה בלוג הפעולות (אם נוסיף audit log).

### F. דיווחי שחקנים
- טבלת `abuse_reports`: reporter_device, target_device, contest_code, reason, created_at.
- UI לסקירה / יישוב.

### G. cohort retention
- D1, D7, D30 retention by date_first_played.
- Funnel: ביקור → שיחק → סיים → חזר.

---

## 4. מונטיזציה — מתי ואיך (H+I)

### עקרון: לא לפני 40% retention יעד

הסיבה: רוב המשתמשים נושרים בלאו הכי. אם תוסיף ads עכשיו, אתה רק תאיץ נשירה ולא תרוויח כלום (CPM נמוך כשאין retention).

### H. Stripe Checkout (כשמגיע הזמן)

**מוצרים מומלצים**:
| מוצר | מחיר | מה כולל |
|------|------|---------|
| `remove_ads` | $4.99 חד-פעמי | מסיר את כל המודעות לתמיד |
| `skin_pack_neon` | $1.99 | 8 SVG חדשים לכל ה-tiers |
| `skin_pack_classic` | $1.99 | סט סקינים אחר |
| `daily_bonus_run` | $0.99 | משחק יומי נוסף |

**מה צריך בקוד**:
- טבלת `purchases` (device_id, sku, stripe_session_id, status, created_at)
- Webhook מ-Stripe → `/api/stripe/webhook`
- בדיקה ב-frontend: device מחזיק purchase של `remove_ads`? אם כן — דלג על הצגת מודעות
- במונטיזציית סקינים — מצב גלובלי שמחליף את ה-`TIERS[]` SVG

**עלות**: Stripe גובה 2.9% + $0.30 לעסקה. על $4.99 = ~$0.45 (≈9%). לא נורא.

### I. AdMob — מודעות מתגמלות

**רק** אחרי שיש לך אפליקציה ב-App Store / Google Play (דרך Capacitor).

**טיפוסי מודעות**:
- "צפה ב-15 שניות → קבל חלק רמז" (= הצעת drop אופטימלי).
- "צפה ב-15 שניות → המשך אחרי game-over" (פעם אחת לסשן).
- "צפה ב-15 שניות → הכפל את הניקוד היומי".

**הכנסה**: ~$3-7 לאלף משתמשים שצפו (CPM). דורש 1,000+ DAU כדי שיהיה משמעותי.

---

## 5. סדר העדיפויות בפועל (אם אני אתה, ב-2-3 חודשים הקרובים)

```
שבוע 1-2: השקה לחברים, מעקב אורגני אחרי הPostgres
שבוע 3:   A — דשבורד DAU + retention
שבוע 4:   B — הגנת admin
שבוע 5:   C — סקריפט דמו (לפני שיתוף ב-Telegram/חברים)
חודש 2:   שיווק → להגיע ל-100 DAU
חודש 3:   אם retention ≥ 25% → להשקיע בכלי D-G
          אם retention < 25% → לחזור לפיצ'רים בליבת המשחק
חודש 4-6: אם retention >= 40% → להתחיל H (Stripe)
חודש 6+:  Capacitor + I (AdMob)
```

---

## 6. דברים שלא לעשות

- **לא להוסיף Firebase / Mixpanel / Sentry עכשיו.** ה-Postgres שלך מחזיק את כל הנתונים. סטטיסטיקה ב-SQL.
- **לא להוסיף Tailwind / React / build step.** השמירה על HTML יחיד בלי build היא יתרון תחזוקתי.
- **לא להוסיף תשלומים לפני retention.** אתה רק תאיץ נשירה.
- **לא לבזבז זמן על pen-test עכשיו.** בלי כסף בתחרות = אין מוטיבציה לרמות.

---

## 7. מה אני יכול לבנות לך הבא (אם תאשר)

| בקשה | מה תקבל | זמן עבודה משוער |
|------|---------|-----------------|
| "תבנה לי A+B+C" | דשבורד אדמין מוגן בסיסמה + סקריפט דמו | כ-2-3 שעות |
| "תכין סקריפט דמו בלבד" | רק C — מהיר ושימושי לבד | חצי שעה |
| "תוסיף לי D — מחיקת שחקנים" | UI ב-admin לבן/מחק | שעה |
| "תכין spec מלא לתשלומים" | מסמך ביצוע מפורט (לא קוד) | שעה |

תגיד מה מעניין אותך ונעבוד צעד-צעד.

---

*מסמך זה כתוב 2026-05-14. עדכן לפי שינויים בנתוני המשחק והשוק.*
