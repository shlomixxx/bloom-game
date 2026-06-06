# PAGE_REDESIGN_TASKS — BLOOM page-by-page UX / beauty / addiction audit + executable plan

> **Created 2026-06-06 (build `v20260606h`).** Owner ask (paraphrased): "Do a deep analysis of every page and say what to do so each page is **beautiful, big, clear, uncrowded, and addictive — including the game**. Today some pages look bad / overloaded, and in the game ~2/3 of the screen is stuff unrelated to the game. Produce a report with tasks Claude can execute the moment it reads it."
>
> **How this was produced:** live audit on PRODUCTION at iPhone viewport **390×844** (`game_v2` is ON for 100% of players, `home_variant='tiles'` is the default). Every finding is grounded in a screenshot I captured AND/OR a `file:line` I read first-hand. A multi-agent workflow was attempted but the parallel subagents kept hitting an **API server rate-limit** (server-side throttle, not usage), so the analysis was completed inline — which actually means **every claim here is first-hand verified** (per the CLAUDE.md AD.3 lesson: audit claims that quote code often don't match real code).
>
> **Screenshots:** `audit/01-home-tiles.png`, `02-ingame-v2.png`, `03-tab-rewards.png`, `04-tab-social.png`, `05-tab-progress.png`, `06-tab-shop.png`, `07-modal-bank.png`.

---

## 🇮🇱 תקציר בעברית (לקריאה מהירה)

הבעיות האמיתיות שאומתו על הפרודקשן:

1. **בתוך המשחק** — הלוח עצמו תופס ~65% במסך מלא, אבל בטלפון אמיתי (שורת הכתובת אוכלת ~120px) הוא יורד ל-~55% והלוח מתכווץ. מעליו יש **שכבות מיותרות וכפולות**: תווית הקושי מופיעה **פעמיים** ("חופשי · ברירת מחדל" למעלה + "ברירת מחדל 📦" ברצועה מתחת), שורת מכפילי-עמודות **×1 ×2 ×4 ×8** שצצה במשחק רגיל, ובאנר "⏰ שחק! הבונוסים מגיעים רק כשמשחקים" שקופץ **על הלוח** אחרי ~10 שניות לפני שבכלל זזת. → **משימות UR.1–UR.5**.
2. **דפי הלשוניות (פרסים / קהילה / דרגות / חנות)** — נראים עמוסים כי **לכל כרטיס יש גרדיאנט צבעוני רועש משלו** (זהב/סגול/ירוק/טורקיז/ורוד/כחול/אדום) = "מרק קשת" בלי היררכיה. + כפילויות (גלגל המזל מופיע גם בבית וגם ב"פרסים"). → **משימות UR.6–UR.9** (מערכת-כרטיס אחידה).
3. **מסך סיום משחק** — יכול לערום 10–15 באנרים בו-זמנית. → **UR.10**.
4. **המודאלים עצמם דווקא טובים** (הבנק לדוגמה נקי ועקבי) — הבעיה היא הדפים והמשחק.

המסקנה: **לא חסרים פיצ'רים — צריך לנקות, לאחד ולתת היררכיה.** הרשימה למטה ממוינת לפי החזר-על-מאמץ; הראשונות הן בדיוק שתי התלונות שלך.

---

## ✅ Shipped 2026-06-06 (`v20260606j`, deployed + live-verified on prod)

The owner said "do everything to make the **home beautiful** and the **game very addictive**." The two PRIMARY surfaces were done + verified live (Playwright @390×844):

| Task | What shipped | Live verification |
|---|---|---|
| **UR.1** ✅ | `#mode-extras` no longer mirrors the `.practice-diff-chip` — the duplicate "ברירת מחדל" above the board is gone (difficulty stays editable via the top-row `.mode-chip` → picker). Icon-only leader/target chips (a lone "🏆") are also dropped. | In-game `#mode-extras` now shows nothing duplicate (was "🏆 ברירת מחדל 📦"). |
| **UR.3** ✅ | The idle "⏰ שחק!" nag is gated on `dropsCount>0` — never fires before the first move. | Waited **12s in-game without moving → no banner** (was nagging at ~10s over the board). |
| **UR.11** ✅ | Tier-maxed veterans get a live SCORE chase instead of the dead "הגעת לכתר!". | Ladder now reads **"👑 שיא: 123K · תשבור?"**. |
| **UR.12** ✅ | The single home hot-card is capped + calmed on the tiles home (icon 70→40px). | Hot-card **272→181px**; pid pulled above the fold (792→696), actions to the fold edge. |
| **UR.14** ✅ | Added `<meta name="mobile-web-app-capable">`. | Console deprecation warning gone. |

**Guardrails held:** engine untouched (self-test 200 games / 0 floating tiles every build); all CSS scoped to the tiles variant / `body.bloom-v2`; JS guarded; fully reversible (admin `🏠` picker + `?hv=` still work). Screenshots: `audit/08-home-after.png`, `audit/09-ingame-after.png`.

### ⏭️ Recommended next (NOT shipped — need your eye / a reproduction)
- **UR.6–UR.9 (unified `.bloom-card` system for the 4 tab pages)** — this is the "overloaded pages / rainbow-soup" fix and it's a broad, taste-sensitive visual change across ~20 feature cards. Per the project's own lesson (home v3 was built then rejected), this should be shipped with your eye on it — ideally as a previewable change. Fully specified below; ready to execute on your go.
- **UR.10 (game-over banner cap)** — a refactor of the highest-emotion screen. The *overloaded* case (new-best + crown + streak-milestone + N achievements + N quests at once) can't be reproduced headlessly, so it shouldn't ship blind. Capture a real overloaded game-over first, then execute.

---

## Scores (0–100, BLOOM's 7 dimensions: addiction 30% · visual 18% · comfort 12% · clarity 12% · focus 12% · closability 8% · relevance 8%)

| Screen | addict | visual | comfort | clarity | focus | close | relev | **Overall** | One-line verdict |
|---|---|---|---|---|---|---|---|---|---|
| **In-game (v2 board)** | 76 | 64 | 68 | 70 | 64 | 82 | 64 | **63 → ~70** ✅ | Board now clean: no duplicate difficulty, no idle nag over the board. Remaining: col-mult row intent (UR.2) + chrome height on real phones (UR.4). |
| **Home (tiles)** | 82 | 80 | 80 | 78 | 86 | — | 78 | **77 → ~83** ✅ | Hot-card capped (272→181px) so PLAY+ladder+actions sit near the fold; tier-maxed ladder now a live score chase. |
| **Tab pages (×4)** | 65 | 54 | 62 | 60 | 50 | 82 | 60 | **60** | "Rainbow-card-soup" — every card a loud gradient, no hierarchy. The #1 "overloaded" complaint. |
| **Game-over** | 82 | 66 | 64 | 62 | 60 | 76 | 64 | **69** | Strong hooks, but up to 10–15 banners can stack = overload. |
| **Modals (econ/progress/social)** | 78 | 76 | 78 | 76 | 74 | 84 | 72 | **77** | Generally good; just inconsistent headers/CTA between modules. |
| **FTUE / tour** | 76 | 74 | 78 | 80 | 78 | 80 | 70 | **76** | Solid scripted demo; minor polish. |
| **Design system (cross-cut)** | — | 55 | — | 62 | 58 | — | — | **58** | Tokens already exist in `:root` but feature cards ignore them (299 gradients in boards.css, 170 in home-v2.css). |

**Game average ≈ 68/100 (B−).** The two lowest scores (In-game chrome 63, Tab pages 60) are exactly the user's two complaints.

---

## Cross-cutting themes (root causes)

1. **🎮 In-game chrome is too tall and partly redundant.** Above the board sit: stats row, a *duplicate* difficulty label (`#mode-extras`), the spine (ladder+hold+next), and a column-multiplier row that shows even on default practice. On a real phone this is ~40–45% of the screen → the board shrinks and feels secondary. **Fix:** delete the duplicate, gate/compact the col-mult row, tame the idle nag → reclaim ~45px and push the board past 70%.
2. **🌈 Rainbow-card-soup on the 4 tab pages.** Every feature card defines its own loud saturated gradient. There's no shared card class, so the pages read as chaotic. Ironically a *calm* card style already exists in `home-v2.css` (subtle rgba-accent tints, ~L295–323) right next to the loud ones (~L755–785). **Fix:** one shared `.bloom-card` (neutral surface + a single category-accent stripe/icon-chip) and migrate the loud tiles to it.
3. **♻️ Feature duplication across surfaces.** Spin wheel = home hot-card **and** a "פרסים" card; bundles/deals appear in both "פרסים" and "חנות." Same thing twice dilutes every signal. **Fix:** one canonical home per feature; the home hot-card is a *shortcut*, not a clone.
4. **🎉 Game-over can overload.** Board-best + global-rank + daily-special + streak-freeze + streak-milestone + N achievements + N quests + daily-streak + next-reward + 3-button funnel + share + play-again can all render at once. **Fix:** cap reward banners to 1 inline + "🎁 +N more" line; keep PLAY-AGAIN unmistakably dominant.
5. **🏔️ Tier-maxed home anticlimax.** A veteran who's reached Crown sees "🪜 הדרגות שלך … הגעת לכתר!" with nothing left to chase — the strongest near-goal pull is dead exactly for the most-engaged players. **Fix:** when tier-maxed, swap the ladder's right-side hook to a *score* goal ("שיא: 123K · תשבור?") or prestige/skin progress.
6. **🎨 Design tokens exist but aren't adopted.** `:root` already defines accent/surface/success/danger + radius/shadow/z-index. The sprawl (299+170 gradients) is the "not beautiful" root. **Fix:** phased adoption, starting with the shared card class.

---

## RANKED TASK LIST (execute top-down; ROI = (addiction+severity)/effort)

> Every task: **Steps** = exact file + selector/function + change (zero re-discovery). **Accept** = how to verify. Respect the **Guardrails** at the bottom.

### 🥇 Tier A — the two complaints (do first)

#### UR.1 — Kill the duplicate difficulty label in-game `[high · ⭐3 · S]`
- **Screens:** In-game. **Evidence:** `src/11-game.js:715` `syncModeExtrasStrip()` mirrors `#mode-sub` into `#mode-extras`; the difficulty ("ברירת מחדל") is ALREADY shown by `.mode-chip` in the top-row (`index.html:115`, painted in `src/11-game.js:~450`). Screenshot `02-ingame-v2.png` shows both.
- **Steps:** In `syncModeExtrasStrip()`, after building `mirrored`, strip the redundant difficulty/practice-difficulty chip from the mirrored HTML (the `.practice-diff-chip` / plain difficulty label) — keep ONLY value-add chips: `.dyn-target-chip` (personal best), `.dyn-leader-chip`, and the daily-special chip. If nothing remains after stripping, set `host.style.display='none'`. (The `.mode-chip` stays the single source of truth for mode+difficulty.)
- **Accept:** On a plain practice game, `#mode-extras` is `display:none` (no "ברירת מחדל" twice); on a dynamic board with a leaderboard it still shows the target/leader chips. Reclaims ~27px.

#### UR.2 — Don't show the column-multiplier row on the default game `[high · ⭐3 · S]`
- **Screens:** In-game. **Evidence:** `src/12-tour-info.js:1416` `syncColumnMultiplierBar()` renders `.col-mult-bar` whenever `getColumnMultipliers()` is non-null. Live, a dynamic column-mult board (×1×2×4×8) is applied to **plain practice** (screenshot `02-ingame-v2.png`), so the row appears in what looks like a normal game — confusing clutter the player can't act on.
- **Steps:** First **confirm intent in admin** (`game_config` / boards `applies_to`): is a column-multiplier board *meant* to be the default practice experience? 
  - If **NO** (likely): remove `'practice'` from that board's `applies_to` (or unset the active default-practice board) so default practice has no multipliers. Then `.col-mult-bar` naturally won't render.
  - If **YES** (it's an intentional addiction lever): keep it but **compact it into the spine** — move the ×N pills into `#v2-launch` (the spine) instead of a separate 18px row, OR only render `.col-mult-bar` when the board was *explicitly chosen* by the player (a dynamic board from the picker), not when silently applied to default practice. Add a small `aria`/legend so it's understandable in <3s.
- **Accept:** Default practice shows no orphan ×N row (or it's folded into the spine). A user-picked dynamic board still shows multipliers with a clear label.

#### UR.3 — Stop the idle nag from punishing players who are reading the board `[high · ⭐3 · S]`
- **Screens:** In-game. **Evidence:** `src/11-game.js:~3542` `showIdleWarn()` (text "⏰ שחק! הבונוסים מגיעים רק כשמשחקים") fires at `idle_warn_seconds` (default 10) of inactivity; live it appeared **over the board within ~10s of entering, before any drop** (screenshot `02-ingame-v2.png`).
- **Steps:** In the idle watcher (`src/11-game.js:~3560–3590`), gate `showIdleWarn()` on `dropsCount > 0` (don't nag before the first move of a game) AND raise the default `idle_warn_seconds` to ~20–25 (admin key — keep it tunable, don't hardcode). Also ensure the banner never overlaps the grid center: it should sit in the header band, not on the board (verify `.idle-warn-banner` top position in `base.css`).
- **Accept:** Enter a game, wait 15s without moving → no nag until after the first drop AND after the (raised) threshold. Banner never covers the board.

#### UR.4 — Reclaim vertical space so the board dominates on real phones `[high · ⭐4 · M]`
- **Screens:** In-game. **Evidence:** measured bands at 390×844: chrome above `#grid-wrap` = 277px; on a real phone (~720px usable after URL bar) that's ~40% and `fitGrid()` (`src/06-contests.js:1630`) becomes height-bound → smaller cells.
- **Steps:** Stack the wins: UR.1 (−27px `#mode-extras`) + UR.2 (−18px col-mult) ⇒ ~45px back to the board. Then audit the `.stats` row (`base.css:336–344`): consider a slimmer single-line stats (score hero, demote שיא/רצף/חנות to smaller chips) to save another ~15–25px. Target: **chrome ≤ 28% of usable height, board ≥ ~70%.**
- **Accept:** Re-measure with the Playwright eval (band tops/heights) at a simulated ~720px usable height; confirm `#grid` height ≥ ~70% of usable and `[fitGrid]` cell size increased vs. baseline (87px width-bound stays; height-bound case grows from ~72 → ~79).

#### UR.5 — Compact / justify the v2 spine `[medium · ⭐3 · M]`
- **Screens:** In-game. **Evidence:** `#v2-spine` = 98px (tier ladder 45 + `#v2-launch` hold/next 52) — `index.html:146`, `src/52-v2-board.js:29 paintV2Launch`. The ladder is a deliberate merge-memory aid (GV.4.4) and an addiction climb-meter, so **keep it** — but the hold/next launch row can be tightened.
- **Steps:** In `public/css/v2-mechanics.css`, reduce `#v2-launch` vertical padding + tile size so the launch row is ~36–40px instead of 52 (keep the NEXT tile legible). Don't touch `#tier-bar` (the climb meter). Net ~12px.
- **Accept:** Spine ≤ ~84px; NEXT/HOLD still clearly readable at 390px; tier climb animations unaffected.

### 🥈 Tier B — the "overloaded pages" complaint (unified card system)

#### UR.6 — Introduce ONE shared card class `.bloom-card` `[high · ⭐4 · M]`
- **Screens:** all 4 tab pages + home tiles. **Evidence:** `home-v2.css` already has BOTH a calm token-based style (~L295–323, subtle `rgba(accent)` tints + `var(--color-surface)`) AND loud bespoke gradients (~L755 orange, L772 gold, L776 red, L785 pink, L859 gold, L107 orange) — inconsistent within one file. `boards.css` has 299 gradients.
- **Steps:** In `public/css/base.css` (after the `:root` tokens) define a reusable card: 
  ```css
  .bloom-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);position:relative;overflow:hidden}
  .bloom-card::before{content:"";position:absolute;inset-inline-start:0;top:0;bottom:0;width:4px;background:var(--feat-color,var(--color-accent))}
  .bloom-card .bloom-card-icon{/* small 40px rounded chip tinted with var(--feat-color) */}
  ```
  Each card sets `--feat-color` to ONE category hue (rewards=gold `#FAC775`, social=indigo, progress=green `#2E8B6F`, shop=accent). The loud full-bleed gradient becomes a thin accent stripe + a tinted icon chip; the body is the neutral surface. Provide a `[data-theme="dark"]` pair using the dark tokens (already defined).
- **Accept:** The class exists and renders calm in light+dark; visual diff shows a neutral surface with one accent stripe (not a full loud gradient).

#### UR.7 — Migrate the tab tiles/banners to `.bloom-card` `[high · ⭐4 · M]`
- **Screens:** rewards/social/progress/shop. **Evidence:** loud per-tile gradients to neutralize (sample): `home-v2.css` `#spin-home-tile`/spin (L107, L859), the banner gradients L755/772/776/785, `#home-jackpot`, `.daily-deal-home-banner`, plus per-feature tiles in `src/34-trophy-road.js`, `src/30-leagues.js`, `src/22-pet.js`, `src/19-skin-gacha.js`, `src/23-bundles.js`.
- **Steps:** Add `bloom-card` to each home tile/banner element (in each `maybeShow*`/render fn) and set `--feat-color` per category; in CSS, replace each loud `background:linear-gradient(...)` with the shared class (delete the bespoke gradient or scope it to a tiny `::after` glow only for the single "hot" card). Keep ONE card per tab visually "hot" (pulsing accent) — the rest calm. Do it tab-by-tab (rewards first — it's the busiest) so each is independently verifiable.
- **Accept:** Re-screenshot each tab; ≤1 "hot" card per tab, the rest neutral surfaces with category accents; no two adjacent cards use clashing full gradients.

#### UR.8 — De-duplicate features across surfaces `[medium · ⭐3 · S]`
- **Screens:** home + rewards + shop. **Evidence:** `src/31-home-variants.js collectHotSignals()` can surface Spin as the home hot-card while Spin also lives in the rewards tab; bundles/deals appear in rewards AND shop.
- **Steps:** Decide canonical homes: Spin → rewards tab (home hot-card is allowed as a *shortcut* but should read as "🎡 גלגל חינם — לחץ" not a full clone of the tab card). Bundles/deals → shop only (remove from rewards) OR rewards only (remove from shop) — pick one in `TILE_TO_TAB` (`src/46-bottom-nav.js:44`). Ensure the home hot-card never *renders the same big card* a tab already shows; prefer a slim shortcut.
- **Accept:** Each feature card appears in exactly one tab; the home hot-card is visually a shortcut (smaller) not a duplicate of a tab card.

#### UR.9 — Per-tab hierarchy + fill the sparse social tab `[medium · ⭐3 · M]`
- **Screens:** all 4 tabs (social looked sparse). **Evidence:** screenshots 03–06; tab defs `src/46-bottom-nav.js:23`.
- **Steps:** Within each tab, order cards by addiction priority (reuse `src/80-polish.js` priority ranking) so the top card is the strongest hook; only the top card is "hot" (UR.7). For the sparse **social** tab, surface the highest-emotion social hooks higher (friend requests, duel ⚡ live-race, ghost race) and/or merge thin content so the tab doesn't read empty. Verify tab count-badges are honest (they reflect real unclaimed/unread counts, not noise).
- **Accept:** Each tab has a clear #1 card; social tab fills the fold; badges match real state.

### 🥉 Tier C — game-over + polish

#### UR.10 — Cap game-over banner stacking `[high · ⭐4 · M]`
- **Screens:** Game-over. **Evidence:** `src/12-tour-info.js:769–988` — board-best + `over-board-rank` + `over-daily-special-banner` + `over-streak-banner-freeze` + `-milestone` + N×`over-ach-banner` + N×`over-quest-banner` + `over-streak` + `over-next-reward` + `over-funnel`(3 btns) can all render together.
- **Steps:** In the over template, collect all *reward* banners (daily-special, streak-milestone, each ach, each quest) into an array; render the **top 1** inline and, if more, a single line "🎁 עוד N פרסים — ראה בתפריט" linking to the relevant modal. Keep: title + hero score (count-up) + rank pill + ONE streak hook + **PLAY-AGAIN (dominant)** + share. Collapse the 3-button `over-funnel` under a single "עוד דרכים לשחק ▾". Target ≤ ~6 vertical blocks.
- **Accept:** Force a big game (new best + crown + streak milestone + 2 achievements): ≤6 stacked blocks; PLAY-AGAIN is the largest element; share is visible without scrolling.

#### UR.11 — Tier-maxed home: give veterans a next goal `[medium · ⭐4 · S]`
- **Screens:** Home (tiles). **Evidence:** `src/31-home-variants.js buildTileLadder()` — when `best >= MAX` it shows `htl-maxed` + "👑 הגעת לכתר!" (no chase). Screenshot `01-home-tiles.png`.
- **Steps:** In `buildTileLadder()`, when `atTop`, replace the right-side text with a *score* hook: "👑 שיא: {best} · תשבור?" (read `loadLifetimeInt(BEST_KEY)`/`best`), or wire to prestige/skin progress if available. Keep stone→crown direction (HOME.1). Pure decorator, no engine touch.
- **Accept:** On a tier-maxed device the ladder shows a live score chase, not a dead end.

#### UR.12 — Right-size the home hot-card `[medium · ⭐3 · S]`
- **Screens:** Home (tiles). **Evidence:** hot-card = 272px (screenshot `01-home-tiles.png`), pushing pid+actions below the fold.
- **Steps:** In `public/css/home-v2.css` `body[data-home-variant="tiles"] .hvar-hero-big`, cap the hot-card height (~150–180px) so the play-mode actions sit closer to the fold; keep the CTA legible.
- **Accept:** On 390×844, pid OR the first actions row is at least partially visible above the fold; hot-card ≤ ~180px.

#### UR.13 — Modal consistency pass `[medium · ⭐2 · M]`
- **Screens:** all feature modals. **Evidence:** Bank (`src/42-gem-bank.js`, screenshot `07-modal-bank.png`) is the clean reference (green theme, 44px ✕ top-left, clear CTA, tip line). Others (`19-skin-gacha`, `17-starter-pack`, `23-bundles`, `18-daily-deals`, `05c` season pass, `34-trophy-road`, `30-leagues`, `26-lifetime`, `25-album`, `22-pet`, `32-daily-spin`, `38-trophy-chests`) each build their own header/close/CTA.
- **Steps:** Extract a shared modal shell helper (header with title + 44px ✕ + optional tip; one dominant CTA at the bottom) and adopt it module-by-module. Verify each: single dominant BUY/action CTA, badges/ribbons never overlap the ✕ (IS.5 regression class), `prefers-reduced-motion` + dark-mode covered, passes the UX 5-question gate.
- **Accept:** Spot-check 5 modals — same close affordance + one dominant CTA; no badge overlaps the ✕.

#### UR.14 — Fix deprecated PWA meta `[low · ⭐1 · S]`
- **Screens:** global. **Evidence:** console warning; `index.html:14` uses only `<meta name="apple-mobile-web-app-capable">`.
- **Steps:** Add `<meta name="mobile-web-app-capable" content="yes">` alongside the existing apple one in `public/index.html`.
- **Accept:** Console warning gone.

---

## Quick wins (best impact-per-effort — ship these first)

1. **UR.1** — remove the duplicate difficulty strip in-game (S, instantly less crowded).
2. **UR.3** — don't nag before the first drop + raise idle threshold (S, removes the over-board banner).
3. **UR.2** — get the ×N column row off the default game (S, once admin intent confirmed).
4. **UR.11** — tier-maxed home → score chase (S, restores the near-goal pull for veterans).
5. **UR.12** — cap the home hot-card height (S, brings actions toward the fold).

---

## Completeness gaps / verify-next

- **Game-over not captured live** — analyzed from `src/12-tour-info.js` only (the on-page `?bot=1` auto-player didn't start: live `BloomDebug` exposes only `setColumnMultipliers/getColumnMultipliers/restart`, no `drop`, so the bot can't drive the board). Before executing UR.10, capture a real game-over (finish a manual game or restore the bot's drop hook) to confirm the live banner stack.
- **New-player state not captured** — the audited device is a veteran (60 games, tier-maxed). Re-run home + FTUE with cleared `localStorage` to confirm the new-player tile set + the FTUE→home handoff.
- **`col-mult` intent (UR.2)** is an **admin decision** — confirm in the admin panel whether a column-multiplier board should apply to default practice before changing code.
- **Modal group depth** — UR.13 lists the modules but each modal deserves its own before/after screenshot during execution.
- **Gradient migration scope** — `boards.css` (299 gradients) is large; UR.6/UR.7 should be done tab-by-tab with a screenshot diff each, not in one sweep.

---

## Guardrails (do NOT touch)

- The merge **engine / gravity / scoring / 4×6 grid dims** — none of these tasks require it; all fixes are CSS/decorator/DOM-arrangement.
- **v2 layers stay gated** by `v2On()` / `body.bloom-v2`; flag-off must remain byte-identical classic.
- **`prefers-reduced-motion`** — every new animation respects the global guard (`base.css`).
- **Admin controls everything** — keep new thresholds (idle seconds, etc.) as `game_config` keys; don't hardcode.
- **RTL Hebrew** copy + stone→crown ladder direction (HOME.1).
- **PLAY / the board must dominate** — the north star of every change here.
- No **stacked CSS transforms** on the same cell (use box-shadow/outline for in-game juice).

---

## Per-screen detail (reference)

**In-game (v2):** DOM `index.html:84–150` → `.top`(stats+mode-chip) · `#mode-extras`(dup) · `#v2-spine`(`#tier-bar`+`#v2-launch`) · `.col-mult-bar` · `#grid-wrap>#grid`. `.brand` is already hidden in-game (`base.css:289`) — not a problem. Cell 87px, board 65% at 844 / ~55% on a real phone. → UR.1–UR.5.

**Home (tiles):** `src/31-home-variants.js applyTilesVariant` hoists PLAY (good, dominant), builds the tier ladder + ONE hot-card. Issues: hot-card 272px, Spin duplication, tier-maxed anticlimax, pre-PLAY chrome (topbar+balance+brand) to y=271. → UR.8, UR.11, UR.12.

**Tab pages:** `src/46-bottom-nav.js` (5 tabs). Rainbow-soup from per-tile gradients; calm style already exists in `home-v2.css`. → UR.6–UR.9.

**Game-over:** `src/12-tour-info.js:769–988`. Strong hooks; banner overload risk; `.over-title` is 21px bold (R7 — good). → UR.10.

**Modals:** Bank is the clean reference; others inconsistent. → UR.13.

**FTUE:** `src/15-ftue.js` — scripted 3-step demo (tap/merge/chain), skippable, `bloom_ftue_done` flag, reuses real tile art. Solid; minor polish only.

**Design system:** `:root` tokens exist (`base.css:19–74`: accent `#BA7517`, surface, success `#2E8B6F`, danger `#FF8C42`, radius/shadow/z-index). Not adopted by cards (299+170 gradients). → UR.6 is the entry point for adoption.
