# 📋 BLOOM Tasks — קונבנציה

> **המקום היחיד למשימות.** שורש הפרויקט שמור ל-3 קבצים בלבד: `RESUME.md`, `CLAUDE.md`, `README.md`. כל השאר חי כאן.

---

## 🗂 מבנה התיקיה

```
tasks/
├── README.md          ← אתה כאן (הקובץ הזה — קונבנציה)
├── ACTIVE/            ← משימות בעבודה — Claude קורא אותם בכל סשן
└── ARCHIVE/           ← היסטוריה — Claude קורא רק אם מבקשים במפורש
```

---

## ✅ tasks/ACTIVE/ — המשימות החיות

קבצים שהן **המקור היחיד לאמת** למה שלא הושלם.

| קובץ | מה זה | מצב |
|---|---|---|
| **[BLOOM_TASKS.md](ACTIVE/BLOOM_TASKS.md)** | המסלול המקורי (audit) — 38 משימות, 8 שלבים | 34/38 (4 deferred) |
| **[FUTURE_TASKS.md](ACTIVE/FUTURE_TASKS.md)** | באקלוג A1-A10 + monetization legacy | 10/10 pure-addiction ✓ |
| **[MONETIZATION_TASKS.md](ACTIVE/MONETIZATION_TASKS.md)** | תכנית 7 שלבים M1-M7 (Self-Promo + Stripe + VIP) | M1 ✓ · M2-M7 פתוחים |
| **[MANUAL_TASKS.md](ACTIVE/MANUAL_TASKS.md)** | מה המשתמש צריך לעשות ידנית (GA4 / Stripe / domain) | תלוי במשתמש |

---

## 🗄 tasks/ARCHIVE/ — היסטוריה

מסמכים שכבר נסגרו או שולבו במסמך אחר. Claude **לא** קורא אותם אוטומטית — אבל הם שמורים לרפרנס אם נדרש לחזור לתכנון מקורי.

הקבצים: `ROADMAP_1.md`, `ADDICTION_ROADMAP.md`, `ADMIN_ROADMAP.md`, `AUDIT_REPORT.md`, `BLOOM_AURORA_INSTALL.md`, `BLOOM_DYNAMIC_BOARDS.md`, `BLOOM_FULL_AUDIT.md`, `BLOOM_MONETIZATION_ROADMAP.md`, `CLAUDE_INSTRUCTIONS.md`, `CONTEST_TASKS.md`, `HOME_AUDIT.md`, `RAILWAY_SETUP.md`, `_START_HERE.md`, `ACCESS.md`.

---

## ➕ איך להוסיף קובץ משימות חדש

### אם זה תכנית חדשה שאתה רוצה שאעבד עליה:

1. **שם הקובץ**: `<DOMAIN>_TASKS.md` (לדוגמה: `MARKETING_TASKS.md` / `SEO_TASKS.md` / `LEGAL_TASKS.md`)
2. **מיקום**: `tasks/ACTIVE/<DOMAIN>_TASKS.md`
3. **פורמט מומלץ** (אבל לא חובה):
   ```markdown
   # 🎯 <DOMAIN>_TASKS.md — כותרת ברורה

   > עדכון אחרון: YYYY-MM-DD · X/Y הושלמו

   ## פאזה 1 — שם
   - [ ] T1.1 — תיאור משימה (~זמן עבודה)
   - [x] T1.2 — משימה שכבר נסגרה

   ## פאזה 2 — שם
   ...
   ```

4. **תגיד לי**: "תוסיף את הקובץ tasks/ACTIVE/X_TASKS.md ל-RESUME.md" — ואני אעדכן את הרשימה הראשית כך שאדע איפה למצוא אותו בכל סשן עתידי.

### אם זה משימה אד-הוק (לא דורש קובץ נפרד):

פשוט תגיד לי — ואני אכניס אותה ל-MONETIZATION_TASKS.md / FUTURE_TASKS.md אם היא שייכת לאחד מהם, או אפתח קובץ חדש לפי הצורך.

---

## 🚦 כללי הקריאה של Claude (זה מה שאני עושה אוטומטית)

בכל סשן חדש אני קורא ב-**סדר הזה**:

1. **`RESUME.md`** (שורש) — תמונת מצב של 30 שניות
2. **`CLAUDE.md`** §0 — Stages Tracker (היסטוריה של 49 שלבים)
3. **`tasks/ACTIVE/*.md`** — כל הקבצים בתיקיה הזאת
4. אם משימה מתייחסת ל-archive — אז `tasks/ARCHIVE/<file>` לפי הצורך

**מה זה אומר עבורך**: אם תיצור קובץ ב-`tasks/ACTIVE/` ותגיד לי שמו, אני אטמיע אותו אוטומטית בכל הסשנים הבאים.

---

## 📤 איך לסגור משימה

כשמשימה נגמרת לחלוטין (כל הסעיפים הושלמו):

**אפשרות א'** (מומלץ): השאר את הקובץ ב-`ACTIVE/` עם הערה ✅ הושלם בכותרת + עדכן את `RESUME.md`. ככה תראה את ההיסטוריה שלך.

**אפשרות ב'**: העבר ל-`ARCHIVE/` עם `git mv tasks/ACTIVE/X.md tasks/ARCHIVE/X.md`. שורש "ACTIVE" נקי יותר.

תגיד לי איך אתה רוצה — אני אעשה את זה.
