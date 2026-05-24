# 📍 BLOOM — Where to Resume

> **קובץ הזה הוא המסך הראשון לקרוא בכל סשן חדש.** הוא אומר במשפט אחד מה המצב, מה הצעד הבא, ולאן ללכת לפרטים מלאים.
>
> עדכון אחרון: **2026-05-24** · 47 שלבים חיים בפרודקשן · /api/health=ok

---

## 🟢 המצב עכשיו (תשובה ב-30 שניות)

**מה חי**:
- ✅ **BLOOM_TASKS.md**: 34/38 = 89.5% (4 deferred עם נימוק ברור)
- ✅ **FUTURE_TASKS.md**: 9/10 משימות backlog הושלמו (A1+A2+A3+A4+A6+A7+A8+A9+A10)
- ✅ **47 stages** ב-CLAUDE.md §0 — חיים בפרודקשן ([bloom-web-production-f3bd.up.railway.app](https://bloom-web-production-f3bd.up.railway.app))
- ✅ Cache `v20260524q` · SW `bloom-v13.1`

**מה פתוח** (1 backlog item + 4 monetization items):
- A5 Live PvP Race (3-4 ימים, WebSocket — הפיצ׳ר האחרון של pure-addiction)
- + 4 משימות monetization (Stripe IAP, VIP sub, RM shop, wager certification)

**מה מומלץ לעצור**:
- D1/D7 retention על שחקנים אמיתיים — יש מספיק פיצ'רים ויראליים שבנינו (Friend Challenges + Wrapped + Random Matchmaking). זה הזמן לבחון data לפני שמוסיפים עוד.

---

## 📂 הקבצים שאני עובד לפיהם

### 1. [BLOOM_TASKS.md](BLOOM_TASKS.md) — Roadmap מקורי (38 משימות, 8 שלבים)
זה ה-audit-driven roadmap שהתחלתי ממנו. Phase 0 → Phase 7. **כמעט נסגר** (4 deferred).

**4 משימות פתוחות** (כולן בכוונה — לא לפספס):
- **T4.1 Live PvP** — דורש WebSocket + matchmaking + split-screen. סשן ייעודי (3-5 ימים).
- **T6.1 home-state API** — perf gain שולי אחרי T6.3 cache. רק אם profiling יראה latency.
- **T6.5 server.js split** — refactor טהור. אפס user value. אל תיגע אלא אם תוסיף TypeScript/tests.
- **T7.5 i18n אנגלית** — multi-day. Pre-launch לחו"ל בלבד.

### 2. [FUTURE_TASKS.md](FUTURE_TASKS.md) — Backlog (10 pure-addiction + 4 monetization)
אחרי שסיימתי את ה-roadmap, עברתי לזה. **6/10 כבר נבנו** ב-A1/A2/A3/A4/A6/A7.

**1 משימה פתוחה** (האחרונה ב-pure-addiction):
| # | פיצ'ר | מאמץ | השפעה | תיאור |
|---|---|---|---|---|
| **A5** | ⚡ Live PvP Race | 3-4 ימים | ★★★★★ | real-time 1v1, אותו seed, 60 שניות — **הכי גדול, צריך WebSocket** |

**4 משימות monetization** (real money — דורש Stripe + יעוץ משפטי):
- 17b Stripe IAP — תשתית לכל השאר. ~3-4 ימים.
- 22 VIP subscription — $4.99/mo MRR. אחרי 17b.
- 23 RM cosmetic shop — IAP-only skins. אחרי 17b.
- 24 Wager / RM tournaments — דורש legal certification של מדינה.

### 3. [CLAUDE.md](CLAUDE.md) — Living spec של הפרויקט
ה-truth של כל פיצ'ר שנבנה אי פעם. §0 = retention stages tracker (44 stages עכשיו). §5 = current features. **אם הוספת stage חדש — חובה להוסיף entry ב-§5 + טבלה ב-§0.**

### 4. [BLOOM_FULL_AUDIT.md](BLOOM_FULL_AUDIT.md) — הביקורת המקורית
הצוקנע של 40+ בעיות שהיו. רובן נפתרו. שמור לרפרנס היסטורי.

---

## 🎯 איך לבחור מה לבנות הלאה

**3 אסטרטגיות מרכזיות**, תלוי במה שאתה רוצה:

### אסטרטגיה A — "להמשיך את ה-pure addiction backlog"
סדר העדיפויות:
1. A10 (1 יום, ★★★) — הכי קל, ROI סולידי
2. A8 (2 ימים, ★★★★) — מעל infra קיים של guilds + tournaments
3. A9 (2 ימים, ★★★)
4. A5 (3-4 ימים, ★★★★★) — הכי גדול, ה-killer feature האחרון

זה עוד **8-12 ימי עבודה** של פיצ'רים. אחרי זה — ה-pure-addiction backlog מסיים.

### אסטרטגיה B — "להפעיל monetization"
1. Stripe IAP — ~3-4 ימים
2. AdSense display ads — ~30 דקות (יש קובץ נפרד עם הוראות, ראה למטה)
3. AdMob rewarded ads — דורש wrapping native (2-3 שבועות)

### אסטרטגיה C — "לעצור ולפלייטסט" (ההמלצה שלי כרגע)
44 stages חיים. ה-K-factor הוויראלי סגור. זה רגע טוב לאסוף data על D1/D7 retention על שחקנים אמיתיים לפני שמוסיפים עוד דברים.

---

## 🚀 פקודות מהירות (חיוניות בכל סשן)

```bash
# בדיקת מצב
cat BLOOM_TASKS.md | head -50
cat FUTURE_TASKS.md | head -20
git log --oneline -10

# בנייה + סנכרון
./build.sh
node --check public/app.js && node --check server.js

# Deploy
git add -A && git commit -m "..." && git push && railway up --service bloom-web --detach --ci

# Health check
curl -fsS https://bloom-web-production-f3bd.up.railway.app/api/health

# מצב פיצ'ר ספציפי
curl -fsS "https://bloom-web-production-f3bd.up.railway.app/api/weekly-recap?deviceId=test12345"
```

---

## 📢 פרסומות — איך עומדים

**מצב נוכחי**: `simulateAdWatch()` ב-[src/12-tour-info.js](src/12-tour-info.js) פשוט מחכה 3 שניות. אין הכנסה אמיתית. ה-`/api/player/ad-watch` endpoint עובד מלא — רק שאין מי שמשלם.

**3 שלבי מעבר**:

### שלב 1 — AdSense Display Ads (קל, 30 דקות, $30-90/חודש passive)
1. הירשם ב-[adsense.google.com](https://adsense.google.com) עם הדומיין bloom-game.co.il
2. ממתינים אישור (1-7 ימים)
3. מקבלים Publisher ID `ca-pub-XXXXXXXXX`
4. שולחים את ה-ID ל-claude ואני מטמיע ב-2 דקות (Auto Ads = שורה אחת)
5. גוגל מציב באנרים אוטומטית בין משחקים, על הבית, וכו'

**זה לא מחליף** את ה-"watch ad → 30💎" — זה רק שכבת הכנסה passive.

### שלב 2 — Unity Web Ads (rewarded video עבור web, אופציונלי)
- נרשם ב-[unity.com/products/unity-ads](https://unity.com/products/unity-ads)
- מקבל Game ID
- ה-SDK תומך ב-HTML5 → ה-`simulateAdWatch` הופך לקריאה אמיתית
- רווח: ~$5-10 CPM (כי rewarded שווה יותר מ-banner)
- עבודה: ~2 ימים

### שלב 3 — Native wrapper + AdMob (full path, 2-3 שבועות)
- עוטפים את BLOOM עם Capacitor → אפליקציית iOS/Android
- מטמיעים AdMob SDK (rewarded video)
- מעלים ל-App Store + Play Store
- רווח: ~$10-20 CPM. הסטנדרט של תעשייה.
- עבודה: 2-3 שבועות + תהליך אישור store

**המלצה**: שלב 1 עכשיו. שלב 3 כשיש לך 1000+ DAU.

---

## 🛡 כללי-ברזל שאסור לשבור

מ-[CLAUDE.md §10](CLAUDE.md):

1. **אל תיגע במנוע** — BFS group detection / gravity / chain scoring / merge logic. אפילו אם נראה ש"זה רק שינוי קטן". יש [scripts/test_engine.mjs](scripts/test_engine.mjs) לוודא.
2. **אסור הוספת dependencies** — frontend stays dep-free. Backend = express + pg + web-push בלבד.
3. **אסור לפצל את ה-IIFE** — `public/app.js` הוא single closure שנבנה מ-`src/*.js` דרך `build.sh`.
4. **שמור Asia/Jerusalem** — ה-daily seed מבוסס עליו. אל תעבור ל-UTC או client-local.
5. **`daily_scores` PK = `(date, device_id)`** — לא לשנות.
6. **שינוי schema = idempotent ALTER** ב-`schema.sql` + ב-`db.js`. הקובץ schema.sql רץ בכל boot.
7. **לפני deploy** — תמיד `node --check` + `./build.sh` + `git push` + `railway up` + curl health.
8. **לעדכן CLAUDE.md + RESUME.md בכל stage חדש** — אחרת ה-session הבא הולך לאיבוד.

---

## 📊 מה נמדד / מי משוחק עכשיו

- **GA4**: `G-KTRD0NCTX8` (bloom-game property). כל `trackEvent()` בקוד שולח אירועים — game_start, game_over, purchase, level_up, וכו'
- **Admin dashboard**: `https://bloom-web-production-f3bd.up.railway.app/<ADMIN_PATH>` — DAU, retention, funnel, heatmap, audit log
- **/api/version**: build SHA + uptime
- **/api/health**: ok

---

*קובץ זה מתעדכן בכל סוף סשן. אם הוא לא תואם למצב — סימן שמשהו נפל בסנכרון. בדוק עם `git log -10` ו-CLAUDE.md §0 השני.*
