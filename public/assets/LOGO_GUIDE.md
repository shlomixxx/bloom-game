# BLOOM Logo — מדריך הטמעה

## הקבצים שיצרתי לך

```
bloom-logo/
├── icon-1024.png + .svg      ← אייקון אפליקציה לחנויות
├── icon-512.png + .svg       ← PWA גדול
├── icon-192.png + .svg       ← PWA קטן
├── apple-touch-icon.png      ← iOS (180×180)
├── favicon.svg               ← Favicon וקטורי
├── favicon-32.png            ← Favicon לדפדפן
├── favicon-16.png            ← Favicon זעיר
├── logo-horizontal-light.png ← לוגו אופקי לרקע בהיר
├── logo-horizontal-dark.png  ← לוגו אופקי לרקע כהה
└── social-share.png          ← תמונה לוואטסאפ/פייסבוק (1200×630)
```

יש גם גרסאות SVG מקבילות לעריכה עתידית.

---

## שלב 1 — העברת הקבצים לפרויקט

תיצור תיקיה חדשה `assets/` בתוך `public/`:

```
public/
├── index.html
├── bloom-music.mp3
├── bloom-music-lobby.mp3
├── bloom-music-fail.mp3
├── manifest.json              ← נוסיף בשלב 2
└── assets/                    ← תיקיה חדשה
    ├── icon-512.png
    ├── icon-192.png
    ├── apple-touch-icon.png
    ├── favicon-32.png
    ├── favicon-16.png
    ├── favicon.svg
    ├── logo-horizontal-light.png
    └── social-share.png
```

`icon-1024.png` שמור במחשב שלך — תשתמש בו רק כשתעלה לחנות אפליקציות (App Store / Google Play). הוא לא צריך להיות באתר.

---

## שלב 2 — יצירת `manifest.json`

תיצור קובץ חדש בשם `manifest.json` בתוך `public/`:

```json
{
  "name": "BLOOM",
  "short_name": "BLOOM",
  "description": "משחק מיזוג בעברית",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#F5F5F0",
  "theme_color": "#FFF1D6",
  "orientation": "portrait",
  "lang": "he",
  "dir": "rtl",
  "icons": [
    {
      "src": "/assets/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/assets/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    }
  ]
}
```

הקובץ הזה הופך את BLOOM ל-PWA — אנשים יוכלו ללחוץ "הוסף למסך הבית" באנדרואיד ולקבל את האייקון שלך כאפליקציה.

---

## שלב 3 — עדכון `public/index.html`

ב-`<head>` של ה-HTML הקיים שלך, **תוסיף את הבלוק הבא** (לפני סוף ה-`<head>`):

```html
<!-- Favicons -->
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png">

<!-- iOS Home Screen -->
<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">

<!-- Android Home Screen / PWA -->
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#FFF1D6">

<!-- Open Graph (WhatsApp, Facebook, LinkedIn preview) -->
<meta property="og:title" content="BLOOM — משחק מיזוג">
<meta property="og:description" content="מזג חפצים, גלה דרגות חדשות, והגע עד לכתר. שחק עכשיו בחינם.">
<meta property="og:image" content="https://YOUR_DOMAIN/assets/social-share.png">
<meta property="og:type" content="website">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="BLOOM — משחק מיזוג">
<meta name="twitter:description" content="מזג חפצים, גלה דרגות חדשות, והגע עד לכתר.">
<meta name="twitter:image" content="https://YOUR_DOMAIN/assets/social-share.png">
```

**חשוב!** במקום `YOUR_DOMAIN` תכניס את הכתובת האמיתית של האתר שלך ב-Railway, למשל:
```
https://bloom-production-1234.up.railway.app
```

---

## שלב 4 — וודא ש-Express מגיש את התיקיה

בקובץ `server.js` שלך כבר יש את השורה:

```javascript
app.use(express.static('public', { maxAge: '5m', extensions: ['html'] }));
```

**זה כבר עובד.** ה-`express.static('public')` מגיש את כל התיקיה כולל `assets/` ו-`manifest.json`. אין צורך לשנות שום דבר ב-`server.js`.

---

## שלב 5 — Deploy ל-Railway

```bash
git add public/assets/ public/manifest.json public/index.html
git commit -m "Add BLOOM logo and PWA support"
git push
```

Railway יפרוס תוך 1-2 דקות.

---

## איפה תראה את הלוגו אחרי הפריסה

| מקום | קובץ שמופיע | מי רואה |
|---|---|---|
| **טאב הדפדפן** | `favicon.svg` (וקטור) או `favicon-32.png` | כל מי שפותח באתר במחשב |
| **iPhone Home Screen** | `apple-touch-icon.png` | מי שעושה "Add to Home Screen" ב-Safari |
| **Android Home Screen** | `icon-192.png` / `icon-512.png` (דרך manifest) | מי שעושה "Add to Home Screen" ב-Chrome |
| **שיתוף בוואטסאפ** | `social-share.png` | כל מי שמקבל ממך לינק |
| **שיתוף בפייסבוק/לינקדאין** | `social-share.png` | אותו דבר |
| **App Store / Google Play** | `icon-1024.png` (כשתעלה) | משתמשי החנויות |

---

## בדיקה — איך לוודא שהכל עובד

### 1. טאב הדפדפן
תפתח את האתר במחשב. בטאב למעלה, ליד הכותרת — אמור להופיע הפאוויקון. אם אתה רואה אייקון של דפדפן ברירת מחדל, תרענן עם **`Cmd+Shift+R`** (Mac) או **`Ctrl+F5`** (Windows) — לפעמים הדפדפן מחזיק במטמון.

### 2. שיתוף בוואטסאפ
תפתח וואטסאפ במחשב או בטלפון. תשלח לעצמך את הלינק לאתר. אחרי 5-10 שניות, אמורה להופיע תצוגה מקדימה יפה עם:
- הלוגו של BLOOM
- הכותרת
- התיאור

**אם זה לא קורה:**
1. תוודא שעדכנת את `og:image` עם הדומיין הנכון (לא `YOUR_DOMAIN`)
2. תלך ל-[Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) ותדביק את הלינק שלך — זה ינקה את המטמון של פייסבוק
3. תמתין 10 דקות (לפעמים יש עיכוב)

### 3. הוסף למסך הבית
**iPhone (Safari):**
- תפתח את האתר → לחיצה על אייקון השיתוף (ריבוע עם חץ)
- "Add to Home Screen"
- אתה אמור לראות את האייקון הצבעוני שלך

**Android (Chrome):**
- תפתח את האתר → תפריט (3 נקודות) למעלה
- "Add to Home screen" / "Install app"
- אותו דבר

---

## אם יש משהו שלא עובד

**אם הפאוויקון לא מתעדכן בדפדפן:**
- תרענן עם הקאש (Cmd+Shift+R)
- תסגור את הדפדפן ותפתח מחדש
- אם זה עדיין לא — תפתח את האתר במצב גלישה פרטית (Incognito)

**אם וואטסאפ מציג את הלוגו הישן:**
- וואטסאפ שומר במטמון ל-24-48 שעות
- תוסיף `?v=2` לסוף ה-URL כדי לאלץ רענון: `https://yourdomain.com/?v=2`

**אם הלוגו מוצג קטן בטלפון:**
- בדוק שהוספת את `<meta name="theme-color" content="#FFF1D6">`
- וודא ש-manifest.json נטען נכון (בקונסול F12)

---

## הצעד הבא

אחרי שתעלה את הקבצים ותפרוס ל-Railway, תספר לי איך הלך. נוכל להתאים פרטים אם משהו לא ייראה בדיוק כמו שאתה רוצה.

ואחרי שזה יושב טוב — נמשיך לתחרות חברים (אם קלוד ב-Cursor סיים), או לפיצ'רים הבאים מה-ROADMAP.
