# HOME_REDESIGN_TASKS — Bottom-Nav redesign + global referral

**Created**: 2026-05-27
**Driver**: User wants the home stripped down to a single clear CTA + 5 bottom-nav tabs, and EVERY share surface to embed the user's BLOOM code so the referral counter + push notifications fire automatically.

**Two parallel tracks**:
- **Track A** — Referral system universal (smaller, ship first)
- **Track B** — Bottom-nav redesign (bigger, multi-phase)

---

## Track A — Referral System Universal

**Goal**: every share → carries `?ref=BLOOM-XXXX` → recipient who registers triggers a counter bump + push notification to the referrer.

### A0 — Audit every share surface
- [x] Friend invite from friends modal ([src/05c-dynamic-boards.js](../../src/05c-dynamic-boards.js) `shareInviteViaWhatsApp` / `buildInviteUrl`)
- [ ] Replay sharing ([src/27-replay.js](../../src/27-replay.js) canvas → WhatsApp / Native / Copy / Save)
- [ ] BLOOM Wrapped weekly recap ([src/40-weekly-recap.js](../../src/40-weekly-recap.js))
- [ ] Profile page share (`/player/BLOOM-XXXX` HTML view)
- [ ] Game-over share (Wordle-style emoji grid)
- [ ] Contest "share code" copy button
- [ ] Duel "send challenge" link
- [ ] Daily-login bonus modal "share my reward" (if exists)

For each one — verify the URL/text built includes `?ref=<myCode>`. If the user has no name set, fall back to `BLOOM-XXXX` only (no name).

### A1 — Build universal `buildShareUrl()` helper
- [ ] New function in `src/07-identity.js`: `buildShareUrl(path='/', extraParams={})`. Returns full origin + path + `?ref=BLOOM-XXXX&...`. Reads `playerCode` from in-scope binding (NOT localStorage — needs to be the canonical server-issued code).
- [ ] New function `buildShareText(template, vars)` that takes a template string with `{ref}`/`{score}`/`{url}` placeholders.
- [ ] Replace every existing share-URL construction with calls to these helpers.

### A2 — Server referral counter
- [ ] Audit existing `/api/referral` endpoint (rate-limited 3/day from CLAUDE.md). Verify it increments a counter.
- [ ] New column `player_profiles.referral_count INT DEFAULT 0` (idempotent migration).
- [ ] In the `?ref=` autohandler ([src/05c-dynamic-boards.js](../../src/05c-dynamic-boards.js)), when a new device-id registers via the ref link, server must:
  - Insert a `referrals` row (referrer + referee + dt)
  - `UPDATE player_profiles SET referral_count = referral_count + 1 WHERE device_id = <referrer>`
  - Fire a push notification to the referrer: "🎁 {newPlayerName} הצטרף דרך הקוד שלך — +200💎 לשניכם!"
- [ ] New table `referrals(id BIGSERIAL, referrer_device VARCHAR(64), referee_device VARCHAR(64) UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW())` with index on referrer_device.

### A3 — Referral counter UI on home
- [ ] Add a small pill near the player's BLOOM code: "👥 הזמנת 7" (clickable → opens friends modal at "my referrals" section)
- [ ] Inside friends modal, new section "📊 הסטטיסטיקות שלי" — total referred + total earned from referrals + list of names (top 5).
- [ ] When counter increments, show toast "🎁 {name} הצטרף בזכותך! +200💎" with confetti.

### A4 — Verify push notification end-to-end
- [ ] Push to referrer fires within 1s of new registration via ref link.
- [ ] Push includes referee name + deep-link to friends modal.

---

## Track B — Bottom Nav Home Redesign

**Goal**: 5 tabs at the bottom, each with focused content. Home tab has 4 elements only: currency strip / rotating hero / massive PLAY CTA / today's challenge hint.

### B0 — Foundation: Bottom Nav skeleton
- [ ] New file `src/46-bottom-nav.js` (own IIFE)
- [ ] Render 5-button bar: 🏠 משחק / 🎁 פרסים / 👥 קהילה / 🏆 דרגות / 🛍 חנות
- [ ] Sticky bottom, 60px tall, `position: fixed`, safe-area-inset-bottom respected
- [ ] Active tab indicator (top bar above icon + filled color)
- [ ] Badge component per tab (red dot or count number)
- [ ] localStorage `bloom_active_tab` persists selection
- [ ] `window.__bloomGoToTab('rewards')` global router
- [ ] CSS in new `public/css/bottom-nav.css` added to `build.sh`

### B1 — Home tab simplification
- [ ] Rip out everything from `#home-screen` except: currency strip / brand / pid / rotating-hero-card / massive PLAY CTA / today's challenge hint
- [ ] Remove `#home-variant-hero-extras` drawer (no longer needed — its content is now in tabs)
- [ ] Stage 31 `applyHomeVariant` becomes a no-op when bottom-nav active

### B2 — Rewards tab content
- [ ] New screen `#tab-rewards-screen`
- [ ] Top: Login Calendar 7-day strip (always visible at top)
- [ ] Then: Spin Wheel tile + Daily Free Gacha tile (side-by-side compact)
- [ ] Then: Daily Quests checklist (3 quests + claim buttons)
- [ ] Then: Horizontal-swipe Daily Deals carousel
- [ ] Then: Battle Pass tile (progress + claim count)
- [ ] Then: Starter Pack / Bundles section (when active)
- [ ] Bottom: footer "מתעדכן כל חצות ⏰"

### B3 — Social tab content
- [ ] New screen `#tab-social-screen`
- [ ] Top: ⚡ Live PvP Race entry (biggest card)
- [ ] Then: Rivalry 24h tile (if active)
- [ ] Then: Friends list compact (top 5 online, "see all" expander)
- [ ] Then: Guild tile + Guild Wars (if member)
- [ ] Then: Squad Tournament (if in active)
- [ ] Inbox: floating top-right of this tab (red badge if unread)

### B4 — Progress tab content
- [ ] New screen `#tab-progress-screen`
- [ ] Top: Trophy Road horizontal strip (8 arenas + my position pulsing)
- [ ] Then: Weekly League card (current tier + progress + unclaimed reward)
- [ ] Then: Lifetime Progression (level + prestige stars)
- [ ] Then: Achievement progress bar (X / Y unlocked)
- [ ] Then: Album progress (cells collected)
- [ ] Then: BLOOM Wrapped link (if Sunday or recent)
- [ ] Leaderboard button at bottom (opens existing LB modal)

### B5 — Shop tab content
- [ ] New screen `#tab-shop-screen`
- [ ] Top: Skins gallery (horizontal swipe + owned/unowned ribbon)
- [ ] Then: Gacha tile (pull + 10x + free-pull indicator)
- [ ] Then: Gem Bank (balance + 1%/day rate + ms-till-next-interest)
- [ ] Then: Boosters (PICK 🎯 + POP 💥 with prices, "buy in-game")
- [ ] Stripe IAP placeholder section at top (defer)

### B6 — Game tab routing
- [ ] When user clicks 🎮 שחק עכשיו → start game; bottom nav hides during game
- [ ] On game-over, bottom nav restored
- [ ] Each tab also routes "home" back to home tab when player clicks logo

### B7 — In-game UI cleanup
- [ ] Hide tier-ladder behind "?" icon (always-on row consumes ~60px)
- [ ] Mode bar → single chip "🎯 יומי 27/05" (currently full-width bar)
- [ ] Verify 4×6 cells get the reclaimed vertical space

### B8 — Final polish + verification
- [ ] Engine self-test 200 games / 0 floating tiles
- [ ] Chrome viewport tests at 390×844 (mobile) + 768×1024 (tablet)
- [ ] All 5 tabs reachable + each shows expected content
- [ ] No console errors
- [ ] Badge counts update in real-time

---

## Order of execution

1. **Phase A** ships FIRST (referral system) — smaller scope + user said "הכי חשוב"
2. Phase B0 (bottom-nav skeleton) — POC that user can see
3. Phase B1 (home cleanup) — proves the model works
4. Phase B2-B5 in order (one tab per session)
5. Phase B7 (in-game) — touch only when home is fully stable

---

## Out of scope (defer)

- Stripe IAP gem packs (depends on legal/payment work)
- Native app wrapper
- New monetization features beyond what exists
