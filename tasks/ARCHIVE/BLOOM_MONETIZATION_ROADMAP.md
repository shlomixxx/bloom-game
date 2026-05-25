# BLOOM — Monetization & Addiction Roadmap (May 2026 →)

This is the post-stage-15 roadmap. Stages 1-15 built the **retention engine**
(streaks, season pass, daily special, friends, tournaments). The next phase
turns retained players into **paying or session-multiplying players**.

> Prime directive: **every stage answers one of two questions** —
> 1. *"What makes the player play one more game right now?"* (addiction)
> 2. *"What makes the player willingly spend a real dollar or earn-and-burn cycle of credits?"* (monetization)
>
> Anything that doesn't move one of those needles waits.

---

## 🔥 Critical gaps in the existing systems (do these first)

These are flaws in stages 1-15 that limit their impact. Fix before adding new layers.

### G1 — Battle Pass has no purchase track (currently 100% free)
Current: 20 tiers, 16K💎/season, all unlocked free as you earn XP.
Missing: **Premium track** that doubles every tier's reward + adds exclusive cosmetic rewards.
**Why this matters**: industry standard. Fortnite/Apex/Genshin all charge $4.99-$9.99/season. The free track gets players hooked; the premium track is what they pay for. Without it, the entire Battle Pass system makes ZERO revenue.
**What to build**:
- New `season_pass_premium_price` config + a new "premium_owned" column on `player_season_progress`
- 2nd reward column per tier: `season_tier_<N>_premium_reward`
- "🔓 שדרג ל-Premium" button at top of Season Pass modal with the price
- Stripe Checkout integration OR diamond-pack purchase (e.g. 1500💎)
- Locked premium rewards visually shown but greyed until purchase
- "🎁 פספסת 5 פרסים premium!" recap when player crosses tiers without owning
**Addiction lever**: loss aversion ("I already played, I should get all the rewards")

### G2 — Battle Pass + XP system is INVISIBLE from home
Current: only accessible via the dynamic-boards picker → 2-click depth from home.
**Problem**: a player who never opens dynamic-boards never sees the Battle Pass exists. The biggest retention system in the app is hidden.
**What to build**:
- Primary tile on home screen showing current tier + progress bar + "🎁 N לקבל" badge
- Pulsing gold border when there are claimable rewards
- Tap → opens Season Pass modal directly (skip picker)

### G3 — Admin has no Season Pass / XP control panel
Current: all 50+ XP/tier keys live in the "כל ההגדרות" auto-config table at the bottom of the page.
**Problem**: admin has to scroll/search through 200+ keys to tune the Battle Pass. Tier curve adjustments require editing 20 separate rows.
**What to build**:
- New dedicated section under 💰 כלכלה tab: "🎖 Battle Pass" with:
  - Master toggle + season name + end date in one card
  - 20-tier visual table with editable XP threshold + free reward + premium reward columns
  - Quick presets: "easy curve", "default", "hardcore"
  - Live preview of total free/premium gem distribution

### G4 — Daily Special needs an admin override panel
Currently `daily_special_override_id` is a free-text key. Admin has to look up the numeric board ID elsewhere.
**Fix**: dropdown next to the boards table showing "🌟 Today's Special: <name>" + "Override:" dropdown of all active boards.

### G5 — No "first time" funnel for any retention system
Players are not introduced to streaks/quests/season pass/friends. They discover them randomly or never.
**Fix**: post-FTUE one-time tour that pops the picker open + briefly highlights each headline pill.

---

## 💰 Stage 16-25 — Monetization layer (ranked by revenue impact × addiction)

### Stage 16 — Achievement-driven cross-leaderboard (already in tracker, retention)
*Pre-existing. Builds the competitive layer needed before paid cosmetics matter.*

### Stage 17 — Premium Battle Pass (G1 above, **highest priority**)
- $4.99 IAP OR 1500💎 conversion price
- 2× every free tier reward + 4 exclusive cosmetic-only tiers (skin variants, profile borders, tile-style frames)
- "Catch up" packs to skip tiers ($1.99 = 3 tiers)
- **Expected lift**: 3-7% of active players buy → $0.15-$0.35 ARPU/month at 1K DAU

### Stage 18 — Skin Gacha (variable-reward Skinner box for cosmetics)
- New currency: "Bloom Tokens" 🌸 (earned from quests, can be bought $4.99=100🌸)
- Pull rates: 70% common skin, 20% uncommon, 8% rare, 1.8% legendary, 0.2% mythic
- **Pity system**: guaranteed legendary at 50 pulls
- Limited-time banner skins (only available for 7-14 days)
- **Why it works**: industry standard for cosmetic monetization. Genshin makes $4B/year from this exact pattern.
- **Anti-cheese**: pull history shown so player feels "I'm building toward something"

### Stage 19 — Energy / Lives system (controversial but addictive)
- 5 daily lives, regen 1/hour
- Out of lives → "wait 1h" / "watch ad +1 life" / "buy 30 lives = $0.99"
- **Important**: only applies to DYNAMIC boards (daily challenge stays free + unlimited practice stays free).
- **Why this is addictive**: scarcity = anticipation. "I want to play but can't" creates a return-visit hook far stronger than streaks alone.
- **Why this monetizes**: $0.99 micro-transactions for impatient power users
- **Risk**: bad UX if implemented wrong. Make it 100% optional / removable via admin toggle. Test for 2 weeks; if D7 retention drops, revert.

### Stage 20 — Starter Pack ($1.99 first-purchase offer)
- Triggers ONCE after the player's first game-over with score >5000
- 7-day countdown timer (loss aversion)
- Bundle: 500💎 + 1 random skin + 1 Battle Pass tier
- **Why it works**: 50-90% conversion rates on starter packs are typical in puzzle games. Lowest-barrier-to-paying purchase.
- One-time only per device. Cannot be re-shown.

### Stage 21 — Daily Deals (1 rotating offer/day at discount)
- Server-side: pick a random offer from the catalog per Asia/Jerusalem day
- Offers: gems, skins, Battle Pass tier skip, life refills
- 50-70% discount vs base prices
- Modal pops once per day at home-screen mount (after the daily login reward)
- **Why it works**: anchoring. Player sees "10💎 instead of 25💎 — saved 60%!" and buys to "not miss out".

### Stage 22 — VIP / Battle Pass + subscription
- $4.99/month auto-renew: includes premium Battle Pass each season + 2 daily ads removed + bonus 50💎/day
- Cancel anytime
- **Why it works**: stable MRR. 1-2% subscriber rate × $5 = $50-100/mo per 1K DAU.

### Stage 23 — Real money cosmetic shop
- Static catalog of "premium skins" only buyable for IAP (not earnable in-game)
- Price tiers: $0.99 / $2.99 / $5.99
- Rotation: 3 featured items + 8 catalog
- **Why it works**: collectors. Whales (top 1% spenders) buy everything.

### Stage 24 — Wager / Trading (existing duels system + monetization)
- Duels already support gem wagers. Add **real-money entry** to special tournaments ($1 entry, prize pool 70% returned)
- ⚠ Legal compliance critical — gambling laws vary by jurisdiction. Israel = OK with disclosure.
- **Why it works**: ARPU lift on competitive players who play 10+ duels/day

### Stage 25 — Limited-time bundle drops (every 2 weeks)
- "🎄 Hanukkah Pack: 200💎 + Menorah skin + 5 Battle Pass tiers = $4.99"
- 7-day countdown
- One-time purchase only
- Pre-set in admin with rich preview UI

---

## 🧠 Stage 26-32 — Deep addiction layers (retention-first)

### Stage 26 — Live ops calendar
Visual calendar showing the next 30 days of events: tournaments, daily specials (per-day), themed weekends, double-XP days. Lets players PLAN around the game.
**Why**: turns "I should play sometime" into "I'm playing Thursday at 8pm because of the tournament".

### Stage 27 — Guilds / Clans
- 10-50 players per clan
- Daily clan goal (e.g. "30 crowns collectively")
- Clan leaderboard
- Clan chat (filtered Hebrew profanity list)
- Weekly clan-vs-clan league
**Why**: peer pressure. Disappointing 30 strangers feels worse than disappointing yourself.

### Stage 28 — Pet / Mascot system
A virtual pet that levels up with you. Feeds on your score. Visible on home screen. Has a name. Sad face if you don't play for a day.
**Why**: emotional attachment. Tamagotchi turned this into a $10B industry. Cute pet = strong daily-return anchor.

### Stage 29 — Achievement collection album (already in backlog as stage 17)
Genshin-style album: collect tier-8 crowns on each board → unlock special border. Visual completionist drive.

### Stage 30 — Player progression meta-game
Not Battle Pass tier — a separate "lifetime level" 1-100 that NEVER resets and persists across seasons. Unlocks new game modes, skins, board types as you progress. Like Modern Warfare's "prestige" system.
**Why**: long-term goal. Battle Pass resets every season; this never does.

### Stage 31 — Notification orchestration
Smart server-side scheduler that picks the right push for the right player:
- "Your streak is at risk!" 22:00 local time
- "Hanukkah board ends in 4h!" 16:00
- "Daniel just beat your score on Hanukkah!" instant
- "Your Battle Pass season ends in 2 days — 5 tiers to claim" 5 days before
**Why**: most apps spray-and-pray. Personalized push = 3-5× higher tap rate.

### Stage 32 — Replay / share system
Auto-record best games (high score, big chain). Share as 10-second GIF/video to WhatsApp/TikTok.
**Why**: viral content. Every shared replay = free user acquisition.

---

## 🎯 Implementation order (recommended)

### Sprint 1 (this week) — Fix the gaps
- G1 + G3: Premium Battle Pass + admin Section
- G2: Battle Pass on home screen
- G4: Daily Special admin override dropdown

### Sprint 2 — Easy money
- Stage 20: Starter Pack ($1.99)
- Stage 21: Daily Deals

### Sprint 3 — Big money
- Stage 17: Premium Battle Pass purchase flow with Stripe
- Stage 18: Skin Gacha

### Sprint 4 — Risk experiments (A/B-flagged)
- Stage 19: Energy system (admin toggleable, 50/50 rollout)
- Stage 22: VIP subscription

### Sprint 5 — Deep retention
- Stage 27: Guilds
- Stage 28: Pet system

---

## 📊 Success metrics

| Stage | Primary metric | Target |
|---|---|---|
| G1-G4 (gap fixes) | Battle Pass open rate per DAU | +60% week-over-week |
| Stage 17 (Premium BP) | Conversion rate of active players | 3-7% within first season |
| Stage 18 (Gacha) | ARPU among gacha-users | $0.30-$1/month |
| Stage 19 (Energy) | D7 retention | No regression — kill if negative |
| Stage 20 (Starter) | First-purchase conversion | 1-3% of DAU within 7 days of install |
| Stage 21 (Daily Deals) | Daily IAP transactions | +30% |
| Stage 22 (VIP) | MRR per 1K DAU | $50-100 |
| Stage 27 (Guilds) | D30 retention | +15-25% |

---

## 🚫 What NOT to do

- **Pay-to-win**: never sell scoring bonuses, never let money buy leaderboard rank. Cosmetic-only and convenience-only purchases.
- **Dark patterns**: no fake countdowns, no fake "scarcity" claims, no opaque pull rates.
- **Over-monetization**: more than 3 paywalls/day = uninstall.
- **Removing free progression**: every Battle Pass / event must have a meaningful free track. Premium adds; doesn't replace.

---

## 🤝 Contract with the user

When this roadmap drives implementation:
1. Every stage gets master admin toggle (admin can disable without redeploy)
2. Every paid feature has a free equivalent path (slower, but real)
3. Every monetization stage starts with A/B test (5% rollout) — full rollout only if metric improves
4. Every change is reversible — no destructive migrations, no schema breaks without parallel old-path
