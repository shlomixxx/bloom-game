# 📍 BLOOM — Where to Resume

> **קובץ הזה הוא המסך הראשון לקרוא בכל סשן חדש.** הוא אומר במשפט אחד מה המצב, מה הצעד הבא, ולאן ללכת לפרטים מלאים.
>
> עדכון אחרון: **2026-06-06** · /api/health=ok · **HOME.1 — וריאנט בית חדש "🧩 אריחים" (PLAY-first + דופמין) + BUGFIX.1 (סריקה עמוקה, 6 באגים)** 🧩 · Cache `v20260606h`

---

## 🟢 המצב עכשיו (תשובה ב-30 שניות)

**מה חי**:
- ✅ **BLOOM_TASKS.md**: 34/38 = 89.5% (4 deferred עם נימוק ברור)
- ✅ **FUTURE_TASKS.md**: **10/10 משימות pure-addiction הושלמו** 🎉 (כל A1-A10)
- ✅ **49 stages** ב-CLAUDE.md §0 — חיים בפרודקשן ([bloom-web-production-f3bd.up.railway.app](https://bloom-web-production-f3bd.up.railway.app))
- ✅ **M1 Self-Promo Engine חי** — מחליף AdSense שלא מאשרים את ה-subdomain. כל "watch ad" הופך לקידום של מוצר שלנו (Starter Pack/Daily Deal/Gacha/BP/Gem Bank).
- ✅ **HOME.1 (2026-06-06)**: וריאנט בית חדש `home_variant='tiles'` — PLAY ענק מנצח את הקיפול + סטריפ דרגות על אריחי המשחק האמיתיים (אבן→כתר, ✓ + "כמעט!") + כרטיס "חם" יציב + merge-tease. נבחר באדמין (🧩 "אריחים (חדש)"); **ברירת מחדל עדיין `hero`** — כעת ברירת המחדל לכולם (אדמין יכול להחליף ב-🏠). + תיקון כיוון "איך לשחק" (אבן-שמאל→כתר-ימין).
- ✅ **BUGFIX.1 (2026-06-06)**: 6 באגים תוקנו+אומתו חי — GA4 CSP (אנליטיקה הייתה חסומה ב-100%), קריסת באנר גאצ׳ה, קישורי Discovery מתים, deep-link מעל המשחק, פס בוסטרים חופף, דליפות אינטרוול.
- ✅ **HOME.1.2 (2026-06-06)**: תוקן ה-spine של המשחק שדלף לראש הבית אחרי משחק (נראה עמוס) — מוסתר כש-#home-screen קיים. הבית עכשיו נקי כמו הדמו.
- ✅ Cache `v20260606h` · SW auto-stamped

**מה פתוח** — [MONETIZATION_TASKS.md](MONETIZATION_TASKS.md) 7 שלבים (M1-M7):
- ✅ **M1 Self-Promo** (1.5 שעות — הושלם היום!) — admin CRUD + 6 פרסומות מסומנות
- ⏳ **M2 Stripe Foundation** (~3 ימים, דורש Stripe account של המשתמש)
- ⏳ **M3 RM per-product wiring** (4-6 שעות, אחרי M2)
- ⏳ **M4 Legal + VAT** (3 שעות)
- ⏳ **M5 Self-Promo + RM Integration** (אחרי M3)
- ⏳ **M6 VIP Subscription** ($4.99/mo, אחרי M3)
- ⏳ **M7 Analytics** (עליות באירוע רכישה דרך GA4)

**מה מומלץ לעצור**:
- D1/D7 retention על שחקנים אמיתיים — יש מספיק פיצ'רים ויראליים שבנינו (Friend Challenges + Wrapped + Random Matchmaking). זה הזמן לבחון data לפני שמוסיפים עוד.

---

## 📂 הקבצים שאני עובד לפיהם

> **כל המשימות חיות ב-[tasks/](tasks/)**. שורש הפרויקט שמור ל-RESUME.md / CLAUDE.md / README.md בלבד. ראה [tasks/README.md](tasks/README.md) לקונבנציה מלאה (איך להוסיף קובץ משימות חדש, מבנה התיקיות, סדר קריאה).

### 📋 tasks/ACTIVE/ — המשימות החיות (הקבצים שאני קורא בכל סשן)

**1. [tasks/ACTIVE/BLOOM_TASKS.md](tasks/ACTIVE/BLOOM_TASKS.md)** — Roadmap מקורי (38 משימות, 8 שלבים). 34/38 הושלמו. 4 פתוחות בכוונה:
- T4.1 Live PvP, T6.1 home-state API, T6.5 server.js split, T7.5 i18n אנגלית

**2. [tasks/ACTIVE/FUTURE_TASKS.md](tasks/ACTIVE/FUTURE_TASKS.md)** — Backlog. 🎉 **כל ה-10 משימות pure-addiction (A1-A10) הושלמו**. נשאר רק monetization שעבר ל-MONETIZATION_TASKS.md.

**3. [tasks/ACTIVE/MONETIZATION_TASKS.md](tasks/ACTIVE/MONETIZATION_TASKS.md)** — 7 שלבים M1-M7:
- ✅ M1 Self-Promo (הושלם 2026-05-25)
- ⏳ M2 Stripe Foundation (~3 ימים — דורש חשבון Stripe מהמשתמש)
- ⏳ M3 RM per-product wiring · M4 Legal · M5 Self-Promo+RM · M6 VIP · M7 Analytics

**4. [tasks/ACTIVE/MANUAL_TASKS.md](tasks/ACTIVE/MANUAL_TASKS.md)** — מה המשתמש צריך לעשות ידנית (GA4 / Stripe / domain).

**5. [tasks/ACTIVE/ADMIN_TASKS.md](tasks/ACTIVE/ADMIN_TASKS.md)** — Admin panel audit (2026-05-26): ~165 פערים ב-9 phases (A-I). Phase A+B+C = MVP למניעת נטישה (שבועיים, ~25% churn reduction). Drill-down לשחקן בודד + per-player actions + churn detection dashboard עדיין חסרים.

**6. [tasks/ACTIVE/PAGE_UX_AUDIT_TASKS.md](tasks/ACTIVE/PAGE_UX_AUDIT_TASKS.md)** — ביקורת UX+התמכרות לכל 21 הדפים (2026-06-02, 21-agent workflow). ציון משחק כולל **67/100 (B-)**, 141 ממצאים (0 קריטי / 34 גבוה / 65 בינוני / 42 נמוך). טבלת ציונים מדורגת לפי ROI + 8 תמות-רוחב (tokens לא-מאומצים, reduced-motion חסר, חורי-סגירה, tap-targets<40px, hooks ריקים/קפואים, חוסר שיא-דופמין, overload, חוסר השוואה-חברתית) + 18 quick-wins + 11 פרויקטים גדולים. כל ממצא = משימה עם file:line + הוראת-ביצוע.

**7. [tasks/ACTIVE/ONBOARDING_TASKS.md](tasks/ACTIVE/ONBOARDING_TASKS.md)** — FTUE / מדריך / חוויית-שחקן-חדש. FT.1 (2026-06-03) תיקן 5 באגים שדווחו ("המדריך לא נכון"): חוק-מיזוג שגוי (3→2 אריחים), חץ בכיוון שגוי (+28px), אריחים שונים מהמשחק (עיגול→ריבוע ממלא-תא), חוסר הסבר על אלמנטים מיוחדים (פצצה/כוכב/וכו'), ובאג שגרם למדריך לחזור בכל כניסה (done-flag לא נקרא ב-boot). Backlog: FT.2-FT.8 (מדריך אינטראקטיבי על המנוע האמיתי, אנליטיקת skip, A/B, ועוד).

### 📚 קבצי context (לא משימות — הקשר היסטורי)

- **[CLAUDE.md](CLAUDE.md)** — Living spec של הפרויקט. §0 = retention stages tracker (49 stages). §5 = current features.
- **[tasks/ARCHIVE/](tasks/ARCHIVE/)** — 14 קבצי roadmap/audit ישנים. אני לא קורא אוטומטית — שמור לרפרנס היסטורי.

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
