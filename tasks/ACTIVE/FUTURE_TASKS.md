# 📋 BLOOM — משימות עתידיות

> **מסמך מרכזי לכל מה שעדיין לא נבנה.**
> עודכן: 2026-05-24 · 48 שלבים חיים בפרודקשן · 4 משימות פתוחות (כל A1-A10 ✅ pure-addiction) · 4 פתוחות = monetization (Stripe IAP, VIP, RM shop, wager)
>
> 🎯 **איך להשתמש**: בשיחה חדשה תגיד "בוא נבנה A1" / "המשך עם הכי ממכר" / "תעשה A2 + A3 ביחד" ואני אדע בדיוק על מה אתה מדבר.

---

## 🎯 PURE ADDICTION — מוכן לבנייה (אין צורך בכסף אמיתי / חוקיות)

10 רעיונות מדורגים לפי **השפעה × קלות מימוש**.
כל אחד מהם עצמאי — אפשר לבנות בכל סדר.

---

### A1 · 📬 Notification Inbox ✅ נבנה (24.05.2026)
**מאמץ**: 1-2 ימים · **השפעה**: ★★★★★ · **המלצה ראשונה שלי**

**מה זה**:
בדג׳ אדום בפינה העליונה של הבית, עם מספר שמראה כמה דברים חדשים מאז הביקור האחרון. לחיצה → רשימה של כל המהלכים האחרונים — push notifications שפיספסת, הישגים שנפתחו, פרסים שמחכים, פעילות חברים, תוצאות טורנירים.

**למה לבנות**:
- ה-UI element הכי-נלחץ בכל המשחקים המובילים (Clash Royale, Brawl Stars, Royal Match)
- פותר בעיה אמיתית — אחרי 38 שלבים הבית מלא פיצ׳רים ושחקנים לא יודעים "מה חדש"
- מספר אדום = retention boost כפול (Genshin משקיעה $10M/שנה רק במספרים אדומים)
- חוצה את כל 4 גירסאות הבית (35) — יעבוד בכולן

**טכני**:
- טבלה חדשה `notification_inbox` (PK device_id + id, type, message, link, created_at, read_at)
- 1 endpoint `GET /api/inbox` + `POST /api/inbox/mark-read`
- UI: כפתור בפינה + modal עם רשימה גוללת

---

### A2 · 🎯 Friend Challenges ✅ נבנה (24.05.2026)
**מאמץ**: 1-2 ימים · **השפעה**: ★★★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- שחקן A לוחץ 🎯 ליד חבר במודאל החברים → modal "אתגר חבר" עם BLOOM code (pre-filled) + יעד ניקוד (input) + הודעה אופציונלית
- שרת מאמת ש-A ו-B חברים בפועל (`friendships`), יוצר row, שולח push ל-B
- שחקן B רואה את האתגר ב-inbox (✅ source חמישי) + (לעתיד: בתוך מודאל "האתגרים שלי")
- **Auto-resolve**: כל submission של ציון (`/api/score`, `/api/score/practice`, `/api/boards/:id/score`) מפעיל `_resolveFriendChallengesForGame(deviceId, score)` שסורק את כל ה-pending challenges של השחקן ומפליפ ל-`passed` כל אחד שהציון עבר את היעד שלו. Atomic UPDATE עם WHERE status='pending' guard.
- **שני הצדדים מקבלים 50💎** (config-tunable `friend_challenge_win_reward`). כל אחד → push: "🏆 ניצח/ה!"
- **24 שעות** ל-pending (config-tunable). אחרי = `failed_expired` אוטומטית (lazy-update בכל `/mine` fetch).
- Schema: טבלה `friend_challenges` + 4 config keys. Server: 3 endpoints (send / mine / decline). Inbox כולל פסים לכל מצב: ⏳ sent / 🎯 incoming / 🏆 passed / ⌛ expired / 🚫 declined.
- Client: [src/39-friend-challenges.js](src/39-friend-challenges.js) — IIFE עצמאי. Send modal + List modal. CSS לאדום-ורוד (theme של אתגרים).

**Loop ויראלי**: A מאתגר B עם 67K → push ל-B → B חוזר ומשחק → עובר → שניהם מקבלים 50💎 + push ל-A "B עבר אותך" → A רוצה להתנקם → מאתגר חזרה. K-factor במלוא מובן המילה.

---

### A3 · 🎁 Trophy Chests ✅ נבנה (24.05.2026)
**מאמץ**: 1-2 ימים · **השפעה**: ★★★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- 3 רמות תיבות (🎁 common / 💎 rare / 🏆 legendary) עם משכי פתיחה 4ש / 8ש / 24ש (admin-tunable)
- 4 slots פתוחים, אם כולם מלאים → אין דרופים חדשים
- רק תיבה אחת יכולה להיפתח בכל רגע נתון (Clash Royale pattern — בחירה אסטרטגית)
- Drop chance 50% על משחק עם score ≥ 500 (admin-tunable). Arena promotion = guaranteed Rare. Milestone claim = guaranteed Legendary.
- Schema: טבלה `trophy_chests` + 13 config keys
- Endpoints: `GET /api/chests/state`, `POST /api/chests/start-unlock`, `POST /api/chests/open`
- Client: [src/38-trophy-chests.js](src/38-trophy-chests.js) — IIFE עצמאי. Home tile (L10+, only-when-chests-exist) עם 4 icon-pills + countdown. Modal עם 4 קלפים. Full-screen rarity-themed celebration (legendary = 40 confetti particles, soundMilestone(7)).
- חיווט אוטומטי דרך Stage 38 — `_trophyGrantFromGame` קורא ל-`_maybeGrantChest` בסוף, ומחזיר `chestEarned` ל-client. Client trophy module fires the chest toast 1.2s אחרי trophy toast.

---

### A4 · 📊 Weekly Recap ("BLOOM Wrapped") ✅ נבנה (24.05.2026)
**מאמץ**: 1 יום · **השפעה**: ★★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- Auto-fires כל יום ראשון אחה"צ (12:00 IL+) בכניסה הראשונה לבית של השבוע. Per-week dedup דרך `localStorage[bloom_wrapped_seen_<YYYY-MM-DD>]`. Gate נוסף: לפחות 5 משחקים השבוע (אחרת ה-recap ייראה ריק/עצוב).
- Modal פתיחה דרמטי בגרדיינט סגול-ורוד-זהוב עם "🌟 Wrapped" כותרת + bouncing brand + 6 stat cards:
  - 🎮 משחקים, 🏆 שיא ניקוד, 💎 דרגת אריח מירבית (👑 = tier 8), ⚡ trophies שצברתי, 👥 חברים שיחקו איתי, 🏅 דרגה כללית
- Activity grade: A+/A/B/C/D לפי גיימים השבוע (100+/50+/25+/10+/<10)
- **Canvas-rendered 720×1280 PNG** מוכן לשיתוף: גרדיינט מעוצב + scattered emojis + huge grade + 6 stats + brand + URL
- 4 share buttons: 💬 WhatsApp (pre-filled text + URL) / 📤 Native share API (אם תומך file share — שולח את ה-PNG ישירות) / 📋 Copy (text only) / 💾 Save (download PNG)
- Server: `GET /api/weekly-recap?deviceId=` מצרף 6 sources במקבל: daily_scores + difficulty_scores + dynamic_board_scores + trophy_history + friendship_shared_days + player_profiles (כולל trophies מ-player_trophies). אפס schema חדש.
- Client: [src/40-weekly-recap.js](src/40-weekly-recap.js) — IIFE עצמאי. Canvas render, share modal, dedup logic. `window.__bloomWrapped.openNow()` לבדיקת ה-flow ב-devtools.

---

### A5 · ⚡ Live PvP Race ✅ נבנה (24.05.2026 — MVP polling-based)
**מאמץ**: ~75 דקות (במקום 3-4 ימים של true WebSocket) · **השפעה**: ★★★★★ · **סטטוס: חי בייצור**

**מה נבנה — MVP חכם בלי WebSocket**:
- **החלטה אסטרטגית**: במקום להוסיף WebSocket server לסטאק (3-4 ימי עבודה), השתמשתי ב-**polling כל 1 שניה** מעל ה-duels infrastructure הקיים. החוויה כמעט זהה (delay של 1-2s לא מורגש במשחק של 60 שניות), הסקופ קטן פי 4.
- 6 ALTER COLUMN על `duels`: `is_live`, `started_at`, `duration_seconds`, `challenger_live_score`, `opponent_live_score`, `live_last_heartbeat_at`. 3 config keys (enabled, duration=60, winner_reward=50).
- **Matchmaking**: `POST /api/duels/find-random-live` — אותה atomic-match-or-queue logic של A6, עם `difficulty_label = '@live:<diff>'` כדי לבודד את ה-pool הליבל מה-async. כשנמצא יריב → INSERT duel עם `is_live=TRUE`, `status='accepted'`, `started_at=NOW()`.
- **Heartbeat**: `POST /api/duels/:id/live-heartbeat` — כל שחקן שולח את הציון הנוכחי שלו פעם בשנייה. שמירה ב-`<role>_live_score` עם `GREATEST` guard (score-only-grows).
- **Polling**: `GET /api/duels/:id/live-state` — מחזיר שני הציונים + timeLeft. השחקנים פולינג כל 1s ב-stagger של 500ms מה-heartbeat.
- **Auto-settle**: שני מנגנונים — (1) ה-heartbeat עצמו מסיים כשduration עוברה. (2) cron כל 30s סורק duels שlive+accepted+stale ומסיים בכוח (מגן על disconnects).
- **Client flow** ([src/02-shop.js](src/02-shop.js)): "⚡ דו-קרב חי 60 שניות" button בduel modal → matchmaking overlay אדום-ורוד → countdown overlay 3-2-1-GO! עם sound + buzz → init('practice', {fresh, seed}) → mount Live HUD (timer גדול + 2-side scores) → heartbeat+polling loops → at timeout או status=settled, show result overlay עם 4 modes (won/tie/lost עם gold/purple/pink themes).
- **Result overlay**: full-screen card עם large emoji + title + side-by-side scores + reward line + "המשך" button. soundMilestone(7) + 7-pulse buzz למנצח; soundMilestone(3) + 3-pulse למפסיד.
- Push notifications לשני הצדדים בסוף (win/lose/tie copy מותאם).

**מה לא הוטמע** (out-of-scope MVP):
- Split-screen UI (לא חיוני; ה-HUD מספק את ה-"feel" של תחרות חיה)
- True WebSocket (לא חיוני; polling 1s "feels live" במשחק 60 שניות)
- Per-tile sync של היריב (היריב הוא רק score, לא state of grid)

**Future upgrade**: כשיהיו 100+ DAU וה-Render/Railway plan תומך ב-WebSocket — שדרוג ל-true Socket.io לוקח ~2 ימים על גבי הקיים.

---

### A6 · 🎚 Skill-based Duel Matchmaking ✅ נבנה (24.05.2026)
**מאמץ**: 1 יום · **השפעה**: ★★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- כפתור "🎲 דו-קרב אקראי (חיפוש אוטומטי)" במודאל הdueles, ליד הכפתור הקיים "שלח אתגר".
- שחקן לוחץ → modal חיפוש עם spinner + countdown + "👥 N בתור · 🏆 ±M". Polling כל 3s.
- Server: `POST /api/duels/find-random` הוא **atomic match-or-queue** — בכל קריאה: (1) בדוק אם יש לי duel מתאים שכבר נוצר (אני הצד השני שעדיין מחפש); (2) נסה לחפש opponent בטווח trophy ←atomic FOR UPDATE SKIP LOCKED → אם נמצא: DELETE שני entries + CREATE duel + return matched; (3) אם לא נמצא: UPSERT my queue row + return searching.
- **Range מתרחב כל poll**: 50 → 200 → 350 → 500 → ∞. שחקן לא נשאר תקוע בשעה שקטה.
- Schema: טבלה `duel_matchmaking_queue` (PK device_id, trophy_count, joined_queue_at, poll_count, difficulty_label) + 5 config keys (enabled, range_initial, range_widen, max_wait_secs, wager=0). ALTER duels ADD COLUMN is_random_match.
- Duel נוצר עם `status='accepted'` ישירות (skip accept dance) + `is_random_match=TRUE`. Wager=0 (random duels are FREE).
- Push לצד השני (שעדיין מחפש) כש-match נוצר — backup ל-polling במקרה שהאפליקציה מינימייז.
- Client: [src/02-shop.js](src/02-shop.js) `startRandomMatchmaking(diff)` → spinner overlay → match-found flash (gold gradient pop) → auto-start `startDuelGame()`. כמובן: cancel button מסיר מהqueue. Cleanup interval 5min מנקה queue rows ישנים.

---

### A7 · 📅 7-Day Login Calendar ✅ נבנה (24.05.2026)
**מאמץ**: 1 יום · **השפעה**: ★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- מסלול 7-יומי נפרד מה-daily login הקיים. כל יום ברצף = פרס גדל: 50 / 100 / 200 / 500 / 1000 / 2000 / **5000💎**. אחרי יום 7 — חוזר ליום 1 (cycle אינסופי).
- **פספסת יום** = reset ליום 1. ה-FOMO של איבוד הג׳קפוט (5000💎) ביום 7 הוא ה-driver העיקרי.
- Schema: 2 עמודות חדשות על `player_profiles` (`login_cal_day`, `login_cal_last_claim`) + 8 config keys (master + 7 reward tiers). אפס טבלה חדשה.
- Server: `GET /state` + `POST /claim` עם atomic transaction (FOR UPDATE על המ player_profiles row → diff days → advance/reset → atomic balance update + state save).
- Client: [src/41-login-cal.js](src/41-login-cal.js) — home tile (L5+) עם mini 7-grid + status pill + claim ribbon. Modal עם 7-card grid (4-col, day 7 פורש על 2 stretches כי זה ג׳קפוט) + "🎁 קבל X💎 עכשיו" + tip.
- Celebration: 3 tiers — normal (3 sound, 10 confetti), big (5 sound, 24 confetti, day 5-6), **jackpot** (day 7: gold border ענק + 50 confetti + 7-pulse buzz + 76px 👑 spinning).
- כפתור לא auto-claim — שחקן חייב ללחוץ (Clash Royale pattern — מרגיש earned).

**מה זה**:
רשת 7-ימים. כל יום פרס מצטבר: 50→100→200→500→1000→2000→**5000💎**. אם מפסיד יום אחד → מתחיל מההתחלה.

**למה לבנות**:
- Genshin Impact pattern — דוחף 7 ימים רצופים
- שונה מ-daily login הקיים (שהוא flat per-day)
- ה-FOMO של "להפסיד יום שביעי" עוצמתי

**טכני**:
- שדרוג של ה-daily login הקיים
- Visual: 7 כרטיסים גריד 4+3 או 7-בשורה

---

### A8 · 🏟 Squad Tournaments ✅ נבנה (24.05.2026)
**מאמץ**: 2 ימים · **השפעה**: ★★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- Auto-matchmaker רץ כל יום ראשון 06:00 IL → מצרף 4 קלאנים power-balanced (top vs 4th, 2nd vs 3rd seeding)
- כל ה-week, score של כל חבר-קלאן מתווסף ל-`squad_tournament_guilds.score_total` דרך hook ב-`/api/guilds/contribute` (Atomic, same transaction).
- **יום רביעי 20:00 IL**: חצי-גמרים — הגבוה ביותר בכל pair עובר; השני נפסל.
- **יום שבת 20:00 IL**: גמר — מנצח-גמר נקבע.
- **Rewards**: גמר-מנצח 1000💎/חבר · מגיע-לגמר 300💎/חבר · נופל-בחצי 100💎/חבר.
- Schema: 4 טבלאות חדשות (squad_tournaments + squad_tournament_guilds + squad_tournament_contributions + squad_tournament_claims) + 5 config keys (admin-tunable: rewards, min_members).
- Server: 2 endpoints (`GET /state` + `POST /claim`) + 2 crons (matchmaker hourly, advancer hourly — both no-op outside their time windows).
- Client: [src/43-squad-tournament.js](src/43-squad-tournament.js) — IIFE עצמאי. Tile (L15+) רק מוצג כשהקלאן IN tournament. Modal עם bracket visualization (קבוצה A + VS + קבוצה B), per-guild scores + my-contribution + claim button (gold-pulsing כשמגיע).
- **Push notifications**: כשהtournament מתחיל (לכל חברי 4 הקלאנים) + כשהtournament נסגר (לכל החברים עם הודעה role-appropriate).
- Differs from Stage 37 Guild Wars (1v1): 4-way bracket → 3 elimination stages → more drama → שבועי.

---

### A9 · 👻 Ghost Mode ✅ נבנה (24.05.2026)
**מאמץ**: 2 ימים · **השפעה**: ★★★ · **סטטוס: חי בייצור**

**מה נבנה** (Mario Kart pattern):
- Schema: `ALTER daily_scores + difficulty_scores ADD drops_sequence JSONB` (array of column indices). 3 config keys.
- בכל drop של שחקן ב-`11-game.js`, `window.__bloomDropsSeq.push(col)` שומר את העמודה. נשלח אל ה-server יחד עם הציון.
- Server validates: array of ints 0-3, max 200 entries. נשמר בעמודה הJSONB יחד עם daily/practice score upsert.
- Endpoint חדש `GET /api/ghost/random?date=&deviceId=`: עדיפות חבר → fallback לglobal random ghost מאותו תאריך.
- Client tile (L8+) "👻 שחק נגד רוח" → fetch random ghost → confirm modal עם stats → arm ghost → init('daily')
- בזמן המשחק: HUD floating "👻 דניאל: 38,400 vs אתה: 42,200" (gold כשמובילים, אדום כשמאחורי). Column indicator שקוף סגול-לבן מציין את העמודה הבאה שדניאל יזרוק עליה.
- כשעוברים את ה-final-score של דניאל → toast גדול "🏆 עברת את דניאל! +3,000" + 5-pulse buzz + soundMilestone(5).
- Client: [src/44-ghost-mode.js](src/44-ghost-mode.js). Disarm אוטומטי כשעוברים מ-daily למצב אחר (interval watcher).

**הגבלות v1**: daily/practice בלבד (לא contest/duel). הציון של הרוח מתפלג ליניארית (לא time-based) — כי לא שומרים timestamps פר-drop.

---

### A10 · 💰 Compound Interest Gem Bank ✅ נבנה (24.05.2026)
**מאמץ**: 1 יום · **השפעה**: ★★★ · **סטטוס: חי בייצור**

**מה נבנה**:
- Tile ירוק-זוהר במסך הבית (L8+). הצגה: "💰 בבנק: 1,500💎 · ⏰ ריבית הבאה: בעוד 14ש"
- Modal: יתרה בארנק + יתרה בבנק + total earned. שתי שורות action (הפקדה / משיכה) עם 25%/50%/הכל preset buttons.
- "💡 מחר תהיה לך X💎" projection — psychological hook.
- Schema: טבלה `gem_bank` (device_id PK, deposited, total_interest_paid, last_interest_date) + 5 config keys (enabled, interest_pct=1, fee_pct=5, min_deposit=100, max_balance=1M).
- Server: 3 endpoints — GET /state (lazy-creates row, computes msUntilNext), POST /deposit (atomic UPDATE עם balance>=amount guard), POST /withdraw (atomic, fee deducted). Daily cron בorder of 03:00 IL — UPDATE כל ה-rows עם last_interest_date < today.
- Client: [src/42-gem-bank.js](src/42-gem-bank.js). 1% ריבית מצטברת → אחרי 30 יום על 1,000💎 → 1,348💎.
- Loss aversion: עמלת 5% בכל משיכה. השחקן יחשוב פעמיים לפני שמוציא.

---

## 💵 MONETIZATION — דורש Stripe + חוקיות

4 משימות לכסף אמיתי. דורשות חשבון Stripe + חוקיות (במיוחד #24).

| # | פיצ׳ר | מאמץ | תיאור |
|---|---|---|---|
| **17b** | 💳 Stripe IAP | 3-4י | מסלול דולרים אמיתי. דרישת בסיס ל-22/23/24 |
| **22** | ⭐ VIP subscription | 2י | $4.99/חודש auto-renew. MRR יציב. דורש 17b |
| **23** | 🎨 Real-money cosmetic shop | 2י | סקינים premium ב-USD בלבד. דורש 17b |
| **24** | 💸 Wager / RM tournaments | 4י | $1 כניסה, 70% פרס. **דורש אישור חוקי** (חוק הימורים בישראל) |

---

## 🚫 מחוץ ל-Scope — תחום שלך (לא תכנותי)

| משימה | סטטוס |
|---|---|
| 🌐 דומיין bloom-game.co.il | טרם נקנה |
| 📱 App Store listing (PWA wrapper) | לא נעשה |
| 📊 GA4 measurement ID | יש קוד, חסר ID — דרוש חשבון Google Analytics |
| 🎯 Landing page + SEO | לא נעשה |

---

## 📊 סיכום למבט מהיר

| קטגוריה | כמה | מצב |
|---|---|---|
| ✅ נבנו וחיים בפרודקשן | 38 שלבים | פעילים |
| 🎯 Pure Addiction backlog | 10 משימות | מוכן לבנייה — אין תלות |
| 💵 Monetization backlog | 4 משימות | דורש Stripe + חוקיות |
| 🚫 מחוץ ל-scope | 4 פריטים | תחום המשתמש |

**סך הכל**: **14 משימות פתוחות** שאני יכול לבנות מתי שתחליט.

---

## 🎯 ההמלצות שלי (לפי סדר)

### 1️⃣ הכי הגיוני להתחיל: **A1 (Notification Inbox)**
- 1-2 ימים בלבד
- פותר בעיה ממשית (overload של 38 פיצ׳רים)
- ה-UI הכי-נלחץ במשחקים מובילים
- חוצה את כל 4 גירסאות הבית

### 2️⃣ לויראליות: **A2 (Friend Challenges)**
- K-factor הכי חזק שיש
- מנצל infrastructure קיים
- 1-2 ימים

### 3️⃣ לחיזוק Stage 38: **A3 (Trophy Chests)**
- משלים את Trophy Road
- "must return" mechanic
- 1-2 ימים

### 4️⃣ למשהו ויראלי-משותף: **A4 (BLOOM Wrapped)**
- 1 יום בלבד
- Spotify pattern — נוסטלגיה + שיתוף
- מתאים מאוד לסוף השבוע

---

## 📝 איך לפתוח שיחה חדשה ולהמשיך

תגיד אחד מהבאים ואני אדע בדיוק מה לבנות:

```
"בוא נבנה A1"          → בונה Notification Inbox
"תעשה A2 + A3 ביחד"     → בונה Friend Challenges + Trophy Chests
"המשך עם הכי ממכר"      → אני אבחר A1 (לפי ההמלצה)
"מה ב-FUTURE_TASKS.md?" → אקרא את הקובץ ואסכם
"שכח A10, תוסיף X"      → מעדכן את הרשימה
```

---

*קובץ זה מתעדכן אוטומטית כשבונים פיצ׳ר חדש או כשמוסיפים רעיון לbacklog.*
