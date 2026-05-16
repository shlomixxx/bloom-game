# 🎯 BLOOM Events — תוכנית מחודדת

## עיקרון

אלמנט מיוחד מופיע על **תא ריק רנדומלי** בלוח, עם **טיימר מעגלי** שנספר אחורה.
השחקן צריך **להניח אריח על התא** לפני שהטיימר מסתיים.
אם הצליח → אפקט מיוחד + בונוס.
אם לא → האלמנט נעלם, הזדמנות הוחמצה.

---

## שליטת אדמין מלאה

### הגדרות כלליות

| מפתח | ברירת מחדל | תיאור |
|------|------------|-------|
| `events_enabled` | `true` | מתג ראשי — הפעלה/כיבוי של כל המערכת |
| `events_start_delay` | `30` | שניות מתחילת המשחק עד שה-event הראשון יכול להופיע |
| `events_min_gap` | `20` | שניות מינימום בין event ל-event |
| `events_max_gap` | `45` | שניות מקסימום בין event ל-event |
| `events_min_empty_cells` | `4` | מספר תאים ריקים מינימלי כדי ש-event יופיע |
| `events_max_active` | `1` | מקסימום events בו-זמנית על הלוח |

### הגדרות לכל Event

#### 💣 פצצה (Bomb)
| מפתח | ברירת מחדל | תיאור |
|------|------------|-------|
| `event_bomb_enabled` | `true` | הפעלה/כיבוי |
| `event_bomb_weight` | `25` | אחוז הסתברות (מתוך סה"כ ה-weights) |
| `event_bomb_timer` | `8` | שניות עד שנעלם |
| `event_bomb_radius` | `1` | רדיוס פיצוץ (1 = 4 שכנים, 2 = 12 תאים) |
| `event_bomb_points_per_tile` | `2000` | נקודות בונוס לכל אריח שפוצץ |

**מכניקה:**
- מופיע על תא ריק עם אייקון 💣 מהבהב
- טיימר מעגלי מתכווץ (8→0)
- שחקן מניח אריח על התא → פיצוץ!
- כל אריח בטווח radius נמחק מהלוח
- בונוס: (מספר אריחים שפוצצו) × points_per_tile
- אריחים שפוצצו נופלים (gravity) → אפשרות ל-chain reactions!
- אם הטיימר נגמר → 💣 נעלם בשקט

#### ⭐ כוכב זהב (Golden Star)
| מפתח | ברירת מחדל | תיאור |
|------|------------|-------|
| `event_star_enabled` | `true` | הפעלה/כיבוי |
| `event_star_weight` | `20` | אחוז הסתברות |
| `event_star_timer` | `6` | שניות |
| `event_star_upgrade` | `1` | כמה דרגות לקפוץ (+1 ברירת מחדל) |
| `event_star_points` | `500` | נקודות בונוס |

**מכניקה:**
- מופיע על תא ריק עם ⭐ מסתובב
- שחקן מניח אריח על התא
- האריח שהונח **מתקפיץ** דרגה: עלה→פרח, אש→ברק, יהלום→כתר!
- +500 נקודות
- אם האריח כבר כתר (MAX_TIER) → Crown Merge מיידי (אם crown_merge_enabled)
- אם הטיימר נגמר → ⭐ נעלם

#### 🔥 Fever (טירוף)
| מפתח | ברירת מחדל | תיאור |
|------|------------|-------|
| `event_fever_enabled` | `true` | הפעלה/כיבוי |
| `event_fever_weight` | `12` | אחוז הסתברות |
| `event_fever_timer` | `5` | שניות להפעלה |
| `event_fever_duration` | `10` | שניות של Fever פעיל |
| `event_fever_multiplier` | `3` | מכפיל ניקוד בזמן Fever |

**מכניקה:**
- מופיע על תא ריק עם 🔥 בוער
- שחקן מניח אריח → Fever Mode מופעל!
- למשך 10 שניות: כל מיזוג ×3 ניקוד
- מסגרת הלוח בוערת + countdown bar בראש
- מוזיקה מואצת (playback rate ×1.2)
- כשנגמר: צליל "cooldown" + חזרה לנורמלי

#### 🎁 מתנה (Gift Box)
| מפתח | ברירת מחדל | תיאור |
|------|------------|-------|
| `event_gift_enabled` | `true` | הפעלה/כיבוי |
| `event_gift_weight` | `25` | אחוז הסתברות |
| `event_gift_timer` | `10` | שניות (ארוך — פחות לחץ) |
| `event_gift_credits_min` | `5` | מינימום 💎 |
| `event_gift_credits_max` | `50` | מקסימום 💎 |
| `event_gift_jackpot_chance` | `5` | אחוז סיכוי ל-Jackpot |
| `event_gift_jackpot_amount` | `500` | כמות 💎 ב-Jackpot |

**מכניקה:**
- מופיע על תא ריק עם 🎁 מתנדנד
- שחקן מניח אריח → תיבה נפתחת!
- הגרלה:
  - 95%: בין 5-50 💎 (רנדומלי)
  - 5%: **JACKPOT!** 500 💎 + אנימציה מיוחדת
- טוסט מראה כמה זכה
- אם הטיימר נגמר → 🎁 נעלם

#### ❄️ הקפאה (Freeze)
| מפתח | ברירת מחדל | תיאור |
|------|------------|-------|
| `event_freeze_enabled` | `true` | הפעלה/כיבוי |
| `event_freeze_weight` | `8` | אחוז הסתברות |
| `event_freeze_timer` | `4` | שניות (קצר — דחוף!) |
| `event_freeze_clear_rows` | `1` | כמה שורות לנקות מלמעלה |
| `event_freeze_points` | `1000` | נקודות בונוס |
| `event_freeze_min_filled_rows` | `3` | מופיע רק כשיש X שורות מלאות |

**מכניקה:**
- מופיע **רק** כשהלוח כמעט מלא (≥3 שורות מלאות)
- אייקון ❄️ מהבהב מהר (דחוף!)
- שחקן מניח אריח → שורה עליונה נמחקת!
- אפקט קרח כחול + 1,000 נקודות
- **הצלת חיים** — מונע game-over
- אם הטיימר נגמר → ❄️ נעלם (אולי game-over...)

#### 🎯 מטרה (Target)
| מפתח | ברירת מחדל | תיאור |
|------|------------|-------|
| `event_target_enabled` | `true` | הפעלה/כיבוי |
| `event_target_weight` | `10` | אחוז הסתברות |
| `event_target_timer` | `12` | שניות (ארוך — צריך לתכנן) |
| `event_target_multiplier` | `5` | מכפיל ניקוד על המיזוג |

**מכניקה:**
- לא מופיע על תא — מסמן **דרגה ספציפית** בטייר-בר
- דרגה רנדומלית (2-6) מקבלת מסגרת זוהרת + טיימר
- שחקן צריך למזג 2 אריחים מהדרגה המסומנת תוך הזמן
- אם הצליח: ×5 ניקוד על המיזוג הזה
- אם לא: הסימון נעלם

---

## Spawn Algorithm

```
כל frame (60fps):
  1. אם events_enabled === false → דלג
  2. אם יש event פעיל על הלוח → דלג
  3. אם עברו פחות מ-events_start_delay שניות מתחילת המשחק → דלג
  4. אם עברו פחות מ-events_min_gap שניות מה-event האחרון → דלג
  5. אם תאים ריקים < events_min_empty_cells → דלג
  6. חשב זמן שעבר מה-event האחרון
  7. הסתברות = (זמן_שעבר - min_gap) / (max_gap - min_gap)
  8. אם random() < הסתברות → spawn event!
  
  Spawn:
  1. בחר סוג לפי weights (רק events שהם enabled)
  2. ❄️ Freeze: רק אם filled_rows >= min_filled_rows
  3. 🎯 Target: בחר דרגה רנדומלית (2-6) ← לא על התא, על הטייר-בר
  4. שאר: בחר תא ריק רנדומלי
  5. הצג event עם טיימר
```

### חישוב הסתברות (Weighted Random)

```
נניח:
  bomb_weight  = 25
  star_weight  = 20
  fever_weight = 12
  gift_weight  = 25
  freeze_weight = 8
  target_weight = 10
  ─────────────────
  סה"כ = 100

bomb:   25/100 = 25%
star:   20/100 = 20%
fever:  12/100 = 12%
gift:   25/100 = 25%
freeze:  8/100 =  8%
target: 10/100 = 10%
```

האדמין יכול לשנות את ה-weights כרצונו. 
למשל: `event_bomb_weight = 50` → פצצות יופיעו לעתים קרובות יותר.
`event_fever_weight = 0` → Fever לא יופיע לעולם.

---

## ויזואלי — Event על תא

```
  ┌─────────────┐
  │             │
  │     💣      │  אייקון גדול (24px), מהבהב
  │             │
  │  ┌───────┐  │  טיימר מעגלי (SVG circle)
  │  │ 5.2s  │  │  מתכווץ + משנה צבע (ירוק→צהוב→אדום)
  │  └───────┘  │
  │             │
  └─────────────┘
  
  צבעי טיימר:
  100%-50%: ירוק (#2E8B6F)
  50%-25%:  צהוב (#FAC775)
  25%-0%:   אדום (#C8472F) + מהבהב מהר
```

---

## תחרויות ודו-קרבות

- **Events פעילים בכל המצבים** (חופשי, יומי, תחרות, דו-קרב)
- באתגר יומי: **כל השחקנים מקבלים אותם events באותו זמן** (נקבע לפי ה-seed)
- בתחרות/דו-קרב: events מופיעים באותו רגע לשני השחקנים (fair)
- אדמין יכול לכבות events בתחרויות: `events_in_contests = true/false`

---

## סדר פיתוח

### Phase 1 — מנוע + 3 Events ראשונים
| # | משימה | מאמץ |
|---|--------|------|
| 1 | Event spawn engine (timer, random, weights) | בינוני |
| 2 | Event cell visual (icon + circular timer) | בינוני |
| 3 | Event trigger (detect tile placed on event cell) | קל |
| 4 | 💣 Bomb — clear radius + points | בינוני |
| 5 | ⭐ Star — upgrade tier +1 | קל |
| 6 | 🎁 Gift — random credits + jackpot | קל |
| 7 | Admin config keys (schema + /api/config) | קל |
| 8 | Event expire + cleanup | קל |

### Phase 2 — 3 Events נוספים
| # | משימה | מאמץ |
|---|--------|------|
| 9 | 🔥 Fever — multiplier mode + countdown bar | בינוני-גבוה |
| 10 | ❄️ Freeze — clear top row + condition check | בינוני |
| 11 | 🎯 Target — tier-bar highlight + detect merge | בינוני |

### Phase 3 — Polish
| # | משימה | מאמץ |
|---|--------|------|
| 12 | Sounds for each event | קל |
| 13 | Seed-based events for daily/contest mode | בינוני |
| 14 | Analytics tracking | קל |
