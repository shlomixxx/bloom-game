<!-- Generated 2026-07-10 by a 7-agent scoring workflow (heuristic — no live analytics). Validate against the admin dashboard before deleting code. Companion to IMPROVEMENT_PLAN.md. -->

# BLOOM Feature Scorecard — Add / Change / Delete

**Net score = retentionValue + monetizationValue − maintenanceCost − uiClutter.** Higher = more value per unit of cost/clutter carried. This is a triage signal, not a verdict on its own — a few negative-Net systems are correctly KEPT because they own a unique axis the linear formula can't see (churn-prevention, the only working async-delivery channel, D1 onboarding). Those exceptions are flagged.

**Headline:** 29 of 46 systems score negative Net — the catalog's maintenance + clutter cost now exceeds its retention + monetization value in aggregate. This is a **consolidation problem, not a feature-gap problem.** The single most valuable move is deletion, not addition.

---

## 1. Scorecard table (sorted by Net, descending)

| # | Feature | R | M | Mnt | UI | **Net** | Verdict |
|---|---------|---|---|-----|----|---------|---------|
| 1 | Season Pass + Premium | 85 | 88 | 66 | 35 | **+72** | KEEP ⭐ |
| 2 | Bottom Nav (46) | 80 | 45 | 50 | 18 | **+57** | KEEP ⭐ |
| 3 | Starter Pack | 40 | 85 | 40 | 35 | **+50** | KEEP |
| 4 | Daily Special board | 78 | 18 | 22 | 24 | **+50** | KEEP ⭐ |
| 5 | Trophy Road (engine) | 88 | 35 | 46 | 34 | **+43** | KEEP ⭐ |
| 6 | FTUE onboarding (15) | 78 | 10 | 40 | 5 | **+43** | KEEP ⭐ |
| 7 | Skin Gacha | 75 | 85 | 76 | 45 | **+39** | KEEP |
| 8 | Live Tournaments | 78 | 30 | 42 | 34 | **+32** | KEEP ⭐ |
| 9 | 1v1 Duels (+ live-race) | 85 | 46 | 66 | 35 | **+30** | KEEP ⭐ |
| 10 | Daily Deals | 45 | 78 | 52 | 44 | **+27** | KEEP (only sink) |
| 11 | Daily Spin Wheel | 90 | 20 | 45 | 42 | **+23** | KEEP ⭐ |
| 12 | Device Sync (48) | 55 | 5 | 30 | 12 | **+18** | KEEP |
| 13 | Tile Shop + power-ups | 30 | 55 | 45 | 25 | **+15** | KEEP |
| 14 | Self-Promo engine (45) | 15 | 55 | 40 | 20 | **+10** | KEEP |
| 15 | Trophy Road milestones | 82 | 25 | 62 | 40 | **+5** | KEEP (= #5) |
| 16 | Referrals (07) | 42 | 8 | 35 | 15 | **0** | KEEP (backbone) |
| 17 | Friends Contests | 60 | 40 | 62 | 38 | **0** | IMPROVE |
| 18 | Notification Inbox (36) | 55 | 5 | 45 | 18 | **−3** | KEEP (only channel) |
| 19 | Limited Bundles | 40 | 55 | 52 | 46 | **−3** | MERGE → Daily Deals |
| 20 | Priority Calmer (80) | 55 | 30 | 55 | 35 | **−5** | IMPROVE |
| 21 | Weekly Leagues | 55 | 15 | 38 | 42 | **−10** | MERGE → Trophy Road |
| 22 | Daily Checklist | 55 | 22 | 48 | 42 | **−13** | IMPROVE (→ hub) |
| 23 | Replay Share PNG (27) | 35 | 8 | 35 | 25 | **−17** | KEEP (K-factor) |
| 24 | Push + Smart-push (16) | 45 | 10 | 60 | 15 | **−20** | IMPROVE (highest ceiling) |
| 25 | Lives / Energy | 15 | 30 | 55 | 10 | **−20** | CUT |
| 26 | Achievements + cross-LB | 62 | 18 | 45 | 55 | **−20** | IMPROVE (split) |
| 27 | Pet / Mascot | 72 | 32 | 72 | 55 | **−23** | KEEP (unique axis) |
| 28 | Golden Hour / Events | 25 | 8 | 24 | 32 | **−23** | MERGE → Daily Special |
| 29 | Game v2 board (52) | 62 | 12 | 72 | 25 | **−23** | IMPROVE (graduate) |
| 30 | 7-Day Login Calendar | 55 | 8 | 40 | 46 | **−23** | MERGE → Daily Spin |
| 31 | Danger/Flow/Idle (11) | 58 | 15 | 60 | 38 | **−25** | IMPROVE |
| 32 | Lifetime Prestige | 42 | 15 | 35 | 50 | **−28** | IMPROVE-or-CUT |
| 33 | BLOOM Challenges | 45 | 15 | 50 | 38 | **−28** | MERGE → Tournaments |
| 34 | Guild Wars | 40 | 12 | 52 | 30 | **−30** | MERGE (survivor clan) |
| 35 | Home Variants A/B (31) | 45 | 30 | 78 | 30 | **−33** | IMPROVE (collapse to 1) |
| 36 | Weekly Recap / Wrapped (40) | 30 | 3 | 48 | 20 | **−35** | MERGE → Replay Share |
| 37 | Friend Search/List/Notify (49/50/51) | 55 | 10 | 60 | 45 | **−40** | IMPROVE (keep primitive) |
| 38 | In-game Boosters (35) | 20 | 35 | 42 | 55 | **−42** | MERGE → Tile Shop |
| 39 | Ghost Mode (44) | 28 | 8 | 38 | 40 | **−42** | CUT |
| 40 | Rivalries (29) | 30 | 12 | 46 | 44 | **−48** | CUT |
| 41 | Gem Bank interest (42) | 42 | 15 | 62 | 48 | **−53** | CUT |
| 42 | Friend Challenges (39) | 32 | 5 | 50 | 40 | **−53** | CUT |
| 43 | Squad Tournaments (43) | 22 | 10 | 58 | 28 | **−54** | CUT |
| 44 | Trophy Chests (38) | 48 | 15 | 72 | 55 | **−64** | MERGE → Trophy Road |
| 45 | Feature Discovery (47) | 32 | 12 | 55 | 55 | **−66** | IMPROVE (banner only) |
| 46 | Tile Collection Album (25) | 30 | 12 | 55 | 60 | **−73** | MERGE → Achievements |

**Verdict counts:** KEEP 19 · IMPROVE 11 · MERGE 10 · CUT 6.

---

## 2. ✂️ CUT / MERGE (do first)

The bottom of the table is dominated by **duplicate members of overloaded clusters.** Retention risk on every item below is **low** — all are admin-toggleable, so you kill-switch first and delete code only after the DAU/D1 line holds flat. You are not removing a lever; you are removing the *third or fourth copy* of a lever you keep.

### The four overlap clusters killing the catalog

**A. Too many competitive ladders (5 → 2).** Trophy Road, Weekly Leagues, Season Pass, Lifetime Prestige, and the Achievement cross-leaderboard all teach one lesson: *play → climb a rank → claim gems.* Five parallel ladders dilute each other's meaning and split five home tiles.
- **Weekly Leagues → MERGE into Trophy Road** (Net −10). Fold the Sunday-reset "fresh chase" into a Trophy Road seasonal element. Retire `player_weekly_xp` + its tile.
- Survivors: **Trophy Road** (the loss-aversion spine) + **Season Pass** (the premium/XP ladder). Two ladders, distinct jobs.

**B. Too many daily-return faucets (6 → 2).** Daily Spin, 7-Day Login Calendar, the `daily_login` streak bonus, Trophy Chests, Gem Bank, and Pet all hand out gems for showing up. Six systems, one lesson, and collectively they **inflate the economy** — which the project's own AD.9 dashboard flags as the thing that weakens every gem-sink.
- **7-Day Login Calendar → MERGE into Daily Spin's streak** (Net −23). One daily-claim ladder, not three. The 5000-gem day-7 jackpot is an inflation risk — cap it on merge.
- **Trophy Chests → MERGE into Trophy Road milestones** (Net −64, the worst clutter/cost ratio in the batch). Convert chest rewards to direct milestone gem grants; **delete the 4-slot/4-8-24h-timer machinery** — it buys nothing because there's no pay-to-skip sink. The "appointment at a specific hour" job is already done by the Daily Auto-Tournament.
- **Gem Bank → CUT** (Net −53). It is the *only* gem faucet with a compounding-interest cron that actively **rewards hoarding** and re-inflates the economy — it fights every sink (Gacha/Bundles/Shop/Starter) the monetization plan depends on. Its one merit (daily "check interest") is already owned by Spin + Login. Delete the table + the 03:00 cron. (If ever revived, redesign as a *net sink*: time-locked deposit, 0% interest, exit fee.)
- Survivors: **Daily Spin** (best-in-class variable reward) + **Pet** (kept — distinct guilt/loss-aversion axis *and* a gem sink via feed).

**C. Too many "beat a specific person" loops (4 → 1).** Duels, Rivalries, Ghost Mode, Friend Challenges. Duels already do it best (live 60s race, wager sink, **bot fallback so it works at zero DAU**).
- **Rivalries → CUT** (Net −48). A passive 24h XP-grind against a stranger you never see, needing a live pairing population the game lacks — so rivals are dead accounts and the "race" is hollow. Delete `player_rivalries` + the 4h cron.
- **Ghost Mode → CUT** (Net −42). Score is *linearly interpolated by drop-count* (per its own limitation note) — the race is fake — and it's daily/practice-only. Delete; hooks the hot `drop()` loop for engine risk with zero payoff.
- **Friend Challenges → CUT** (Net −53). A weaker re-implementation of Duels, gated on mutual friendship so it can't fire in a near-empty graph, and its auto-resolve scan runs on **every score submission across daily/practice/dynamic** — a hot-path cost for a loop that rarely fires. Route the intent through Duels.
- Survivor: **1v1 Duels** owns the entire fantasy.

**D. Too many clan-vs-clan systems (2 → 1).** Both are fed by the same `/guilds/contribute` hook.
- **Squad Tournaments → CUT** (Net −54). Needs **12+ simultaneously-active guilded players** (4 guilds × 3 members) to ever fire — dead code at this DAU. Highest maintenance-to-payoff in the batch (4 tables + Wed/Sat state-machine crons).
- **Guild Wars → MERGE** as the single consolidated clan mode (needs only 2 guilds). It stays gated (tile only shows during a war), so clutter is low.

### Also cut
- **Lives / Energy → CUT** (Net −20). Default-OFF, so **zero live value today** while carrying a full system's code. It also *contradicts the prime directive* — energy gating caps sessions, the opposite of "one more drop." Delete; reintroduce deliberately only if an A/B ever demands it.

**Net of Section 2:** eliminate/fold **~15 systems.** No retention lever is lost — every survivor already covers the cut item's job better.

---

## 3. 🔧 CHANGE / IMPROVE (valuable but under-delivering)

Each gets **one** highest-leverage change. Do not rebuild; do the single thing that unlocks the trapped value.

- **Home Variants A/B (31), Net −33** → **Collapse to the one live variant (`tiles`), delete the other 4 branches.** 1074 lines exist to run an A/B a solo dev with no analytics can never read — and it's pinned at 100% anyway. Deleting carousel/hero/jit/standard collapses the maintenance cost and removes the third redundant tile-routing map. *Highest single maintenance win in the catalog.*

- **Game v2 board (52), Net −23** → **Graduate v2 to the only engine; delete the classic fork + feature-flag + beta-cookie scaffolding.** The mechanics (hold/swap, next-up, ghost-aim) are already 100% rolled out. The entire dual-engine tax buys nothing.

- **Feature Discovery (47), Net −66** → **Keep only the next-unlock FOMO banner; delete the discovery tile + the hand-maintained 28-row catalog modal.** Discovery is Bottom Nav's job. Auto-generate any remaining list from the `LEVEL_UNLOCKS` map so it can't drift.

- **Tile Album (25) → MERGE into Achievements; Achievements cross-LB → fold into the achievements modal.** They track the same data (highest tier per board). Keep the completionist *catalog* (proven pillar); delete the redundant 5th ranking surface and the album's separate tables. *(Net −73 and −20 respectively — two cheap deletions from one unification.)*

- **Daily Checklist (22), Net −13** → **Promote it to the canonical daily hub** that routes spin/deal/special/gacha/quest through one surface, and **cut the bundled 30-day Live-Ops calendar.** This turns a clutter item into a net *declutter* (one surface indexes the whole daily cluster).

- **Friends 49/50/51, Net −40** → **Fold the 45s friend-request poller (51) into the Inbox poll.** Three parallel delivery paths (poll + inbox + push) for one signal. Keep the friendship *primitive* (Duels depend on it); deprioritize search until acquisition grows the graph.

- **Weekly Recap (40) → MERGE into Replay Share (27).** Two 720×1280 canvas renderers + two share modals for the same job. Reuse one renderer; surface the weekly trigger as an Inbox row, not an interrupt modal.

- **Push + Smart-push (16), Net −20 but ceiling ~70** → **Fix ADOPTION, not the scheduler.** The 8-signal scheduler is firing into ~3 subscribers. Verify VAPID is set in prod, prompt iOS users to "Add to Home Screen," and surface the soft opt-in at the highest-emotion beats. This is the single highest-*ceiling* lever in the whole batch.

- **Friends Contests (17), Net 0** → **Share the live-spectator infra with Duels and slim the heartbeat/watcher machinery.** Keep the wager (a real sink) and K-factor; stop paying for a parallel spectator stack.

- **Danger/Flow/Idle (11), Net −25** → **Default `idle_action` to "warn" only (never autodrop).** Auto-dropping a thinking player's tile is a churn risk. Keep the activity-gate (kills the camp exploit) and flow multiplier.

- **Lifetime Prestige (32), Net −28** → **Add a per-game "lifetime XP +N" toast on game-over.** Today it's an invisible passive mirror. Add the feedback loop or **CUT it** — an unseen tile is pure clutter.

- **Priority Calmer (80), Net −5** → **Merge its `TILE_PRIORITIES` map into one shared config with Bottom Nav + Home Variants; drop the micro-tutorial balloons.** Three independent hardcoded home-tile maps that drift separately.

---

## 4. ➕ ADD (only 5 — each activates or measures *multiple* built systems)

The bar: **beat the marginal 41st loop.** Every ADD below unlocks value already sitting in the catalog rather than adding a new isolated system.

1. **Real-money IAP (Stripe, stage 17b).** *Highest conviction.* The entire monetization column of this scorecard is **theoretical**: Season Pass Premium ($4.99 is display-only), Starter Pack (M85 — but gems-only, currently a *giveaway* not revenue), Skin Gacha (M85), Daily Deals (M78) all convert to gems, not dollars. One integration turns **four already-shipped M80+ systems** from faucets into revenue. Nothing you could build competes with activating four finished monetization surfaces.

2. **Analytics instrumentation (GA4 ID + per-feature engagement counters on the admin dashboard).** *The meta-fix.* Every KEEP/CUT in this report is a heuristic guess because *there is no live data* — the recurring lament across the scorecard. GA4 is already code-ready (needs the `G-XXXX` env var); add server-side per-feature open/claim counters to the AD.9 economy dashboard. This is the tool that tells you whether the ~22 survivors actually work. It beats a 41st system because it makes every future decision data-driven instead of vibes-driven.

3. **A unified "⚔️ Compete" hub.** Not a new mode — the missing *container*. After the Section-2 cuts, Duels + Live Tournaments + Friends Contests are three scattered survivors of one cluster. One "Compete" entry that routes to all three makes the cluster legible and reclaims home real estate. Beats adding a 5th competitive mode (which is exactly the mistake that produced Rivalries/Ghost/Squad).

4. **A universal gem SINK (paid continue / paid trophy-boost).** The economy is faucet-heavy (Section 2, cluster B) with **one real sink** (Daily Deals) — and that sink only bites players who want cosmetics. A universal sink every player feels (pay gems to continue a great run, or to boost trophy gain on a win) creates spend pressure for the whole base and pre-monetizes the moment Stripe lands. Beats a 41st faucet, which would deepen the exact imbalance the AD.9 dashboard warns about.

5. **Owned domain (`bloom-game.co.il`).** *Cheap external unlock, not code.* AdSense refuses a Railway subdomain (so Self-Promo M55 can't become real ad revenue) and the K-factor share footer is an unproven placeholder URL (so Replay Share + Wrapped conversion is untested). One purchase unblocks **two systems' real value.** Beats a new feature because it's a $10 action that de-risks a whole viral + ad-revenue path.

---

## 5. The focus verdict

**Target end-state: from ~40 player-facing systems to ~22 that measurably drive return + spend** — 19 KEEPs (the anchors: Season Pass, Trophy Road, Duels, Live Tournaments, Daily Spin, Daily Special, Skin Gacha, Daily Deals, Starter Pack, Bottom Nav, FTUE, Pet, Device Sync, Tile Shop, Self-Promo, Referrals, Inbox, Replay Share) plus the slimmed IMPROVE survivors — with the 6 CUTs deleted and the 10 MERGEs folded into a sibling so they stop being independently-maintained code. The organizing principle: **two competitive ladders, one clan mode, one daily-claim ladder, one offers store, one in-game shop, one share renderer, one home layout, one notification channel.** Everything is the *first* copy of its lever, not the third.

**The exact next 5 admin toggles to flip OFF first** — these are the 5 code-CUT candidates that are all admin-gated, all deeply net-negative, and all fully covered by a survivor, so the retention risk is low and observable. Flip each `*_enabled` key to `false` in the `game_config` table, then watch the admin dashboard **DAU / D1 / session-frequency** for 10–14 days (this *is* your A/B, given no formal split-test tooling — kill-switch + KPI-watch). If the line holds flat, delete the code:

| Order | Toggle (game_config key, verify exact name in the config table) | System | Net | Covered by |
|-------|------------------------------------------------------------------|--------|-----|------------|
| 1 | `squad_tournaments_enabled` → false | Squad Tournaments | −54 | Guild Wars (never fired anyway) |
| 2 | `gem_bank_enabled` → false | Gem Bank interest | −53 | Spin + Login (and it *fights* the economy) |
| 3 | `friend_challenges_enabled` → false | Friend Challenges | −53 | 1v1 Duels |
| 4 | `rival_enabled` → false | Rivalries | −48 | 1v1 Duels |
| 5 | `ghost_enabled` → false | Ghost Mode | −42 | 1v1 Duels |

(Lives/Energy is already default-OFF — it's a straight code deletion, not a toggle test.) After these five hold flat, execute the 10 MERGEs (starting with the two cheapest, highest-clutter wins: **Trophy Chests → Trophy Road, Net −64**, and **Tile Album → Achievements, Net −73**), then spend the reclaimed maintenance budget on ADD #1 (Stripe) and ADD #2 (analytics) — the two moves that convert this entire scorecard from a heuristic into a measured, revenue-generating funnel.
