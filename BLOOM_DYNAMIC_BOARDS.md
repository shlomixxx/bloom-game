# BLOOM — מערכת לוחות דינמיים (Dynamic Boards System)

> **לקלוד שיקרא את הקובץ הזה:** המסמך הזה מתאר תוכנית פיתוח רב-שלבית להוספת מערכת לוחות משחק מודולרית ל-BLOOM. **חשוב מאוד:** אל תעבוד על יותר משלב אחד בכל פעם. אחרי כל שלב — קומיט נפרד, push, ועדכן לשלומי. עצור והמתן לאישור לפני שעוברים לשלב הבא. השלבים בנויים מהקל למורכב — שלב 1 ניתן להטמעה בשעתיים, שלב 5 דורש שבועות. אל תקפוץ קדימה.
>
> **בכל פעם שאתה מתחיל פאזה:** קרא את [CLAUDE.md](CLAUDE.md) ו-[schema.sql](schema.sql). וודא `git status` נקי. תוודא שאתה על `main`. תקרא את הסקציה הספציפית כאן. תתחיל לעבוד.

### מצב נוכחי (עדכון 2026-05-22)

- **שלב 0 — הכנת תשתית:** ✅ הושלם חלקית **לפני** שהמסמך הזה נכתב. בקוד כבר קיימים `getActiveTiers()`, `getBoardRows()`, `getBoardCols()` ב-[src/01-constants.js](src/01-constants.js) — תוארו בפירוט ב-[CLAUDE.md](CLAUDE.md) §11 כ"architectural prep for the App launch". **אסור לכפול** את האבסטרקציות האלה; כל שלב חייב לקרוא דרכן.
- **שלב 1 — Score Multipliers:** ✅ הושלם 2026-05-22 — `getColumnMultipliers()`/`setColumnMultipliers()` + `pointsFor(tier, group, chain, col)` + pill-bar UI מעל הלוח + floating ×N badge על נחיתות ≥2× + `__bloomDebug.setColumnMultipliers([6,4,2,1])` בקונסול. zero-regression validated על `test_engine.mjs`.
- **שלב 2 — Admin Control Panel + Opt-In Mode:** ✅ הושלם 2026-05-22 (תוקן באותו היום) — האסטרטגיה השתנתה אחרי בדיקת UX. **גרסה ראשונה הוחלפה** — האדמין יוצר לוחות, אך הקליינט לא מחיל אותם אוטומטית על כל משחק. במקום זה: כפתור "🎯 לוחות דינמיים" בעמוד הבית, picker שמראה את כל הלוחות הזמינים, ובחירה מתחילה סשן `mode === 'dynamic'`. דיילי / תחרות / דו-קרב / אתגר / practice default — אפס שינוי. סשנים דינמיים לא נכנסים ללוחות מובילים כלל (חוויה טהורה, לא משפיע על fairness). Endpoint `/api/boards/available` חדש מחזיר רשימה (לא יחיד). פיקר ב-[src/05c-dynamic-boards.js](src/05c-dynamic-boards.js), כפתור ב-[src/05a-home-v2.js](src/05a-home-v2.js), branch `'dynamic'` ב-init() של [src/11-game.js](src/11-game.js). ה-pill bar רק נמשך כש-`mode === 'dynamic'`, width-matched לגריד (לא דוחק את ה-tier ladder).
- **שלב 3 (חלק א') — Per-Mode Targeting:** ✅ הושלם 2026-05-22 — האדמין מחליט באילו מצבי משחק כל לוח פעיל. עמודה חדשה `applies_to TEXT[]` (default `'{dynamic}'`) על board_configurations. אדמין מסמן 4 checkboxes: 🎯 דינמי / ⚡ פרקטיס / ⚔️ דו-קרב / 📅 דיילי (עם confirm חזק). Endpoint `/api/active-board/:mode` חדש מחזיר את הלוח הפעיל לכל מצב, עם cache פר-mode. דיילי = אותו לוח לכולם היום (לידרבורד נשאר הוגן). פרקטיס + לוח פעיל = ניקוד **לא** נשלח ללידרבורד (fairness guard). דו-קרב = snapshot על שורת הדו-קרב ברגע יצירה (שני השחקנים זהים אפילו אם אדמין משנה אחרי). Toast חדש "🎯 לוח מיוחד פעיל" בכניסה למשחק (gradient pink-orange, slide-in מלמעלה, dismissible). תחרות + אתגר עדיין לא במצב targeting (סקופ עתידי).
- שלבים 3 (ב'-6): ⏳ עתידיים. ראה הערות "✨ ניצול תשתית קיימת" בכל שלב.

ראה את סקציה [1.5 — התשתית הקיימת](#15-התשתית-הקיימת-מה-כבר-בקוד) **לפני** שמתחילים שלב.

---

## תוכן עניינים

1. [רקע ומוטיבציה](#1-רקע-ומוטיבציה)
1.5. [התשתית הקיימת — מה כבר בקוד](#15-התשתית-הקיימת-מה-כבר-בקוד)
2. [ארכיטקטורה — איך זה עובד ברמת המערכת](#2-ארכיטקטורה--איך-זה-עובד-ברמת-המערכת)
3. [שש קטגוריות של לוחות](#3-שש-קטגוריות-של-לוחות)
4. [שלבי פיתוח — סדר עבודה ל-Claude Code](#4-שלבי-פיתוח--סדר-עבודה-ל-claude-code)
   - [שלב 1: Score Multipliers (יסוד)](#שלב-1-score-multipliers-יסוד)
   - [שלב 2: Admin Control Panel](#שלב-2-admin-control-panel)
   - [שלב 3: Special Cells](#שלב-3-special-cells)
   - [שלב 4: Themed Boards (חגים)](#שלב-4-themed-boards-חגים)
   - [שלב 5: Board Shapes](#שלב-5-board-shapes)
   - [שלב 6: LiveOps Scheduler](#שלב-6-liveops-scheduler)
5. [שיפורים עתידיים](#5-שיפורים-עתידיים)

---

## 1. רקע ומוטיבציה

### הבעיה הנוכחית

ב-BLOOM כיום יש לוח אחד, סטטי: 6×4 grid עם 8 דרגות אריחים. הלוח לא משתנה לעולם. סקינים משנים רק את **המראה** של האריחים — לא את הלוח עצמו, לא את החוקים, לא את הניקוד.

זה גורם לכך ששחקן ביום 30 משחק בדיוק את אותו משחק כמו ביום 1. החברות הגדולות פתרו את זה — Royal Match מציעה לוחות שונים, Candy Crush מציעה תרחישים שונים. ל-BLOOM אין את זה.

### הפתרון

מערכת **לוחות דינמיים** — לוח עצמו (לא רק האריחים) משתנה בין משחקים. האדמין מחליט מה זמין מתי. שש קטגוריות שונות של לוחות, מאות וריאציות אפשריות.

### למה זה קריטי עסקית

- **רטנשן (D7, D30)**: שחקן שמחכה לראות "מה הלוח של היום" חוזר. ביום 7 הוא לא קופץ, כי לוח Speed זמין רק היום.
- **שיחה ויראלית**: "ראית את לוח החנוכה? חייב לנסות". זה תוכן ל-TikTok / Stories.
- **Monetization**: לוח VIP זמין רק לבעלי Battle Pass. לוח תחרות זמין בכניסה בקרדיטים.
- **Localization**: לכל שוק (ישראל, ערבית, ספרדית) יהיו לוחות מותאמים-תרבותית.

---

## 1.5 התשתית הקיימת — מה כבר בקוד

> **קריאת חובה לפני כל שלב.** הרבה תשתית כבר קיימת. אל תכתוב מחדש מה שאפשר להרחיב.

### אבסטרקציות שכבר הוטמעו (חודש מאי 2026)

| שם | מיקום | מצב | רלוונטיות לתוכנית |
|----|--------|------|---------------------|
| `getActiveTiers()` | [src/01-constants.js](src/01-constants.js) | ✅ קיים, 17 callsites | כל שלב שנוגע באריחים חייב לקרוא דרכה |
| `getBoardRows()` / `getBoardCols()` | [src/01-constants.js](src/01-constants.js) | ✅ קיים | **קריטי לשלב 5** (Board Shapes) — הצמתים כבר הוחלפו |
| `pointsFor(tier, group, chain)` | [src/11-game.js](src/11-game.js) | ✅ קיים | הציר היחיד שצריך לעדכן בשלב 1 (multipliers) |
| `SKIN_PACKS` | [src/01-constants.js](src/01-constants.js) | ✅ 7 פאקים | מודל ל-themed boards (שלב 4) — אותו דפוס של "אופציונלי, ניתן לכיבוי, נשמר בשרת" |
| `DIFFICULTY_PRESETS` + `resolveDifficulty()` | [server.js](server.js) | ✅ 5 פריסטים | מודל מצוין ל-"variations" — לוחות יכולים לקרוא להגדרה אחת ולהרחיב |
| `events` system (bomb/star/gift/fever/freeze/target) | [src/14-events.js](src/14-events.js) | ✅ קיים | **חופף חזק עם שלב 3** (Special Cells) — צריך להחליט אם להרחיב או להחליף |

### תשתית שרת שניתן לנצל (לא ליצור חדשה)

| מערכת קיימת | למה היא טובה כאן | פאזה רלוונטית |
|-------------|-------------------|----------------|
| `game_config` (key/value table) | כבר משמש לכל ההגדרות הגלובליות. **תוסיף שורות במקום טבלה חדשה** ללוחות פשוטים. | שלב 2 |
| `contests.board_seed` / `contests.board_type` | עמודות שכבר קיימות בטבלת contests — היו אמורות לתמוך בלוחות שונים בתחרויות. **לנצל**, לא להמציא מחדש. | שלב 2 |
| `DIFFICULTY_PRESETS` snapshot pattern | פריסטים נשמרים על השורה (`difficulty_label`/`difficulty_weights`/`difficulty_speed_pct`) ברגע יצירת תחרות/דו-קרב — שינוי הפריסט בעתיד לא מערער על משחקים פעילים. **חזור על הדפוס הזה לוחות**. | שלב 2 |
| `admin_actions` audit log | קיים. כל שינוי אדמין על לוח חייב לכתוב לכאן. | שלב 2 |
| `checkRateLimit()` helper | קיים. עוטף הגנה מ-spam על כל endpoint חדש. | שלב 2 |

### Admin UX patterns שצריך לחקות (לא להמציא מחדש)

האדמין כבר עבר רענון UX משמעותי (CLAUDE.md §11 "Admin config UX"). דפוסי החובה:

1. **6 טאבים** ב-[admin/index.html](admin/index.html): `📊 דשבורד` / `🎮 משחק` / `💰 כלכלה` / `👥 שחקנים` / `🏆 תחרויות` / `🔧 ניטור`. **לוחות שייכים ל-🎮 משחק** — אל תיצור טאב שביעי, פתח sub-section בתוך 🎮 משחק.
2. **`renderConfigValueCell(key, value)`** — boolean keys → toggle buttons (`✓ פעיל` / `✗ כבוי`); numeric/enum → input + preset chips. **השתמש בדפוס הזה** לכל שדה חדש של לוח.
3. **`PRESETS_PER_KEY` + `TIPS_PER_KEY`** — כל מפתח חדש צריך גם preset chips וגם tooltip בעברית עם דוגמה קונקרטית. **לא לחרוג מהדפוס**.
4. **`persistConfigValue(host, key, val)`** — single source of truth לכל PATCH /config + toast + רענון. **לעבור דרכה**.

### Frontend infrastructure שניתן לנצל

- **`NavStack` + `mountShell({title, onBack, actions})`** ב-[src/04-ui-utils.js](src/04-ui-utils.js) — כל מסך אדמין/בחירה חדש בקליינט חייב לעבור דרכה (קיים מפאזה 2 של ה-UX audit).
- **Design tokens** ב-[public/css/base.css](public/css/base.css) — `--color-accent`, `--color-surface`, `--shadow-glow` וכו'. **אסור** ל-hard-code צבעים בלוחות חדשים.
- **`showToast(msg, kind)`** ב-[src/04-ui-utils.js](src/04-ui-utils.js) — לכל אישור/שגיאה בקליינט.
- **`buildTierBar` + `revealNextTier` (slot machine)** ב-[src/12-tour-info.js](src/12-tour-info.js) — אם לוחות יהיו עם next-piece teaser מותאם.

### חפיפות שצריך לפתור לפני התחלת כל שלב

לפני שמתחילים — **לעצור ולחשוב** על החפיפות הבאות:

- **Phase 3 (Special Cells) vs. existing events system**: ה-events של היום (bomb/star/gift/fever/freeze/target) הם cell-level effects בכל זאת — האם תאי "frozen" / "electric" / "gold" צריכים לבוא כאקסטנשן ל-`event_*` או כמערכת חדשה? **המלצה:** מערכת חדשה (זמן חיים שונה — events הם רגעיים, special cells הם persistent). **אבל** ויזואל ו-FX (overlay, fly-particles) — לנצל את `fxAtCell()` הקיים.
- **Phase 4 (Themed Boards) vs. SKIN_PACKS**: skins משנים אריחים, themed boards משנים רקע + multipliers + special cells. **המלצה:** themed board = "skin פלוס" — שכבת תמה מעל המשחק, לא מערכת מתחרה. שמור על אבחנה ברורה ב-UI ("סקין" vs "לוח").
- **Phase 5 (Board Shapes) vs. `getBoardRows`/`getBoardCols`**: הגטרים הקיימים מחזירים מספרים, לא מטריצה. נדרשת אבסטרקציה רחבה יותר: `getBoardGeometry()` שמחזירה מטריצה של `active` cells, ו-`getBoardRows()`/`getBoardCols()` ימשיכו לעבוד כ-`geometry.length` / `geometry[0].length`. **לא שינוי שובר תאימות לאחור** — רק הוספה.
- **Phase 6 (LiveOps Scheduler) vs. existing weekly contest**: יש כבר `weekly_enabled` + auto-creation ב-server.js (CLAUDE.md §11 — "Weekly Auto-Challenge"). הדפוס כבר קיים. **לנצל את אותו interval pattern** במקום להמציא scheduler חדש.

---

## 2. ארכיטקטורה — איך זה עובד ברמת המערכת

### מהן רכיבי הלוח

לוח מורכב מ-4 שכבות נפרדות:

1. **Geometry (גיאומטריה)** — צורת ה-grid. 6×4 רגיל, או heart-shaped, או tree-shaped, וכו'.
2. **Cell Properties (תכונות תאים)** — כל תא יכול להיות רגיל / קפוא / זהב / חשמלי / נעול / טלפורט.
3. **Scoring Rules (חוקי ניקוד)** — מכפילים פר עמודה, פר שורה, או פר תא.
4. **Visual Theme (תמה ויזואלית)** — צבע רקע, סקין אריחים, אנימציות, צלילים.

**שיטה:** לכל לוח יש "definition" JSON שמתאר את כל ארבע השכבות. הקוד הקיים של BLOOM יקרא את ה-definition בתחילת משחק, ויטען לוח לפי המוגדר שם.

### מה האדמין רואה

ב-`admin/` יוסיף עמוד חדש: **"ניהול לוחות"**.

- רשימה של כל הלוחות המוגדרים (עם תצוגה מקדימה ויזואלית של כל אחד)
- לכל לוח: שם, סוג, סטטוס (פעיל / לא פעיל / מתוזמן)
- כפתורי "הפעל עכשיו" / "השבת" / "תזמן"
- מסך תזמון: "פעיל מ-X עד Y", "פעיל בימי שלישי", "פעיל רק לרמה 10+"
- כפתור "צור לוח חדש" — מסך בנייה ידני

### איך הלקוח (browser) יודע איזה לוח להציג

כשהמשחק נטען, הוא קורא ל-`GET /api/active-board` (endpoint חדש). הקריאה מחזירה את ה-board definition הפעיל כרגע לשחקן הזה (לפי השעה, היום, רמתו, מנויו ל-Battle Pass). הלקוח מטמיע את ה-definition ומאתחל את המשחק לפיו.

---

## 3. שש קטגוריות של לוחות

### קטגוריה 1: Score Multipliers (מכפילי ניקוד)

הקטגוריה הכי פשוטה. הלוח רגיל (6×4), אבל **כל עמודה (או שורה) נותנת מכפיל שונה לניקוד**.

**דוגמה:**
- עמודה 1 (ימין): מכפיל ×6
- עמודה 2: מכפיל ×4
- עמודה 3: מכפיל ×2
- עמודה 4 (שמאל): מכפיל ×1

**מה זה משנה במשחק:**
שחקן שמפיל אריח כתר (דרגה 8) על עמודה ×6 יקבל ~4,800 נקודות. על עמודה ×1 — רק 800. ההחלטה איפה להפיל הופכת לאסטרטגית.

**גישה ויזואלית:**
- כל עמודה מקבלת רקע צבעוני שונה (כתום בוהק ל-×6, צהוב ל-×4, ירוק ל-×2, אפור ל-×1)
- בראש כל עמודה מוצג ה-multiplier (×6, ×4, וכו') בפונט גדול

**וריאציות:**
- Multipliers דינמיים: ×6 עולה ל-×10 אחרי 10 drops, ואז יורד ל-×3
- Multipliers שמתחלפים: כל 30 שניות עמודות מתחלפות במכפילים שלהן
- Multipliers הפוכים: ×0.5 (מחצית הניקוד) בעמודה אחת, ×8 בעמודה אחרת

---

### קטגוריה 2: Special Cells (תאים מיוחדים)

הלוח הוא 6×4 רגיל, אבל **חלק מהתאים יש להם תכונות מיוחדות**.

**סוגי תאים מיוחדים:**

| סוג | מה קורה | ויזואלי |
|-----|---------|---------|
| **תא קפוא** | אריח שנוחת שם נשאר אבל לא מתמזג עד שמפשירים | מסגרת כחולה זוהרת |
| **תא זהב** | אריח שנוחת שם עולה דרגה אחת אוטומטית | מסגרת זהובה מנצנצת |
| **תא חשמלי** | אריח שמתמזג שם משדר merge גם לתאים לא-סמוכים | מסגרת צהובה עם זיגזג |
| **תא נעול** | סגור עד שנעשים X מיזוגים בלוח (אז נפתח) | אריח שחור עם מנעול |
| **תא טלפורט** | אריח שנוחת שם קופץ לתא אקראי אחר | מסגרת סגולה עם ספירלה |
| **תא בונוס** | מיזוג עליו = +500 ניקוד | מסגרת ירוקה |

**מה זה משנה במשחק:**
שחקן צריך לזכור איפה התא הקפוא ולהימנע ממנו. תא זהב = מטרה. תא חשמלי = הזדמנות ל-mega chain. ההחלטות הופכות עמוקות יותר.

**מיקום התאים המיוחדים:**
האדמין מגדיר את המיקומים בקובץ ה-board definition. למשל: "תא זהב ב-(3,2), תא קפוא ב-(5,1), תא חשמלי ב-(2,3)".

---

### קטגוריה 3: Board Shapes (לוחות בצורות שונות)

הלוח **לא 6×4 רגיל**. הצורה משתנה לחלוטין.

**דוגמאות לצורות:**

| צורה | תיאור | מתי להשתמש |
|------|--------|------------|
| **Heart-shaped** | לוח בצורת לב, מאריחים | יום ולנטיין |
| **Tree of Life** | לוח בצורת עץ אנכי, רחב למטה ובחר ל-1 תא בראש | חג המולד / חנוכה |
| **Star of David** | משולשים מתחברים ל-6 קודקודים | יום העצמאות |
| **Pyramid** | משולש הולך וצר כלפי מעלה | פסח / רמדאן |
| **Donut** | חור במרכז הלוח, לא ניתן להפיל לאזור המרכזי | יוצא דופן / mystery |
| **Wide 8×4** | לוח רחב יותר | speed mode |
| **Tall 5×8** | לוח גבוה יותר | survival mode |
| **Two-column 4×8** | שני "ערוצים" צרים | duel mode |

**מה זה משנה במשחק:**
כל מסלולי ה-merge משתנים, אזורים בלתי-נגישים יוצרים אילוצים, החוויה כולה אחרת. אותו core gameplay, ממש לא אותה חוויה.

**טיפול טכני (הערה לחיפוש מאוחר יותר):**
הלוגיקה הנוכחית של BLOOM מבוססת על מערך 2D פשוט. צריך להוסיף תמיכה בתאים `null` שמסמנים "לא חלק מהלוח" (לעומת 0 שמסמן "ריק אבל קיים"). הגיאומטריה תוגדר כרשת של cells פעילים בלבד.

---

### קטגוריה 4: Themed Boards (לוחות מותאמי-עונה/חג)

זהו ה-LiveOps המלא — שילוב של כל הקטגוריות הקודמות סביב תמה.

**דוגמאות:**

#### לוח Hanukkah (חנוכה)
- צורה: חנוכייה (9 עמודות, האמצעית מעט גבוהה יותר)
- אריחים: בכחול-לבן
- תא מיוחד: נר השמש באמצע ב-multiplier ×8 לכל מיזוג סביבו
- אקטיבי: 8 ימים בכסלו
- שמע: ניגון מעוצב

#### לוח Christmas (חג המולד)
- צורה: עץ אשוח אנכי
- אריחים: ירוק-אדום-זהב
- תא מיוחד: מתנות בתחתית הלוח. הגיע אריח דרגה גבוהה אליה = jackpot
- אקטיבי: 20-26 בדצמבר
- שמע: jingle bells

#### לוח Passover (פסח)
- צורה: סדר פסח — גביעים במקום אריחים
- אריחים: מצות (לא ניתנות להזיז — נעולות)
- בונוס מיוחד: "מכת בכורות" — מנקה שורה
- אקטיבי: שבוע לפני פסח

#### לוח Valentine's Day
- צורה: לב מאריחים
- אריחים: ורוד-אדום
- מכפיל: כל חוליה רומנטית (תאים שמרחקם אופקי 2) = +2× ניקוד
- אקטיבי: 13-15 בפברואר

#### לוח Yom Ha'atzmaut (יום העצמאות)
- צורה: דגל ישראל אופקי
- אריחים: כחול-לבן
- מיוחד: אריחי מגן דוד מתמזגים יחד = רינגטון "התקווה"
- אקטיבי: יום העצמאות

#### לוח Ramadan
- צורה: לוח עם סהר וכוכבים
- אריחים: זהב-ירוק כהה
- מיוחד: "ארוחת איפטר" — בשעה 18:00 לוקאלית, כל המכפילים מוכפלים ב-2
- אקטיבי: כל חודש הרמדאן

#### לוח Mother's Day
- צורה: לב גדול מאריחים
- אריחים: ורוד פרחוני
- מיוחד: לוח עם פרחים פתוחים, כל מיזוג סביב פרח = bonus

---

### קטגוריה 5: Game Mode Boards (וריאציות חוקים)

הלוח אותו דבר (6×4 רגיל), אבל **החוקים שונים**.

**מצבים:**

| מצב | חוקים | משך |
|-----|--------|-----|
| **Speed Board** | דקה אחת בלבד, כמה מיזוגים שתספיק | 60 שניות |
| **Survival Board** | אריחים נופלים אוטומטית כל 2 שניות, מנע overflow | עד אובדן |
| **Puzzle Board** | לוח מוגדר מראש (preset), צריך להגיע לכתר ב-X מהלכים בדיוק | עד פתרון |
| **Chain Hunt** | רק chains ×3+ נחשבים. ×1-×2 = 0 נקודות | רגיל |
| **Mirror Board** | כל מה שאתה עושה משוכפל בלוח של היריב במקביל | PvP |
| **Time Attack** | כל אריח שמסתיים על הקרקע מוסיף שנייה לטיימר | עד nu time |
| **No-Bonus Board** | בונוסים מבוטלים, רק החכמה היא לנצח | רגיל |
| **All-Bonus Board** | כל אריח שלישי הוא בונוס | רגיל |

---

### קטגוריה 6: VIP / Exclusive Boards (בלעדיים)

לוחות שזמינים רק לקהל מסוים:

| קהל | סוג לוח | למה |
|-----|---------|-----|
| **Battle Pass subscribers** | לוח יוקרתי עם ×2 קבוע | הצדקה לרכישה |
| **Level 10+** | לוח עם תאים נדירים שאין בלוח רגיל | מטרה לחתור אליה |
| **Daily contest entrants** | לוח שזמין רק בתחרות | יצירת urgency |
| **Whales (top 1%)** | לוח דמוי-קזינו עם רולטה אקראית של multipliers | הצדקה ל-IAP גדולים |
| **First-time players (D1)** | לוח קל מאוד עם הרבה בונוסים | onboarding חזק |
| **Returning after 7+ days** | לוח "ברוך שובך" עם תגמולים מוגברים | win-back |

---

## 4. שלבי פיתוח — סדר עבודה ל-Claude Code

### עקרונות עבודה כלליים

לפני שלב בכלל:
1. וודא `git status` נקי
2. וודא אתה על branch `main`
3. עשה `git pull` כדי להבטיח שאתה עם הגרסה האחרונה
4. קרא את `CLAUDE.md` ו-`README.md` הנוכחיים

בכל סוף שלב:
1. בדוק שהמשחק עדיין רץ (פתח את `sst.co.il` אחרי deploy)
2. רוץ `node --check server.js` לוודא שאין שגיאות תחביר
3. עשה `./build.sh` כדי להרכיב CSS/JS
4. עשה `git add -A && git commit -m "..."` עם הודעת קומיט ברורה
5. עשה `git push`
6. **חכה לאישור מ-שלומי לפני שעוברים לשלב הבא**

---

### שלב 1: Score Multipliers (יסוד)

**מטרה:** להוסיף יכולת לכל עמודה (column) להיות עם מכפיל ניקוד שונה. הכי בסיסי, נותן ערך מיידי.

**זמן צפוי:** 2-3 שעות

**✨ ניצול תשתית קיימת:**
- `pointsFor(tier, group, chain)` ב-[src/11-game.js](src/11-game.js) — הציר היחיד שצריך לעדכן. **לא להוסיף multiplier בכל call site**, רק להעביר column ל-`pointsFor` ולהכפיל בפנים.
- `getBoardCols()` קיים — להשתמש בו במקום למקודד `4`.
- Design tokens מ-[public/css/base.css](public/css/base.css) — להשתמש ב-`--color-accent` / `--color-warning` / `--color-success` במקום צבעים hardcoded.
- `showToast(msg, 'success')` / `showFloatingScore()` קיימים — לא להמציא banner חדש.

**מה יש לעשות:**

#### 1.1 הוסף הגדרות מכפילים ל-[src/01-constants.js](src/01-constants.js)

ליד `getBoardRows()` / `getBoardCols()` הקיימים, הוסף:

```js
let _columnMultipliers = null;       // null = pure refactor, no multiplier active
function getColumnMultipliers() {
  if (_columnMultipliers && Array.isArray(_columnMultipliers) && _columnMultipliers.length === getBoardCols()) {
    return _columnMultipliers;
  }
  return null;  // falsy = skip the multiplier logic entirely
}
function setColumnMultipliers(arr) { _columnMultipliers = arr; }
```

**עקרון מרכזי:** ברירת מחדל = `null`, **לא** `[1,1,1,1]`. ככה הקוד יודע לדלג על כל הלוגיקה כשאין multiplier — אפס impact על משחקים רגילים. (זה אותו דפוס של `sessionDifficulty` ב-init().)

#### 1.2 חבר את המכפילים ל-`pointsFor()` ב-[src/11-game.js](src/11-game.js)

`pointsFor()` היא נקודת הציר היחידה לחישוב נקודות (ראה CLAUDE.md §11 — score economy rebalance). חתימה נוכחית: `pointsFor(tier, group, chain)`. שינוי:

```js
function pointsFor(tier, group, chain, col) {
  const base = tier * 10 * (1 + (tier-1) * 0.3) * group * chain;
  const mults = getColumnMultipliers();
  if (!mults || typeof col !== 'number') return base;
  return Math.round(base * (mults[col] || 1));
}
```

מצא את כל ה-callers של `pointsFor()` והעבר להם את העמודה. ב-`processChains()`, העמודה היא של תא ה-survivor של המיזוג (לא תא ה-drop המקורי — כי merge יכול לעבור עמודות, וזה ייצור עיוות). **תיעד את הבחירה הזו בקומיט.**

**הימנע מ:** הכפלה כפולה ב-drop event + merge event — נקודות מגיעות רק ב-merge, אין "drop points" נפרדים בקוד הקיים. וודא ב-grep.

#### 1.3 הוסף ויזואל לעמודות

קובץ חדש [public/css/board-multipliers.css](public/css/board-multipliers.css) (build.sh יקטר אוטומטית — glob `[a-z]*.css`):

```css
.col-mult-indicator {
  /* pill מעל ה-drop zone */
  position: absolute; top: -28px; left: 50%; transform: translateX(-50%);
  padding: 2px 8px; border-radius: var(--radius-sm);
  background: var(--color-accent); color: var(--color-accent-ink);
  font-weight: 800; font-size: 14px; box-shadow: var(--shadow-sm);
  pointer-events: none; opacity: 0.95;
}
.col-mult-indicator.tier-1x { display: none; }   /* don't clutter ×1 columns */
.col-mult-indicator.tier-2x { background: var(--color-success); }
.col-mult-indicator.tier-4x { background: var(--color-warning); animation: pulse 1.6s ease-in-out infinite; }
.col-mult-indicator.tier-6x { background: linear-gradient(135deg, #FFB95C, #FF6B9D); animation: pulse 0.9s ease-in-out infinite; }
```

ב-[src/11-game.js](src/11-game.js) `render()`, אחרי שהגריד מצויר: אם `getColumnMultipliers()` מחזיר מערך, הוסף `<div class="col-mult-indicator tier-Nx">×N</div>` בראש כל drop-zone שבה המכפיל ≠ 1. (אם אין drop-zone wrapper — צור אחד מעל ה-`.grid` שמחולק לעמודות.)

#### 1.4 הוסף הודעה לשחקן

ב-`processChains()` אחרי הוספת הנקודות, אם `col` היה תחת מכפיל ≥ 2:
```js
const mults = getColumnMultipliers();
if (mults && mults[col] >= 2) {
  showFloatingScore(cell, `×${mults[col]} בונוס!`, '#FFB95C');
}
```

לא להציג ל-×1 (רעש). לא להציג חיתוך toast עליון — `showFloatingScore` כבר קיים ועובד בדיוק לזה.

#### 1.5 בדיקה ידנית לפני קומיט

1. `./build.sh` — מתקטר את ה-JS וה-CSS.
2. פתח את `public/index.html` בדפדפן או הרץ `npm start`.
3. **שלב א'** (אסור regression): וודא שמשחק רגיל **בלי** קריאה ל-`setColumnMultipliers` פועל **בדיוק** כמו לפני. אותם ניקודים, אותה ויזואליה.
4. **שלב ב'** (validation חדש): פתח DevTools console, רוץ:
   ```js
   __bloomDebug?.setColumnMultipliers?.([6, 4, 2, 1]); __bloomDebug?.restart?.();
   ```
   (להוסיף את שניהם ל-`BloomDebug` export ב-[src/13-boot.js](src/13-boot.js).) ראה שהאינדיקטורים מופיעים, ושנקודות מגיעות עם המכפיל הנכון.
5. **שלב ג'** (engine sanity): רוץ `node scripts/test_engine.mjs` — אסור שהוא יישבר.

#### 1.6 עדכן [CLAUDE.md](CLAUDE.md) §11 + §13

הוסף שורה ל-§11 (Current progress): `- ✅ **Score Multipliers (Phase 1 of Dynamic Boards System, May 2026)** — column multipliers...`. עדכן את `BLOOM_DYNAMIC_BOARDS.md` "מצב נוכחי" — שלב 1 ✅.

#### 1.7 קומיט

```
git add -A
git commit -m "feat(boards): phase 1 — column score multipliers

- getColumnMultipliers() / setColumnMultipliers() in 01-constants.js (default null = no-op)
- pointsFor() now takes col and applies the multiplier — single chokepoint, no duplication
- Visual ×N pills above drop zones (board-multipliers.css, design tokens only)
- showFloatingScore('×N בונוס!') on landings under ≥2x columns
- BloomDebug.setColumnMultipliers exposed for in-browser testing
- Zero regression when multiplier is null (verified via test_engine.mjs)"
git push
```

**Deploy:** `railway up --service bloom-web --detach --ci` (לפי feedback_deploy_after_commit memory).

**הודעה לשלומי:** "שלב 1 הושלם ועלה לפרודקשן. כדי להפעיל ניסוי על הלוח, פתח DevTools ב-`https://sst.co.il` ותריץ: `__bloomDebug.setColumnMultipliers([6, 4, 2, 1]); __bloomDebug.restart();`. שלב 2 ייצור ממשק אדמין שיחליף את הקונסול הזה — מוכן לעבור?"

---

### שלב 2: Admin Control Panel

**מטרה:** האדמין יכול להפעיל/לכבות את ה-multipliers דרך ממשק, בלי לערוך קוד.

**זמן צפוי:** 3-4 שעות

**✨ ניצול תשתית קיימת:**
- **טבלה חדשה — אבל idempotent**: כל DDL ב-[schema.sql](schema.sql) חייב להיות `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN IF NOT EXISTS` (CLAUDE.md §9). `db.js` מריץ schema.sql בכל boot.
- **admin auth**: השתמש ב-`requireAdmin` middleware הקיים. אל תיצור auth חדש.
- **admin tab**: לוחות שייכים ל-`🎮 משחק`. **אל תיצור טאב שביעי**. צור sub-section `<section data-tip="..."><h2>🎯 לוחות דינמיים</h2>...` בתוך הטאב הקיים.
- **`renderConfigValueCell` + `PRESETS_PER_KEY` + `TIPS_PER_KEY`**: לכל toggle/preset של לוח — לרשום ב-3 הדפוסים האלה. **לא להמציא UI חדש**.
- **`apiPost` helper** ב-[src/07-identity.js](src/07-identity.js) — auto-injects `{deviceId, token}`. **כל POST חדש בקליינט עובר דרכו**.

**מה יש לעשות:**

#### 2.1 הוסף טבלה חדשה ב-[schema.sql](schema.sql)

```sql
CREATE TABLE IF NOT EXISTS board_configurations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('multipliers', 'special_cells', 'shape', 'themed', 'mode', 'vip')),
  definition JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT false,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  target_audience TEXT NOT NULL DEFAULT 'all',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_board_configs_active ON board_configurations (is_active, priority DESC) WHERE is_active = true;
```

#### 2.2 הוסף endpoints ב-[server.js](server.js)

`GET /api/active-board` (public, `softDeviceAuth`):
1. שאילתה אחת: `SELECT * FROM board_configurations WHERE is_active=true AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) ORDER BY priority DESC LIMIT 1`
2. אם אין שורה — החזר `{ ok: true, board: null }` (לא 404 — קליינט יקבל null וידע "default mode").
3. אם יש — החזר `{ ok: true, board: { type, definition, name, ... } }`.
4. **TTL caching**: 60s in-memory cache (key = audience + level — עתידי). אל תפגע ב-Postgres עם 100 req/sec.

`POST /<ADMIN_PATH>/api/boards` / `PATCH /<ADMIN_PATH>/api/boards/:id` / `DELETE /<ADMIN_PATH>/api/boards/:id` (`requireAdmin`):
- INSERT/UPDATE/DELETE, כותב ל-`admin_actions` audit.
- ולידציה ב-`validateBoardDefinition(type, definition)` helper חדש: לפי הסוג, בדוק שכל השדות הנדרשים קיימים ובגבולות (multipliers: array של אורך `cols`, כל ערך בטווח 0.5..20).

`GET /<ADMIN_PATH>/api/boards` — list של כל הלוחות, עם counts (כמה משחקים שוחקו תחת כל לוח — מ-`daily_scores` עם join עתידי).

#### 2.3 הוסף sub-section ב-[admin/index.html](admin/index.html)

ב-טאב `🎮 משחק`, אחרי "הגדרות משחק", הוסף:

```html
<section data-tab="game">
  <h2>🎯 לוחות דינמיים <span class="tip-trigger" data-tip="boards_intro">?</span></h2>
  <p class="section-desc">לוחות עם חוקים שונים. כשלוח פעיל — שחקנים רואים אותו במקום הלוח הסטנדרטי.</p>
  <div id="boards-list"><!-- מתמלא ע"י loadBoards() --></div>
  <button class="primary" onclick="openBoardEditor()">+ צור לוח חדש</button>
</section>
```

`renderBoardRow(board)`:
- Pills בהיררכיה של design tokens: שם / סוג emoji / סטטוס badge (פעיל=mint, מתוזמן=gold, כבוי=gray).
- כפתורי פעולה: `הפעל עכשיו` (PATCH is_active=true) / `השבת` / `ערוך` / `🗑 מחק`.

`openBoardEditor(boardId?)`:
- מודאל פשוט. שדה definition הוא **לא** textarea של JSON גולמי — **בנה UI ספציפי לסוג**:
  - `multipliers` → 4 input boxes (אחד לכל עמודה) + preset chips: `[1,1,1,1]` / `[6,4,2,1]` / `[2,1,1,2]` / `[10,1,1,1]`.
  - `special_cells` (שלב 3) → grid editor.
  - `shape` (שלב 5) → matrix editor.
  - וכו'.
- שמור דרך `persistConfigValue`-equivalent חדש (`saveBoard(boardId, data)`).

#### 2.4 חבר את הקליינט ב-[src/13-boot.js](src/13-boot.js)

בנקודה הקיימת שטוענת `/api/config` (boot sequence):
```js
const boardRes = await fetch('/api/active-board').then(r => r.json()).catch(() => null);
if (boardRes?.board?.type === 'multipliers' && Array.isArray(boardRes.board.definition?.multipliers)) {
  setColumnMultipliers(boardRes.board.definition.multipliers);
  window._activeBoardName = boardRes.board.name;
}
```

הוסף בנדר ב-mode bar / home: `🎯 לוח פעיל: "${name}"` — לא מטעין אם `_activeBoardName` ריק.

#### 2.5 בדיקה ידנית

1. שמור באדמין לוח `{"multipliers":[6,4,2,1]}`, `is_active=true`.
2. רענן את המשחק — וודא pills מופיעים, וניקוד מוכפל.
3. השבת מהאדמין — וודא שהמשחק חוזר ל-default ללא רענון (אפשר לעשות 60s ולחכות, או לחשוף `__bloomDebug.refetchBoard()`).
4. רוץ smoke test: `curl https://sst.co.il/api/active-board | jq`.

#### 2.6 עדכן [CLAUDE.md](CLAUDE.md)

- §7 (APIs) — הוסף שורה ל-`GET /api/active-board` + 3 admin routes.
- §11 (Current progress) — `✅ **Dynamic Boards — Phase 2 admin control (May 2026)** ...`
- שלב 2 ✅ ב-BLOOM_DYNAMIC_BOARDS.md "מצב נוכחי".

#### 2.7 קומיט + deploy

```
git add -A
git commit -m "feat(boards): phase 2 — admin control panel

- New idempotent table board_configurations + index on (is_active, priority)
- GET /api/active-board with 60s in-memory cache
- POST/PATCH/DELETE under /<ADMIN_PATH>/api/boards (requireAdmin + audit)
- Sub-section in 🎮 משחק tab (NOT a new top-level tab — uses existing chrome)
- Type-specific editor UI (no raw JSON for type=multipliers)
- Client picks up active board on boot; falsy = vanilla gameplay"
git push
railway up --service bloom-web --detach --ci
```

**הודעה לשלומי:** "שלב 2 הושלם ופרוס. פתח admin → 🎮 משחק → 🎯 לוחות דינמיים. צור לוח, סמן `is_active=true`, ראה אותו במשחק תוך 60 שניות. מוכן לשלב 3?"

---

### שלב 3: Special Cells (תאים מיוחדים)

**מטרה:** להוסיף 6 סוגי תאים מיוחדים — קפוא, זהב, חשמלי, נעול, טלפורט, בונוס.

**זמן צפוי:** 1-2 שבועות

**⚠️ החלטה ארכיטקטונית קריטית לפני התחלה:**

המערכת הקיימת ב-[src/14-events.js](src/14-events.js) (`event_bomb` / `event_star` / `event_gift` / `event_fever` / `event_freeze` / `event_target`) **חופפת חלקית** עם special cells. ההבחנה:
- **Events** = רגעיים, מופיעים על תא אקראי, נעלמים אחרי N דקות.
- **Special cells** = persistent, מיקום קבוע בלוח לפי הגדרת הלוח.

**המלצה (תעצור ותשאל אם לא ברור):** מערכות נפרדות אבל **המנגנון הוויזואלי משותף** — `fxAtCell()` הקיים, ה-`event_overlay` div, וה-CSS animations של `fx-explode`/`fx-freeze`. **לא להמציא overlay חדש.**

**✨ ניצול תשתית קיימת:**
- `fxAtCell()` + `purgeEventOverlays()` ב-[src/14-events.js](src/14-events.js).
- `auroraFlyParticlesToScore()` ב-[src/01-constants.js](src/01-constants.js) — אפקט נחיתה על תא זהב יכול לקרוא לזה.
- ה-validateBoardDefinition של שלב 2 — הרחב לסוג `special_cells`.

**מה יש לעשות:**

#### 3.1 הרחב את ה-board definition

ה-definition של לוח כעת תומך ב-`special_cells`:

```
{
  "multipliers": [1, 1, 1, 1],
  "special_cells": [
    { "row": 0, "col": 2, "type": "gold" },
    { "row": 3, "col": 1, "type": "frozen" },
    { "row": 2, "col": 3, "type": "electric" }
  ]
}
```

#### 3.2 הוסף לוגיקת תא לכל סוג

ב-`src/11-game.js`:

**Gold cell (תא זהב):**
- בעת drop על תא זהב — האריח מקבל +1 דרגה אוטומטית
- ויזואלית: flash זהוב

**Frozen cell (תא קפוא):**
- אריח שנוחת על תא קפוא — נשאר בו, לא יכול להתמזג
- כדי להפשיר: בונוס Freeze (קיים) מפשיר את כל התאים הקפואים
- ויזואלית: overlay כחול שקוף

**Electric cell (תא חשמלי):**
- כשאריח על תא חשמלי מתמזג, ה-merge מועבר גם לכל האריחים מאותה דרגה ב-radius של 2 (לא רק סמוכים)
- ויזואלית: זיגזג צהוב מהתא לכל המטרות

**Locked cell (תא נעול):**
- בהתחלה נעול — לא ניתן להפיל אריחים שיגיעו אליו
- אחרי X מיזוגים בלוח (מוגדר ב-definition: `"unlock_after": 10`), התא נפתח

**Teleport cell (תא טלפורט):**
- אריח שנוחת על תא טלפורט מטולפז מיד לתא אקראי אחר (ריק)
- ויזואלית: ספירלה סגולה

**Bonus cell (תא בונוס):**
- כל מיזוג עליו מוסיף +500 ניקוד בנוסף לרגיל
- ויזואלית: רקע ירוק עם +500 צף

#### 3.3 הוסף ויזואלים ב-CSS

לכל סוג תא — CSS class חדש עם רקע, animation, overlay. וודא שהאיורים לא מסתירים את האריח עצמו (כשיש אריח על תא מיוחד, האריח גלוי, התא הוא רק מסביב).

#### 3.4 חבר ל-admin

ב-`admin/boards.html`, כשבוחרים type = 'special-cells', הצג עורך גרפי:
- תצוגה ויזואלית של 6×4
- לחיצה על תא = פתיחת menu לבחירת סוג
- אפשרות לקבוע unlock_after, multiplier, וכו'

#### 3.5 קומיט

```
git add -A
git commit -m "feat(boards): add special cells system

- 6 cell types: gold/frozen/electric/locked/teleport/bonus
- Each type has unique gameplay effect and visual treatment
- Board definition supports cell positions and per-cell parameters
- Admin UI provides graphical cell editor"
git push
```

---

### שלב 4: Themed Boards (חגים)

**מטרה:** ליצור 5 לוחות מותאמי-חג מוכנים-לשימוש: חנוכה, פסח, יום העצמאות, ולנטיין, חג מולד.

**זמן צפוי:** שבועיים-3 (כל לוח 2-3 ימים)

**✨ ניצול תשתית קיימת:**
- **`SKIN_PACKS` הוא המודל**: כל themed board = "skin פלוס" (skin בלבד = רק אריחים; themed board = skin + multipliers + special cells + theme overlay). ראה Aurora skin pack ב-[public/css/tiles-aurora.css](public/css/tiles-aurora.css) — כל ה-CSS scoped תחת `body.skin-aurora-active`. **חזור על אותו דפוס** עם `body.theme-hanukkah-active` וכו'.
- **`syncBodySkinClass()`** ב-[src/01-constants.js](src/01-constants.js) — הרחב ל-`syncBodyThemeClass()` מקביל.
- **תאריכי חגים**: יש כבר `weekly_enabled` + auto-creation לוגיקה בשרת. הוסף `holiday_schedules` JSON לכל themed board במקום ידני.
- **קבצי seed**: כבר יש דפוס של idempotent inserts בסכמה. צור `themed-boards-seed.sql` עם `INSERT ... ON CONFLICT DO NOTHING`.

**מה יש לעשות:**

#### 4.1 צור 5 לוחות בקובץ seed

ב-`schema.sql` או בקובץ נפרד `themed-boards-seed.sql`, הוסף INSERT statements עם ה-board configurations של החגים:

**לוח חנוכה (Hanukkah Board):**
- name: "🕎 לוח חנוכה"
- type: "themed"
- definition: כולל multipliers + special cells בצורת חנוכייה + theme = "hanukkah-blue-white"
- starts_at: תחילת חנוכה (לחישוב — שינוי בכל שנה, אבל אפשר להזין ידנית)
- ends_at: סוף חנוכה
- priority: 100 (גבוה מאוד)
- target_audience: "all"

**לוח פסח (Passover Board):**
- name: "🍷 לוח פסח"
- definition: גביעים-themed, locked cells representing מצות, multipliers
- starts_at: שבוע לפני פסח

**לוח יום העצמאות:**
- name: "🇮🇱 יום העצמאות"
- definition: כחול-לבן theme, מגן דוד special cells
- starts_at: יום העצמאות

**לוח ולנטיין:**
- name: "💕 ולנטיין"
- definition: ורוד-אדום theme, lb עם heart pattern בלוח
- starts_at: 13-15 בפברואר

**לוח חג מולד:**
- name: "🎄 קריסמס"
- definition: tree-shape בקירוב, ירוק-אדום-זהב, מתנות special cells
- starts_at: 20 בדצמבר
- ends_at: 26 בדצמבר

#### 4.2 הוסף תמיכה ב-themes ל-CSS

ב-`public/css/themed-boards.css` (קובץ חדש):

```
לכל theme — set שלם של CSS variables:
.theme-hanukkah {
  --board-bg: גרדיאנט כחול-לבן
  --tile-overlay: כחול שקוף
  --cell-border: לבן זוהר
}
.theme-passover { ... }
.theme-yom-haatzmaut { ... }
.theme-valentine { ... }
.theme-christmas { ... }
```

ב-`src/13-boot.js` כשנטען הלוח, הוסף את ה-class המתאים ל-body: `document.body.classList.add('theme-hanukkah')`.

#### 4.3 הוסף sound effects (אופציונלי)

לכל חג — קובץ אודיו קצר שמופעל בכניסה ללוח. לחנוכה — ניגון "מעוז צור". לקריסמס — jingle bells. לפסח — מנגינת "מה נשתנה". וכו'.

#### 4.4 הוסף שכבה ויזואלית

ב-`public/index.html`, מעל הלוח, הוסף div חדש: `<div id="theme-overlay"></div>`. ה-overlay יכיל גרפיקה דקורטיבית של החג (נר חנוכה זוהר, מגן דוד, וכו').

#### 4.5 קומיט

```
git add -A
git commit -m "feat(boards): add 5 themed boards for holidays

- 🕎 Hanukkah, 🍷 Passover, 🇮🇱 Yom Ha'atzmaut, 💕 Valentine's, 🎄 Christmas
- Each board has unique theme, special cells, multipliers
- Themes applied via body CSS class
- Decorative overlay for each holiday
- Boards auto-activate by date schedule"
git push
```

---

### שלב 5: Board Shapes (לוחות בצורות שונות)

**מטרה:** הלוח לא 6×4 רגיל. צורות שונות לחלוטין.

**זמן צפוי:** 3-4 שבועות (זה השלב המורכב ביותר)

**✨ ניצול תשתית קיימת (חשוב!):**
- **חצי מהעבודה נעשתה כבר**: `getBoardRows()` / `getBoardCols()` ב-[src/01-constants.js](src/01-constants.js) קיימים מ-2026-05 ("architectural prep for the App launch" — CLAUDE.md §11). ההרחבה היחידה: להוסיף `getBoardGeometry()` שמחזירה מטריצה של 0/1 (active/absent), ול-`getBoardRows()`/`getBoardCols()` יהיו `geometry.length` / `geometry[0].length`.
- **לא לשבור תאימות**: כל ה-callers של הגטרים הקיימים ימשיכו לעבוד **בלי שינוי** — אם אין geometry מוגדרת, הגטרים מחזירים את ה-6/4 הסטנדרטיים.
- **engine self-test** ב-[scripts/test_engine.mjs](scripts/test_engine.mjs) — חובה להרחיב לכלול 5 צורות חדשות. ל-`gravity invariant` חייב להמשיך לעבוד.

**⚠️ אסור להמציא מחדש**: 5 הצורות הראשונות חופפות לחגים — heart=ולנטיין, tree=חנוכה+קריסמס, star=יום העצמאות, pyramid=פסח. **תיאם עם שלב 4** או תעשה שלב 5 לפני שלב 4 (אם לוגי לוועדת התכנון).

**מה יש לעשות:**

#### 5.1 שינוי לוגיקת ה-grid

ב-`src/11-game.js`, ה-grid הוא מערך 2D פשוט. צריך להוסיף concept חדש: `cell.active` (האם תא זה חלק מהלוח).

**Geometry definition בקובץ ה-board config:**

```
{
  "shape": "custom",
  "geometry": [
    [0, 1, 1, 0],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [0, 1, 1, 0],
    [0, 0, 1, 0]
  ]
}
```

1 = תא פעיל. 0 = תא לא קיים.

#### 5.2 שינוי קונפיגורציית ה-gravity

הקוד הקיים מניח שאריח שנופל מגיע לתא הכי נמוך באותה עמודה. עם צורות חדשות — צריך לחשב את הצנרה (path) שהאריח עובר תוך התחשבות בתאים לא-קיימים.

לדוגמה ב-pyramid (הולך וצר כלפי מעלה):
- מהשורה התחתונה (רחבה), אריחים נופלים רגיל
- בשורה צרה יותר, יש פחות עמודות. אריחים שמופלים מצד ימין/שמאל מחליקים פנימה

#### 5.3 שינוי לוגיקת המיזוג

מיזוג בודק תאים סמוכים — צריך לוודא שהבדיקה לא תחשב תאים לא-קיימים כ"סמוכים".

#### 5.4 שינוי ה-rendering

ב-`renderBoard()` ב-`src/11-game.js`, צריך להציג רק תאים פעילים. תאים לא-קיימים = invisible. הצורה של הלוח מתבטאת אוטומטית.

#### 5.5 הוסף 5 צורות ראשונות

- **Heart**: צורת לב (ל-Valentine's)
- **Tree**: עץ אנכי (ל-Christmas/Hanukkah)
- **Star**: מגן דוד (ל-Yom Ha'atzmaut)
- **Pyramid**: פירמידה (ל-Passover)
- **Wide 8×4**: לוח רחב (ל-Speed mode)

ההגדרה של כל אחת ב-board config — מטריצת geometry.

#### 5.6 קומיט

```
git add -A
git commit -m "feat(boards): add board shapes system

- New geometry concept: cells can be 'active' or 'absent'
- Gravity and merge logic updated to skip absent cells
- 5 initial shapes: heart, tree, star, pyramid, wide
- Each shape changes gameplay drastically
- Board definition supports custom geometry matrix"
git push
```

**הודעה לשלומי:** "שלב 5 הושלם — הגדול ביותר עד עכשיו. עכשיו יש 5 צורות חדשות. תבדוק את לוח Tree (במיוחד), כי הוא יוצר חוויה ממש שונה. מוכן לשלב 6?"

---

### שלב 6: LiveOps Scheduler

**מטרה:** מערכת תזמון אוטומטית. האדמין מגדיר "כל יום שני בשעה 20:00 הפעל את Speed Board", והמערכת עושה את זה אוטומטית.

**זמן צפוי:** שבוע

**✨ ניצול תשתית קיימת:**
- **Weekly auto-contest** ב-[server.js](server.js) — `weekly_enabled` config + `setInterval` שבודק כל שעה אם צריך ליצור תחרות שבועית חדשה. **חזור על אותו interval pattern** במקום להמציא scheduler חדש.
- **`admin_actions` audit** — כל autosave של scheduler חייב לכתוב audit.
- **`weekly_name` config** — דפוס מצוין לשמות מתוזמנים. השתמש בו.

**מה יש לעשות:**

#### 6.1 הוסף שדה schedule_rules ל-board_configurations

ב-`schema.sql`:

```
ALTER TABLE board_configurations ADD COLUMN schedule_rules JSONB;
```

ה-rules הם כלל מתי הלוח פעיל:

```
{
  "type": "weekly",
  "day_of_week": 2,
  "start_hour": 20,
  "duration_hours": 1
}
```

או:

```
{
  "type": "date_range",
  "starts_at": "2026-12-20",
  "ends_at": "2026-12-26"
}
```

או:

```
{
  "type": "hourly",
  "active_minutes": 15,
  "rest_minutes": 45
}
```

#### 6.2 הוסף לוגיקה חישוב "האם פעיל כרגע"

ב-`server.js`:

```
function isBoardActiveNow(board) {
  const now = new Date();
  // אם יש starts_at/ends_at — תבדוק אותם
  // אם יש schedule_rules — תחשב לפי הסוג
  // אם אין — תמיד פעיל
}
```

קרא לפונקציה הזו ב-`GET /api/active-board` במקום הבדיקה הנוכחית.

#### 6.3 הוסף mass UI ב-admin

ב-`admin/boards.html`, עורך schedule rules גרפי:
- Dropdown לסוג: "תאריך קבוע" / "שבועי" / "חודשי" / "שעתי" / "תמיד"
- כל סוג מציג את הפרמטרים שלו
- תצוגה מקדימה: "פעיל ב-X פעמים בשבוע הבא"

#### 6.4 הוסף indicator לקליינט

כשלוח מיוחד פעיל, הצג למעלה: "🎄 הלוח של חג המולד! פעיל עד 26.12". כשפעיל זמן מוגבל (כמו Speed שעתי): "⏰ 47 דקות נותרו".

#### 6.5 קומיט

```
git add -A
git commit -m "feat(boards): add LiveOps scheduler

- Schedule rules support: date_range / weekly / monthly / hourly / always
- Server computes active boards based on current time + rules
- Admin UI provides graphical schedule editor
- Client shows banner with time-remaining for special boards"
git push
```

---

## 5. שיפורים עתידיים

אחרי שלב 6, המערכת תהיה functional לחלוטין. הנה כיוונים נוספים לחקור:

### 5.1 Mystery Boards
לוח שמוסתר עד שהשחקן מתחיל. אחרי 5 שניות מתגלה: "המכפילים מוכפלים ב-3!"

### 5.2 Player-Voted Boards
משאל שבועי באפליקציה: "איזה לוח תרצה לראות ביום ראשון?" הלוח המנצח רץ.

### 5.3 Tournament-Locked Boards
לוחות שזמינים רק בתחרות. "כניסה ל-Diamond Board: 100 קרדיטים".

### 5.4 Board Achievements
"השג כתר בלוח Hanukkah", "100 chains בלוח Speed". Trophy מיוחד למי שסיים את כולם.

### 5.5 Combo: Skin + Board
שילובים מוצעים: סקין Aurora + לוח Hanukkah = "הקרפד הכחול"; הצעת קמפיין שיווקית.

### 5.6 Daily Board Rotation
יום ראשון = Multipliers. יום שני = Mystery. יום שלישי = Speed. וכו'.

### 5.7 Difficulty Tiers
לכל לוח 3 רמות: Easy, Medium, Hard. רק שחקנים מתקדמים יכולים לגשת ל-Hard.

### 5.8 Local Boards Per Country
לוח טורקי לחג טורקי, לוח הודי לדיוואלי. חיזוק לסטרטגיית localization.

---

## סיכום ההתחייבות לשלומי

לאחר השלמת כל 6 השלבים, BLOOM יהיה ה-merge puzzle הראשון שיש לו:
- **מערכת לוחות דינמיים** עם 6 קטגוריות
- **לוחות חגים** שזמינים אוטומטית
- **שליטה גמורה של האדמין** בלי שינוי קוד
- **תזמון אוטומטי** של אירועים
- **אינסוף וריאציות** שמתחזקות שחקנים לחזור

הלוחות יהוו ה-engagement engine הכי חזק במשחק — יותר מסקינים, יותר מבונוסים. כל שחקן יודע שהיום זה לא אותו משחק כמו אתמול.

---

## נספח: Pre-flight checklist לכל שלב

לפני שמתחילים שלב, לרוץ דרך הרשימה הזו:

- [ ] קראתי את [CLAUDE.md](CLAUDE.md) — לפחות §3 (Architecture), §4 (File structure), §7 (APIs), §10 (What should NOT be changed), §11 (Current progress).
- [ ] קראתי את [schema.sql](schema.sql) ויודע מה idempotent + מה ה-PKs/indexes.
- [ ] קראתי את סקציה [1.5 — התשתית הקיימת](#15-התשתית-הקיימת-מה-כבר-בקוד) ויודע מה כבר קיים.
- [ ] `git status` נקי. אני על `main`. עשיתי `git pull`.
- [ ] קראתי את הסקציה הספציפית של השלב הזה כולל הערות "✨ ניצול תשתית".
- [ ] זיהיתי את כל קבצי המקור שאערוך לפני שאתחיל — לא בוחר src/* באמצע העבודה.
- [ ] אעבור דרך `./build.sh` לפני קומיט (לא לערוך `public/app.js` או `public/styles.css` ישירות — CLAUDE.md §10.1).

לפני קומיט, לרוץ דרך הרשימה הזו:

- [ ] `node --check server.js` עובר.
- [ ] `./build.sh` רץ בלי שגיאות; `git diff public/app.js | head` מראה רק שינויים שנובעים מ-src/.
- [ ] `node scripts/test_engine.mjs` עובר (אם נגעתי בלוגיקת engine).
- [ ] בדקתי ידנית בדפדפן את ה-golden path וגם edge case אחד.
- [ ] עדכנתי את [CLAUDE.md](CLAUDE.md) §11 + רלוונטיים אחרים — Living docs rule.
- [ ] עדכנתי את "מצב נוכחי" ב-BLOOM_DYNAMIC_BOARDS.md ✅ לשלב המתאים.
- [ ] cache buster ב-[public/index.html](public/index.html) הוקפץ (`v20260XXXX...`); SW `CACHE_NAME` ב-[public/sw.js](public/sw.js) הוקפץ אם נגעתי בקבצים שנשמרים בקאש.
- [ ] קומיט עם מסר מובנה (`feat(boards): phase N — ...` + bullet list).
- [ ] `railway up --service bloom-web --detach --ci` (לפי feedback_deploy_after_commit memory — לא לחכות לאישור עבור deploy).
- [ ] smoke test על production (`curl /api/health`, פתחתי את האתר וצפיתי 30 שניות).

---

## נספח: טעויות לא לחזור עליהן

בעבר Claude עשה את הטעויות הבאות בפרויקט. אל תחזור עליהן:

1. **לא לערוך `public/app.js` או `public/styles.css` ישירות.** הם generated. לערוך תמיד את [src/*.js](src/) ו-[public/css/*.css](public/css/). build.sh מקטר.
2. **לא ליצור טבלאות `CREATE TABLE` בלי `IF NOT EXISTS`.** `db.js` מריץ את schema.sql בכל boot — אסור שיישבר.
3. **לא להמציא auth חדש.** השתמש ב-`requireDeviceAuth` (hard) או `softDeviceAuth` (rollout) לקליינט, וב-`requireAdmin` לאדמין.
4. **לא להמציא צבעים hardcoded.** Design tokens ב-[public/css/base.css](public/css/base.css) — `--color-accent`, `--color-surface`, `--shadow-glow`, וכו'.
5. **לא לקרוא ל-balance update בלי atomic UPDATE.** `UPDATE player_profiles SET balance = balance - $1 WHERE balance >= $1 RETURNING balance` — לא `SELECT then check then UPDATE`. ראה Security hardening phase 3 ב-CLAUDE.md §11.
6. **לא להוסיף dependency חדש.** Frontend dep-free, backend = רק `express` + `pg`. CLAUDE.md §9.
7. **לא להוסיף build step / framework / CDN.** vanilla, no bundler. CLAUDE.md §9.
8. **לא לערוך את `WHERE daily_scores.score < EXCLUDED.score`** במיקודי upsert — Best-score-wins הוא load-bearing (CLAUDE.md §10.5).
9. **לא לעבוד על יותר משלב אחד בכל פעם.** השלב הבא דורש אישור שלומי.
10. **לא להגיב על `BLOOM_DYNAMIC_BOARDS.md` בלי לעדכן את [CLAUDE.md](CLAUDE.md) במקביל.** Living docs rule (CLAUDE.md §16).

---

**מסמך זה הוא חוזה. כל סטייה ממנו — דווח לשלומי לפני שינוי.**
