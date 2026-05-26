# 📋 משימות ידניות — BLOOM

כל מה שאתה צריך לעשות ידנית. הקוד כבר מוכן לכל הפריטים האלה.

---

## ✅ 1. Google Analytics — כבר מופעל

**Measurement ID:** `G-KTRD0NCTX8` (property: `bloom-game`)

ה-gtag.js נטען ישירות מ-[public/index.html](../../public/index.html) בכל פתיחה של דף. כל קריאות `trackEvent()` בקוד שולחות אירועים אמיתיים ל-GA4: `game_start`, `game_over`, `contest_join`, `challenge_enter`, `tutorial_complete`, `share`, `daily_login_claimed`, `level_up`, `purchase`.

**איפה לראות:** https://analytics.google.com → Property "bloom-game" → Realtime
**אומת לייב:** 26/05/2026 — `G-KTRD0NCTX8` חי במקור ה-HTML של ה-production.

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

## 4. 🚨 ERROR_WEBHOOK — התראות crash (אופציונלי, 3 דקות)

### מה זה נותן:
כשה-server קורס או נופל → הודעה מיידית ב-Discord/Slack/WhatsApp. בלי זה — אתה לומד על קריסה רק כששחקן מתלונן.

הקוד כבר מחובר ב-[server.js](../../server.js): `unhandledRejection` + `uncaughtException` שולחים POST ל-URL מה-env var `ERROR_WEBHOOK`. אם לא מוגדר — לוג בלבד.

### הכי קל — Discord webhook (3 דקות):
1. אם אין חשבון Discord: https://discord.com → Register
2. פתח Discord → צור Server פרטי (Server → Create My Own → For me and my friends)
3. לחץ ימני על ערוץ #general → **Edit Channel** → **Integrations** → **Create Webhook**
4. שם: `BLOOM Alerts` · **Copy Webhook URL**
5. שלח לי את ה-URL ואני אגדיר ב-Railway אוטומטית — או הוסף בעצמך:
   ```
   Railway → bloom-web → Variables → New Variable
   Key: ERROR_WEBHOOK
   Value: https://discord.com/api/webhooks/...
   ```

### חלופה — Slack webhook:
https://api.slack.com/messaging/webhooks → Create app → Incoming Webhooks → Add to Channel → Copy URL.

---

## 5. 💳 Stripe IAP — שילוב תשלום אמיתי (כשתהיה מוכן למוניטיזציה)

### מה זה נותן:
שחקנים יוכלו לקנות בכסף אמיתי (USD/ILS) — premium battle pass, gem packs, VIP, real-money cosmetic skins. הקוד הנוכחי הכל gems-only. צריך 3-4 ימי עבודה משולבת.

### מה צריך ממך לפני שאני אתחיל:
1. **חשבון Stripe** (https://dashboard.stripe.com) — verify business identity (15 דק' + 24h אישור).
2. **חשבון בנק עסקי בישראל** — Stripe ישראל דורש הוכחת זהות עסקית.
3. **מע"מ ID + ע.ע.מ.** — לחשבוניות אוטומטיות.
4. **תקנון משחק + מדיניות החזרים** — חוקי הגנת הצרכן IL דורשים תקופת ביטול 14 יום.

### מה אני אבנה אחרי שתאשר:
- `POST /api/iap/checkout` עם `priceId` מאושר → Stripe Checkout session → webhook → atomic gem credit + entitlement.
- `POST /webhooks/stripe` עם signature verification.
- Admin: dashboard מכירות יומי/חודשי, refund tooling, dispute alerts.
- Client: 2 כפתורי תשלום ליד כל "buy with gems" (USD path + ILS path).

### עדיפות:
לא דחוף. עדיף לקבל קודם 100-200 שחקנים אמיתיים עם נתוני retention טובים (>40% D1, >20% D7) — אז המוניטיזציה הופכת ל-ROI חיובי. בלי משתמשים אין מה למנטז.

---

## 6. 🏆 VIP Subscription ($4.99/חודש) — אחרי Stripe

תוכנית חודשית עם ×2 daily login, ×3 quest rewards, exclusive skin pack, ad-free, חודש בחינם בהזמנה ראשונה. MRR יציב.

---

## 7. 🎨 Real-Money Cosmetic Shop — אחרי Stripe

חנות סקינים פרימיום שמשלמים ב-$ ישירות (לא דרך gems). Targeting collectors. רווח גבוה (60-80% margin).

---

## 8. 💰 Wager / Real-Money Tournaments — דרושה הסמכה משפטית

טורנירים ב-$1 entry, 70% prize pool. דורש:
- אישור משפטי שזה לא "הימור" לפי חוק ההגרלות והמשחקים האסורים (ישראל).
- בד"כ skill-based exemption — אבל צריך עורך דין שיאשר.
- KYC לזוכים מעל ₪200.

---

## סיכום — מה לעשות עכשיו:

| עדיפות | משימה | זמן | סטטוס |
|--------|-------|-----|-------|
| ✅ | GA4 | — | כבר עובד (G-KTRD0NCTX8) |
| 🟡 | ERROR_WEBHOOK | 3 דק' | ממתין ל-URL ממך |
| 🟡 | דומיין | 15 דק' | ממתין |
| 🟢 | Stripe IAP | 3-4 ימים | ממתין לאישור עסקי |
| 🟢 | VIP / Cosmetic Shop | יום | אחרי Stripe |
| 🟢 | Wager Tournaments | יום + ייעוץ משפטי | אחרי Stripe |
| 🟢 | App Store screenshots | יום | כשתהיה מוכן |

---

*עודכן: 26/05/2026 — סוקר אוטומטית: GA4 פעיל, orphan DBs נמחקו, Issue Tracker חי.*
