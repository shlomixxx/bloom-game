# 🎯 BLOOM Addiction Roadmap

> תוכנית מפורטת ל**מקסום ההתמכרות** של השחקנים שלך.
> מה כבר נשלח, מה אתה צריך לעשות, ומה הצעד הבא — מסודר לפי שלבים ועדיפויות.

---

## 📋 חלק 0: מה אתה צריך לעשות *עכשיו* (30 דקות)

### 🔴 קריטי — בדיקת מערכת ה-push החדשה

המערכת **כבר חיה ופועלת**, אבל אתה חייב לבדוק שהיא עובדת אצלך:

#### צעד 1: בדיקה ב-Android Chrome (5 דק')
1. סגור את כל הטאבים של BLOOM (Tab switcher → swipe up)
2. פתח Chrome חדש → `bloom-web-production-f3bd.up.railway.app`
3. שלח דו-קרב לחבר (BLOOM-XXXX אמיתי) או לעצמך מטאב אחר
4. **אמור לקפוץ פופ-אפ:** "🔔 הפעל התראות מיידיות"
5. לחץ "✅ הפעל התראות" → אשר את הדפדפן
6. במכשיר/טאב השני — בתוך 2-3 שניות **אמור לקפוץ banner מערכת**

#### צעד 2: בדיקה ב-iPhone (אם רלוונטי) (10 דק')
**iOS דורש PWA install** לפני שהוא יודע push:
1. פתח Safari ב-iPhone → `bloom-web-production-f3bd.up.railway.app`
2. לחץ על כפתור Share (ריבוע עם חץ למעלה)
3. גלול למטה → "Add to Home Screen" → אשר
4. סגור Safari → פתח את BLOOM **מהמסך הבית** (לא מ-Safari)
5. עכשיו שלח דו-קרב → תקבל את הפופ-אפ → אישר → push יעבוד

#### צעד 3: GA4 (אופציונלי, 5 דק')
לקבל נתונים על user behavior:
1. לך ל-`analytics.google.com` → צור property חדש "BLOOM"
2. קח את ה-Measurement ID (פורמט: `G-XXXXXXXXXX`)
3. ב-Railway dashboard → bloom-web → Variables → הוסף:
   ```
   GA_ID = G-XXXXXXXXXX
   ```
4. Railway יפרוס מחדש אוטומטית
5. תקבל metric על: גיימרים יומיים, רטנשן, conversion funnels

#### צעד 4: דומיין מקצועי (אופציונלי, ~₪50/שנה)
שדרוג מהיר של מקצועיות:
1. קנה `bloom-game.co.il` ב-domain.co.il או GoDaddy (~₪50)
2. ב-Railway → bloom-web → Settings → Networking → Custom Domain
3. הוסף `bloom-game.co.il` → Railway ייתן רשומת DNS להעתיק
4. אצל ספק הדומיין → DNS settings → הוסף את הרשומה
5. תוך שעה הדומיין החדש פועל

---

## ✅ חלק 1: מה כבר נשלח ועובד (יכול להראות *היום*)

### Core gameplay
- ✅ 4×6 grid עם 8 tiers (אבן→כתר)
- ✅ Chain multipliers (×1 / ×1.5 / ×2 / ×2.5 / ×3)
- ✅ Score עם first-time-tier-up bonus (+500 / +1500 / +5000 / +15000)
- ✅ 5 רמות קושי (default / easy / medium / hard / insane)

### Identity & Social
- ✅ BLOOM-XXXX player codes ייחודיים
- ✅ הסרת חיכוך כניסה — שם ברירת מחדל "שחקן 4F2C"
- ✅ פרופיל ציבורי `/player/BLOOM-XXXX`
- ✅ עריכת שם + דגל ארץ
- ✅ Leaderboards: יומי / שבועי / חודשי × global / country / difficulty

### Retention mechanics (the addiction layer)
- ✅ **Streak system** — רצף ימי משחק עם תגמולים
- ✅ **Streak FOMO banner** — אחרי 19:00 אם לא שיחקת היום
- ✅ **Comeback bonus** — 50/100/200💎 לחזרה אחרי 2-30+ ימים
- ✅ **Daily login** עם slot-machine animation
- ✅ **FTUE** — מדריך 3-שלבי לשחקנים חדשים
- ✅ **Daily challenge** — חידה יומית עם seed זהה לכולם
- ✅ **Personal hero banner** — שיא אישי / סטריק / דחיפות

### Game-over emotional context
- ✅ "🏆 מקום #23 מתוך 847" (rank/total)
- ✅ "🎉 שיא אישי חדש! +2,300" (delta)
- ✅ "⬆️ עוד 200 נקודות והיית ב-TOP 20" (gap-to-rank)
- ✅ Animated big CTA "שחק שוב" עם hover glow

### Social loop
- ✅ **1v1 Duels** עם הימור 💎 + difficulty selectable
- ✅ **Live opponent HUD** — ניקוד היריב בזמן אמת תוך כדי משחק
- ✅ **Decline duel** + auto-refund למאתגר
- ✅ **Player-to-player gifts** — שלח 💎 לחבר
- ✅ **Live spectator** — צופים במשחק חי של חבר
- ✅ **Friends contest** — תחרות פרטית עד 30 ימים
- ✅ **BLOOM Challenges** — תחרויות עם פרסים אמיתיים

### Just shipped: Push Notifications (closed-app)
- ✅ ⚔️ אתגר נכנס → push גם כשהאפליקציה סגורה
- ✅ 🎁 מתנה התקבלה → push
- ✅ 🏆/😔/🤝 תוצאת דו-קרב → push
- ✅ 🤷 דחייה / ⏰ פג תוקף → push
- ✅ Soft pre-prompt עם 3-day cooldown
- ✅ Deep-linking: לחיצה על notification פותחת את המקום הנכון

### Economy & monetization-ready
- ✅ Wallet system עם 💎 credits
- ✅ 7 skin packs (כולל Aurora עם אנימציות)
- ✅ Tile shop + power-ups
- ✅ Daily jackpot
- ✅ XP + 11 levels
- ✅ Referral system

### Admin & ops
- ✅ Admin dashboard עם DAU/WAU/MAU, retention, funnel, heatmap
- ✅ Bot system לטסטינג
- ✅ Live view של שחקנים פעילים
- ✅ Backups אוטומטיים (DAILY + WEEKLY ב-Railway)
- ✅ Security hardening (HMAC tokens, rate limits, anti-cheat)

---

## 🚀 חלק 2: התוכנית להגברת התמכרות — שלבים מפורטים

### 📅 שלב A: "Quick Wins" — שבוע 1 (5-8 שעות)

מבצע את כל הדברים שיש להם **ROI גבוה ביותר** בזמן קצר.

#### A1. Daily Goals 🎯 ([2 שעות, +30% DAU])
"השלם 3 משחקים היום ותקבל +50💎"

**מה זה:**
- 3 מטרות יומיות שמתחדשות בחצות (ישראל)
- דוגמאות: "שחק 3 משחקים" / "הגע ל-tier 6 פעם אחת" / "ניצח דו-קרב"
- לכל מטרה תגמול 💎
- Progress bar ויזואלי על המסך הראשי

**למה זה ממכר:**
מעודד את השחקן לחזור היום + לשחק כמה משחקים. השלמת מטרה = dopamine hit.

**מה נדרש:**
- טבלת DB חדשה: `daily_goals_progress` (device_id, date, goal_id, progress, completed)
- 3 endpoints: GET goals / POST progress / POST claim
- UI על המסך הראשי: 3 כרטיסי מטרה

---

#### A2. Friend Activity Panel 👥 ([3 שעות, +20% engagement])
"🟢 דני שיחק לפני 5 דק' · ציון 23,400"

**מה זה:**
- כרטיס במסך הראשי שמראה את הפעילות של חברים (BLOOM-XXXX שיש לך duel history איתם)
- מציג: שם, זמן אחרון משחק, ציון אחרון, אייקון "אתגר אותו"
- מתעדכן כל 30 שניות

**למה זה ממכר:**
"דני הצליח 23K — אני יכול לעשות יותר!" — social comparison מפעיל את ה-loop.

**מה נדרש:**
- Query חדש: SELECT recent activity from players I've duelled
- UI block בבית v2
- Tap "אתגר" → פותח duel modal עם השם

---

#### A3. Achievements Visual Gallery 🏆 ([1.5 שעות, +15% replay])
מסך הישגים מאוייר במקום רשימה.

**מה זה:**
- כרטיסים גדולים עם icon לכל הישג
- מצב "נעול / זמין / הושלם" עם גרפיקה
- Progress bar עבור הישגים מתקדמים

**למה זה ממכר:**
"רק 3 הישגים עד הבא — אני חייב למלא אותם!" — completion drive.

**מה נדרש:**
- Refactor של showAchievements קיים
- 30+ achievements עם art מובנה

---

#### A4. Limited-Time Event Banner ⏰ ([1.5 שעות, +25% session frequency])
"🔥 סוף שבוע מטורף! ×2 נקודות עד יום ראשון 23:59"

**מה זה:**
- Admin יוצר event ב-admin panel
- Banner בולט במסך הראשי
- Multiplier אוטומטי על נקודות בזמן ה-event
- Countdown live

**למה זה ממכר:**
FOMO ענק. "אסור לי לפספס את ה-x2!" — חזרה דחופה.

**מה נדרש:**
- טבלת `live_events` (id, name, banner_text, multiplier, starts_at, ends_at, active)
- Admin UI ליצירה
- Server-side multiplier applied to scoring

---

### 📅 שלב B: "Deep Social" — שבועות 2-3 (10-15 שעות)

#### B1. Friends List + Online Status 👥
- רשימת חברים אמיתיים (לא רק מי שאתגרת)
- "🟢 online now" indicator
- Tap → אתגר / מתנה / צפייה במשחק שלהם

#### B2. Chat in Duels 💬
- צ'אט קצר בתוך duel screen
- 8-10 emoji מוכנים לבחירה (אין הקלדה כדי למנוע toxicity)
- "🔥 wow!" / "😅" / "💪"

#### B3. Squads / Teams 👨‍👩‍👧
- 4-5 שחקנים יכולים להקים "Squad"
- תחרות שבועית בין squads
- חברי squad רואים זה את זה ב-leaderboard מיוחד

#### B4. Trade Skins 🎨
- שחקנים יכולים לתת skin שיש להם לחבר (חד-פעמי)
- מעודד viral loop ("נתתי לך skin, תחזיר טובה")

---

### 📅 שלב C: "Progression Depth" — חודש 2 (15-20 שעות)

#### C1. Battle Pass 🎖
- 30 רמות פרס למשך חודש
- חינמי vs Premium track
- Daily challenges נותנים XP לרצף
- כל רמה = מתנה (skin / 💎 / power-up)

**למה זה ממכר:**
Battle pass הוא ה-#1 monetization mechanic ב-2024 (Fortnite, COD, Apex). תחושת התקדמות יומית מתמשכת.

#### C2. Player Profiles עם Stats מורחבים 📊
- מספר משחקים, שיא, יחס ניצחון, סטריק הכי גבוה
- "מיומנויות" — סטטיסטיקה כמו תחביב Strava
- Share button → תמונה יפה לאינסטה

#### C3. Skill-Based Matchmaking 🎯
- דו-קרבות לא random — נגד שחקן ברמה דומה
- ELO rating מאחורי הקלעים
- "Promotion match" כשעולים rank

---

### 📅 שלב D: "Growth & Monetization" — חודש 3+ (∞ שעות)

#### D1. Real Monetization
- IAP: 100💎/$0.99, 500💎/$3.99, 1500💎/$9.99, 5000💎/$24.99
- Premium subscription: $4.99/חודש — בלי פרסומות + 2x daily reward + premium skins
- Battle pass premium track: $4.99/חודש

#### D2. Ads (Reward Video)
- AdSense / AdMob integration
- "צפה בפרסומת לפרס 30💎" כבר קיים אבל פרסומת לא אמיתית
- Continue game עם פרסומת

#### D3. Push Marketing
- שלב 1 (זה כבר עובד!): push לאירועים חברתיים
- שלב 2 (לעתיד): push קמפיינים — "בא נשחק! עברו 3 ימים"
- שלב 3: A/B test על הניסוחים

#### D4. App Store Listings
- TWA wrapper ל-Google Play
- PWA ל-iOS (כבר עובד דרך Add to Home Screen)
- ASO (App Store Optimization)

---

## 💻 חלק 3: מה מותקן ומה לא

### ✅ כבר מותקן (אין מה לעשות)
- Node.js 18+ ב-Railway
- Express + pg (backend)
- web-push (push notifications)
- Postgres עם 19 טבלאות + auto-backups
- Service Worker עם offline support + push handlers
- PWA manifest + icons

### 🔵 רוצה להתקין יום אחד (אופציונלי)
- **Sentry** (error tracking) — `npm install @sentry/node`
- **Stripe** (אם תרצה IAP אמיתיים) — `npm install stripe`
- **Twilio** (SMS למקרי חירום) — `npm install twilio`

### ⚙️ Environment Variables — מה מוגדר/חסר ב-Railway

| Variable | מצב | מה זה |
|---|---|---|
| `DATABASE_URL` | ✅ מוגדר | חיבור ל-Postgres |
| `PORT` | ✅ אוטו | Railway מזריק |
| `DEVICE_SECRET` | ✅ מוגדר | HMAC לטוקני שחקנים |
| `ADMIN_PATH` | ✅ מוגדר | URL slug לאדמין |
| `ADMIN_PASSWORD` | ✅ מוגדר | סיסמת אדמין |
| `VAPID_PUBLIC_KEY` | ✅ מוגדר | Push notifications |
| `VAPID_PRIVATE_KEY` | ✅ מוגדר | Push notifications |
| `VAPID_SUBJECT` | ✅ מוגדר | Push contact email |
| `GA_ID` | ⚠️ חסר | Google Analytics (אופציונלי) |
| `ERROR_WEBHOOK` | ⚠️ חסר | Slack/Discord error alerts (אופציונלי) |

---

## 🎨 חלק 4: רעיונות אנימציה ספציפיים

אלו רעיונות שדיברנו עליהם או שמשפיעים על "feel":

### כבר ממומשים
- ✅ Slot-machine reel על daily reward
- ✅ Score bump animation (פעימה כתומה כשמיזוג)
- ✅ Confetti על ניצחון
- ✅ FX overlay (פיצוץ/הקפאה)
- ✅ Aurora skin עם merge effects מיוחדים
- ✅ Hero card pulse (streak hot)
- ✅ Big CTA gold breathing glow

### אנימציות שיוסיפו "wow":
- 💡 **Combo meter** — כשעושים merge ברצף, מד קצב מתמלא ומשנה צבע
- 💡 **Crown explosion** — כשמגיעים ל-tier 8, פיצוץ מסך מלא + slow motion
- 💡 **Daily challenge unlock** — בחצות, מסך פתיחה דרמטי "אתגר חדש!"
- 💡 **Friend just joined** — באנר עדין למעלה "🟢 דני נכנס למשחק עכשיו"
- 💡 **Streak milestone** — באנר מסך-מלא ביום ה-7/14/30 עם confetti + sound

### Sound design (חסר):
- 💡 צליל ייחודי לכל tier merge (כמו Suika המקורי)
- 💡 Crescendo כשמגיעים ל-chain ארוך
- 💡 Lobby music עם 3-4 וריאציות
- 💡 Win/lose chimes ייחודיים

---

## 🎯 חלק 5: הצעדים שלי לחודש הקרוב (סדר ביצוע)

אם תעשה את הצעדים האלה לפי הסדר, BLOOM יעלה מ-"משחק טוב" ל-"משחק ממכר באמת":

### שבוע 1 (~6 שעות)
- [ ] **יום 1:** בדוק push notifications באנדרואיד + iPhone
- [ ] **יום 2:** הוסף GA_ID ב-Railway (5 דק')
- [ ] **יום 3-5:** Daily Goals (A1) + LimitedTime Event (A4)

### שבוע 2 (~8 שעות)
- [ ] Friend Activity Panel (A2)
- [ ] Achievements Visual Gallery (A3)
- [ ] תיקוני באגים שתמצא במהלך השבוע

### שבוע 3-4 (~12 שעות)
- [ ] Friends List + Online Status (B1)
- [ ] Squads pilot (B3) — להציע ל-10 שחקנים אקטיביים
- [ ] קמפיין שיווק קטן (Facebook ads ~$20-50 לבדיקה)

### חודש 2 (~25 שעות)
- [ ] Battle Pass v1 (C1) — הכי גדול
- [ ] Skill-based matchmaking (C3)
- [ ] Real IAP integration (D1)

### חודש 3+
- [ ] App Store listings
- [ ] Push marketing campaigns
- [ ] Real revenue optimization

---

## 📊 איך תדע שזה עובד? (KPI יעדים)

מעקב יומי מ-admin dashboard:

| Metric | יעד שבוע 1 | יעד חודש 1 | יעד חודש 3 |
|---|---|---|---|
| DAU (Daily Active Users) | 30+ | 100+ | 500+ |
| D1 Retention | 30% | 40% | 45% |
| D7 Retention | 15% | 25% | 30% |
| Games per session | 2 | 3 | 4 |
| Push opt-in rate | n/a | 25% | 40% |
| Duels per day | 5 | 30 | 100 |
| Gifts per day | 0 | 10 | 50 |

אם המספרים נמוכים מהיעד — זה אומר שמשהו לא עובד בפיצ'ר ספציפי. ה-admin dashboard מראה לך איפה ה-funnel נשבר.

---

## ❓ שאלות נפוצות

**ש: למה לא לעשות הכל בבת אחת?**
ת: מוצר טוב נבנה לפי iteration. כל פיצ'ר צריך לבדוק עליו 1-2 שבועות לראות איך מספרים זזים. הוספה מהירה של 20 פיצ'רים בלי בדיקה = כאוס.

**ש: מתי להתחיל לפרסם בכסף?**
ת: רק אחרי שה-D1 retention עובר 30%. אחרת אתה משלם על שחקנים שנוטשים. כשהמוצר "מחזיק" — אז שווה לקנות התקנות.

**ש: צריך לעבוד עם מעצב/מאייר?**
ת: עד היום הכל קוד + emoji/SVG. ברגע שתרצה Battle Pass premium או Skin shop אמיתי — שווה ~₪500-1500 למאייר חיצוני לכמה skins מקוריות.

**ש: מתי יוצא לאפליקציית מובייל אמיתית?**
ת: היום BLOOM הוא PWA — נראה כאפליקציה ב-Home Screen של iOS/Android. לסטור: TWA לאנדרואיד (חינמי, יומיים) או Capacitor wrapper ל-iOS (~₪99 שנתי לפי License של אפל + 2-3 שבועות עבודה).

---

## 🎯 בשורה התחתונה

BLOOM נמצא במצב טוב מאוד. הליבה (gameplay + retention loops) חזקה. עכשיו זה זמן ל:

1. **לבדוק שהכל עובד** (זה השבוע הזה)
2. **להוסיף Daily Goals + Live Events** (השבוע הבא — הכי כדאי)
3. **להתחיל למדוד** (GA4 + admin dashboard daily)
4. **לעשות iteration** לפי מה שהמספרים מראים

הדבר היחיד שלא תוכל לחזות זה איזה פיצ'ר ספציפי "ייתפס" אצל הקהל. תפצל את הזמן שלך 70/20/10:
- 70% על פיצ'רים חדשים
- 20% על תיקון באגים ופוליש
- 10% על שיווק

בהצלחה — האם להתחיל מ-A1 (Daily Goals)? תגיד "כן" ואני מתחיל מיד.
