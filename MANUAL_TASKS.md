# 📋 משימות ידניות — BLOOM

כל מה שאתה צריך לעשות ידנית. הקוד כבר מוכן לכל הפריטים האלה.

---

## 1. 🔑 הפעלת Google Analytics (5 דקות)

### מה זה נותן:
נתונים על כל מה שקורה במשחק — כמה שחקנים, מאיפה הם מגיעים, כמה זמן משחקים, מה הם עושים.

### שלב 1 — יצירת חשבון GA4:
1. פתח https://analytics.google.com
2. לחץ "Start measuring" (או "התחל למדוד")
3. שם חשבון: `BLOOM`
4. שם Property: `BLOOM Game`
5. בחר timezone: `Israel` ומטבע: `ILS`
6. לחץ "Create"

### שלב 2 — יצירת Web Stream:
1. בתפריט השמאלי: Admin → Data Streams → Add Stream → Web
2. כתובת: `bloom-web-production-f3bd.up.railway.app`
3. שם: `BLOOM Web`
4. לחץ "Create Stream"
5. **העתק את ה-MEASUREMENT ID** — מתחיל ב-`G-` (למשל: `G-ABC123XYZ`)

### שלב 3 — הגדרה ב-Railway:
1. פתח https://railway.app → הפרויקט שלך → bloom-web
2. לחץ על הטאב "Variables"
3. לחץ "New Variable"
4. **Key:** `GA_ID`
5. **Value:** הדבק את ה-Measurement ID (למשל `G-ABC123XYZ`)
6. לחץ "Add"
7. Railway יעשה redeploy אוטומטית

### איך לבדוק שעובד:
1. פתח את המשחק בדפדפן
2. חזור ל-Google Analytics → Realtime
3. אתה צריך לראות "1 user" בלוח

---

## 2. 🌐 רכישת דומיין (10-15 דקות)

### מה זה נותן:
כתובת מקצועית — bloom-game.co.il במקום bloom-web-production-f3bd.up.railway.app

### שלב 1 — רכישת הדומיין:
1. גלוש לאחד מרשמי הדומיינים בישראל:
   - https://www.isoc.org.il (ישראלי, ~35₪/שנה)
   - https://www.namecheap.com (בינלאומי, ~$10/שנה)
   - https://www.godaddy.com
2. חפש `bloom-game.co.il`
3. אם תפוס — נסה: `bloom.co.il`, `bloom-game.com`, `playblo.om`
4. קנה לשנה

### שלב 2 — הגדרה ב-Railway:
1. פתח Railway → bloom-web → Settings → Networking → Custom Domain
2. לחץ "Add Custom Domain"
3. הקלד: `bloom-game.co.il` (או הדומיין שקנית)
4. Railway יציג לך **CNAME record** — משהו כמו:
   ```
   Type: CNAME
   Name: @  (או bloom-game.co.il)
   Value: bloom-web-production-f3bd.up.railway.app
   ```
5. **העתק את ה-Value הזה**

### שלב 3 — הגדרת DNS ברשם הדומיין:
1. חזור לאתר רשם הדומיין שלך
2. מצא "DNS Management" או "ניהול DNS"
3. הוסף record חדש:
   - **Type:** CNAME
   - **Name:** `@` (או השאר ריק — תלוי ברשם)
   - **Value:** `bloom-web-production-f3bd.up.railway.app`
   - **TTL:** 300 (או Auto)
4. שמור

### שלב 4 — המתנה:
- DNS לוקח בין 5 דקות ל-24 שעות (בד"כ 15-30 דקות)
- Railway יחתום SSL אוטומטית

### שלב 5 — ספר לי:
- שלח לי את הדומיין הסופי
- אני אעדכן את כל ה-URLs בקוד:
  - OG meta tags
  - Sitemap
  - Canonical URL
  - Share links
  - Profile page links

---

## 3. 🏪 הכנה ל-App Store (כשתהיה מוכן)

### מה צריך:
- [ ] 3 screenshots של המשחק (1290×2796 px — iPhone 15 Pro Max)
- [ ] 1 screenshot landscape (2796×1290 px)
- [ ] אייקון 1024×1024 px (כבר יש לך icon-512.png — צריך לעשות פי 2)
- [ ] תיאור קצר (30 מילים): "BLOOM — משחק מיזוג ממכר בעברית! מזג אריחים, גלה 8 דרגות, הגע לכתר."
- [ ] תיאור ארוך (4000 תווים)
- [ ] קטגוריה: Games → Puzzle
- [ ] מילות מפתח: bloom, משחק מיזוג, merge game, suika, puzzle

### איפה להגיש:
- **iOS (PWA):** Apple לא מאפשר PWA ב-App Store ישירות. צריך Capacitor wrap (עבודת קוד — אעשה כשתרצה)
- **Google Play (TWA):** אפשר להעלות PWA כ-TWA (Trusted Web Activity). צריך חשבון מפתח Google Play ($25 חד פעמי)

---

## סיכום — מה לעשות עכשיו:

| עדיפות | משימה | זמן |
|--------|-------|-----|
| 🔴 | GA4 — הגדר `GA_ID` ב-Railway | 5 דק' |
| 🟡 | דומיין — קנה והגדר | 15 דק' |
| 🟢 | App Store — הכן screenshots | כשתהיה מוכן |

---

*עודכן: מאי 2026*
