# 🛠 BLOOM Admin — משימות לשליטה מלאה ומניעת נטישה

> **🎯 מטרת-על**: המנהל יוכל לראות כל שחקן, להבין מה הוא מרגיש עכשיו, ולפעול במהירות כדי שלא ינשור.
>
> כל משימה בקובץ הזה מכוונת לאחד מהשלושה:
> 1. **ראות (Visibility)** — להבין מה קורה לשחקן ספציפי / לכלל / לשרת
> 2. **התערבות (Intervention)** — להיות מסוגל לעזור לשחקן בזמן אמת (מתנה, דחיפה, איפוס, בן)
> 3. **חיזוי נטישה (Churn Prevention)** — לזהות שחקן בסיכון *לפני* שהוא נעלם
>
> 📎 רקע: 48 stages נבנו, אבל לאדמין יש בקרה רק על ~70% מהם. אין drill-down לשחקן בודד, אין רשימת "שחקנים בסיכון נטישה", ואי-אפשר לשלוח פוש לשחקן אחד.

---

## PHASE A — Per-Player Drill-Down (קריטי, ~4 ימים)
> 🎯 בלי זה אי אפשר להבין שום שחקן בודד. זה הדבר הכי חשוב.
> 💡 **למה זה ממכר**: אדמין שרואה ש-"דניאל שיחק 8 ימים ברצף, הרצף נגמר היום ב-23:59" יכול לשלוח פוש מותאם → מציל 5-10% מהנושרים.

- [ ] **TA.1** — Backend: `GET /admin/api/player/:id/profile` (מאוחד)
  - Endpoint יחיד שמחזיר את כל המידע על שחקן ב-one shot (cache 60s)
  - בסיסי: `display_name`, `player_code`, `country`, `device_id`, `created_at`, `last_seen`, `level`, `xp`, `total_games`
  - מטבעות: `balance`, `total_earned`, `bank_deposited`, `bank_interest_paid`
  - תחרותי: `trophies`, `current_arena`, `bp_tier`, `bp_premium`, `league_tier`, `lifetime_xp`, `prestige_count`, `friends_count`, `guild_id+role+contribution`
  - Streaks: `daily_streak`, `dyn_streak`, `freezes_owned`, `streak_expires_at`
  - Engagement: `last_play_at`, `days_inactive`, `games_this_week`, `at_risk_flags[]` (מחושב מקומית — ראה TC.1)
  - Content: `achievements_unlocked[]`, `album_pct`, `owned_skins[]`, `pet_level+mood+last_fed`, `gacha_pulls_total`, `spin_streak`
  - Activity tail: `last_5_games[]` (mode/score/board/time), `recent_duels[]` (last 5), `recent_chests[]`
  - Risk: `cheat_flags[]`, `login_history[]` (last 10 IPs), `is_vip`, `is_banned`, `ban_reason`, `ban_until`
  - JOIN 18-20 tables אבל cache 60s + index lookup. אסור לחרוג מ-300ms p95.

- [ ] **TA.2** — Frontend: מודאל drill-down מלא ב-tab `👥 שחקנים`
  - לחיצה על שורה ברשימת השחקנים → modal `.admin-player-modal` רחב (700px)
  - 5 tabs פנימיים: `🪪 פרופיל` / `💎 כלכלה` / `🏆 תחרותי` / `🎁 תוכן` / `📊 היסטוריה`
  - Hero section עליון: שם, BLOOM-XXXX, country flag, level badge, "🟢 פעיל לפני 4 דק'" / "🔴 לא היה כאן 8 ימים"
  - אם at-risk_flags לא ריק → באנר אדום מהבהב למעלה: `⚠ בסיכון נטישה: הרצף נגמר ב-22:14 והוא לא שיחק היום`
  - תחתית המודאל: 8 כפתורי action מהירים (TA.3)
  - Dark theme support מלא

- [ ] **TA.3** — Quick-actions toolbar בתחתית המודאל
  - `🎁 מתנת מטבעות` (כבר קיים בנפרד — להעביר לתוך המודאל)
  - `📤 שלח פוש אישי` → TB.1
  - `🛡 הקפא רצף 24ש` → TB.2
  - `🏆 הענק תרופים` (input + confirm) → TB.3
  - `🎖 קדם דרגת BP` (input N tiers) → TB.4
  - `🚫 בן / שחרר` → TB.5
  - `🚩 דגל כצ'יטר / הסר` → TB.6
  - `👁 הצג היסטוריית audit` → modal עם כל ה-admin_actions עליו

- [ ] **TA.4** — חיפוש משופר ב-`👥 שחקנים`
  - הוסף filter pills מעל הטבלה: `🔴 בסיכון נטישה` / `🟢 פעיל היום` / `💰 ויי-איי-פי` / `🚩 חשוד בצ'יט` / `🔒 בנים`
  - הוסף sort: `🕐 אחרון לשחק` / `📅 הצטרף לאחרונה` / `🏆 הכי הרבה תרופים` / `💎 הכי הרבה מטבעות`
  - הוסף column "סטטוס" בטבלה: 🟢/🟡/🔴 חיווי בריאות
  - Export CSV הוקטן: הוא כבר קיים, רק להוסיף את ה-filtered subset

---

## PHASE B — Per-Player Actions Toolkit (~5 ימים)
> 🎯 לאחר שרואים את השחקן, חייבים להיות מסוגלים לעזור לו.
> 💡 **למה זה ממכר**: שחקן שמשפיע "אדמין שלח לי 200💎ב-WhatsApp הציל את הרצף שלי" → הוא נשאר שנים. זה התופעה בשם "personal touch".

- [ ] **TB.1** — Personal Push Notification (שחקן בודד, לא broadcast)
  - `POST /admin/api/push/personal/:device_id` עם `{title, body, url, requireInteraction}`
  - Server: בודק שיש `push_subscriptions` row פעיל, שולח דרך `sendPushToDevice` (כבר קיים)
  - Frontend: כפתור `📤 שלח פוש אישי` במודאל הדריל-דאון → form עם templates: 🛡 "הרצף שלך מסתיים בעוד 4ש" / 👋 "ברוך שובך! יש לך 200💎 מתנה" / 🏆 "טורניר חדש מתחיל ב-20:00"
  - Audit log חובה: action_type='personal_push', target=device_id, body
  - Rate-limit: 10 פושים אישיים לאדמין בשעה (כדי לא להציף)

- [ ] **TB.2** — Streak Management (איפוס / הקפאה / הארכה)
  - `POST /admin/api/player/:id/streak` עם `{action: 'reset'|'freeze'|'extend', days?: N}`
  - Server: עדכן `player_profiles.streak_count`, `streak_last_at`, `freezes_owned` באטומית
  - תכלית: שחקן שהיה ברצף 60 ימים ובאמת לא יכול היה לשחק יום אחד (חתונה, מילואים) — האדמין מציל לו את הרצף ידנית
  - Frontend: `🛡 הקפא רצף 24ש` / `➕ הוסף N ימים` / `🔄 איפוס מלא`
  - Audit log חובה

- [ ] **TB.3** — Grant/Reset Trophies
  - `POST /admin/api/player/:id/trophies` עם `{delta: ±N, reason}`
  - Server: עדכן `player_trophies` באטומית, אל תיגע ב-`trophies_lifetime`, `highest_trophies`
  - Frontend: input N + reason + confirm
  - שימוש: שחקן שאיבד תרופים בגלל באג → אדמין מחזיר. שחקן שזיהינו צ'יטר → אדמין מוריד.

- [ ] **TB.4** — Grant XP / BP Tier / Lifetime XP / Pet XP / Achievement / Skin
  - Endpoint יחיד `POST /admin/api/player/:id/grant` עם `{type: 'xp'|'bp_tier'|'lifetime_xp'|'pet_xp'|'achievement'|'skin', amount?, id?, reason}`
  - Server: switch לפי type, אטומי בכל אחד
  - Frontend: dropdown של ה-type + שדה דינמי לפי הבחירה
  - Allowlist על type כדי שצ'יטר לא ימציא type חדש

- [ ] **TB.5** — Ban / Unban / Shadow-ban
  - Schema: `ALTER TABLE player_profiles ADD COLUMN banned_at TIMESTAMPTZ, ban_reason TEXT, ban_until TIMESTAMPTZ, shadow_banned BOOLEAN DEFAULT FALSE`
  - `POST /admin/api/player/:id/ban` עם `{type: 'hard'|'shadow', reason, untilDays?}`
  - Server: עדכן עמודות, וכל middleware קיים (`requireDeviceAuth`) צריך לחזיר 403 על `banned_at IS NOT NULL` (hard) או לאפשר אבל לא לכתוב ל-DB (shadow)
  - **Shadow ban**: השחקן רואה ממשק רגיל אבל הציון שלו לא נספר ב-leaderboards, ה-friends שלו לא רואים אותו, פושים לא מגיעים. הוא חושב שהמשחק שלו רגיל.
  - Frontend: כפתור 🚫 עם dropdown סוג בן + שדה סיבה + diferences confirm

- [ ] **TB.6** — Cheat Flag (manual + automatic)
  - Schema: `cheat_reports` table — `(id, device_id, detector, severity 'low'|'med'|'high'|'critical', details JSONB, created_at, reviewed_by, action_taken)`
  - `POST /admin/api/player/:id/cheat-flag` עם `{detector, severity, details}` (manual)
  - 4 detectors אוטומטיים (background job, רץ כל שעה):
    - `score_too_fast`: avg drop time < 100ms על משחק עם score > 10K
    - `multi_account`: 3+ accounts מאותו device_id base (אבל זה anonymous — נצטרך לחפש פעילות זהה: IP + visit pattern)
    - `wash_trading`: 2 שחקנים מתחלפים בנצחונות בדו-קרב 5+ פעמים
    - `friend_farming`: שחקן עם 20+ חברים שכולם רשומים תוך 48 שעות וכולם עם score=0
  - Frontend: tab חדש `🚩 חשודי צ'יט` עם רשימה + filters + bulk actions

- [ ] **TB.7** — VIP / Whale Flag
  - Schema: `ALTER TABLE player_profiles ADD COLUMN vip_tier SMALLINT DEFAULT 0` (0=normal, 1=engaged, 2=whale, 3=super-whale)
  - Heuristic: auto-flag 1 = 30+ games this month, 2 = bought premium BP OR spent 5000+💎, 3 = 50000+💎 spent
  - Frontend: pill בצד שם השחקן ברשימה — `⭐ VIP` / `👑 Whale` / `💎 Super-Whale`
  - **למה ממכר**: ה-VIPs הם 5% מהמשתמשים אבל מספקים 40% מהרווח. דעיכת VIP אחת = שווה ערך לעשרות free players שעוזבים.

- [ ] **TB.8** — Impersonate / View-as-Player
  - `GET /admin/api/player/:id/impersonate-token` → returns short-lived token (5 min)
  - Frontend: כפתור `👁 הצג כשחקן` → פותח tab חדש עם `/?impersonate=TOKEN&device=DEVICE_ID`
  - Boot logic ב-`src/13-boot.js`: אם `?impersonate=` ו-token תקף → load את ה-device_id של היעד, רץ במצב read-only (אסור לכתוב score / לקנות / לשלוח פוש)
  - **למה ממכר**: שחקן מתלונן "המסך לא נטען" — אדמין רואה בדיוק מה הוא רואה.

- [ ] **TB.9** — Audit log per-player
  - `GET /admin/api/player/:id/audit` → returns last 50 `admin_actions` rows where target=device_id
  - Frontend: tab `📋 היסטוריית פעולות` במודאל

---

## PHASE C — Churn Detection Dashboard (~4 ימים)
> 🎯 לראות *בזמן אמת* מי בסיכון לנשור. בלי זה, מטפלים בבעיה רק אחרי שהיא קרתה.
> 💡 **למה זה ממכר**: 50% מהנושרים אפשר להציל אם פונים אליהם תוך 24 שעות. אחר כך זה אבוד.

- [ ] **TC.1** — Churn Risk Signals (background scoring)
  - Schema: `churn_signals` table — `(id, device_id, signal_type, severity SMALLINT 1-10, computed_at, metadata JSONB, resolved_at)`
  - Background job (runs every 2 hours):
    - `streak_danger`: streak ≥3 AND not played today AND it's after 18:00 IL → severity = `min(streak/3, 10)` (streak גבוה = severity גבוה)
    - `streak_lost_recent`: streak >7 was reset in last 48h → severity 9
    - `lapsed_3d`: לא שיחק 3-7 ימים → severity 5
    - `lapsed_7d`: לא שיחק 7-14 ימים → severity 7
    - `lapsed_14d`: לא שיחק 14+ ימים → severity 9 (אבד כמעט בוודאות)
    - `bp_expired_unused`: יש BP tier לא נטען, ה-season מסתיים בעוד 7 ימים → severity 6
    - `league_demoted`: ירד ליגה השבוע + לא שיחק 2 ימים → severity 7
    - `losing_streak_duels`: הפסיד 3+ דו-קרבות ברצף → severity 6 (frustration)
    - `low_balance_stuck`: balance < 50 AND ads daily cap reached AND לא שיחק 24ש → severity 5
    - `whale_at_risk`: VIP tier ≥2 + לא שיחק 2+ ימים → severity 10 (TOP PRIORITY)
  - Job idempotent: עדכן existing signals במקום ליצור duplicates

- [ ] **TC.2** — Churn Risk Dashboard (Tab חדש: `🚨 סיכון נטישה`)
  - 3-stat header: סה"כ בסיכון | בסיכון גבוה (severity ≥8) | VIP בסיכון
  - רשימה ממוינת לפי severity DESC: שורה לכל שחקן עם signal_type + last_play + severity badge
  - לחיצה על שורה → פותח את ה-player drill-down (TA.2)
  - Bulk action: `📤 שלח פוש לכל ה-VIP בסיכון` (select all + use TB.1 with custom template)
  - "🎁 הענק 50💎 לכל בסיכון רגיל" — חיבוב חברתי / mass intervention
  - Filter pills: by signal_type, by severity, by last_play

- [ ] **TC.3** — Comeback Push Effectiveness Tracking
  - Schema: `comeback_pushes` — `(id, device_id, signal_type, push_sent_at, push_opened_at, returned_at, message_used)`
  - כל פוש שיוצא מ-TC.2 או מ-smart-push (Stage 31) נרשם פה
  - `GET /admin/api/comeback/effectiveness` → return % opened, % returned, by message_template
  - Frontend: small panel ב-TC.2 — "המסר 'הרצף שלך מסתיים' החזיר 32% (best); 'ברוך שובך' החזיר 12% (worst)"

- [ ] **TC.4** — Cohort Retention Beyond D30
  - Extend `/admin/api/retention` to return D60 + D90 + D180 columns
  - Frontend: extend cohort table from 8 weeks to 24 weeks
  - חשוב לראות: האם השחקן ש-D7 retained הוא גם D90 retained?

- [ ] **TC.5** — Behavior Segmentation
  - Background job (runs daily 04:00 IL): מחשב segment לכל active player ושומר ב-`player_profiles.segment_label`
  - Segments: `daily` (3+ games/week consistent), `weekend_warrior`, `binger` (long gaps + intense play), `casual`, `competitive` (focus on leagues/duels), `collector` (achievements/album), `whale`
  - Frontend: filter pills בכל מקום (drill-down + churn dashboard + push composer)
  - **למה ממכר**: מסר ל-`whale` שונה ממסר ל-`casual`. Segmentation מאפשר מסרים מותאמים → conversion x2-3.

---

## PHASE D — Stage Telemetry & Live Ops (~3 ימים)
> 🎯 ראות על כל פיצ'ר שנבנה. עכשיו האדמין לא יודע אם Trophy Road נצרך או מתעלמים ממנו.

- [ ] **TD.1** — Per-Stage Telemetry Endpoints
  - Endpoint כללי `GET /admin/api/telemetry/:stage_id` עם adoption metrics:
    - `active_now` (פעילים עכשיו)
    - `today_unique_users` (משתמשים יחודיים היום)
    - `adoption_pct` (% מ-DAU שאינטראקציה עם הפיצ'ר)
    - `avg_engagement_sec` (כמה זמן ממוצע)
    - `recent_users[5]` (דוגמאות אחרונות)
  - 30+ stages לקבל endpoint (trophy-road / spin-wheel / pet / album / lifetime / guilds / etc.)
  - Each endpoint = SQL aggregation, cache 5 min

- [ ] **TD.2** — Stage Telemetry Dashboard (Tab חדש: `📊 פיצ'רים בשטח`)
  - Grid: 6×8 cards, אחת לכל stage
  - כל card מציגה: 🟢 ירוק (adoption >50%) / 🟡 צהוב (10-50%) / 🔴 אדום (<10%) + מספרים
  - Sort by: adoption | active-now | engagement
  - **חיוני**: זה מראה אילו פיצ'רים לא נצרכים → אפשר להשבית אותם זמנית או לשפר את ה-discoverability

- [ ] **TD.3** — Live Operations Panel (extension של `🔧 ניטור`)
  - הוסף 4 cards מעל ה-Live activity הקיים:
    - **שחקנים במשחק כעת**: מספר + breakdown לפי mode (daily/practice/duel/contest/tournament/dynamic-board)
    - **דו-קרבות חיים**: מספר + breakdown לפי status (pending/accepted/in-progress)
    - **טורנירים פעילים**: רשימה עם enrollment count + leader
    - **מלחמות גילדות**: מספר wars פעילים + scores
  - Refresh כל 5 שניות

- [ ] **TD.4** — Gem Economy Health
  - `GET /admin/api/economy/health?period=24h|7d|30d`
  - Return: total_issued, total_spent, net_circulation, by_source breakdown, by_sink breakdown
  - Frontend: 2 pie charts (sources/sinks) + 30-day line chart of net circulation
  - **alert thresholds**: אם net_issued > total_spent ב-30 ימים = אינפלציה. אם <0 = שחקנים חוסכים מטבעות → אולי המחירים גבוהים מדי.

- [ ] **TD.5** — Push Notification Operations
  - `GET /admin/api/push/operations` → return:
    - Active subscriptions count
    - Sent today / this week
    - Success rate (% delivered)
    - Engagement rate (% opened — אם יש tracking)
    - Failed delivery (reasons breakdown: stale token, denied, etc.)
  - Frontend: ב-`🔧 ניטור` tab, מתחת ל-push composer הקיים

- [ ] **TD.6** — Server Health Metrics
  - `GET /admin/api/server/health` → return:
    - Endpoint p50/p95/p99 latency (top 10 slowest)
    - Error rate last hour (5xx count + breakdown)
    - DB connection pool usage
    - Memory % + CPU %
    - Cache hit rate (config cache, skin cache, board cache)
  - Frontend: dashboard עם sparklines (24h)
  - **למה ממכר**: אדמין שמזהה שה-API איטי → לוחץ לפני שהשחקנים נושרים מהאיטיות

---

## PHASE E — Communication & Targeted Engagement (~3 ימים)
> 🎯 broadcast לכולם זה גס. שולחים ל-segment ספציפי = conversion x3.

- [ ] **TE.1** — Segment Builder + Targeted Push
  - `POST /admin/api/push/segment` עם `{segment_rules, message}`
  - Rules: trophy_range, level_range, days_inactive_range, country, segment_label, vip_tier, has_played_today, etc.
  - Server מחשב recipients dynamically, מציג preview ("ייקלטו 234 משתמשים = 18% מ-DAU"), שולח רק על confirm
  - Frontend: segment builder UI עם +הוסף תנאי (and/or), preview live של מספר recipients

- [ ] **TE.2** — In-Game Banner to Segment (לא רק push)
  - `POST /admin/api/banner/segment` עם `{segment_rules, banner: {title, body, cta_text, cta_url, theme, expires_at}}`
  - Schema: `admin_banners` — `(id, segment_rules JSONB, banner JSONB, created_at, expires_at, dismiss_count)`
  - Client: בכל `showHomeV2`, fetch `/api/banners/active?deviceId=X` ומציג את הראשון שמתאים
  - תרחיש: "שחקנים עם trophies < 100, באנר ירוק: 'Trophy Road חדש! תרוויח 100💎 על הארנה הראשונה'"

- [ ] **TE.3** — Player Feedback Inbox
  - Schema: `player_feedback` — `(id, device_id, category 'bug'|'idea'|'abuse'|'praise', message TEXT, created_at, status, admin_reply, replied_at)`
  - Client: כפתור `📝 שלח משוב לצוות` בהגדרות
  - Admin tab: `📬 משוב משחקנים` — רשימה + filter by category + reply box
  - Reply שולח push לשחקן: "👋 הצוות ענה לך"

- [ ] **TE.4** — Notification Templates Library
  - Schema: `push_templates` — `(id, name, category, title_template, body_template, variables JSONB)`
  - 8-12 templates מומלצים: streak_danger / comeback / bp_expires / tournament_starting / friend_passed_you / new_skin / etc.
  - כל template תומך placeholders: `{playerName}` / `{streakCount}` / `{rewardAmount}` / etc.
  - Admin: CRUD על templates + שימוש מהיר ב-TB.1 / TE.1

---

## PHASE F — Anti-Cheat & Fraud Detection (~3 ימים)
> 🎯 חשד שיש בוטים? Multi-account? Wash trading בדו-קרבות? הכל לא נראה ל-admin היום.

- [ ] **TF.1** — Automated Cheat Detection (background job)
  - תכנן 4 detectors מ-TB.6 לרוץ כל שעה כ-job
  - כל hit יוצר row ב-`cheat_reports`
  - גם detector: `impossible_score` (score > 1.5M = severity 10) — דורש review מיידי

- [ ] **TF.2** — Cheat Reports Dashboard (Tab חדש: `🚩 חשודי צ'יט`)
  - 3-stat header: total | high-severity | reviewed-pending
  - רשימה ממוינת לפי severity DESC + age ASC (חדש = יותר חשוב)
  - לכל row: action buttons → `🔍 צפה כשחקן` (impersonate, TB.8) / `🚫 בן` / `🚩 דגל` / `✓ סמן כתקין`
  - Bulk action: "בן את כל הצ'יטרים ברמה critical"

- [ ] **TF.3** — Multi-Account Detection (Heuristic)
  - Background job: מחפש 3+ accounts עם פעילות זהה ב-24 שעות
  - "פעילות זהה" = visits בתוך 60 שניות זה מזה + scores דומים + אותו country
  - Severity 5-8 בהתאם לעוצמה
  - Manual review by admin — לא ban אוטומטי

- [ ] **TF.4** — Wash Trading Detection (Duels)
  - בכל יום: agg query — שני שחקנים שהתחלפו בנצחונות בדו-קרב 5+ פעמים בתוך שבוע
  - Severity 7 — חשש לפארמינג מטבעות בעולם של דו-קרבים על סף
  - Manual review

---

## PHASE G — Stage-Specific Admin Gaps (~5 ימים)
> 🎯 לכל stage לסגור את הפערים הספציפיים (toggle / config / stats / manual trigger / per-player override)
> רוב ה-stages חסר להם או stats או manual trigger או per-player override.

- [ ] **TG.1** — Achievements admin panel (Stage 6)
  - Frontend tab: רשימת כל ה-achievements + count לכל אחד (כמה שחקנים פתחו)
  - Top-100 שחקנים לפי achievement count
  - Edit names + descriptions + icons + rewards (כרגע hardcoded ב-client)
  - Manual grant button per-player (כבר נכלל ב-TB.4)

- [ ] **TG.2** — Quests admin panel (Stage 7)
  - View today's 3 quests + completion rate
  - View 11-quest pool + ability to edit names/descriptions/rewards
  - Force-reset all quests (testing)

- [ ] **TG.3** — Mystery Chest stats (Stage 8)
  - Total chests opened today / week / month
  - Tier distribution (% common / uncommon / rare / legendary / mythic)
  - Total gems paid out from chests
  - Players opened most chests (top 20)

- [ ] **TG.4** — Battle Pass stats (Stage 11, 17)
  - Players at each tier (1-20) — histogram
  - Premium purchase rate (% bought)
  - Unclaimed reward count (the FOMO driver)
  - Predicted revenue for current season

- [ ] **TG.5** — Tournament & Squad Tournament admin (Stage 12, 46)
  - View live tournament enrollment + leader live
  - Auto-create daily tournament at 20:00 IL (cron)
  - Force-finalize early

- [ ] **TG.6** — Friends & Friend Challenges (Stage 13, 41 / A2)
  - View top 20 social players (most friends)
  - View challenge stats (sent / passed / expired / declined)
  - View friend-farming suspects (TF.3 cross-link)

- [ ] **TG.7** — Daily Special / Daily Multiplier (Stage 14, 15)
  - View today's special board + admin can override for testing
  - View multiplier stack effectiveness (avg XP per game with vs without)

- [ ] **TG.8** — Pet admin panel (Stage 28)
  - View pet level distribution (histogram)
  - Top 20 longest-fed pets (engagement signal)
  - Force-evolve / force-feed buttons (per-player)
  - Edit evolution thresholds + mood titles

- [ ] **TG.9** — Album admin panel (Stage 29)
  - View completion % distribution
  - Top 20 album-completionists
  - Force-grant tile / complete board (per-player)

- [ ] **TG.10** — Spin Wheel admin (Stage 36)
  - View today's spin count + reward distribution
  - View streak distribution
  - 12-segment editor (already exists in config; surface in dedicated panel)

- [ ] **TG.11** — Gem Bank admin (Stage A10 / 45)
  - Total deposited (across all players)
  - Total interest paid out today
  - Top 20 depositors
  - Adjust interest rate live (already exists in config)

- [ ] **TG.12** — Replay Sharing stats (Stage 32)
  - Top 20 sharers (already exists)
  - Breakdown by channel (WhatsApp/Native/Copy/Save)
  - Estimated K-factor (visits from shares)

- [ ] **TG.13** — Lives / Energy admin (Stage 19)
  - View % players using lives system (if enabled)
  - View refill source breakdown (ad / gem / wait)
  - Force-refill button (per-player, already in TB.4)

- [ ] **TG.14** — Daily Spin / 7-day Login Calendar (Stage 36, 44)
  - View streak distribution (כמה שחקנים ברצף 1/2/3/4/5/6/7+)
  - View jackpot win count
  - Force-reset calendar (per-player)

- [ ] **TG.15** — Trophy Chests stats (Stage A3 / 40)
  - Total chests earned today
  - Average wait time before opening
  - Top 20 chest-hoarders (engagement signal)

- [ ] **TG.16** — Rivals admin enhancement (Stage 33)
  - Force-match buttons already exist
  - הוסף: View pending rivalries about to expire
  - Manual create rivalry between 2 specific players

- [ ] **TG.17** — Leagues admin enhancement (Stage 34)
  - View league distribution histogram
  - Time until next weekly reset
  - View promotion/demotion rate this week
  - Force-promote button (per-player)

- [ ] **TG.18** — Daily Spin override (Stage 36)
  - Admin can override result of next spin for a specific player (testing)

---

## PHASE H — Real-Money & Analytics Foundations (~4 ימים)
> 🎯 דורש Stripe integration. אם לא, דחה ל-Phase later.

- [ ] **TH.1** — Stripe Integration (stage 17b)
  - דורש Stripe account + webhook URL
  - Schema: `purchases` table — `(id, device_id, sku, price_cents, currency, stripe_session_id, status, refunded_at)`
  - Webhook handler: `POST /stripe/webhook` עם signature verification
  - Frontend: trigger purchase via Stripe Checkout

- [ ] **TH.2** — Revenue Dashboard
  - `GET /admin/api/revenue` → daily/weekly/monthly revenue, ARPPU (avg revenue per paying user), conversion rate
  - Frontend: dashboard עם line chart + breakdown by SKU
  - **דחוף אחרי שיש 100+ purchases** — לפני זה זה אנקדוטות

- [ ] **TH.3** — Refund / Chargeback Management
  - View refund requests
  - One-click refund (deduct gems + Stripe API call)
  - Track chargeback dispute status

- [ ] **TH.4** — Custom Analytics Reports
  - Custom SQL builder (safe — read-only role)
  - Save queries as named reports
  - Email daily/weekly reports
  - **למה ממכר**: מסלים נתונים בלי לחכות לאדמין שיכתוב query — מנהל מוצר עצמאי

---

## PHASE I — Operational Hygiene (~2 ימים)
> 🎯 דברים נחוצים שאדמין צריך לעצמו, לא לשחקנים.

- [ ] **TI.1** — Admin Session Management
  - Schema: `admin_sessions` — `(id, admin_email, ip, user_agent, created_at, expires_at, revoked_at)`
  - Re-auth required every 8h
  - "Active sessions" view ב-admin עם revoke button
  - Alert email/push כששער זר משתחרר (לוג IP חדש = email)

- [ ] **TI.2** — Backup Automation (Already Exists — Doc Only)
  - 2 schedules already running on Railway z2RQ (DAILY + WEEKLY)
  - Add admin UI button "🔄 הפעל גיבוי ידני עכשיו" שמפעיל `volumeInstanceBackupCreate` mutation
  - View list of available backups + last-run timestamp

- [ ] **TI.3** — Feature Flags (כיבוי מהיר לפיצ'רים שבורים)
  - Schema: `feature_flags` — `(flag_name, enabled BOOLEAN, target_segment JSONB, rollout_pct INT)`
  - 48+ existing master toggles in `game_config` already do this for 1-toggle-per-stage
  - חידוש: הגדרות rollout מדורגות (1% → 10% → 100%) + per-segment override
  - מאפשר A/B testing — מומלץ דחיפה אחרי Phase A-D

- [ ] **TI.4** — Version Display + Deploy History
  - Admin badge מציג גרסה + commit hash (כבר קיים — לוודא)
  - View "last 10 deploys" עם time + commit message
  - One-click "deploy main" button (אם הפלטפורמה תומכת)
  - Rollback to previous deploy

---

## 📊 סדר עדיפויות מומלץ (Sprint Order)

**Sprint 1 (שבוע 1)** — Player Visibility (קריטי)
- Phase A: TA.1 + TA.2 + TA.3 + TA.4 (drill-down + quick actions)
- Phase B: TB.1 + TB.2 + TB.3 + TB.4 (push + streak + trophies + grant)

**Sprint 2 (שבוע 2)** — Churn Prevention (קריטי)
- Phase C: TC.1 + TC.2 + TC.3 (churn signals + dashboard + tracking)
- Phase B: TB.5 + TB.6 + TB.7 + TB.8 (ban + cheat-flag + VIP + impersonate)

**Sprint 3 (שבוע 3)** — Operational Excellence
- Phase D: TD.1 + TD.2 + TD.3 + TD.4 (telemetry + live ops + economy + push ops)
- Phase E: TE.1 + TE.3 (segment push + feedback inbox)

**Sprint 4 (שבוע 4)** — Anti-Cheat + Per-Stage Polish
- Phase F: TF.1 + TF.2 (automated detection + dashboard)
- Phase G: top 10 stages by adoption gap

**Sprint 5+ (שבוע 5+)** — Long-term
- Phase G: השאר
- Phase H: Stripe + revenue (כשרלוונטי)
- Phase I: Ops hygiene

---

## 🎯 ROI Estimation

| Phase | Effort | Expected Churn Reduction | Expected Revenue Impact |
|-------|--------|--------------------------|-------------------------|
| A — Drill-down | 4d | 5% (better intervention) | +$200/mo |
| B — Actions Toolkit | 5d | 8% (active intervention) | +$400/mo |
| C — Churn Detection | 4d | 12% (proactive comeback) | +$800/mo |
| D — Telemetry | 3d | 3% (feature optimization) | +$150/mo |
| E — Targeted Comm | 3d | 5% (conversion x2) | +$300/mo |
| F — Anti-Cheat | 3d | 1% (whale protection) | +$100/mo |
| G — Per-Stage | 5d | 4% (engagement uplift) | +$200/mo |
| H — Revenue | 4d | N/A | +$500/mo (Stripe live) |
| I — Hygiene | 2d | 0% | 0 |

**סה"כ Phases A-G**: ~27 ימי עבודה / ~38% הפחתת churn / ~$2,150/mo נוסף

---

## 📝 הערות יישום

- **קונבנציה**: כל endpoint חדש תחת `/admin/api/*` עם `requireAdmin` middleware
- **Audit log**: כל mutation חייב לכתוב ל-`admin_actions` table
- **Atomic transactions**: כל פעולה שמשנה balance / trophies / state חייבת להיות בתוך BEGIN/COMMIT
- **Rate limiting**: כל endpoint admin עם 100/hr default (חוץ מ-personal push: 10/hr)
- **Cache**: drill-down profile cache 60s. live operations 5s. telemetry 5min.
- **Dark theme**: כל component חדש חייב לעבוד בשני המצבים
- **Mobile**: admin panel נצרך גם מהטלפון (responsive)
- **Hebrew RTL**: כל UI חדש בעברית, RTL native

---

> **עדיפות עליונה**: Phase A + B + C = שבועיים עבודה = מציל 25% מהנושרים. זה ה-MVP.
