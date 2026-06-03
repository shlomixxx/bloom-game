# ONBOARDING_TASKS.md — FTUE / tutorial / new-player experience

Single source of truth for the first-time-user experience (FTUE) and anything a
brand-new player meets in their first session. Code lives in
[src/15-ftue.js](../../src/15-ftue.js) + FTUE CSS in
[public/css/viral.css](../../public/css/viral.css) (search `ftue-`). Boot trigger
in [src/13-boot.js](../../src/13-boot.js) (~line 398, `ftueShouldRun() && !hasHistory`).

> The FTUE is a **scripted demo** overlay, not the live engine on a seeded board.
> It must still TEACH THE REAL RULES, because muscle memory transfers to first
> real play. The real merge rule lives in [src/11-game.js](../../src/11-game.js)
> `findGroup` (orthogonal BFS) + `group.length >= 2`, and the game's own tour
> ([src/12-tour-info.js](../../src/12-tour-info.js)) already states it correctly:
> "שני זהים → מיזוג · צמודים אופקית או אנכית".

---

## ✅ FT.1 — FTUE accuracy overhaul (shipped 2026-06-03)

User report: "המדריך לא נכון — חסרים הסברים (פצצות ועוד), החצים בכיוונים שגויים,
האריחים שונים מהמשחק, וההדגמה לא עובדת לפי המערכת (צריך 3 אריחים)." Reproduced
live as a brand-new player (cleared storage, isolated browser context). All five
confirmed and fixed:

1. **Wrong merge rule (the big one).** Demo step-2 bubble said *"שלוש אבנים זהות
   → מיזוג"* and pre-stacked TWO un-merged tier-1 tiles — a board state that's
   **impossible** in the real engine (two adjacent equals would have already
   merged). Real rule is `group.length >= 2` (orthogonal). Fixed: step 2 now
   drops a 2nd tier-1 onto one existing tile → 2 touch → merge; welcome bullet
   now reads *"מזגו 2 אבנים זהות שנוגעות (אופקי/אנכי)"*. Animation helpers
   (`performStepAnimation`/`animateMergeAt`/`animateChainHop`) rewritten to be
   **data-driven** from each step's `after` descriptor (`landRow`/`popCells`/
   `mergedAt`/`chainWith`/`chainResultAt`) — no more hardcoded "pop bottom 3".
2. **Arrow pointed at the wrong column.** `.ftue-arrow` used
   `transform: translateX(50%)` while JS sets `left` to the column CENTER — that
   shifted the arrow RIGHT by a full arrow-width (~28px ≈ half a column), so it
   hovered over the GAP beside the highlighted column. Measured live: +28px off.
   Fixed to `translateX(-50%)` (centers on the point; RTL-agnostic). Applied to
   the base rule + `ftueArrowBounce` + `ftueArrowNudge` keyframes.
3. **Demo tiles looked different from the game.** FTUE rendered an inset CIRCLE
   (`border-radius:50%`, 88%, svg 70%); the real game fills the CELL as a rounded
   square (`border-radius:10px`, svg 62%). Fixed `.ftue-tile` to fill the cell as
   a rounded square with svg 62% — now identical to the live board (also fixes
   the circular "next piece" preview).
4. **No explanation of special tiles.** The demo never mentioned the 6 in-game
   events. Added a recognition grid to the **graduation card** (the last screen
   before play): 💣 פצצה / ⭐ כוכב / 🎁 מתנה / 🔥 טירוף / ❄️ הקפאה / 🎯 מטרה, each
   with a one-line description. Chose a recognition card over 6 forced
   interactions to stay inside the UX 5-questions gate (understood <3s, no
   overload). Source of truth for the 6 events: [src/14-events.js](../../src/14-events.js) `EVENT_TYPES`.
5. **Done-flag ignored at boot (re-fire bug).** `ftueAlreadyDone()` read
   `localStorage.getItem(FTUE_KEY)`, but the app is one IIFE and 13-boot.js
   (concatenated BEFORE 15-ftue.js) calls it **synchronously at module-eval
   time**, before `var FTUE_KEY = 'bloom_ftue_done'` is assigned → it was
   `undefined` → `getItem(undefined)` → always null → `ftueShouldRun()` always
   true. Masked by the `!hasHistory` gate (anyone who'd finished ≥1 game was
   saved), so it bit the cohort who saw the tutorial but hadn't completed a game:
   they re-saw the FTUE every visit. **Reproduced live** (skip via the real
   button → reload → FTUE fired again). Fixed by reading the literal
   `'bloom_ftue_done'` key inside `ftueAlreadyDone()`, independent of eval order.

Build clean (`node --check`), engine self-test clean (200 games / 0 floating
tiles), live-verified after deploy. Cache `v20260603a`, SW `bloom-v26.3`.

---

## 🔭 Backlog — future onboarding work

| # | Task | Why | Effort |
|---|------|-----|--------|
| **FT.2** | **Interactive FTUE on the REAL engine** (seed-controlled `init`, intercept the first 2-3 drops, pause/resume the tour). Replaces the scripted demo. | The demo now matches the rule, but a player learning on the actual board is the gold standard. Deferred originally for engine-risk; revisit if D1 data demands it. | L |
| **FT.3** | **Explicit horizontal-merge beat.** Step 2 stacks vertically; step 3 shows a horizontal chain. Add/clarify a beat where two tiles meet **side-by-side** so the "אופקי גם נחשב" lesson is unmistakable. | Players over-learn "stack in a column" and miss horizontal merges. | S |
| **FT.4** | **Skip-rate analytics per step.** `tutorial_step` / `tutorial_skip` already fire — build an admin view of where players bail. | Find the exact beat that loses new players; tune copy/pacing. | S |
| **FT.5** | **Replayable tutorial** from the info/"איך משחקים?" modal for players who skipped or want a refresher. | The FTUE is once-and-done; there's no way back to it today. | S |
| **FT.6** | **Audit first-real-game coach-marks** (`maybeOnboardStep*` in [src/11-game.js](../../src/11-game.js)). Confirm they fire after the FTUE and don't contradict it. | The FTUE hands off to a real game — the coach-marks must continue the lesson, not restart it. | S |
| **FT.7** | **A/B test FTUE on/off + length vs D1 retention** once GA4 is live (`GA_ID` env var). | The whole point of the FTUE is D1; measure it. | M |
| **FT.8** | **Deeper new-player playthrough audit** of the first REAL game (not just the tutorial) — empty-state, first game-over, first reward, first home. `BloomDebug` is currently limited (`setColumnMultipliers`/`restart` only); consider exposing `drop`/`setMode` behind a debug flag to enable automated new-player QA. | The user asked to "play as a real new player and find problems" — FT.1 covered the tutorial; the first real session deserves the same scrutiny. | M |

---

## Guardrails (don't regress)

- **The demo must teach the REAL rule.** If you touch FTUE_STEPS, keep it at
  **2 identical adjacent tiles → merge** (never "3"). Cross-check against
  `group.length >= 2` in 11-game.js and the tour copy in 12-tour-info.js.
- **The arrow centers on the column** via `translateX(-50%)` + JS `left`=center.
- **Demo tiles must look like the live board** (cell-fill rounded square, svg
  62%) — not circles.
- **`ftueAlreadyDone()` must read the literal key** (eval-order safe). Don't
  "optimize" it back to `FTUE_KEY`.
- Every change runs through the **UX 5-questions gate** (see CLAUDE.md §10b).
- **RTL arrow direction (FT.1.1):** the game is RTL, so in any "inputs → result"
  tile illustration the result renders on the LEFT. A connector arrow must point
  LEFT (`←`, toward the result), not `→` (which reads backwards as "result →
  inputs"). The in-game tour uses the shared `TOUR_MERGE_ARROW` constant for this
  — keep it. Inline text arrows inside sentences ("הזמן חבר → +200💎") are
  idiomatic and stay `→`.
