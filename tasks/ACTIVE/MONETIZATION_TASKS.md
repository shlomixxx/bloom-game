# 💰 BLOOM — מסלול מוניטיזציה

> **המטרה**: להפוך את BLOOM ממשחק חינמי-בלבד לאקוסיסטם הכנסות מלא — בלי פגיעה ב-F2P retention שכבר נבנה.
>
> **2 מסלולי הכנסה במקביל**:
> 1. **Self-Promo** (M1) — פרסומות פנימיות במקום AdSense → דחיפת המוצרים שלנו → הכנסה דרך 💎
> 2. **Real-Money Buy** (M2-M3) — לכל מה שהיום נקנה ב-💎 אפשר לקנות גם בכרטיס אשראי
>
> עדכון: 2026-05-25

---

## 📊 מצב עכשיו

**כבר נבנה**: 48 פיצ'רים חיים, כולל מערכת gems שלמה (earn + spend + balance), חנות סקינים, Daily Deals, Starter Pack, Bundles, Gacha, Battle Pass Free+Premium, Boosters.

**כל המוצרים שכבר נמכרים ב-💎**:
- 🎨 סקינים (200-500💎)
- 🛒 Starter Pack (500💎 → שווה 2400💎)
- 🔥 Daily Deals (50-800💎)
- 🎁 Bundles עונתיים (600-1200💎)
- 🎰 Gacha pulls (100💎 single / 900💎 ×10)
- ✨ Battle Pass Premium (1500💎)
- 🎯/💥 Boosters (40-50💎)
- 🛡 Streak Freeze (200💎)
- 📦 Bonus Chest (100💎)

**מה חסר**: כולם מסתמכים על gems. שחקן צריך לצבור גמרי לפני שיכול לקנות. לא דורש כסף אמיתי.

---

## 🎯 PHASE M1 — Self-Promo Engine

**מאמץ**: ~90 דקות · **השפעה**: ★★★★ · **תלות**: 0 · **ROI מיידי**

החליפה ישירה ל-AdSense. במקום פרסומות צד-שלישי שמשלמות ₪4 לאלף הצגות, נדחוף את **המוצרים שלנו** בכל "ad slot".

### תכולה
- [ ] **M1.1** Schema: `internal_promos` table (id, kind, title, body, cta_text, target_url, image_emoji, level_min, level_max, weight, starts_at, ends_at, is_enabled) + `promo_impressions` + `promo_clicks`
- [ ] **M1.2** Server: `GET /api/promo/next?slot=X&deviceId=Y` — smart targeting לפי level + מה שכבר קנה + slot-cooldown
- [ ] **M1.3** Server: `POST /api/promo/impression` + `POST /api/promo/click` — tracking
- [ ] **M1.4** Client: החלפת ה-`simulateAdWatch` UI — promo card במקום black-screen של 3 שניות
- [ ] **M1.5** 6 promos seeded by default (Starter Pack / Daily Deal / Skin / Gacha / Battle Pass / Premium Gem Pack)
- [ ] **M1.6** Targeting rules — לא להציג Starter Pack למי שכבר קנה, לא להציג Premium BP למי שכבר VIP, וכו'
- [ ] **M1.7** Admin panel: section חדש "📢 פרסומות פנימיות" עם CRUD + סטטיסטיקות (impressions / clicks / CTR / conversion)
- [ ] **M1.8** Slot-cooldown: לא לחזור על אותו promo יותר מפעם בשעה (per device)

### למה זה ROI מיידי
- אפס תלות חיצונית
- לא דורש דומיין / Stripe / שום דבר חיצוני
- מתחיל לעבוד מיד עם השחקנים הקיימים
- כל קליק יכול להוביל לרכישת gems שכבר עובדת

---

## 💳 PHASE M2 — Stripe IAP Foundation

**מאמץ**: ~3-4 שעות + 30 דקות user-action · **השפעה**: ★★★★★ · **תלות**: בעל BLOOM חייב לפתוח Stripe account

### תכולה
- [ ] **M2.1** *User action*: פתיחת חשבון Stripe ב-stripe.com (דרושים: שם עסק / ת.ז / חשבון בנק / תיאור עסק). זמן: ~30 דק'.
- [ ] **M2.2** *User action*: קבלת `STRIPE_PUBLISHABLE_KEY` + `STRIPE_SECRET_KEY` (Test mode) → הגדרה ב-Railway env vars
- [ ] **M2.3** Schema: `rm_products` (id, slug, kind, gem_equivalent, price_usd, price_ils, stripe_price_id) + `rm_payments` (id, device_id, product_slug, amount, currency, stripe_payment_intent_id, status, granted_at)
- [ ] **M2.4** Server: install `stripe` npm package (first new dependency since web-push). Webhook handler at `/api/webhooks/stripe`
- [ ] **M2.5** Server: `POST /api/rm/create-checkout-session` — יוצר Stripe Checkout Session, מחזיר session URL
- [ ] **M2.6** Server: `POST /api/webhooks/stripe` — מקבל events (`checkout.session.completed`, `payment_intent.succeeded`), מעניק את המוצר אטומית, idempotent dedup
- [ ] **M2.7** Client: helper `purchaseWithCard(productSlug)` שפותח Stripe Checkout
- [ ] **M2.8** Test mode validation: Stripe מספק כרטיסי-בדיקה. בדיקה של 4-5 רכישות סוף-לסוף

### מה user צריך לעשות
1. כניסה ל-[stripe.com](https://stripe.com), Sign up
2. מילוי business details (אפשר גם personal — Israeli sole proprietor)
3. צירוף חשבון בנק לpayouts
4. אישור email
5. העתקת 2 API keys → שליחה ל-Claude

---

## 🛍 PHASE M3 — RM Per-Product Wiring

**מאמץ**: ~4-6 שעות · **תלות**: M2

**העיקרון**: לכל product שכבר נקנה ב-💎, הוסף **2 כפתורי קנייה**:
- 💎 X gems (הקיים)
- 💳 $Y / ₪Z (חדש, דרך Stripe)

### תכולה לפי מוצר
- [ ] **M3.1** סקינים — כל סקין מקבל מחיר $ (Aurora $4.99, Classic-Plus $1.99, וכו')
- [ ] **M3.2** Gem Packs (חדש לגמרי) — חבילות 💎: $0.99 → 100💎, $4.99 → 600💎, $9.99 → 1400💎, $19.99 → 3000💎
- [ ] **M3.3** Daily Deals — כל deal מקבל $ alternative (~50% של ערך ה-💎)
- [ ] **M3.4** Starter Pack — $4.99 במקום 500💎 (אופציה במקום, או נוסף — להחליט)
- [ ] **M3.5** Bundles עונתיים — $4.99-$14.99 בהתאם
- [ ] **M3.6** Gacha — $0.99 single pull / $7.99 10x pull
- [ ] **M3.7** Battle Pass Premium — $4.99 instead of 1500💎
- [ ] **M3.8** Boosters — נשארים gems-only (קטנים מכדי להצדיק transaction fee)

### כללי תמחור
- מינימום transaction: $0.99 (כי Stripe לוקח $0.30 + 2.9%)
- ערך per dollar: $1 ≈ 100💎 (כלל אצבע F2P)
- "premium discount": רכישה ב-$ נותנת ~20% יותר ערך מערך ה-💎 השקול → מעודד RM

---

## ⚖️ PHASE M4 — Legal + Tax + Polish

**מאמץ**: ~2-3 שעות · **תלות**: M2 (Stripe קיים)

### תכולה
- [ ] **M4.1** Terms of Service בעברית — מסמך פשוט (אפשר template)
- [ ] **M4.2** Privacy Policy updates — להזכיר ש-Stripe מעבד תשלומים, אנחנו לא שומרים פרטי כרטיס
- [ ] **M4.3** Refund Policy — מדיניות החזרים (סטנדרט: לא ניתן להחזיר digital goods שכבר נצרכו)
- [ ] **M4.4** VAT — Stripe Tax מטפל אוטומטית בVAT ישראלי 17%. צריך הפעלה ב-Stripe dashboard
- [ ] **M4.5** Footer links — קישורים לToS + Privacy + Refund בכל מסך עם רכישה
- [ ] **M4.6** Email confirmations — Stripe שולח אוטומטית, אבל עדיף custom template

### Compliance
- ⚠ Israeli law דורש הצגת מע"מ במחיר. ב-Stripe Tax זה אוטומטי
- ⚠ אם תעבור $20K/שנה הכנסות → דווח למס הכנסה כעוסק עצמאי
- ✅ אין צורך באישור משחקים (BLOOM = puzzle, לא הימורים)

---

## 🎨 PHASE M5 — Self-Promo + RM Integration

**מאמץ**: ~2 שעות · **תלות**: M1 + M3

המיזוג של 2 ה-systems. אחרי M1 הpromos דוחפים רכישת gems. אחרי M3 הם דוחפים גם RM ישיר.

### תכולה
- [ ] **M5.1** Promo schema: הוסף `cta_kind` ENUM (gem_purchase / rm_purchase / skin_trial / external_link)
- [ ] **M5.2** Promo cards מציגים **שני כפתורים**: "💎 500" + "💳 $4.99"
- [ ] **M5.3** A/B test: 50% מהשחקנים רואים רק 💎, 50% רואים גם 💳 → איזה ROI גבוה
- [ ] **M5.4** Track per-promo: gems_revenue / rm_revenue / total_revenue
- [ ] **M5.5** Admin: "Top performing promos" view

---

## 🔄 PHASE M6 — VIP Subscription

**מאמץ**: ~3-4 שעות · **תלות**: M2

הכנסה חוזרת חודשית — הכי יציבה ב-F2P.

### תכולה
- [ ] **M6.1** Stripe Products: VIP Bronze ($1.99/mo), VIP Silver ($4.99/mo), VIP Gold ($9.99/mo)
- [ ] **M6.2** Per-tier benefits:
  - Bronze: 2x daily login, ad-free, exclusive skin
  - Silver: + 5x daily login, free 1 booster/day, monthly skin
  - Gold: + 10x daily login, free 3 boosters/day, monthly bundle, VIP badge
- [ ] **M6.3** Server: `POST /api/rm/subscribe` — Stripe Subscriptions API
- [ ] **M6.4** Webhook handlers: `customer.subscription.created/updated/deleted`
- [ ] **M6.5** Player profile: `vip_tier` column + benefits-evaluator helper
- [ ] **M6.6** Home tile "👑 VIP" — מציג benefits + countdown לrenewal
- [ ] **M6.7** Cancellation flow — שחקן יכול לבטל מ-account settings

---

## 📈 PHASE M7 — Analytics & Optimization

**מאמץ**: ~2-3 שעות · **תלות**: M2-M3 חיים

### תכולה
- [ ] **M7.1** Admin dashboard: "💰 Revenue" section
  - הכנסה היומית/שבועית/חודשית
  - ARPU (Average Revenue Per User)
  - ARPPU (Average Revenue Per Paying User)
  - Top-spending players
  - Conversion funnel: visit → game → first purchase
- [ ] **M7.2** Per-product breakdown: גרף של "מי מוכר הכי הרבה"
- [ ] **M7.3** Cohort analysis: F2P vs spenders — D1/D7/D30
- [ ] **M7.4** Webhook for big-spenders: push לאדמין כשמישהו רוכש מעל $50
- [ ] **M7.5** GA4 enhanced events: `purchase`, `add_to_cart`, `begin_checkout`

---

## 🚫 OUT OF SCOPE (לא בוונה הנוכחית)

- Wager/RM tournaments — דורש legal certification של ממשלה. דוחים לעתיד.
- Cryptocurrency payments — קומפליקציה מיותרת.
- In-game advertising מצדדים שלישיים — הוחלף ע"י M1.
- App Store / Play Store IAP — דורש native wrapper. אחרי M1-M3.

---

## 📊 הקצב המומלץ

| Phase | זמן עבודה | תלות | סדר עדיפויות |
|-------|----------|------|---------------|
| **M1** | 90 דק' | אפס | **עכשיו** — אפס תלות, ROI מיידי |
| M2 | 4-5 שעות + user action | Stripe account | אחרי M1 |
| M3 | 5-7 שעות | M2 | אחרי M2 — לפי product priority |
| M4 | 3 שעות | M2 | במקביל ל-M3 |
| M5 | 2 שעות | M1 + M3 | אחרי M3 |
| M6 | 4 שעות | M2 | אחרי M3 — אופציונלי |
| M7 | 3 שעות | M2-M3 חיים | בסוף, אחרי שיש נתונים |

**סה"כ זמן עבודה**: ~25-30 שעות (פרוס על מספר שבועות)
**ROI צפוי**: ARPU $0.50-$2 (תעשיית puzzle F2P) → 1000 DAU = $500-$2000/חודש

---

*קובץ זה נכתב ב-25.05.2026. עדכן עם כל phase שהושלם.*
