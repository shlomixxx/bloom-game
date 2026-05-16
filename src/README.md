# src/ — BLOOM source files

These files are concatenated (in numeric order) into `public/app.js` by `build.sh`.  
All files share **one IIFE closure** — `01-constants.js` opens `(function() {`, `13-boot.js` closes `})();`.

## Files

| File | Lines | What's inside |
|------|-------|---------------|
| `01-constants.js` | ~295 | IIFE open, board dims, SVG icons, TIERS, WEIGHTS, skin packs, theme/skin abstraction |
| `02-shop.js` | ~501 | 1v1 duel system, in-game tile shop, power-ups, roulette |
| `03-audio.js` | ~374 | localStorage keys, API_BASE, Web Audio synth, music loader, volume controls |
| `04-ui-utils.js` | ~386 | Theme switcher (light/dark/auto), mute menu, streak, achievements system |
| `05-home.js` | ~208 | `showHome()`, `hideHome()`, button wiring |
| `06-contests.js` | ~962 | Contest menu, create/join, contest leaderboard, live score push |
| `07-identity.js` | ~291 | RNG (`mulberry32`), date helpers, `getDeviceId`, `getPlayerName` |
| `08-contest-helpers.js` | ~637 | Contest helpers, practice state save/restore, social proof, jackpot, viral (streak/mini-lb/addiction) |
| `09-challenges.js` | ~654 | Challenge list, detail, enter, in-game, result screens |
| `10-spectator.js` | ~290 | Spectator picker, `startSpectator`, `spectatorTick`, `renderSpectatorView` |
| `11-game.js` | ~998 | `init()`, grid logic, `drop()`, `findGroup()`, `applyGravity()`, `processChains()`, scoring, share |
| `12-tour-info.js` | ~651 | Interactive tutorial, `showInfo()`, `render()` |
| `13-boot.js` | ~228 | Boot sequence, BloomDebug, PWA install, IIFE close |

## How to build

```bash
./build.sh           # Concatenate → public/app.js + public/styles.css
./build.sh --watch   # Auto-rebuild on change (requires fswatch)
```

## Rules

- **Don't edit `public/app.js` directly** — it's generated. Edit `src/*.js` then run `build.sh`.
- **Don't edit `public/styles.css` directly** — edit `public/css/*.css` then run `build.sh`.
- The numeric prefix controls load order. Don't renumber without checking dependencies.
- All 250 functions are hoisted (`function` declarations), so call order doesn't matter.
- `let`/`const`/`var` state variables must be declared before use — they're concentrated in `01-constants.js` and `03-audio.js`.
