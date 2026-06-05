# BLOOM — Home Redesign "🧩 אריחים" (tiles variant) — design spec

**Date:** 2026-06-06
**Owner ask:** Home looked overloaded. Redesign so PLAY wins the fold, it's calm/clear/addictive, uses the **real game tiles** (not a flower), maximizes player dopamine. The **admin must be able to choose between home versions** (keep or revert).
**Approved artifact:** [docs/mockups/home-redesign-v2.html](../../mockups/home-redesign-v2.html) (user: "אהבתי מאוד … נראה טוב פלוס"), with one correction applied: the tier ladder reads **stone-left → crown-right**, and the same direction is applied to the in-game "how to play" explanations.

## Decision

Ship as a **new selectable home variant `'tiles'`** in the existing `home_variant` system (`src/31-home-variants.js`), alongside `standard / carousel / hero / jit`. Pure **decorator** on the existing v2 home — reuses every existing tile, handler, and data fetch; only reorders / restyles / adds a few self-contained elements. Zero engine touch.

**Admin chooses:** the variant is selectable in the admin 🏠 home-variant picker. Default stays `hero` for now; a **preview override** (`?hv=tiles`, persisted to `localStorage.bloom_home_variant_force`, `?hv=auto` clears) lets the admin/owner preview any variant live without changing the global default. Once the owner approves live, they flip the global to `tiles` in the admin panel (or we flip the seed default).

## What the `'tiles'` variant does (home tab, bottom-nav active)

1. **PLAY wins the fold.** Move `#home-v2-start` (the existing PLAY CTA) up to right under the brand (above `#home-v2-hero` + `#home-v2-pid`) and style it as the dominant, breathing gold hero. Inject a small looping **merge-tease** (leaf+leaf→flower using `getActiveTiers()`) in its corner — shows the satisfying core loop = dopamine/anticipation.
2. **Tier-ladder progress strip** (NEW, `#home-tiles-ladder`) right under PLAY: all 8 real tiles from `getActiveTiers()`, stone-LEFT → crown-RIGHT (`direction:ltr`). Reached tiers (≤ `loadLifetimeInt(BEST_TIER_KEY)`) show a ✓ and full color; the next tier pulses gold with "כמעט! עוד דרגה ל-X". The near-goal + progress hook, using tiles the player knows.
3. **Single stable hot card.** Reuse `#home-v2-hero` to show `collectHotSignals()[0]` as ONE non-rotating card (kills the disorienting auto-rotating carousel the audit flagged). Hidden if no signal.
4. **Floating game tiles** drift in the home background (replaces the generic look) — `getActiveTiers()` tiles at low opacity.
5. Quick actions (`.home-v2-actions`) + bottom-nav (incl. the now-filled קהילה tab) unchanged. All other tiles relocated to tabs by the existing bottom-nav observer.

All new CSS scoped under `body[data-home-variant="tiles"]` so the other 4 variants are byte-unaffected.

## How-to-play direction fix (same direction everywhere)

Make the tier progression read **stone-LEFT → crown-RIGHT** in the tutorial too (the in-game tier-bar already does):
- `.tour-row` → add `direction:ltr` (public/css/home.css) **and** flip `TOUR_MERGE_ARROW` `←`→`→` (src/12-tour-info.js) — must ship together.
- `.ftue-welcome-ladder` → add `direction:ltr` (public/css/viral.css).
- (cosmetic) `.tour-welcome .icons-row` → `direction:ltr`.
No engine risk: tier-bar highlight binds to `data-tier`, never DOM index (verified).

## Safety / reversibility

- Gated on `getHomeVariant() === 'tiles'`; default unchanged → byte-identical current home until selected.
- `try/catch` around the whole `applyTilesVariant`.
- Admin can switch to any of the 5 variants in one click.
- Engine self-test + node --check + build must stay clean; live-verify via `?hv=tiles` before flipping any default.

## Out of scope

- No new monetization surfaces. No engine/scoring changes. Banner-stacking (streak/gift/comeback) consolidation is folded in only as far as the tiles layout already calms the top-of-home; a full banner queue is a separate task.
