# GV.4 — Bring v2 board mechanics INTO the classic app (only the board changes)

**Date:** 2026-06-05
**Status:** approved (user confirmed design in-chat)

## Problem

GV.1–3 shipped "Game v2" as a **standalone full-takeover** module: when the flag is on,
the entire classic app (home, leaderboards, trophies, Battle Pass, friends, daily,
shop — the whole 50+-stage retention meta) is **replaced** by a bare board. The user's
actual intent: **only the in-game playfield should change to the v2 feel; everything
else must work exactly as today.** And the admin must be able to revert to the exact
pre-session classic state instantly.

## Decision (user-confirmed)

- **Board stays 4×6 + classic scoring.** (CLAUDE.md §10 protects these; changing to 4×7
  would break dynamic-board shapes, FTUE, the server bot, and make the shared
  leaderboards/trophies/BP unfair by mixing two score scales.) Leaderboards stay valid.
- **Bring the full v2 *feel* into the real classic engine, gated by the existing
  `game_v2` flag:** hold/swap slot, ghost-landing preview + drag-to-aim, the v2 visual
  look, and extra juice (score-pop + "🏆 new best" celebration). Plus the 💬 feedback
  widget for the beta.
- **Flag OFF = byte-behaviour-identical classic** (instant revert / kill switch). Every
  v2 code path is gated on a runtime `v2On()` check; when off, only the classic path runs.

## Model change

Today the **loader** (public/index.html) chooses classic-vs-v2 and, for v2, imports the
bare module + hides `.app`. New model:

- The loader **ALWAYS loads the classic app** (`app.js` + `bot.js`) for everyone. It still
  fetches `/api/flags/game_v2`, still tags GA `bloom_variant`, still honors beta/force,
  but it only **exposes the variant** to classic: `window.__bloomVariant`,
  `localStorage.bloom_variant`, `<html data-bloom-variant>`. It no longer imports
  `game-v2.js` or hides `.app`.
- The classic app reads the variant at boot and, when `'v2'`, adds `body.bloom-v2` and
  enables the gated mechanics. The standalone `public/js/game-v2.js` +
  `public/css/game-v2.css` (bare takeover) are **retired** (no longer referenced).

Because games already start through `init('practice',{fresh:true})` and ALL game-over
meta hooks (score submit, trophies, pet, guild, duel, contest, mystery chest, season XP,
streak, achievements, quests, starter-pack) fire **inside** the classic engine
(src/11-game.js ~3590–4071), enhancing the engine **in place** leaves every meta system
working unchanged.

## Gated mechanics (all behind `v2On()`; default off → classic)

1. **v2 look** — `body.bloom-v2` + a new `public/css/v2-mechanics.css` (added to build.sh,
   every rule scoped under `body.bloom-v2`). Mirrors the `syncBodySkinClass` pattern
   (src/01-constants.js). Restyles the board/cells/header subtly for the v2 vibe; flag
   off → no class → classic look.
2. **Hold / swap slot** — new `heldPiece` state in src/11-game.js (reset in `init()`); a
   hold UI chip near the tier-bar; tapping it swaps `nextPiece` ↔ `heldPiece` (once per
   drop). Gated; invisible + inert when off.
3. **Ghost preview + same-tier pulse + drag-to-aim** — in `render()` (src/12-tour-info.js):
   when v2On(), show a translucent landing preview of `nextPiece` in the aimed column,
   highlight that column, and pulse orthogonal same-tier neighbors of the landing cell.
   A pointer layer on `#grid` lets the player drag to choose the column and release to
   drop (tap-to-drop still works). All gated; classic keeps pure tap-to-drop.
4. **Juice** — score-stat pop on each gain + a "🏆 שיא חדש!" celebration when the live
   score first crosses the previous best (reusing `soundMilestone`/`buzz`/`window.__bloomConfetti`).
   Classic already has the above-best pill; the v2 path adds its flavor without duplicating.
5. **💬 feedback** — a small gated feedback affordance (reuses the existing
   `POST /api/feedback` + admin panel from GV.2) so beta testers can rate the new board.

## Admin / revert (unchanged surface)

The "🧪 Game v2" admin card (enable / rollout % / beta / force link) + the "💬 משוב"
panel stay exactly as in GV.2/3. **Flag OFF (enabled=false, beta off, rollout 0) → every
player gets the classic app exactly as before this session.** That is the instant revert.

## Safety / verification

- Every v2 branch guarded by `v2On()` (reads the variant once at boot). Flag off → classic
  code path only → identical runtime behavior. (app.js bytes change because gated code is
  added, but flag-off *behavior* is unchanged — that is the revert guarantee.)
- `node scripts/test_engine.mjs` (200 games / 0 floating tiles) must pass unchanged
  (it never sets the flag → exercises the classic path).
- Playwright: (a) flag OFF → classic home + board exactly as today, no v2 artifacts;
  (b) flag ON → classic home + all meta tiles present AND the board shows hold/ghost/v2
  look, plays to game-over, and the over-screen meta (trophies/score/etc.) fires.
- Keep 4×6 + scoring untouched; do not touch dynamic-board/FTUE/bot code.

## Out of scope

- 4×7 board, v2 scoring (rejected for fairness/breakage).
- Per-mechanic admin toggles (the single `game_v2` flag is the master control for now).
