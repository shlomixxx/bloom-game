# Game-UI Compaction (Approach B + Rollback)

**Date:** 2026-05-28
**Status:** Approved by user (2026-05-28)
**Goal:** Reduce in-game chrome from 232px (34% of viewport) to ~145px (21%), giving the 4×6 grid ~75-85px additional space → cells grow from 63 → 71-73px (+13%) on mobile. User must be able to revert if they dislike the result.

---

## Current state (measured 500×685 viewport)

| Element | Height | % viewport |
|---|---|---|
| `.top` (brand + 5 icons + 4 stats) | 124px | 18% |
| `.mode-bar` | 50px | 7% |
| `.tier-bar` (kept always) | 58px | 8.5% |
| **Total chrome** | **232px** | **34%** |
| Grid (cell 63×63) | 403px | 59% |

---

## Approach: B (Balanced) with rollback safety

### Phase 1 — Compact stats row
- Single horizontal row instead of 2-stack
- Score: 22px (was 28). Best/streak: 13px. Wallet: 14px gold pill
- Padding 8/12 → 4/8. Height target: 60 → 44 (-16px)
- **Preserves** score bump animation + dopamine pop on score-up

### Phase 2 — Mode-chip in `.top-row`
- Hide `.mode-bar` entirely via CSS (`display:none`)
- New `.mode-chip` element appended into `.top-row`, right of icon buttons
- Renders: `📅 יומי 27.05 · 📦 ברירת מחדל ⌄` (mode emoji + name + difficulty + chevron)
- Tap → existing `showModePicker()` (same flow as current chevron)
- Reuses existing logic in `updateModeBar()` — just paints a different DOM node
- **Savings: ~50px** (entire mode-bar row)

### Phase 3 — `⋯` menu for secondary icon buttons
- `.top-buttons` keeps 3 buttons visible: 🔊 mute · 🏆 LB · ⋯ menu
- 4 buttons collapse into a popover anchored under `⋯`:
  - 🏠 home (back to home tab)
  - 🏅 achievements
  - ℹ️ info
  - 🔄 reset (with confirm)
- **NEW:** the popover ALSO contains a "🎨 גירסה ישנה" link → the rollback toggle
- Popover dismissed via ESC + click-outside + back gesture
- a11y: role="menu", aria-haspopup="true", focus-trap

### Phase 4 — Tier-cell narrow-viewport safety
- Below 360px viewport width (iPhone SE / older Androids), tier-cell shrinks 32px → 28px
- Prevents horizontal scrollbar when 8 cells don't fit
- Pure CSS: `@media (max-width: 360px) .tier-icon { width: 28px; height: 28px }`

### Phase 5 — Cross-page consistency audit
- **Game-over screen**: stats display matches new style (smaller, single-line)
- **Home tab (Power Hero)**: CTA shows "🎮 שחק עכשיו" — when entering game, the mode-chip on top should match the home's mode badge style for continuity
- **Daily reward modal**: re-measure → ensure not clipped by changed `.top` height
- **In-game LB modal**: launcher button (🏆) still has 44+ tap target

### Phase 6 — Rollback mechanism (REQUIRED)
**Trigger paths:**
1. **In-menu link**: ⋯ menu → "🎨 גירסה ישנה" → flips localStorage `bloom_game_ui_legacy='1'` → reload
2. **URL param**: `?ui=legacy` → instant test without committing the setting
3. **Body class**: `body.legacy-game-ui` reverses all Phase-1-4 changes via CSS
4. **Easy return**: legacy layout shows a small "↩ נסה את העיצוב החדש" link near the bottom → flips back

**CSS pattern:**
```css
/* New layout = default (no class needed) */
.stats { /* compact */ }
.mode-bar { display: none; }
.mode-chip { display: flex; }

/* Legacy override */
body.legacy-game-ui .stats { /* original padding/sizes */ }
body.legacy-game-ui .mode-bar { display: flex; }
body.legacy-game-ui .mode-chip { display: none; }
```

**localStorage key:** `bloom_game_ui_legacy` ('1' = legacy, anything else = new)
**Default:** new layout
**Persistence:** survives reload + service-worker cache busting

---

## Acceptance criteria

- [ ] Chrome total ≤ 150px on 390px viewport
- [ ] Cell size ≥ 71px on 390px viewport
- [ ] No horizontal scroll on 320px viewport
- [ ] Score bump animation still visible + felt
- [ ] Mode change accessible in ≤ 2 taps from any screen
- [ ] User can revert via ⋯ menu in <5 seconds
- [ ] Engine self-test: 200 games / 0 floating tiles
- [ ] 0 console errors during natural boot + game

---

## Out of scope (future)

- Real-money IAP integration
- New game modes
- Re-balancing scoring
- Multi-language (RTL-only for now)

---

## Implementation order

| Phase | Files touched | Risk | Rollback impact |
|---|---|---|---|
| 1. Compact stats | base.css | Low | CSS-only revert |
| 2. Mode chip | index.html, 11-game.js, base.css | Med | New element + CSS |
| 3. ⋯ menu | index.html, 13-boot.js (or new file), base.css | Med | New module |
| 4. Tier-cell narrow | base.css | None | @media only |
| 5. Cross-page audit | various | Low | Mostly visual checks |
| 6. Rollback mechanism | 13-boot.js, base.css | Low | Body class + CSS |

Total estimated commits: 6. Test after each.
