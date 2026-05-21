# BLOOM — מערכת לוחות דינמיים (Dynamic Boards System)

> **לקלוד שיקרא את הקובץ הזה:** המסמך הזה מתאר תוכנית פיתוח רב-שלבית להוספת מערכת לוחות משחק מודולרית ל-BLOOM. **חשוב מאוד:** אל תעבוד על יותר משלב אחד בכל פעם. אחרי כל שלב — קומיט נפרד, push, ועדכן לשלומי. עצור והמתן לאישור לפני שעוברים לשלב הבא. השלבים בנויים מהקל למורכב — שלב 1 ניתן להטמעה בשעתיים, שלב 5 דורש שבועות. אל תקפוץ קדימה.
>
> **בכל פעם שאתה מתחיל פאזה:** קרא את `CLAUDE.md` ו-`schema.sql`. וודא `git status` נקי. תוודא שאתה על `main`. תקרא את הסקציה הספציפית כאן. תתחיל לעבוד.

---

## תוכן עניינים

1. [רקע ומוטיבציה](#1-רקע-ומוטיבציה)
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

**מה יש לעשות:**

#### 1.1 הוסף הגדרות מכפילים ל-`src/01-constants.js`

הוסף קבועים חדשים:

```
COLUMN_MULTIPLIERS — מערך של 4 ערכים. ברירת מחדל [1, 1, 1, 1] (כל העמודות שוות).
ENABLE_MULTIPLIERS — boolean flag. true = להפעיל את המכפילים.
```

החוסר במכפילים יהיה לא משבר — הקוד יעבוד כמו לפני אם כל המכפילים הם 1.

#### 1.2 חבר את המכפילים לחישוב הניקוד ב-`src/11-game.js`

חפש את כל המקומות בהם הניקוד מתחשב:
- כשאריח נוחת (drop event)
- כשמיזוג מתרחש (merge event)
- כשחוליה מתרחשת (chain event)

בכל פעם שמתחשב ניקוד:
1. בדוק באיזו עמודה זה קרה
2. אם `ENABLE_MULTIPLIERS = true`, הכפל את הניקוד ב-`COLUMN_MULTIPLIERS[column]`
3. אחרת — תן הניקוד הרגיל

**חשוב:** ה-multiplier מתייחס לעמודה שבה האריח נוחת, לא לאריחים האחרים שמשתתפים במיזוג. החלטה זו מקלה על הלוגיקה ועדיין נותנת השפעה אסטרטגית.

#### 1.3 הוסף ויזואל לעמודות

ב-`public/css/base.css` (או באחד מקבצי ה-CSS), הוסף סטיילים חדשים:

```
.column-multiplier-6 — רקע כתום בוהק
.column-multiplier-4 — רקע צהוב
.column-multiplier-2 — רקע ירוק
.column-multiplier-1 — רקע אפור
```

בראש כל עמודה (`drop-zone`) הוסף text indicator: "×6", "×4", "×2", "×1" בפונט גדול ובולט.

ב-JavaScript, כשהמשחק מתחיל:
1. קרא את `COLUMN_MULTIPLIERS`
2. הוסף את הקלאס המתאים לכל drop-zone
3. הצג את ה-multiplier למעלה

#### 1.4 הוסף הודעה לשחקן

כשאריח נוחת על עמודה ×4+, הצג הודעה קצרה: "×4 נקודות!" עם אנימציית הבזק. השתמש במנגנון הקיים של banner messages.

#### 1.5 קומיט

```
git add -A
git commit -m "feat(boards): add column score multipliers system

- COLUMN_MULTIPLIERS constant in 01-constants.js (default [1,1,1,1] = no effect)
- Score calculation in 11-game.js now applies column multiplier
- Visual indicators on drop zones (color + ×N text)
- Banner message on high-multiplier landings (×4+)
- ENABLE_MULTIPLIERS flag allows global toggle"
git push
```

**הודעה לשלומי:** "שלב 1 הושלם. בודק שהמשחק רץ. אם תרצה להפעיל את הניסוי, הגדר `COLUMN_MULTIPLIERS = [6, 4, 2, 1]` ו-`ENABLE_MULTIPLIERS = true` ב-01-constants.js, ועשה build. מוכן לעבור לשלב 2?"

---

### שלב 2: Admin Control Panel

**מטרה:** האדמין יכול להפעיל/לכבות את ה-multipliers דרך ממשק, בלי לערוך קוד.

**זמן צפוי:** 3-4 שעות

**מה יש לעשות:**

#### 2.1 הוסף טבלה חדשה ב-`schema.sql`

```
טבלה: board_configurations
שדות:
  id (serial primary key)
  name (varchar, למשל "Multipliers ×6-×4-×2-×1")
  type (varchar — 'multipliers' / 'special-cells' / 'shape' / 'themed' / 'mode' / 'vip')
  definition (jsonb — כל ההגדרות בפורמט JSON)
  is_active (boolean — האם פעיל כרגע)
  starts_at (timestamp — אם null, פעיל מיד)
  ends_at (timestamp — אם null, לא מסתיים)
  target_audience (varchar — 'all' / 'vip' / 'level-10+' / 'new-users' / 'returning')
  priority (integer — אם כמה לוחות פעילים, הגבוה ביותר נבחר)
  created_at (timestamp default now())
```

#### 2.2 הוסף endpoint שרת ב-`server.js`

`GET /api/active-board` — מחזיר את ה-board configuration הפעיל לשחקן הזה כרגע.

לוגיקה:
1. אם השחקן הוא Battle Pass — חפש לוחות עם `target_audience = 'vip'`
2. בדוק את רמת השחקן (XP level), חפש לוחות שמתאימים לרמה הזו
3. סנן רק לוחות פעילים (`is_active = true` AND `(starts_at IS NULL OR starts_at <= NOW())` AND `(ends_at IS NULL OR ends_at >= NOW())`)
4. מיין לפי priority desc
5. החזר את הראשון. אם אין — החזר default (multipliers = [1,1,1,1])

`POST /api/admin/board-config` — יוצר/מעדכן board configuration. דרוש admin auth.

`DELETE /api/admin/board-config/:id` — מוחק board configuration.

#### 2.3 הוסף עמוד אדמין חדש: `admin/boards.html`

מסך פשוט, אבל פונקציונלי:

**חלק עליון:**
- כפתור "צור לוח חדש"
- פילטר לפי סוג: All / Multipliers / Special Cells / Shapes / Themed / Modes / VIP

**חלק אמצעי — טבלה של כל הלוחות:**
- עמודות: שם / סוג / סטטוס (פעיל/מתוזמן/לא פעיל) / תאריך התחלה / תאריך סיום / קהל יעד / פעולות
- כפתורי פעולה: ערוך / כפל / השבת / הפעל עכשיו / מחק

**חלק תחתון — יצירה/עריכה:**
- שם
- סוג (dropdown)
- definition (JSON editor — textarea עם validation)
- starts_at / ends_at (date pickers)
- target_audience (dropdown)
- priority (number input, default 0)
- כפתור שמור

#### 2.4 חבר את הלקוח ל-API החדש

ב-`src/13-boot.js`, כשהמשחק נטען, קרא ל-`/api/active-board`. ה-response יוטמע ב-`window.activeBoardConfig`.

ב-`src/01-constants.js`, החלף את ה-`COLUMN_MULTIPLIERS` הקבוע במשתנה שנקרא מ-`window.activeBoardConfig.multipliers`.

ב-`src/11-game.js`, כשמתחשב ניקוד, השתמש ב-`window.activeBoardConfig.multipliers` במקום בקבוע.

#### 2.5 קומיט

```
git add -A
git commit -m "feat(boards): add admin board configuration system

- New table board_configurations with type/definition/scheduling/audience
- GET /api/active-board returns appropriate config per player
- POST /api/admin/board-config creates/updates configurations
- admin/boards.html provides management UI
- Client now fetches and applies live board config on boot"
git push
```

**הודעה לשלומי:** "שלב 2 הושלם. עכשיו אתה יכול לפתוח את `admin/boards.html`, ליצור לוח חדש מסוג 'multipliers' עם definition `{\"multipliers\":[6,4,2,1]}`, להגדיר אותו פעיל — ולראות אותו במשחק. מוכן לשלב 3?"

---

### שלב 3: Special Cells (תאים מיוחדים)

**מטרה:** להוסיף 6 סוגי תאים מיוחדים — קפוא, זהב, חשמלי, נעול, טלפורט, בונוס.

**זמן צפוי:** 1-2 שבועות

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

**מסמך זה הוא חוזה. כל סטייה ממנו — דווח לשלומי לפני שינוי.**
