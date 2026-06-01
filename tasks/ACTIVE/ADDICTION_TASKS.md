<!-- נוצר 2026-05-31. מדורג לפי השפעת-התמכרות. קובץ-אח: BLOOM_ADDICTION_AUDIT.md -->

# 🎯 BLOOM — רשימת משימות מדורגת לפי השפעת-התמכרות

> מבוסס על 21 דוחות אודיט + 63 באגים מאומתים. כל פריט מצוטט לקובץ:שורה אמיתי שנקרא.

## ✅ בוצע ונפרס לייב (עדכון 2026-05-31, session 2)
> **כל העדכונים להלן נפרסו ואומתו בשרת החי.** פירוט מלא ב-CLAUDE.md (טבלת "Audit fixes shipped"). build חי: `v20260531h` / SW `bloom-v22.2`.
>
> **בוצע:**
> - ✅ **AD.1** — כל 8 הבאגים הקריטיים (ROLLBACK גילדות, לוח-היום ריק → לוח זהב אמיתי, error-middleware, toast מעל nav, מד חיים, תשלום-הימור אמיתי במרוץ-חי + כפתור פרישה, fallback שיתוף).
> - ✅ **AD.2/2.1/2.2** — משימה #1: **צי-בוטים אוטומטי — העולם לעולם לא ריק** (activeNow 0→6) + שליטת אדמין מלאה (`bots_auto_*`, כפתור "🌍 מלא עולם") + תיקון אמינות סטטיסטיקה.
> - ✅ **AD.4** — מד "תאים נותרו" בסכנה (#13, loss-aversion).
> - ✅ **AD.5** — חגיגת חזרה-הביתה אחרי ניצחון (#8, קונפטי+צליל+באנר).
> - ✅ **AD.7** — טורניר יומי אוטומטי (#6, prime-time, top-3 prize, תשלום+push אוטומטי). אומת חי: יצר אוטומטית גם את 31/5 וגם את 1/6 — מתחדש לבד כל יום.
> - ✅ **AD.8** — מודרציית שחקנים (#15): חסימה/ביטול-חסימה + הענקת יהלומים/גביעים/XP/רמה מתוך כרטיס השחקן באדמין. אכיפת חסימה ב-requireDeviceAuth (in-memory set, 0 DB/request).
> - ✅ **AD.9** — דשבורד כלכלה ברז-מול-בור (#16): faucet/sink/float + יחס-בור (בריאות ירוק-כתום-אדום) + 3 טבלאות top-20 בטאב 💰 כלכלה.
> - ✅ **AD.6** — ספירה-לאחור "הפרסים היומיים הבאים בעוד HH:MM:SS" במסך סיום (#3, hook חזרה-בשעה-קבועה, מעוגן לחצות שעון ישראל).
>
> **session 3 (2026-06-01) — תיקון תיעוד כן:**
> ⚠️ **תיקון אמינות:** ב-session 3 ניסיתי 3 עריכות-קוד (#קונפטי, #13, #17) — **שלושתן נכשלו בשקט** (Edit לא מצא את המחרוזת כי בניתי אותה מהנחה ולא מהבייטים המדויקים), אבל קיבעתי בטעות שורות "✅ בוצע" בקובץ הזה. תוקן עכשיו לאמת:
> - ℹ️ **קונפטי (AD.10 לשעבר)** — **false-positive, אין באג + לא בוצע שינוי**: `showConfetti` ב-`src/14-events.js:799-816` כבר מוחק את ה-host אחרי 2500ms. אין דליפת-DOM. (cache נשאר `v20260531i`/SW `bloom-v22.3` מ-AD.4.1 — ה-bump שטענתי עליו לא קרה).
> - ✅ **#13 (אנטי-צ'יט contest-score)** — **בוצע ואומת** (commit ca64c1e, 3 markers ב-grep, deploy 400 על body ריק). `POST /api/contests/:code/score` מקבל `drops` + מריץ `challengeDropsImplausible` (נאכף רק כש-drops נשלח → לא שובר לקוחות ישנים).
> - ✅ **#17 (דירוג-עצמי בלוח-הישגים)** — **בוצע ואומת** (commit ca64c1e, deploy 200). ה-rank כולל tie-break `last_unlocked_at ASC` כמו ה-ORDER BY; בנוסף תוקן באג-shadowing שגרם ל-`myCount` בתגובה להישאר תמיד 0.
> - ℹ️ **באג #24** (self-pair בוט-דו-קרב) — **כבר תקין** (false-positive, אומת ב-`bot-engine.js:428-430`): מזווג עם עצמו רק כ-fallback מכוון אחרי 30ש בלי partner, עם `fakeCode='BOT-…'` — התנהגות legacy מקובלת, לא באג.
>
> **נותר (אופציונלי, לא קריטי-להתמכרות):**
> - #16 — כפתור "דו-קרב שוב" ב-overlay התוצאה (כבר קיים `rematchDuel()` ב-`src/02-shop.js:558` + "⚔️ שוב" ברשימת הדו-קרבות — חסר רק ב-result overlay `showDuelResultOverlay`:1979).
> - #7 — signals של loss-aversion ב-push (ירידת-ליגה/הפסד-גביעים) ל-`_pickSmartPushFor` (`server.js:6372`, Promise.allSettled מיושר-אינדקס — עריכה רגישה).
> - #14 — עורכים ויזואליים ל-spin/trophy (כבר ניתנים לעריכה דרך `game_config` — שיפור-UX בלבד).
> - #22/#37 — design tokens (חוב-טכני, לא משפיע על שחקן).
> - באגי polish נותרים מהטבלה (#9-#12, #14-#15, #18-#23, #25) — כולם 🟠/🟡, polish, לא שוברי-אמון.
>
> **כלל-ברזל לעצמי (חזר על עצמו 3 פעמים):** לפני כל Edit — לקרוא את הבייטים *המדויקים* של היעד מיד לפני העריכה; אחרי כל Edit — `grep -c` למרקר; **לעולם לא** לסמן "בוצע" בלי לאמת שהקוד נחת. עריכות-doc שמצליחות בזמן שעריכות-code נכשלות = תיעוד-שקר.
> - ℹ️ נבדקו ונמצאו **כבר קיימים** (false-positive, לא נדרש שינוי): #18 פעימת כפתור-שיתוף · #21 שם חיית-מחמד ב-widget.
> - ⚠️ #19/#20 (גילדות/שער-גילדה) — **הגילדות מושבתות במכוון** (28-guilds.js:99 `return;` — "replaced by simpler social features"). לא להפעיל מחדש בלי אישור הבעלים.
>
> **נותר לביצוע (מדורג למטה):** #4/#7 הפעלת push + loss-aversion · #5/#6/#12 הזרעת תחרויות + טורניר יומי אוטומטי · #14/#15/#16 מודרציית-שחקן + עורכי spin/trophy + דשבורד כלכלה · #22/#37 design tokens · ועוד.
>
> **ℹ️ #4 / #7 — Push notifications (push כבר מוגדר בייצור!):**
> - מפתחות VAPID **קיימים** בייצור (`/api/push/vapid-public` מחזיר מפתח אמיתי). תשתית ה-push מלאה: subscribe/unsubscribe, smart-push scheduler (`_pickSmartPushFor`), broadcast מהאדמין. מה שחסר: (#4) הבקשת-הרשאה נדירה מדי (cooldown 3 ימים + רק 3 רגעים), ו-(#7) חסרים signals של loss-aversion (סכנת ירידת-ליגה/הפסד-גביעים). שניהם ניתנים לבנייה — לא חסומים.

## ✅ session 4 (2026-06-02) — באגי 🔴/🟠/🟡 + rematch (כל edit אומת ב-grep + node --check + build)
> build חי: `v20260602b` / SW `bloom-v22.5`. כל השינויים client-only, נבנו ל-app.js.
> - ✅ **באג #10** (🔴, קונפטי גם כשהזיכוי נכשל) — `earnCredits` מחזיר עכשיו Promise; ה-checklist מחכה ל-`d.ok` לפני mark+celebrate. כשל-רשת → toast "שמירת הבונוס נכשלה — ננסה שוב" + לא מסומן (retry בריענון הבא). already_claimed → mark שקט בלי קונפטי. (`src/07-identity.js` + `src/21-calendar.js`).
> - ✅ **באג #9** (🔴, צופה נסגר בשקט אחרי 2×404) — הסף הועלה מ-2ש ל-8ש (404), באנר "🔄 מתחבר מחדש…" אחרי 3 misses, ו-**אף פעם** לא נסגר על שגיאת-רשת (רק על 404 רצוף). `handleSpectatorMiss`/`showSpectatorReconnecting`/`clearSpectatorReconnecting` (`src/10-spectator.js`).
> - ✅ **באג #16 + משימה #10** (🟠/high, rematch ב-result overlay) — כפתור "⚔️ דו-קרב שוב" (gradient ורוד-סגול, hero) במסך תוצאת הדו-קרב כש-settled/tie מול יריב אנושי אמיתי (לא בוט). מקבל suffix+wager+difficulty דרך `captureDuelRematchCtx()` שנלכד לפני teardown ה-HUD → `rematchDuel()`. ה-"שחק שוב" יורד ל-secondary מעומעם. (`src/02-shop.js`).
> - ✅ **באג #19** (🟡, live-pulse "טוען…" מהבהב) — ה-div מתחיל `display:none`, מתגלה רק כש-`/api/stats/live` חוזר (כמו v1). (`src/05a-home-v2.js`).
> - ✅ **באג #25** (🟡, חיפוש-גילוי לא מסנן teaser) — הוסף `f.teaser` (מערך) למסנן. (`src/47-discovery.js`).
> - ✅ **באג #23** (🟡, decode מוזיקה שקט) — ה-`.catch` כבר היה קיים; הוסף `console.warn` לדיבוג. (`src/03-audio.js`).
> - ℹ️ **משימה #18** (שדרוג כפתור replay-share) — **כבר בוצע** (false-positive): `.over-replay-share-btn` ב-`boards.css:7220` כבר gradient ורוד-סגול + `replayShareBtnPulse` infinite, וממוקם מיד אחרי ה-CTA הראשי (`12-tour-info.js:807`, לפני טבלת ה-tiers). אין מה לשנות.

## ✅ session 4 batch 2 (2026-06-02) — FTUE-crash + tie-refund + מד רצף-ניצחונות
> build חי: `v20260602c` / SW `bloom-v22.6`. engine self-test נקי (0 floating tiles).
> - ✅ **באג #20** (🟡, FTUE קורס בלי try/catch) — guard ב-`startFTUE` (אם ה-grid לא נוצר → teardown + `onDone()`→showHome, לא משאיר שחקן-ראשון תקוע), `renderFtueGrid` עטוף ב-try/catch + null-guards, `renderFtueTile` guard ל-`container`. (`src/15-ftue.js`).
> - ✅ **באג #22** (🟡, תיקו-wager לא מראה סכום) — השרת מחזיר עכשיו `refund: u.amount` בתגובת התיקו (`server.js:17448`), וה-overlay מציג "ההימור הוחזר: N💎". (`server.js` + `src/02-shop.js`).
> - ✅ **משימה #24** (medium/high addiction, מד win-streak תוך-סשן) — מד "🔥 רצף N ניצחונות — עוד אחד!" מעל כפתור "שחק שוב" במסך הסיום. ניצחון = ניקוד ≥ `win_streak_threshold` (ברירת מחדל 15K). 3 רמות חזותיות (רגיל/hot 5+/blaze 7+) + חגיגה מסלימה (קונפטי+צליל+buzz) ב-3/5/7/10, ו-"💔 הרצף נשבר ב-N" loss-aversion כשנשבר. מתאפס בסגירת טאב (sessionStorage), dedup per-game דרך `getCurrentGameId`, מדלג על בוטים/skin-trial/restored. **שליטת אדמין מלאה:** `win_streak_enabled` + `win_streak_threshold` ב-schema+db+admin (TIPS+PRESETS). client-only celebration (בלי reward → בלי anti-cheat). (`src/12-tour-info.js` + `public/css/screens.css` + schema/db/admin).

## ✅ session 4 batch 3 (2026-06-02) — tier-bar fix + push appointment-signal
> build חי: `v20260602d` / SW `bloom-v22.7`.
> - ✅ **באג #12** (🟠, אנימציית tier-bar אחרי game-over → אריח שגוי) — `revealToken++` במסך הסיום מבטל את ה-sweep התלוי של `revealNextTier` מהטלה האחרונה, כך שהדגשת ה-highestTier לא נדרסת. (`src/12-tour-info.js`).
> - ✅ **משימה #7** (push) — **הוחלט במכוון לא להוסיף trophy-loss/league-drop**: ב-BLOOM גביעים/ליגות הם gain-only (לא נשחקים פסיבית), אז אין trigger אמיתי ל"אתה עומד לרדת" — להמציא אחד = רעש. **במקום זה הוסף signal מתאים-ל-BLOOM:** `tournament_starting` ב-`_pickSmartPushFor` (append באינדקס 8, בלי הזזת אינדקסים) — push "🏆 הטורניר מתחיל בעוד N דקות" כש-`tournaments.status='scheduled'` ו-`starts_at` בתוך 90 דק'. ממלא את ה-push החסר של AD.7 (טורניר prime-time) = appointment hook. נרשם ב-`SP_REASON_LABELS` באדמין (+ נוסף `streak_freeze_offer` שהיה חסר). 7 ה-signals הקיימים (streak_danger/streak_freeze_offer/pet_crying/friend_played/comeback) כבר מכסים את ה-loss-aversion המתאים ל-BLOOM. (`server.js` + `admin/index.html`).
> - ⏸️ **באגים #14/#15** (🟠, carousel/badge staleness) — **נדחו במכוון** (low-ROI + סיכון): #14 רלוונטי רק ב-variant `carousel` (לא ברירת-מחדל; הדיפולט `hero`). #15 — ה-badge ב-bottom-nav הוא count-based (כמות אריחים), אז refresh תקופתי לא יתקן שינוי-מצב בתוך אריח קיים (chest שהבשיל); תיקון אמיתי דורש MutationObserver על גוף-הטאב עם ניהול-מחזור-חיים זהיר — סיכון רגרסיה גבוה מול תועלת-freshness שולית. להחזיר רק אם מתלוננים.

## איך לקרוא את הקובץ
בצע מלמעלה למטה — דירוג 1 הוא ההשפעה הגדולה ביותר על "השחקן לא מצליח להפסיק". קודם תקן את הבאגים האדומים (שוברים אמון = הורגים התמכרות), אחר כך רד ברשימה המדורגת לפי ROI.

---

## 🔴 באגים לתקן קודם

| # | חומרה | מה לתקן | מיקום (file:line) | מה לעשות |
|---|-------|---------|-------------------|----------|
| 1 | 🔴 גבוה | מלחמת גילדות יכולה להישאר חצי-משולמת + להרעיל connection בבריכה | `server.js:10208-10216` (`_finalizeGuildWar`) | עטוף את ה-BEGIN/COMMIT ב-`try { … } catch(e){ await client.query('ROLLBACK'); throw e; }` כמו בשורה 2277. זה ה-transaction היחיד בכל הקוד בלי ROLLBACK. |
| 2 | 🔴 גבוה | "הלוח של היום" (הוק היומי הכי רועש) שולח ללוח ריק שנראה רגיל | `server.js:2638-2641` (validateBoardDefinition) + `src/11-game.js:52-56` (applyBoardToSession) | הוסף ולידציה שרת: לוח `themed` חייב theme_id ⊻ cells ⊻ multipliers לא-ריקים. ב-`_dailySpecialHash` דלג על לוחות ריקים. |
| 3 | 🔴 גבוה | אין Express error-middleware מרכזי → route שזורק מחזיר 500 גולמי עם stack | `server.js` (חסר `app.use((err,req,res,next)=>…)`) | הוסף handler גלובלי בסוף ה-routes שמחזיר `{error:'server_error'}` + מתעד stack. תופס כל route לא-עטוף במקום אחד. |
| 4 | 🔴 גבוה | Toast מוסתר מאחורי ה-bottom-nav → משוב שגיאה/הצלחה בלתי-נראה ב-iOS | `src/04-ui-utils.js:427` | שנה `bottom:32px` ל-`bottom: calc(90px + env(safe-area-inset-bottom,0px))`. |
| 5 | 🔴 גבוה | מד החיים (lives) בבר-איזון לעולם לא מוצג — קורא `window._livesCache` שלא נחשף | `src/05a-home-v2.js:1293-1300` + מודול lives (Stage 19 IIFE) | חשוף `window._livesCache` מ-מודול ה-lives, או החלף קריאה ל-`fetchLivesState()`. |
| 6 | 🔴 גבוה | תוצאת מרוץ-חי מציגה "+50💎" קבוע — לא מציגה את ה-wager האמיתי שזוכה | `src/02-shop.js:1406` (showLiveRaceResult) | העבר `wager` לפונקציה, חשב `50 + (wager*2)*0.95`, הצג סכום אמיתי. |
| 7 | 🔴 גבוה | אין כפתור יציאה/forfeit במרוץ-חי — שחקן נעול 60 שניות | `src/02-shop.js:1285-1316` (mountLiveRaceHUD) | הוסף כפתור "פרוש" שמגיש ניקוד נוכחי + מסיים, כמו `duel-hud-exit` בשורה 720. |
| 8 | 🔴 גבוה | שיתוף קישור תחרות נכשל בשקט ב-Safari/מובייל — מעתיק את טקסט הוואטסאפ במקום הקישור | `src/06-contests.js:397-413` | ב-fallback העתק את ה-link/code (לא את shareText) והצג הודעה ברורה "הקוד הועתק — הדבק בוואטסאפ". |
| 9 | 🔴 גבוה | צופה נסגר בשקט אחרי 2 כשלי 404 — לא מבחין בין נתק רשת לסיום משחק | `src/10-spectator.js:156-162` | הבחן בין 404 (נסה שוב) ל-status=ended; הצג "מתחבר מחדש…" לפני סגירה. |
| 10 | 🔴 גבוה | בונוס "כל המשימות הושלמו" מציג קונפטי גם כשהזיכוי נכשל | `src/21-calendar.js:138-157` + `src/07-identity.js:540-591` | המתן לתוצאת `earnCredits` (הפוך ל-promise) לפני הצגת ה-celebration; אם נכשל — toast שגיאה. |
| 11 | 🟠 בינוני | באג danger-mode: אין מד "X מהלכים עד סוף" קדימה; clutch-save נורה אחרי שהשחקן ניצל | `src/11-game.js:3239-3327` | הצג מונה `countEmptyPlayableCells()` ב-HUD + תחזית מהלכים; הזז את ה-banner לרגע הלחץ. |
| 12 | 🟠 בינוני | אנימציית tier-bar ממשיכה לרוץ אחרי game-over → מציגה אריח שגוי | `src/11-game.js:311-380` + `473-476` | קדם `revealToken` ב-render({over:true}) כדי לבטל את האנימציה התלויה. |
| 13 | 🟠 בינוני | `/api/contests/:code/score` חסר את בדיקת drops-implausibility שיש לכל שאר ה-endpoints | `server.js` (route /api/contests/:code/score, ~1582) | קבל `drops`, הרץ `challengeDropsImplausible` כמו ב-`/api/score`. |
| 14 | 🟠 בינוני | קרוסלה לא מתעדכנת כשאריחים משתנים דינמית (claim trophy → כרטיס מציג מצב ישן) | `src/31-home-variants.js:200-228` | הוסף MutationObserver על שינויי classList של אריחים, או re-build בעת `__bloomRenderBal`. |
| 15 | 🟠 בינוני | Badge לא מתרענן כשאריח מהוגר משנה מצב (chest countdown נגמר) | `src/46-bottom-nav.js:392` + חסר CSS `bn-tile-arrived` | הרחב את ה-observer לגוף-טאב היעד; הוסף את אנימציית `bn-tile-arrived` ל-`public/css/bottom-nav.css`. |
| 16 | 🟠 בינוני | rematch תמיד פותח practice, לא duel — שובר מומנטום אחרי ניצחון | `src/02-shop.js:1992-1994` | הוסף כפתור "דו-קרב שוב" ל-overlay התוצאה שקורא ל-`rematchDuel()` עם הקוד/wager/difficulty. |
| 17 | 🟠 בינוני | leaderboard הישגים: myRank לא עקבי עם המיקום בפועל כשיש תיקו | `server.js:5734-5742` | חשב myRank לפי המיקום ברשימה הממוינת (ach_count DESC, last_unlocked_at ASC) במקום `COUNT(*) WHERE count > my`. |
| 18 | 🟠 בינוני | spectator picker מציג "last score" עם prefix '+' כאילו זה ניקוד חי | `src/10-spectator.js:46-59` | סמן בבירור "שיא קודם" או משוך את הניקוד החי האמיתי. |
| 19 | 🟡 נמוך | live-pulse בבית v2 מציג "טוען…" שניות לפני שה-fetch חוזר (v1 מסתיר עד שמוכן) | `src/05a-home-v2.js:92-95` | הסתר את ה-div עד ל-fetch הראשון (display:none → show on resolve), כמו v1. |
| 20 | 🟡 נמוך | FTUE קורס בלי try/catch אם DOM של הרשת לא נמצא | `src/15-ftue.js:178-196` | הוסף בדיקות null על `gridEl`/`container` + try/catch סביב innerHTML. |
| 21 | 🟡 נמוך | קונפטי כהה (#2E8B6F) כמעט בלתי-נראה ב-dark mode בחגיגת שיא | `src/14-events.js:797-816` | הוסף `DARK_CONFETTI_COLORS` מואר וקרא לפי `html[data-theme]`. |
| 22 | 🟡 נמוך | תיקו עם wager לא מראה ויזואלית שההימור הוחזר (סכום) | `src/02-shop.js:1926-1928` | העבר `u.amount` ל-overlay והצג "ההימור הוחזר: N💎". |
| 23 | 🟡 נמוך | אין error-handling לכשל decode של buffer מוזיקה — שקט מוחלט בלי סיבה | `src/03-audio.js:340` | הוסף `.catch` עם לוג ב-`fadeInTrack`. |
| 24 | 🟡 נמוך | self-pair בוט-דו-קרב יכול לכתוב שורת "X vs X תיקו" (fleet legacy בלבד) | `bot-engine.js:430` | אם אין partner — דלג על ה-INSERT במקום לזווג בוט לעצמו. |
| 25 | 🟡 נמוך | חיפוש במודאל גילוי לא מסנן לפי טקסט ה-teaser של פיצ'רים נעולים | `src/47-discovery.js:440-444` | הוסף את `f.teaser` למסנן החיפוש. |

---

## 🎯 משימות מדורגות לפי השפעת-התמכרות

### 1. הפעל צי-בוטים קבוע אוטומטית באתחול — המשחק לעולם לא ריק
**השפעה:** high · **מאמץ:** S · **למה זה ממכר:** שחקן ראשון שנוחת על "0 שחקנים פעילים" ו-leaderboard עם דב בודד — נוטש מיד; חיים מדומים מצדיקים כל פיצ'ר חברתי/תחרותי. · **מה לעשות:** הוסף config key `bots_auto_start_count` (ברירת מחדל 8-15) שמכובד ברצף האתחול וקורא ל-`startBots()` אוטומטית; ה-leader-election כבר קיים (`server.js:18343-18387`) רק חסר ברירת-מחדל-on. · **דורש אדמין:** כן

### 2. תקן את "הלוח של היום" שיהיה באמת מיוחד + הצג מכפיל בתוך המשחק
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** ה-Daily Special הוא הוק "פתח את האפליקציה כל יום" הכי חזק ב-F2P — כרגע הוא שולח ללוח שנראה זהה ל-practice (`src/11-game.js:52-56`, lוח #3 cells:[]). · **מה לעשות:** סנן לוחות ריקים בבחירה (server `_dailySpecialHash`), דרוש theme/cells/multipliers, והוסף banner בתוך המשחק "🌟 ×3 XP פעיל!" (`src/12-tour-info.js`) לא רק בבית. · **דורש אדמין:** כן

### 3. הוסף בלוק "הפרס הבא שלך בעוד HH:MM:SS" למסך game-over + לבית
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** ה-lever החזק ביותר ב-F2P ל"חזרה בשעה מסוימת" — כרגע כל סשן נגמר בלי שעון. · **מה לעשות:** חשב את הטיימר הקרוב ביותר מבין spin/login-cal/chest/daily-deal/energy והצג ב-`src/12-tour-info.js` (over-screen) + ראש הבית. הפוך copy ל-config. · **דורש אדמין:** כן

### 4. תקן הפעלת push: שאל הרשאה אחרי game-over מצוין + מסגרת ערך
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** push בזמן אפליקציה-סגורה הוא ה-driver מס' 1 לחזרה; כרגע opt-in זעום כי השאלה מאחורי 3 רגעים נדירים + cooldown 3 ימים. · **מה לעשות:** ב-`src/16-push.js` הוסף trigger ב-game-over של personal-best/chain-5/crown ("הפעל התראות → נזכיר לך כשהרצף בסכנה + פרס ממתין"); קצר את ה-cooldown. · **דורש אדמין:** כן

### 5. זרע leaderboards/גילדות/תחרויות עם שורות בוט אמינות
**השפעה:** high · **מאמץ:** L · **למה זה ממכר:** שחקן שפותח leaderboard ב-3 לפנות בוקר ורואה רשימה ריקה — הרגע שבו אשליית ההתמכרות מתה. · **מה לעשות:** הרחב את מערכת הבוטים (`server.js:18186`) שתזין את ה-leaderboard הגלובלי, rosters של גילדות, ולוחות תחרות עם שמות ישראליים (`bot-engine.js` כבר יש 200) וניקודים סמוכים. עומק-יעד מתכוונן ב-admin. · **דורש אדמין:** כן

### 6. תזמן טורניר-שיא אוטומטי יומי (פעימת live-ops בשעה קבועה)
**השפעה:** high · **מאמץ:** L · **למה זה ממכר:** אירוע בשעה קבועה שהשחקן מתכנן סביבו את היום (Coin Master/Royal Match). · **מה לעשות:** הוסף scheduler ב-server (במקביל ל-`ensureWeeklyContest` ב-`server.js:18532`) שיוצר טורניר כל יום ב-20:00 שעון ישראל עם prize pool, שולח push 30 דק' לפני, ומציג banner ספירה-לאחור בבית. · **דורש אדמין:** כן

### 7. push של loss-aversion: "עומדים לעקוף אותך / לרדת ליגה"
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** ה-push בעל ה-CTR הגבוה ב-Clash Royale; הנתונים קיימים (ליגות, גביעים, תחרויות) — רק הסיגנל לא מדורג. · **מה לעשות:** הוסף ל-`_pickSmartPushFor` (`server.js:6311`) סיגנלים: סכנת ירידת-ליגה, סכנת הפסד גביעים, מישהו עקף אותך בתחרות שאתה מוביל. · **דורש אדמין:** כן

### 8. חגיגת ניצחון בחזרה לבית (קונפטי + צליל + כרטיס פרס)
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** מאריך את אדרנלין-הניצחון וגורם לרצות לשחק שוב (Candy Crush מתפוצץ קונפטי בכל ניצחון). · **מה לעשות:** הוסף ב-`showHomeV2` קונפטי + צליל + כרטיס פרס לכמה שניות כשחוזרים אחרי ניצחון; config `celebration_enabled` + מספר קונפטי. · **דורש אדמין:** כן

### 9. wager אמיתי + animation החזר-תיקו במרוץ-חי
**השפעה:** high · **מאמץ:** S · **למה זה ממכר:** "5 דקות אדרנלין" צריך להרגיש high-stakes — כרגע +50 קבוע מרגיש זרוק. · **מה לעשות:** תקן `src/02-shop.js:1406+1422` להצגת payout אמיתי; בתיקו הצג "הוחזר N💎" + pulse. (תלוי בבאג #6). · **דורש אדמין:** כן (טווח reward)

### 10. קיצור-דרך rematch בלחיצה אחת אחרי דו-קרב
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** ה-CTA עם ה-conversion הגבוה ביותר אחרי קרב הוא "שחק שוב מיד" — שימור מומנטום. · **מה לעשות:** הוסף כפתור "דו-קרב שוב" ל-overlay התוצאה (`src/02-shop.js:1917-1994`) שממלא מראש קוד+wager+difficulty דרך `rematchDuel`. (תלוי בבאג #16). · **דורש אדמין:** לא

### 11. כווץ את הבית ללולאה-גיבור אחת + מסילת "חם היום"
**השפעה:** high · **מאמץ:** L · **למה זה ממכר:** הבית הוא קיר של 20 סוגי-אריחים; העין מתפזרת, וה-core loop (drop→merge→climb) נקבר. · **מה לעשות:** התחייב מלא ל-home_variant=hero — כפתור PLAY ענק + מסילה אופקית של ≤3 פריטים דחופי-זמן + כל השאר לחיצה אחת מתחת ל-bottom-nav (`src/05a-home-v2.js`, `src/31-home-variants.js`). · **דורש אדמין:** כן (variant + A/B)

### 12. הזרק ניקודי-בוט אמינים לכל תחרות/טורניר חדשים
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** שחקן שמצטרף ללוח תחרות עם איש-אחד נוטש — vector הנטישה הכי מהיר בציר התחרות. · **מה לעשות:** hook שמפיל מספר ניקודי-בוט ברגע שתחרות/טורניר נפתחים ומחדש לאורך החיים שלהם (בוט-דו-קרב לא כותב contest_scores כיום). · **דורש אדמין:** כן

### 13. הוסף "מד מהלכים עד סוף" קדימה ל-danger mode
**השפעה:** high · **מאמץ:** S · **למה זה ממכר:** loss-aversion — הופך danger מ"ראיתי אדום" ל-puzzle טקטי ("אני יכול לפנות 3 תאים ב-2 הטלות?"). · **מה לעשות:** הצג badge מתחת לרשת `🚨 2 מהלכים` מתוך `countEmptyPlayableCells()` (`src/11-game.js:3239-3327`); בהצלחה — פלאש ירוק + delta. config `danger_meter_enabled`. (תלוי בבאג #11). · **דורש אדמין:** כן

### 14. עורכים ויזואליים ל-Spin Wheel + Trophy arenas (כמו עורך Gacha)
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** אלו דפוסי החזרה-היומית של Coin Master/Clash Royale; כרגע אפשר לכוונן רק דרך קיר-מפתחות סתום או קבועים hardcoded. · **מה לעשות:** הוסף POST/PATCH/DELETE ל-spin segments + trophy arenas (כיום GET-only ב-`server.js:14678`/`14650`) + UI כמו `loadGachaPool`. מאפשר עונות/אירועים בלי deploy. · **דורש אדמין:** כן

### 15. פעולות מודרציה בדריל-דאון שחקן (ban / reset-streak / grant)
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** סנקציה על רמאים מגינה על שחקנים ישרים; grant של רצון-טוב מחזיר שחקנים נוטשים — שניהם levers שימור. · **מה לעשות:** balance-set כבר קיים (`server.js:13392`); הוסף 4 endpoints + כפתורים בתוך `GET /api/player/:id`: ban/unban, reset streak, grant gems/BP/trophies/XP. כל אחד כותב `admin_actions`. · **דורש אדמין:** כן

### 16. Economy Control Center — דשבורד faucet-vs-sink + כיוונון inline
**השפעה:** high · **מאמץ:** L · **למה זה ממכר:** במשחק עם כלכלה של 50 שלבים, זו השליטה ששומרת על פרסים שמרגישים יקרים — ה-dopamine driver המרכזי. · **מה לעשות:** אחד את endpoints הסטטיסטיקה המבודדים (jackpot/wager/referrals/spin/trophies/replay) ל-טאב אחד שמראה gems-IN לעומת gems-OUT ב-24h/7d עם config keys ערוכים ליד כל שורה. · **דורש אדמין:** כן

### 17. צור קישוריות-צולבת בין מערכות איסוף (חיית מחמד ↔ הישגים ↔ אלבום)
**השפעה:** medium · **מאמץ:** M · **למה זה ממכר:** "אהה, הכל מדבר אחד עם השני" — הפיכת dopamine מבודד למערכת-אקוסיסטם. · **מה לעשות:** מתן שם לחיית-מחמד פותח הישג "Gardener" → toast הישג → עדכון rank → השחקן רואה "עכשיו #1234". דרוש config הישג חדש + קריאת unlock ב-`POST /api/pet/name`. · **דורש אדמין:** כן

### 18. שדרג כפתור שיתוף-Replay (pulse + gradient ורוד-סגול) + מקם גבוה
**השפעה:** high · **מאמץ:** S · **למה זה ממכר:** K-factor — כל replay משותף = משתמש פוטנציאלי חדש; הכפתור צריך להיות הכי רועש על המסך. · **מה לעשות:** הוסף `.over-replay-share { animation: ctaPop, ctaGlow infinite; background: linear-gradient(135deg,#EC4899,#A855F7) }` ב-boards.css; הזז את כרטיס-השיתוף לפני טבלת ה-tiers (`src/12-tour-info.js:917-939`). · **דורש אדמין:** לא

### 19. באנר "החברים שלך פה" בבית
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** social proof ברגע ה-login שמניע גילוי כשהשימור שביר (יום 2-5). · **מה לעשות:** הוסף banner מעל מחסנית האריחים: "X מהחברים שלך משחקים יומית · הצטרפו לגילדה". אם 0 חברים → "חבר ראשון = +200💎 לשניכם". קליק → modal חיפוש-חברים (`src/49-friend-search.js`). · **דורש אדמין:** לא

### 20. הורד את שער-הגילדה: tile חינם + הצטרפות-בקוד ב-L3 (לפני יצירה ב-L8)
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** clan retention = +35% D30, 3.4× סשנים/יום; דפוס Clash Royale: הצטרפות חינם, יצירה בתשלום. · **מה לעשות:** ב-L3 הצג tile "גילדות בקרוב · יש קוד גילדה? הזן כאן (חינם)" → modal קוד-בלבד; יצירה (500💎) נשארת ב-L8 (`src/28-guilds.js`). · **דורש אדמין:** כן (שערי level)

### 21. הצג שם חיית-המחמד ב-widget הבית אחרי מתן שם
**השפעה:** high · **מאמץ:** S · **למה זה ממכר:** רגע "חיית-המחמד שלך אמיתית" שמושך עיניים יומיומית במקום "תן לי שם!". · **מה לעשות:** שנה `renderWidgetInner()` (`src/22-pet.js:58-60`) להציג `data.name` מודגש. · **דורש אדמין:** לא

### 22. שפת מיקרו-אינטראקציה אחידה (pop-in/out/feedback) בכל המודאלים
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** עקביות היא מכפיל ה-dopamine — השחקן מרגיש "פרימיום" כשכל משטח משתמש באותה שפה. · **מה לעשות:** הגדר 5 animation tokens (pop-in scale 0.6→1, pop-out, bounce-land, pulse-glow, slide-up) ב-base.css והחל על כל modal/overlay/toast/card. · **דורש אדמין:** כן (animation_duration_multiplier)

### 23. variable-reward (תיבת מסתורין) בכל game-over, לא רק לוחות דינמיים
**השפעה:** medium · **מאמץ:** S · **למה זה ממכר:** פרס-הפתעה בכל game-over הוא ליבת ה-Skinner-box; הגבלה ללוחות דינמיים משאירה את המצבים הכי-משוחקים שטוחים. · **מה לעשות:** הרחב את reward ה-Stage 8 chest (משקלים כבר מתכווננים) ל-daily/practice עם pity floor. · **דורש אדמין:** כן

### 24. מד "win streak" בתוך-סשן + escalation
**השפעה:** medium · **מאמץ:** S · **למה זה ממכר:** הופך "סיימתי משחק" ל"אני ב-run, עוד אחד" — ה-"just one more" driver הגרעיני. · **מה לעשות:** הוסף hot-streak שמתגמל 3+ משחקים רצופים מעל סף, מוצג כמד ב-over-screen; עקומת reward מתכווננת ב-admin. · **דורש אדמין:** כן

### 25. תצוגת "מטרת היום" + ספירה-לאחור לאיפוס בכל אריח התקדמות
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** השחקן יודע יעד-סשן ספציפי → +8% שימור. · **מה לעשות:** הוסף שדה `dailyGain` + `msUntilReset` ל-state endpoints של Trophy/Leagues/Lifetime, והצג pill "היום: +140 XP לגולד (220 נותרו)" + countdown חי (`src/30-leagues.js:48-64`). · **דורש אדמין:** לא

### 26. אחד את ה-Engagement Overview לכל המערכות (לא רק 4)
**השפעה:** medium · **מאמץ:** S · **למה זה ממכר:** (admin productivity) פותר את כאב "איפה X באדמין?" — הופך את האדמין ל-mission-control שהבעלים פותח ראשון. · **מה לעשות:** הרחב `loadEngagementOverview` (`admin/index.html:4683-4692`) מ-4 ל-כל ~44 המערכות, כרטיס לכל אחת עם stat + badge active/needs-attention. · **דורש אדמין:** כן

### 27. גרסה אמיתית-מנוע לחוויית המיזוג-הראשון (החלף FTUE מתוסרט)
**השפעה:** medium · **מאמץ:** M · **למה זה ממכר:** ה-chain האמיתי הראשון הוא ה-hook של משחק-מיזוג; demo מזויף לא מעביר את ה-dopamine. · **מה לעשות:** החלף את `src/15-ftue.js` במשחק-מנוע-אמיתי עם seed שמבטיח chain מוקדם + פרס רועש ב-30 השניות הראשונות. · **דורש אדמין:** כן (טיימינג/הודעות FTUE)

### 28. תור-בוט עם אישיות מתכווננת (לא רק win-rate)
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** דרמה — הפסדים צמודים + ניצחונות-comeback — היא מה שהופך דו-קרבות לממכרים; כרגע כל בוט נפתר לאותה עקומה חלקה ~50%. · **מה לעשות:** הוסף ארכיטיפים מתכווננים-admin per trophy-band (sandbagger/sweat/chaos) ל-`_pickBotTrajectory`/`_calibrateBotScore` (`server.js`). · **דורש אדמין:** כן

### 29. ערכת זהב/נדיר/אגדי ויזואלית לפלחי Spin Wheel ולוחות אלבום
**השפעה:** medium · **מאמץ:** M · **למה זה ממכר:** דפוס Genshin/Apex — perceived rarity מגביר את ה-FOMO לאסוף. · **מה לעשות:** הקצה rarity לכל פלח spin (אפור/בהיר/glow/pulse) + צבע gradient ללוחות אלבום לפי `board_difficulty`. · **דורש אדמין:** כן

### 30. escalation של רצף-המכפיל גלוי כ-FOMO פרוספקטיבי בבית
**השפעה:** medium · **מאמץ:** S · **למה זה ממכר:** פרס מסלים ש"עומדים לפתוח" מושך יותר מפרס שכבר יש. · **מה לעשות:** הצג קבוע בבית "שמור רצף 2 ימים → ×3" (לא רק ב-overlay היומי, Stage 14). שורות ה-breakdown כבר קיימות. · **דורש אדמין:** כן

### 31. סולם-comeback מסלים לשחקנים נוטשים + push
**השפעה:** medium · **מאמץ:** S · **למה זה ממכר:** החזרת שחקן נוטש זולה מרכישה חדשה; שילוב סולם+push הוא מה שמחזיר. · **מה לעשות:** הפוך את comeback bonus (Stage 9) מ-overlay יחיד ל-מתנות מסלימות יום-3/7/14 + recap "מה פספסת" + push לכל אחד. · **דורש אדמין:** כן

### 32. כפתור rematch + "חפש יריב חדש" ל-Rivals שפג
**השפעה:** medium · **מאמץ:** M · **למה זה ממכר:** אישי מנצח מופשט; הסרת חיכוך שומרת engagement. · **מה לעשות:** הוסף ל-modal Rivals (`src/29-rivals.js:190-197`) כפתור "חפש יריב חדש" + endpoint `/api/rival/find-random` (לא קיים). · **דורש אדמין:** כן

### 33. הצג "צופים חיים" בצופה: מד התקדמות + ספירת drops
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** הופך צפייה מ"מה הניקוד" ל"כמה קרוב ל-tier הבא" — micro-narrative שמחזיק תשומת-לב. · **מה לעשות:** הוסף progress bar מתחת לרשת בצופה: drops + tier-progress, עדכון בכל spectator-tick (`src/10-spectator.js`). · **דורש אדמין:** לא

### 34. התראות-חברים חיות: "X התחיל לשחק" + הצטרפות-1-קליק
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** ה-lever מס' 1 לתחרויות: social proof + כניסה בחיכוך-נמוך. · **מה לעשות:** כשחבר מצטרף לתחרות שלח toast + push; קליק → פותח את התחרות של החבר ב-picker מסומן מראש. · **דורש אדמין:** כן

### 35. ספירה-לאחור לאתגר יומי + toasts דחופים תקופתיים
**השפעה:** medium · **מאמץ:** M · **למה זה ממכר:** נלחם בהטיית "יש לי כל הזמן" שהופכת אתגרים ל-low-stakes. · **מה לעשות:** badge פועם על כרטיס האתגר "נותרו 2ש!" + toast כל 30 דק' אם השחקן עדיין במשחק (`src/09-challenges.js`). · **דורש אדמין:** כן

### 36. הזזת ה-Daily-Special banner + מד-מכפיל גלוי תוך-משחק
**השפעה:** medium · **מאמץ:** S · **למה זה ממכר:** ה-dopamine של המכפיל בלתי-נראה בזמן המשחק (רק בית + recap). · **מה לעשות:** הוסף badge תוך-משחק "🌟 ×3 XP פעיל" (`src/12-tour-info.js`). · **דורש אדמין:** לא

### 37. גריד 8px + סקאלת טיפוגרפיה עם override לאדמין
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** lever אחד מתקן 100 משטחים — תחושת "מסודר" שמעלה את ה-perceived quality. · **מה לעשות:** הגדר `--space-xs/sm/md/lg/xl` + `--type-display/title/body/label` ב-base.css, החלף padding/margin קשיחים, והוסף טאב admin "עיצוב > מרווח" עם base-multiplier. · **דורש אדמין:** כן

### 38. מערכת skeleton/loading פרימיום עם parity ל-dark
**השפעה:** medium · **מאמץ:** M · **למה זה ממכר:** מבטל את ה"home pops in tile-by-tile" jank ומשדר חיות בזמן טעינה. · **מה לעשות:** צור `.skeleton-line`/`.skeleton-card` עם shimmer אחיד 1.6s + bg חצי-שקוף ל-dark; החל על כל ה-loading states. · **דורש אדמין:** לא

### 39. ritual "בוקר טוב" שקופץ אוטומטית בפתיחה ראשונה ביום
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** רגע "פתח הכל" של Royal Match הוא עמוד-השדרה של הרגל יומי. · **מה לעשות:** בפתיחה ראשונה לכל יום-ישראל הצג ritual יחיד: אסוף spin + login-cal + כל chest מוכן בswipe אחד, ואז teaser "מחר: ×2 XP". איחוד Stage 26 checklist. · **דורש אדמין:** כן

### 40. תגי-אבן-דרך לרצף ב-3/7/30/365 ימים
**השפעה:** medium · **מאמץ:** M · **למה זה ממכר:** דפוס Duolingo — אבני-דרך אספניות; כרגע רצף 7 ושל 6 נראים זהים. · **מה לעשות:** ב-streakAfter ∈ {3,7,30,365} הצג overlay badge + קונפטי כפול + עדכן את מספר הרצף עם ⭐/🏆 (`src/12-tour-info.js:739-755`). · **דורש אדמין:** כן (toggle)

### 41. הצף בוחר-שם+מדינה בפתיחה ראשונה (לפני הבית)
**השפעה:** medium · **מאמץ:** M · **למה זה ממכר:** השחקן מרגיש שהמשחק אכפת ממנו + נתוני מדינה מלאים ל-day-1 analytics. · **מה לעשות:** יירט את boot — אם אין NAME_KEY ואין games_played, הצג modal 2-שלבי (שם + מדינה) עם כפתור "דלג" (`src/13-boot.js`). · **דורש אדמין:** כן

### 42. עומק dark-mode: focus rings, reduced-motion, contrast
**השפעה:** medium · **מאמץ:** M · **למה זה ממכר:** נגישות = שחקנים נשארים; reduced-motion מכבד הגדרת-OS ומונע נטישה. · **מה לעשות:** הוסף `:focus-visible` לכל input/button + `@media(prefers-reduced-motion){ animation-duration:0.01ms }`. · **דורש אדמין:** לא

### 43. שער-energy עדין ל-core loop ליצירת גבול-סשן
**השפעה:** medium · **מאמץ:** M · **למה זה ממכר:** סשן שנגמר ב"חיים מתמלאים בעוד 22 דק'" יוצר ציפייה לחזרה, במקום פשוט להפסיק. · **מה לעשות:** הפוך lives (`src/20-lives.js`) לחל אופציונלית על practice/daily עם שער נדיב (8 חיים, 1/15דק'). A/B gated; scope מתכוונן-admin. · **דורש אדמין:** כן

### 44. drop-arc animation (תחושת כובד) לכל אריח חדש
**השפעה:** high · **מאמץ:** M · **למה זה ממכר:** ה-feedback loop הראשי (כל 1-2ש) — כרגע אריחים "מקפיצים מאין-כלום" כי render בונה innerHTML מחדש והורס inline styles. · **מה לעשות:** spawn אריחים חדשים ב-drop-container (position:fixed) עם translateY(-100%), אנימציה 0.4-0.6s ease-out, ואז הכנס לרשת. config `drop_animation_enabled`/`drop_duration_ms`. · **דורש אדמין:** כן

### 45. הוסף לוח-בקרה אדמין "האם המשחק חי כרגע?" + מילוי-עולם בקליק
**השפעה:** medium · **מאמץ:** M · **למה זה ממכר:** (admin) הבעלים סולו לא יזכור להפעיל בוטים ידנית; קליק-אחד "מלא את העולם" שומר על אשליית-החיות. · **מה לעשות:** טאב admin שמראה real-vs-bot active counts + כפתור "Fill the world" (start bots + seed contest + set daily special). · **דורש אדמין:** כן

---

## ⚡ נצחונות מהירים (Quick Wins)
*(high-impact, S-effort — עשה השבוע)*
- **#1** הפעל צי-בוטים קבוע אוטומטית באתחול (config key + boot hook)
- **#9** wager אמיתי + החזר-תיקו במרוץ-חי (`src/02-shop.js:1406`)
- **#13** מד "מהלכים עד סוף" ב-danger mode (`src/11-game.js:3239`)
- **#18** שדרג כפתור שיתוף-Replay pulse+gradient + מקם גבוה
- **#21** הצג שם חיית-המחמד ב-widget הבית (`src/22-pet.js:58`)
- **#23** variable-reward chest בכל game-over (לא רק דינמי)
- **#24** מד win-streak תוך-סשן
- **#30** escalation רצף-מכפיל גלוי בבית
- **באג #4** תקן toast מאחורי bottom-nav (`src/04-ui-utils.js:427`)
- **באג #1** תקן ROLLBACK ב-`_finalizeGuildWar` (`server.js:10208`)

## 🚀 הימורים גדולים (Big Bets)
*(high-impact, L-effort — תכנן ל-sprint ייעודי)*
- **#5** זרע leaderboards/גילדות/תחרויות עם בוטים אמינים
- **#6** טורניר אוטומטי יומי בשעה קבועה (פעימת live-ops)
- **#11** כווץ את הבית ללולאה-גיבור אחת + מסילת "חם היום"
- **#16** Economy Control Center — דשבורד faucet-vs-sink

## 🛠 משימות שליטת אדמין

| פער שליטה | מה להוסיף | טאב admin/index.html | server endpoint | config key |
|-----------|-----------|---------------------|-----------------|------------|
| צי-בוטים לא קבוע | toggle "בוטים תמיד-פעילים" + count ברירת-מחדל | 👥 שחקנים (פאנל בוטים, ~9599) | קיים `/api/bots/start` (12911) → קרא ב-boot | `bots_auto_enabled`, `bots_auto_count` |
| Spin Wheel stats-only | עורך 12 פלחים (label/emoji/type/amount/weight/color) | 💰 כלכלה | חדש `POST/PATCH/DELETE /api/spin/segments` | `daily_spin_seg_N_*` |
| Trophy arenas hardcoded | עורך 8 ארנות (שם/אמוג'י/סף) + מכפיל גלובלי | 🏆 דרגות / 💰 כלכלה | חדש `PATCH /api/trophies/arenas` | `trophy_arena_N_at`, `trophy_arena_N_name` |
| מודרציה שחקן | כפתורי ban/reset-streak/grant בדריל-דאון | 👥 שחקנים | חדש `POST /api/player/:id/{ban,reset-streak,grant}` | — (כותב admin_actions) |
| אין live-ops scheduler | חוקי אירוע חוזר (יומי/שבועי tournament, double-XP) | 🏆 תחרויות | חדש `POST /api/admin/liveops/rules` | `liveops_daily_tournament_time` |
| Pet/Starter/Lives/Lifetime/Login-Cal — אין UI ייעודי | סקציות config מקובצות עם labels/presets/tooltips | 💰 כלכלה / 🎮 משחק | קיים `PATCH /api/config/:key` (13489) | `pet_*`, `starter_pack_*`, `lives_*`, `lifetime_*`, `login_cal_*` |
| Battle Pass reward TYPE | בורר reward (skin/item) per tier, לא רק amount | 💰 כלכלה (loadSeasonPassTiers) | הרחב `PATCH season tiers` | `season_tier_N_reward_type` |
| Daily Special picker עיוור | dropdown לוחות eligible + אזהרת "לוח ריק" | 🎮 משחק (~6171) | קיים `/api/boards/available` | `daily_special_override_id` |
| Economy faucet-vs-sink | דשבורד net gem-flow (IN/OUT 24h/7d) | טאב חדש 💰 כלכלה | אחד endpoints stats קיימים | — |
| בוט social-proof + win-rate buried | sliders מסומנים בפאנל בוטים + telemetry | 👥 שחקנים (~9599) | קיים `/admin/api/bot-duels/stats` | `bots_live_stats_max_multiplier`, `bot_duel_player_win_rate_pct`, `bot_traj_pick_percentile` |
| לא ניתן ליצור config key חדש מה-UI | טופס "הוסף מפתח" בטבלת config | 🎮 משחק (~8919) | קיים `PATCH /api/config/:key` (תומך key חדש) | — |
| Calendar events ללא payload | שדה "מכפיל/boost" לאירוע | 💰 כלכלה (~5583) | הרחב `/api/calendar/events` | `calendar_event_N_multiplier` |
| Level-unlock ladder client-hardcoded | עורך LEVEL_UNLOCKS | 🎮 משחק | חדש `GET/PATCH /api/admin/level-unlocks` | `level_unlocks_json` |
| FTUE timing/text hardcoded | עורך שלבים/טיימינג/enable | 🎮 משחק | חדש `GET/PATCH /api/admin/ftue` | `ftue_steps_json`, `ftue_enabled` |
| audio לא ניתן לכוונון | sliders music/sfx/haptic + test buttons | טאב חדש 🔧 | חדש `/api/config` audio keys | `music_volume`, `sfx_volume`, `haptic_intensity` |
| A/B test variants | פיצול תעבורה home_variant 50/50 | 🎮 משחק | קיים config | `home_variant_split` |
| game-over come-back hook לא ערוך | config להודעת "הפרס הבא" | 🎮 משחק | — | `gameover_next_reward_enabled`, `gameover_comeback_copy` |
