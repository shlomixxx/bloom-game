# 🏠 BLOOM Home Screen — Audit & Task Plan

> סקירה מקצועית של המסך הראשי (`src/05-home.js`, `public/css/home.css`, ו-`/api/stats/live` מהשרת) על בסיס מה שמשתמש רואה כשהוא נכנס ל-https://bloom-web-production-f3bd.up.railway.app

---

## 📊 ציון כולל: **7.0 / 10**

מסך שעובד, ברנדינג נקי, CTA ראשי בולט. **אבל**: שטוח רגשית, חסר הקאה רגשית לחוזרים, וההיררכיה אחרי "שחק עכשיו" משטחת את 4-6 הכפתורים הבאים לאותו משקל.

### פירוט הציון לפי ציר

| ציר | ציון | למה |
|-----|------|-----|
| עיצוב ויזואלי | 8/10 | נקי, עקבי, אנימציות עדינות, dark mode עובד |
| זהות מותג | 5/10 | "BLOOM" כטקסט בלבד — אין דמות/אייקון שנדבק בזיכרון |
| בהירות CTA | 7/10 | הראשי בולט; המשניים (תחרות/אתגר/סקין/דו-קרב) באותו משקל בלי הכוונה |
| היררכיית מידע | 5/10 | 15+ אלמנטים בסטאק. השחקן צריך לסרוק יותר מדי |
| פרסונליזציה | 4/10 | streak ושם — וזהו. אין "השיא שלך היום", אין סטטיסטיקה אישית |
| Social proof | 6/10 | פס "🟢 N שחקנים פעילים" קיים אבל **נעלם כש-N=0** (שעות מתות) |
| ערך לחוזרים | 4/10 | זהה לחוזר ולחדש. שחקן שחזר לא מקבל "החמצת!" או "השיא שלך בסכנה" |
| Triggers להתמכרות | 6/10 | streak + daily login + jackpot קיימים אבל לא מנוצלים אגרסיבית |
| Mobile UX | 7/10 | עובד, אבל אין `safe-area-inset-bottom` ו-padding-top של 84px עלול לחפוף ל-notch |
| נגישות | 6/10 | aria-labels על כפתורים, אבל הסתמכות חזקה על צבע (badges) |
| ביצועים | 9/10 | אין תמונות, DOM קל, אנימציות CSS בלבד |

---

## 🚨 הבעיות הקריטיות

### C1. **שחקן חוזר מקבל את אותו המסך שמקבל שחקן חדש**

הבעיה הכי גדולה למוצר שמטרתו retention. שחקן שמחזיר ביום ה-5 רואה:
- אותה כותרת "מזג חפצים, גלה דרגות חדשות, והגע עד לכתר" (גנרי לחלוטין)
- אותם 5 אייקונים מרחפים
- "שחק עכשיו"
- 4 כפתורים פעולות

**מה חסר:**
- "👋 חזרת! יום 5 ברצף — אל תאבד אותו"
- "🏆 השיא שלך אתמול: 18,420. תנצח אותו?"
- "⏰ עוד 8:23 לסיום האתגר היומי"
- "💎 הצטברו לך 152💎 — מה תקנה?"

### C2. **WhatsApp invite ענק מעל ה-fold**

כפתור ירוק רחב לחלוטין "📱 הזמן חבר דרך WhatsApp" יושב **לפני** ה-tour link, אחרי כל פעולות המשחק. בעיה כפולה:
1. **הסחה**: שחקן שבא לשחק לא צריך לראות "תזמין חברים" כברירת מחדל. זה viral mechanic, לא CTA ראשי
2. **תיעדוף שגוי**: זה תופס יותר שטח מ"דו-קרב 1v1" שהוא יותר addictive

### C3. **Social proof bar נעלם בדיוק כשהוא הכי חשוב**

`refreshHomeLivePulse` מסתיר את הפס אם `playingNow < 1 && gamesToday < 1`. אבל בדיוק כשהמספרים נמוכים (4 בבוקר, 23:00 בלילה) — **שחקן חדש שמגיע אז רואה "אתר ריק"**. צריך fallback:
- "247 משחקים השבוע" 
- "1,847 שחקנים השבוע"
- "אתמול: 89 משחקים"

תמיד יש מספר תוסס להראות. אסור שהפס יעלם.

### C4. **השורה של ה-Player ID עמוסה מדי**

```
✏️ שלומי שם טוב · BLOOM-5C2L · 152💎 · Lv.2 · 👤 הפרופיל שלי
```

חמישה אלמנטים שונים בשורה אחת קטנה (12px). קשה לסרוק. גם RTL/LTR מעורבבים (השם בעברית, הקוד באנגלית, ה-emoji באמצע).

### C5. **המסך לא מציג סטטוס דחוף**

אם יש דו-קרב פעיל ממתין לי, אתגר חדש עם פרס, או תחרות חברים שהיריב הוביל אותי בה — **שום דבר במסך לא יודע**. צריך לפתוח את ה-modal הספציפי כדי לגלות.

---

## ⚠️ בעיות בינוניות

### M1. **5 הכפתורים המשניים באותו משקל**

```
[ תחרות חברים ] [ אתגרי BLOOM ]
[ 🎨 סקינים  ] [ ⚔️ דו-קרב 1v1 ]
```

כל הארבעה נראים אותו דבר. השחקן לא יודע "מה הכי כדאי לי עכשיו". צריכים hierarchy:
- אתגר עם פרס פעיל → גדול יותר
- דו-קרב ממתין → highlight
- סקין חדש → רגיל

### M2. **כפתור Mute יחיד בפינה — אבל אין כפתור הגדרות**

ה-mute נמצא ב-`top:14px right:14px` (RTL flip), אבל אין שום נקודת גישה לפרופיל המלא, להתאמת קושי לפרקטיס, או להגדרות כלליות (חוץ מ-`📖 איך משחקים?`).

### M3. **stats bubble מוחבא**

`home-stats-bubble` נפתח רק כשלוחצים על שורת האייקונים העליונה — שחקן רגיל לא יגלה את זה לעולם. גם הצורה "אקראי" — בלי affordance שאומר "יש פה משהו לחשוף".

### M4. **לוח מובילים מיני לא נראה תמיד**

`#home-social` מוזרק על ידי `refreshHomeSocialProof()`. אם ה-API לא מחזיר, השטח ריק. אין skeleton או "טוען...".

### M5. **WhatsApp invite text — אורך מסיבי**

טקסט ההזמנה מורכב מ-5-7 שורות עברית + עברית + emoji. גורם להעתקה כבדה. הצעה: 3 שורות מקסימום + קישור.

### M6. **`home-skip` למתחילים = anti-pattern**

```js
hasSeenTour() ? "📖 איך משחקים?" : "אני יודע לשחק, דלג"
```

לשחקן חדש אומרים "אני יודע לשחק, דלג" — זה ניסוח שמרגיש כאילו "עברנו עליך עם משהו, סלח לנו". במקום, "התחל לשחק" או "סיור מהיר" עם hint על מה הסיור מכיל.

---

## 💡 הזדמנויות (מה לעשות כדי להגיע ל-9/10)

| # | המשימה | השפעה צפויה | מאמץ | עדיפות |
|---|--------|-------------|------|--------|
| H1 | **Personal hero banner** — שחקן חוזר רואה "השיא שלך אתמול / יום X ברצף / חזור עכשיו" | +25% click on primary CTA | בינוני | **P0** |
| H2 | **Hierarchy על המשניים** — promote לפי מה שפעיל היום (אתגר עם פרס / דו-קרב פעיל / סקין חדש) | +15% engagement במצבים מתקדמים | בינוני | **P0** |
| H3 | **Live pulse bar שלא נעלם** — fallback לסטטיסטיקה שבועית כשעכשיו ריק | מנע "ghost town" בלילה | נמוך | **P0** |
| H4 | **Notification badges** — נקודה אדומה על תחרות/דו-קרב/אתגר שדורש פעולה | +30% חזרה למצבים מתקדמים | בינוני | **P1** |
| H5 | **שמיים את WhatsApp invite למיקום נכון** — להזיז ל-bottom או להפוך לקישור קטן | משחרר 100px של real estate | נמוך | **P1** |
| H6 | **Compact player-ID** — 3 שורות במקום 1: שם+code, balance+level, קישור פרופיל | +25% scannability | נמוך | **P1** |
| H7 | **Mascot/brand mark** — אנימציית merge קטנה במקום אייקונים גנריים | זיהוי מותג +20% (long term) | בינוני | **P2** |
| H8 | **"מה חדש" inline banner** — פיצ'ר חדש מציג את עצמו פעם אחת לכל release | מודעות לפיצ'רים +40% | נמוך | **P2** |
| H9 | **Safe-area-inset-bottom** — תיקון iPhone notch/home-indicator | מנע buttons חתוכים | זעיר | **P2** |
| H10 | **Animated tile background** — תיל מרחף ברקע במקום צבע שטוח | feel premium | בינוני | **P3** |
| H11 | **Pre-game gem teaser** — "תקבל +50💎 על המשחק הזה אם תגיע לתיר 6" | engagement loop | נמוך | **P3** |

---

## 🛠 קובץ משימות מסודר לביצוע

### פאזה A — Quick wins (פלח 1-2 שעות, p0)

#### A1. Personal Hero Banner (H1)
**מיקום:** [src/05-home.js](src/05-home.js) `showHome()` — להוסיף `<div id="home-hero-banner">` בין `home-sub` ל-`home-player-id`.

**לוגיקה:**
```js
function buildHeroBanner() {
  var streak = loadStreak();
  var bestEver = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
  var todayPlayed = !!localStorage.getItem(DAILY_PLAYED_PREFIX + dailyDate);
  var hours = new Date().getHours();
  
  // Returning streak holder
  if (streak.count >= 3) {
    return `<div class="home-hero hero-streak">
      🔥 יום ${streak.count} ברצף — ${todayPlayed ? 'כל הכבוד!' : 'אל תאבד את הרצף'}
    </div>`;
  }
  // Has a best score worth beating
  if (bestEver > 5000 && !todayPlayed) {
    return `<div class="home-hero hero-best">
      🏆 השיא שלך: ${bestEver.toLocaleString()} — תנצח אותו?
    </div>`;
  }
  // Late-night urgency
  if (hours >= 21 && !todayPlayed) {
    var hoursLeft = 24 - hours;
    return `<div class="home-hero hero-urgent">
      ⏰ עוד ${hoursLeft} שעות לסיום האתגר היומי
    </div>`;
  }
  return ''; // No banner for fresh new users
}
```

**CSS:** `public/css/home.css` — `.home-hero` (background gradient, 12px padding, animated pulse)

**מדידה:** percentage of home views that click "שחק עכשיו" within 5 seconds (track via GA event).

---

#### A2. Live Pulse Fallback to Weekly (H3)
**מיקום:** [server.js](server.js) `/api/stats/live` — להוסיף `gamesThisWeek` ו-`activeThisHour`.

**שינוי שרת:**
```sql
gamesThisWeek: SELECT COUNT(*) FROM daily_scores WHERE date >= today - 7 days
activeThisHour: SELECT COUNT(DISTINCT device_id) FROM device_visits WHERE last_at > NOW() - INTERVAL '1 hour'
```

**שינוי לקוח** ([src/05-home.js](src/05-home.js) `refreshHomeLivePulse`):
```js
// Tiered fallback — never hide:
if (playing > 0)        → "🟢 N שחקנים פעילים"
else if (gamesToday > 0) → "✅ M משחקים היום"
else if (activeHour > 0) → "🕐 N שחקנים בשעה האחרונה"
else                     → "📊 X משחקים השבוע"
```

**מדידה:** verify the bar never hides on the live URL across 24h period (cron a curl + log).

---

#### A3. WhatsApp Invite to Bottom (H5)
**מיקום:** [src/05-home.js](src/05-home.js) — להזיז את `<button class="home-invite-wa">` מאחרי "אתגרי BLOOM" לאחרי `home-skip`, ולהקטין ל-secondary style.

**שינוי CSS:** `home-invite-wa` הופך מ-button גדול ירוק למקושר טקסטואלי קטן:
```css
.home-invite-wa-small {
  background: transparent;
  color: #25D366;
  border: 1px dashed rgba(37,211,102,0.4);
  font-size: 13px;
  padding: 8px 14px;
  margin: 8px auto;
}
```

---

#### A4. Compact Player-ID (H6)
**מיקום:** [src/05-home.js](src/05-home.js) `renderHomePid()` — לחלק את השורה ל-3 שורות עם hierarchy ברור:

```
שלומי שם טוב ✏️           ← שורה 1: שם בגדול
BLOOM-5C2L · 152💎 · Lv.2 ← שורה 2: זהות + ארנק
👤 הפרופיל שלי            ← שורה 3: קישור
```

---

### פאזה B — Smart hierarchy (פלח 2-3 שעות, p1)

#### B1. Notification Badges on Action Buttons (H4)
**מיקום:** [src/05-home.js](src/05-home.js) — להוסיף `refreshHomeBadges()` שקורא ל-`/api/duels/mine`, ולוקח מ-localStorage `bloom_unseen_challenges`, ומציג נקודה אדומה.

**HTML שינוי:**
```html
<button class="home-action-btn home-action-contest">
  <span class="badge-dot" id="contest-badge" style="display:none">3</span>
  תחרות חברים
</button>
```

**CSS:**
```css
.badge-dot {
  position: absolute;
  top: 8px; left: 8px;
  background: #FF3B30;
  color: #FFF;
  font-size: 10px;
  font-weight: 700;
  min-width: 18px; height: 18px;
  border-radius: 9px;
  display: flex;
  align-items: center; justify-content: center;
  padding: 0 5px;
  animation: badgePulse 1.5s ease-in-out infinite;
}
```

**לוגיקה:**
- contest: number of contests where my rank dropped since last visit
- challenge: count of active challenges I haven't entered
- duel: pending duels where I'm the opponent

---

#### B2. Hierarchy by Activity State (H2)
**מיקום:** [src/05-home.js](src/05-home.js) — לפני שמרנדרים את ה-action-grid, להחליט מי הכי דחוף:

```js
function pickFeaturedAction() {
  // Priority order:
  // 1. Pending duel waiting for me → "⚔️ דו-קרב ממתין!"
  // 2. Active challenge with prize → "🏆 אתגר פעיל - פרס X💎"
  // 3. Active contest where I'm losing → "📉 ניצחו אותך בתחרות"
  // 4. New skin available → "🎨 סקין חדש: Aurora"
  // 5. None — keep default 2x2 grid
}
```

הפעולה ה"מצויינת" נצבעת בצבע bold (gradient), השאר נשארות secondary.

---

#### B3. Home-stats-bubble Affordance (M3)
**מיקום:** [src/05-home.js](src/05-home.js) — להוסיף "↓ הסטטיסטיקות שלך" לרמז שיש משהו לפתוח.

או טוב יותר: **לפתוח כברירת מחדל לשחקנים עם 5+ משחקים**, ולחבא רק אם הם בוחרים.

---

### פאזה C — Polish & brand (פלח 2-4 שעות, p2)

#### C1. Animated Brand Mark
שורת ה-5 אייקונים בראש המסך — להחליף ב-animation לופ קצר של merge: tier 1+1+1 → tier 2, tier 2+2 → tier 3. כל 8 שניות. הופך את ה"לוגו" למיני-demo של המשחק.

**מיקום:** [src/05-home.js](src/05-home.js) `home-icons` — לעבוד עם CSS @keyframes שמחליפים תמונות.

#### C2. "What's New" Banner
פעם אחת לכל cache-buster bump, להציג inline banner:
> ✨ חדש: סקין Aurora עם אנימציות מיוחדות [נסה →]

לקוח קורא `bloom_last_seen_version` מ-localStorage; אם פחות מ-current, מציג. השחקן יכול לסגור (X), זה נשמר עד הבא.

#### C3. Safe-area-inset-bottom
```css
.home-screen { padding-bottom: max(30px, env(safe-area-inset-bottom)); }
```

ובדיקה ב-iPhone X+ שלא נחתכות הכפתורים על ה-home indicator.

---

## 📈 איך למדוד שזה הצליח

לפני הטיפול, לרשום baseline (משתמשים ב-admin dashboard):
- **% מ-home views שמגיעים ל-"שחק עכשיו" תוך 10 שניות**: ___% (יעד אחרי A1+A2+A3: 75%+)
- **CTR מ-home לאחד מ-4 הכפתורים המשניים**: ___% (יעד אחרי B1+B2: ×2)
- **% מהשחקנים שלוחצים על "הזמן חבר ב-WhatsApp"**: ___% (יעד אחרי A3: אותו דבר, פחות הסחה)
- **D1 retention**: ___% (יעד עם פאזות A+B: 40%+ — תלוי גם בכל השאר, לא רק במסך הזה)

---

## 🎯 סיכום

המסך הראשי עובד טוב — לא רע בשום ציר ויעיל בשמירת ה-CTA הראשי בולט. **אבל הוא אותו הדבר לכולם**. ההזדמנות הגדולה היא **לא להוסיף יותר תוכן**, אלא להפוך את המסך לתגובתי לזהות של השחקן ולמצב המוצר שלו ברגע נתון.

3 הבעיות שצריך להרים ראשונות:
1. **A1** — Personal hero banner (שחקן חוזר מקבל הקאה רגשית)
2. **A2** — Live pulse שלא נעלם (תמיד יש social proof)
3. **B1** — Notification badges (יודעים מתי לחזור לפעולה)

אחרי 3 אלה לבד, הציון אמור לעלות מ-7.0 ל-8.5.
