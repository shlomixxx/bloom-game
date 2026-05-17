# 📊 BLOOM — דוח שיפורים מקיף
## השוואה ל-Candy Crush, Subway Surfers, 2048, Tetris, Bejeweled

---

## ✅ מה שכבר מיושם (ותקין)

### Feedback על כל פעולה (16 מנגנונים)

| # | פעולה | ויזואלי | סאונד | ויברציה | Shake | סטטוס |
|---|-------|---------|--------|---------|-------|--------|
| 1 | הפלת אריח | pop animation | soundDrop | ✅ 8ms haptic | — | ✅ תוקן |
| 2 | מיזוג | pulse ripple | soundMerge | — | — | ✅ שודרג |
| 3 | שרשרת ×2+ | badge + combo counter | soundChain | — | — | ✅ שודרג |
| 4 | Triple merge | "✨ Triple!" banner | — | ✅ | ✅ 3 | ✅ |
| 5 | Quad merge | "💥 Quad!" banner | — | ✅ | ✅ 6 | ✅ |
| 6 | Tier-up (5+) | banner + points | soundMilestone | ✅ | ✅ 3-5 | ✅ |
| 7 | Crown Merge | flash + banner + confetti | soundMilestone | ✅✅✅ | ✅ 8 | ✅ שודרג |
| 8 | Score milestone | banner + 💎 | — | ✅ | ✅ 2 | ✅ |
| 9 | שיא חדש | banner + confetti | tone | ✅✅ | ✅ 4 | ✅ שודרג |
| 10 | 💣 Bomb | "BOOM!" + cells flash | — | ✅✅✅ | ✅ 6 | ✅ |
| 11 | ⭐ Star | "Level Up!" | — | ✅ | — | ✅ |
| 12 | 🎁 Gift | "+X💎" (jackpot: confetti) | — | ✅ | — | ✅ שודרג |
| 13 | 🔥 Fever | "×3!" + fire border | — | ✅✅ | — | ✅ |
| 14 | ❄️ Freeze | "הצלה!" + blue flash | — | ✅ | ✅ 4 | ✅ |
| 15 | ⚡ עבר אותך | red slide-in banner | tone | ✅ | ✅ 3 | ✅ |
| 16 | 👑 אתה מוביל | gold slide-in + fanfare | 3 tones | ✅ | ✅ 4 | ✅ |

### מצבי משחק (6 מצבים)

| מצב | Init | Game-over | Score submit | Events | סטטוס |
|-----|------|-----------|-------------|--------|--------|
| יומי | ✅ | ✅ (2 paths) | ✅ leaderboard | ✅ | ✅ |
| חופשי | ✅ | ✅ (2 paths) | ✅ leaderboard | ✅ | ✅ |
| תחרות | ✅ | ✅ (2 paths) | ✅ contest | ✅ | ✅ |
| אתגר | ✅ | ✅ (2 paths) | ✅ challenge | ✅ | ✅ |
| שבועי | ✅ | ✅ (auto) | ✅ contest | ✅ | ✅ |
| דו-קרב | ✅ | ✅ (2 paths) | ✅ duel | ✅ | ✅ |

---

## 🔴 שיפורים שבוצעו עכשיו

| # | שיפור | השראה מ- | השפעה |
|---|--------|----------|-------|
| 1 | **Haptic on every drop** (8ms) | Tetris Effect, Candy Crush | מרגיש tactile, לא "ריק" |
| 2 | **Merge pulse ripple** (גל זהוב) | Bejeweled, Candy Crush | מיזוג מרגיש "כוחני" |
| 3 | **Confetti** on Crown/Best/Jackpot | Subway Surfers, every top game | חגיגיות, "WOW moment" |
| 4 | **Combo counter** (persistent) | Bejeweled Blitz, Tetris 99 | שחקן רואה את ה-chain גדל |

---

## 🟡 שיפורים מומלצים — עדיפות גבוהה

### 1. 🎵 Music tempo increase (Tetris style)
**מה:** ככל שהלוח מתמלא, המוזיקה מואצת
**למה:** יוצר מתח אדיר + דחיפות + אדרנלין
**השראה:** Tetris (iconic), Dr. Mario, Lumines
**מאמץ:** קל (playbackRate על AudioContext)
**ROI:** ⭐⭐⭐⭐⭐ — הדבר הכי ממכר ב-Tetris

### 2. 📸 Share card with screenshot
**מה:** בgame-over, כפתור "שתף" יוצר תמונה יפה עם הניקוד
**למה:** שחקנים משתפים → שחקנים חדשים → growth
**השראה:** Wordle (viral screenshot), Subway Surfers
**מאמץ:** בינוני (html2canvas / Canvas API)
**ROI:** ⭐⭐⭐⭐⭐ — viral growth engine

### 3. 🎯 Daily Quests (3 missions per day)
**מה:** "מזג 5 פרחים", "הגע לברק ב-3 דקות", "שרשרת ×3"
**למה:** סיבה חדשה כל יום לשחק (מעבר לstreak)
**השראה:** Fortnite, Clash Royale, כל Top-10
**מאמץ:** בינוני-גבוה (DB + UI + random quest generator)
**ROI:** ⭐⭐⭐⭐ — D1/D7 retention boost

### 4. 🏆 Season Pass / Battle Pass
**מה:** 30 שלבים עם פרסים שמתקדמים עם XP
**למה:** סיבה לטווח ארוך (30+ ימים) להמשיך לשחק
**השראה:** Fortnite, PUBG, Clash Royale, Candy Crush
**מאמץ:** גבוה
**ROI:** ⭐⭐⭐⭐ — retention + monetization

### 5. 💬 Social: Spectator reactions
**מה:** כשמישהו צופה בך, הוא יכול לשלוח אמוג'י (👏🔥😱)
**למה:** interaction חברתי = engagement
**השראה:** TikTok Live, Twitch, Clash Royale emotes
**מאמץ:** בינוני (WebSocket)
**ROI:** ⭐⭐⭐ — social engagement

---

## 🟢 שיפורים מומלצים — עדיפות בינונית

### 6. Background parallax
**מה:** רקע שזז לאט כשגוללים/משחקים
**למה:** תחושת עומק ויזואלית
**השראה:** Subway Surfers, Temple Run
**מאמץ:** קל (CSS transform)

### 7. Tile unlock animation
**מה:** כשמגיעים לדרגה חדשה בפעם הראשונה אי-פעם, אנימציית unlock מיוחדת
**למה:** רגע "discovery" — חלק מה-core loop
**השראה:** Pokemon (new catch), Suika Game
**מאמץ:** קל

### 8. "Near death" visual
**מה:** כשהלוח כמעט מלא (5+ שורות), קצוות המסך הופכים אדומים
**למה:** מתח ויזואלי, דחיפות
**השראה:** Tetris (flash at top), Dr. Mario
**מאמץ:** קל (CSS transition on grid border)

### 9. Achievement pop-ups during gameplay
**מה:** כשהישג נפתח, pop-up מיוחד (לא רק toast)
**למה:** רגע חגיגי + מוטיבציה
**השראה:** Xbox achievements, PlayStation trophies
**מאמץ:** קל

### 10. Leaderboard animations
**מה:** כשעולים בדירוג, אנימציית "rank up" עם ניקוד ישן → חדש
**למה:** תחרותיות ויזואלית
**השראה:** Clash Royale season end, Brawl Stars
**מאמץ:** בינוני

---

## 📊 סיכום — סדר עדיפויות

| עדיפות | שיפור | מאמץ | ROI |
|--------|--------|------|-----|
| 🔴 1 | Music tempo increase | קל | ⭐⭐⭐⭐⭐ |
| 🔴 2 | Share card screenshot | בינוני | ⭐⭐⭐⭐⭐ |
| 🔴 3 | Daily Quests | בינוני-גבוה | ⭐⭐⭐⭐ |
| 🟡 4 | Season Pass | גבוה | ⭐⭐⭐⭐ |
| 🟡 5 | Spectator reactions | בינוני | ⭐⭐⭐ |
| 🟢 6 | Near-death red edges | קל | ⭐⭐⭐ |
| 🟢 7 | Tile unlock animation | קל | ⭐⭐⭐ |
| 🟢 8 | Background parallax | קל | ⭐⭐ |
| 🟢 9 | Achievement pop-ups | קל | ⭐⭐ |
| 🟢 10 | Leaderboard animations | בינוני | ⭐⭐ |

---

*דוח זה עודכן: מאי 2026*
*מבוסס על ניתוח: Candy Crush, Subway Surfers, Tetris Effect, Bejeweled Blitz, 2048, Clash Royale, Fortnite*
