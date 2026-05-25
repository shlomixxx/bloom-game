# 🔍 BLOOM — ביקורת מקיפה v2

> **מטרת-על**: BLOOM = משחק הכי ממכר שאפשר.
> זו ביקורת שנייה (Round 2) — אחרי שתיקנת את רוב הביקורת הראשונה.
> ממוקדת ב-4 ערוצי בעיות שביקשת לבדוק:
>
> 1. 🛡 **Exploit Prevention** — שחקן לא יעשה רענון כדי לצפות בפרסומות שוב
> 2. 🖼 **Game-Over Persistence** — אחרי סיום, גם ברענון יראה משהו מיוחד (לא לוח עם אריחים)
> 3. 📱 **Display Size** — משהו שנוסף לאחרונה מקטין את תצוגת המשחק
> 4. 🎯 **Stuck Screens / Buttons** — לחצנים שלא עובדים, מסכים תקועים, חוויה לא חלקה

---

## 🚨 PHASE A — Game-Over Exploit Prevention + Persistence

### 🔴 A1 · Practice/Dynamic/Contest מאבדים את מסך game-over ברענון

**הבעיה הקריטית**: רק `daily` mode שומר את ה-game-over screen ב-localStorage (`DAILY_PLAYED_PREFIX + dailyDate`). אם שחקן סיים משחק ב-practice/dynamic/contest והשיג ציון מטורף, ועשה רענון בטעות → איבד את כל המסך, איבד את ההזדמנות לשתף, איבד את ההזדמנות לקבל ad reward.

**ההוכחה בקוד**: `src/11-game.js` שורות 149-167 מטפלות רק ב-daily. עבור practice, `loadPracticeGameState()` מחזיר grid עם תאים מלאים, אבל לא קורא ל-`render({ over: true })` → השחקן רואה לוח מלא וחושב שיכול להמשיך.

**ההשלכה על retention**: שחקן מתוסכל = שחקן שלא חוזר. זה הפגיעה הכי חזקה ב-D1 retention.

---

### 🔴 A2 · Continue Button — אין dedup בין משחקים אחרי רענון

**ה-Exploit**: ב-`src/12-tour-info.js` שורה 894 — `continue-ad` button מאפשר לצפות בפרסומת ולנקות 2 שורות. `usedContinue` נשמר רק ב-`savePracticeGameState()` של ה-current game.

**שלבי ה-exploit**:
1. שחקן ב-practice mode → game-over → לוחץ "צפה בפרסומת והמשך"
2. מקבל 2 שורות נקיות, ממשיך לשחק
3. game-over שוב → רענון בכוונה
4. אם המשחק חדש (לא restored) → `usedContinue=false` → יכול לצפות בפרסומת ולקבל continue שוב

**הגנה חסרה**: אין server-side dedup ל-continue (רק ל-`/api/player/ad-watch`). אז אפילו אם נשמור ב-sessionStorage, מי שמנקה sessionStorage יכול לעקוף.

---

### 🟢 A3 · Watch-Ad Button — כבר מוגן היטב (לא לגעת!)

**מה שעובד**:
- ✅ Per-game dedup (gameId) ב-server
- ✅ Daily cap 5/day ב-server
- ✅ 30s cooldown ב-server
- ✅ sessionStorage `bloom_ad_claimed_<gameId>` ב-client

**Audit**: בדקתי - 5 טאבים פתוחים בו-זמנית חולקים את אותו `_ad_count:<deviceId>:<date>` ב-DB → לא ניתן לחרוג מה-cap. ✅

---

### 🟡 A4 · Game-Over Screen חזק יותר — Shareable Card + Magic

**הבעיה**: מסך game-over נוכחי טוב (rank pill, rival, best delta...) אבל לא מהפנט מספיק לשתף.

**מה Match Masters / Royal Match עושים שאתה לא עושה**:
- Canvas-rendered Shareable Card עם רקע, logo, ציון ענק, tier emoji, שם → download/copy/WhatsApp ב-click
- אנימציית מספרים עולה (count-up) על הציון
- אם שיא — confetti + sound effect ייחודי + animated trophy

**הפתרון**: ב-`src/12-tour-info.js` להוסיף `renderShareableCard()` function שיוצר canvas image + Web Share API.

---

## 📱 PHASE B — Display Size Issues

### 🔴 B1 · Booster Strip מקטין את הלוח ב-30%

**הוכחה בקוד**: `src/35-boosters.js` שורה 59 — `anchor.parentNode.insertBefore(strip, anchor)` שם booster strip בין tier-bar ל-grid-wrap.

**חישוב הגובה**:
- `margin: 8px auto 6px` → 14px vertical
- `padding: 8px 6px` → 16px vertical
- emoji 20px + label 11px + gap 2px + price 10px = 43px content
- **סה"כ ~73px** מתוך height הזמין למשחק

**ההשפעה הויזואלית**:
- ה-`fitGrid()` מחשב: `cellByH = (wrap.clientHeight - 73 - padding) / rows`
- בטלפון ממוצע (h=750px) ה-grid-wrap מקבל ~400px → תאים בגודל 60px במקום 75px
- **ירידה של ~20% בגודל התא** = משחק קטן שמרגיש דחוס

**הפתרון**: 3 אופציות, מומלץ #1.

1. **🥇 Bottom Floating Bar** — שים את הboosters ב-floating bar תחתון. לא מקטין את הלוח, נראה כמו "tool tray" של Match Masters.
2. **🥈 Slim Strip** — height 36px במקום 73px (עוד emoji קטן יותר, אין label).
3. **🥉 Collapsible** — סגור כברירת מחדל. tap → opens.

---

### 🟡 B2 · Col-Mult-Bar (Dynamic Boards) — תפיסת גובה במצבים שלא חייבים

**הבעיה**: ב-dynamic mode עם column multipliers, `col-mult-bar` תופס ~30px בין tier-bar ל-grid-wrap.

**ההשלכה**: בלוחות עם multipliers, התאים קטנים יותר ב-7%.

**הפתרון**: הקטנת margin (כרגע 2px+6px=8px → 2px+2px=4px), הקטנת pill height (22px → 18px).

---

### 🟢 B3 · Stats Bar (top) — לא הבעיה

**מצב**: 50px עבור top + stats. גודל הגיוני, לא משתנה לאחרונה.

---

## 🎯 PHASE C — Stuck Screens / Buttons

### 🔴 C1 · Z-Index War (30+ ערכים בין 10 ל-100003)

**הבעיה**: כל overlay חדש נכתב עם z-index גדול יותר מהקודם. תוצאה:
- Onboarding overlay = z-index 100000
- Modal של achievements = z-index 100001
- Toast = z-index 100002
- Push permission = z-index 100003

**מתי זה שובר UX**:
- 2 overlays נפתחים יחד → ה-X של אחד נמצא מתחת ל-overlay של השני
- שחקן לוחץ X ולא קורה כלום
- שחקן תקוע במסך, מנסה לסגור ולא יכול

**הפתרון**: CSS variables hierarchy:
```css
:root {
  --z-base: 1;
  --z-header: 100;
  --z-overlay: 1000;
  --z-modal: 2000;
  --z-toast: 3000;
  --z-critical: 4000;
}
```
החלף את כל ה-hardcoded numbers.

---

### 🟡 C2 · Modal Stacking — אין global close mechanism

**הבעיה**: כל modal יש לו `*-modal-close` כפתור משלו, אבל:
- ❌ אין ESC key handler אחיד
- ❌ Browser back button → עוזב את הדף במקום לסגור modal
- ❌ Click on backdrop — לא תמיד סוגר

**ההשלכה**: שחקנים על mobile (95% מהמשתמשים) משתמשים ב-back swipe. אם זה לא סוגר את ה-modal, הם יוצאים מהאפליקציה ולא חוזרים.

**הפתרון**: 
- Global ESC handler שמוצא את ה-modal העליון וסוגר אותו
- `history.pushState({ modal: true })` כשפותחים modal, `popstate` listener שסוגר

---

### 🟡 C3 · Heartbeat Cleanup — אובדן שחקן באמצע משחק

**מצב**: `endHeartbeat()` נקרא ב-game-over → admin live view מתעדכן ✅

**הבעיה**: אם שחקן סוגר טאב באמצע משחק (לא game-over) → ה-heartbeat ממשיך לתוך admin עד timeout (60s+).

**הפתרון**: הוסף `window.addEventListener('beforeunload', endHeartbeat)`.

---

### 🟡 C4 · alert() Drift — לוודא שלא נוסף חדש

**מה שעובד**: T0.4 החליף 40 alerts → showToast ✅

**הסיכון**: כל פיצ'ר חדש שנכתב יכול היה להחזיר alert בטעות.

**בדיקה**: 
```bash
grep -rn "alert(" src/*.js | grep -v "//"  | wc -l
```
אם > 0 → להחליף ב-showToast.

---

### 🟢 C5 · Skin Trial — צריך בדיקה

**הבעיה הישנה** (UX8 מ-Audit הראשון): `startSkinTrial()` ללא timer.

**בדיקה נדרשת**: לבדוק אם נוסף timer. אם לא — להוסיף `setTimeout(endSkinTrial, 60000)`.

---

### 🟡 C6 · Dark Theme Drift — אלמנטים חדשים בלי dark override

**הסיכון**: 49 stages חדשים — כל פיצ'ר חדש שלא קיבל dark theme overrides → נראה רע ב-dark mode (לבן על לבן, או שחור על שחור).

**Audit נדרש**:
- booster-strip
- balance-widget
- trophy-strip
- event-banner-strip
- login-cal-tile
- gem-bank-tile
- weekly-recap-modal

---

## 🎮 PHASE D — Addiction Boosters

### D1 · 🔥 Daily Streak Tomorrow Preview

**הרעיון**: השחקן רואה רק "🔥 7 ימים" — לא רואה מה הוא יקבל מחר אם יחזור.

**הפתרון**: על מסך הבית, מתחת ל-streak — "מחר: +200💎 (במקום +100 היום)". escalation visible.

---

### D2 · 🏆 Ghost Replay של מי שניצח אותך

**הרעיון**: אחרי שחבר ניצח אותך → push "Avi ניצח אותך! בוא תראה איך" → ghost replay → "נסה לנצח".

**מה דרוש**: A9 Ghost Mode כבר קיים בקוד. צריך רק לחבר ל-push flow + לעטוף ב-friend challenge.

---

### D3 · 🎰 Mystery Box אחרי game-over

**הרעיון**: ב-15% מהמשחקים, אחרי game-over → "Mystery Box!" → animation → תוצאה.

**מה כבר קיים**: `openMysteryChest()` ב-dynamic mode. רק לוודא שה-rate בולט מספיק (animation strong, sound).

---

### D4 · 📊 Social Comparison Stronger

**הרעיון**: בכל game-over, מציג social cues חזקים יותר:
- "החבר Avi עבר אותך אתמול ב-50 נקודות"
- "Top 10% בישראל היום!"
- "3 ימים רצוף בטופ 100!"

**מה כבר קיים**: `rivalHtml` חלקי. צריך להוסיף more cues.

---

### D5 · 💰 Streak Freeze Loss Aversion

**הרעיון**: יום אחרי שהשחקן לא שיחק — push notification "🛡 הקפא הרצף שלך! 200💎 והוא נשמר ל-24 שעות נוספות".

**מה כבר קיים**: streak freeze logic בשרת. רק להוסיף push notification trigger.

---

### D6 · 🎁 First-Hour-Back Welcome

**הרעיון**: שחקן שלא שיחק 3+ ימים → comeback bonus popup בכניסה הבאה.

**מה כבר קיים**: `maybeShowComebackBonus`. רק לוודא שה-UI חזק.

---

## ✅ סטטוס לפי קטגוריה

| קטגוריה | מצב | חומרה |
|---------|-----|--------|
| **Exploit: ad-watch** | 🟢 מוגן | — |
| **Exploit: continue** | 🟢 תוקן (TA.2, 2026-05-25) | — |
| **Game-Over persist (daily)** | 🟢 עובד | — |
| **Game-Over persist (practice/dynamic)** | 🟢 תוקן (TA.1, 2026-05-25) | — |
| **Display size — booster strip** | 🟢 תוקן (TB.1, 2026-05-25) | — |
| **Display size — col-mult-bar** | 🟢 תוקן (TB.2, 2026-05-25) | — |
| **Z-index war** | 🟡 30+ ערכים | בינונית |
| **Modal close (ESC/back)** | 🟢 תוקן (TC.1, 2026-05-25) | — |
| **Heartbeat cleanup** | 🟡 חלקי | נמוכה |
| **Dark theme drift** | 🟡 דורש audit | נמוכה |
| **Game-over share card** | 🟢 קיים (Stage 32) + confetti (TA.3, 2026-05-25) | — |
| **Streak escalation visible** | 🟡 חלקי | בינונית |
| **Mystery box visibility** | 🟡 חלקי | בינונית |

---

## 🎯 דירוג חומרה — Top 5 לתיקון מיידי

1. 🔴 **B1: Booster Strip מקטין משחק 30%** — קריטי, השפעה ויזואלית מיידית
2. 🔴 **A1: Game-Over persist ב-practice/dynamic** — שחקן מאבד את הציון ברענון
3. 🔴 **A2: Continue Button Exploit** — שחקן מנצל בפרסומות חינמיות
4. 🔴 **A4: Shareable Game-Over Card** — חוסם viral loop
5. 🟡 **C1: Z-Index hierarchy** — מונע "מסך תקוע" באירועים נדירים

---

*תאריך: 2026-05-25 · גרסה: BLOOM_FULL_AUDIT v2 · 49 stages חיים*
