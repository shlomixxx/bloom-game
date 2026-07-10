# BLOOM — Improvement Plan → "Super Professional"
**Date:** 2026-07-10 · Based on the full deep scan ([PROJECT_MAP.md](PROJECT_MAP.md)) + QA audit ([QA_TASKS.md](QA_TASKS.md)).

## The honest assessment
BLOOM has **world-class feature breadth** (74 tables, 174 routes, ~40 retention systems) and a healthy live server. But "super professional" is **not more features** — the app is already over-featured (the home-overload problem has been fought 6+ times). The gap to professional is in **foundations**: no automated safety net, a 19.7K-line monolith, silent error-swallowing, Railway-only backups, and confirmed correctness bugs that shipped undetected. The plan below trades *breadth* for *reliability, focus, and maintainability* — the three things that separate a hobby project from a professional one.

**Guiding principle:** Fix → Protect → Consolidate → Prune → then Grow.

---

## Sprint 1 — FIX confirmed bugs (1–2 days, highest ROI, zero new surface)
All verified in QA_TASKS.md. These are shipping today and hurting real players/admin.
1. **C1** — unify the two game-over branches into one `finalizeGameOver()` so trophy/pet/guild/starter-pack AND dynamic season-XP/album/quests/tournament/board-score fire on **every** game-over. *This silently loses progression for most players — do it first.*
2. **H1** — wrap the 4 unescaped name sites in `escapeHtml()` (guild-wars ×3, contest ×1). Stored XSS.
3. **H2 + H3** — one-character fix each: admin moderation + economy dashboard are dead (`api('/api/…')` → `api('/…')`). *The exact "admin monitoring works?" gap you asked about.*
4. **H4** — route the ~20 CRUD audit writes through `logAdminAction` (kill the nonexistent-`details`-column INSERTs). Restores the admin audit trail.
5. **H5** — gate opponent scores in `GET /api/duels/mine` (wager-peek exploit).
6. **M1/M2** — `duels/:id/decline` → dedicated client; wrap the 3 silent money-path `.catch(()=>{})` in transactions.
7. **L1/L2/L3** — gacha `-0` flash, friend auto-accept UI state, delete/fix the empty "בונוס" board.

## Sprint 2 — PROTECT (the biggest professional gap: no safety net)
Right now a broken build, a 500, or a dead admin panel reaches players before anyone notices (H2/H3 proved this).
1. **CI on every push (GitHub Actions):** `node --check server.js db.js bot-engine.js` + `build.sh` + `node scripts/test_engine.mjs` + the bot-score/contest tests + a syntax check of the built `app.js`. Blocks a broken deploy. ~2 hours to set up, permanent value.
2. **Post-deploy contract smoke test:** script the curl sweep I ran (health + register + every state GET + key POSTs return `{ok:true}`) and run it automatically after each `railway up`. Would have caught H2/H3, the lives-path, any 500. ~half a day.
3. **Staging environment:** a second Railway service + Postgres so changes are verified off-prod (you currently deploy straight to the shared playtester prod). 
4. **Off-Railway DB backup:** weekly `pg_dump` → S3/Google Drive cron. The 2026-05-13 volume-reset wiped data; Railway-only snapshots are a single point of failure (documented in CLAUDE.md §13).
5. **Error observability:** you have `ERROR_WEBHOOK` + the issues auto-logger — add a lightweight Sentry (free tier) or a daily "error-rate + top 500s" digest to the admin dashboard so silent failures surface.

## Sprint 3 — CONSOLIDATE / REFACTOR (maintainability)
1. **Split `server.js` (19.7K lines)** into `routes/<domain>.js` modules (scores, duels, economy, social, admin, …). It's the single biggest maintainability risk — hard to navigate, risky to edit, and the reason bugs like H4 hid. No behavior change; pure structure.
2. **Standardize admin response shapes** — the camelCase-vs-snake_case split (§3.4 in PROJECT_MAP) is a bug factory. Pick one (camelCase) and adapt.
3. **Config-key audit** — `/api/config` returns ~393 keys. Grep each against actual reads; retire dead keys. Document the live set.
4. **Delete dead code** — `src/05b-home-v3.js` (~538 L orphan), duplicate `escapeHtml`, stray root screenshots. Repo hygiene.
5. **Extend the admin debug scanner** to probe *all* admin endpoints (incl. POSTs) + lint for the double-`/api/` pattern, so a dead panel can't hide again.

## Sprint 4 — PRUNE (the counter-intuitive professional move: remove, don't add)
You have **~10 overlapping competitive loops** (Trophy Road, Leagues, Rivalries, Guild Wars, Squad Tournaments, Tournaments, Contests, Duels, Challenges, Ghost) and **~7 daily-return hooks** (Spin, Login-Cal, Daily-Deal, Daily-Special, Checklist, Pet, Chests). A solo dev can't maintain 40 systems well, and players can't absorb them — that's why the home keeps overloading.
- **Use the analytics you already have.** The admin dashboard has DAU/retention/engagement. Rank every feature by *actual* contribution to D1/D7/D30 and to gem-sink. **Retire or merge the bottom quartile** — the systems that add maintenance cost + UI clutter but don't move retention. Fewer, sharper loops beat many dull ones.
- **Decide Lives/Energy** (default-off, controversial) — keep and A/B it properly, or cut it.
- Goal: go from "40 systems, home overloaded" to "the ~15 that measurably drive return + monetization." *This is admin-toggleable, so nothing is destroyed — it's turned off and measured.*

## Sprint 5 — GROW (only after 1–4)
- If revenue is a goal: real IAP (Stripe) — currently gems-only (your roadmap 17b). This is the one place "add" is the professional move, because it converts the retention you already built into a business.
- Bundle size: `app.js` is a 38K-line / 1.9MB single file. Within the no-build constraint you can't code-split, but you can lazy-load the heaviest feature modules behind their first open.
- Accessibility + performance pass (Lighthouse) once the foundation is solid.

---

## Recommended order & why
| # | Sprint | Effort | Why now |
|---|---|---|---|
| 1 | Fix confirmed bugs | 1–2 d | Live player/admin harm; trivial fixes |
| 2 | CI + smoke test + backups | 2–3 d | Stops the *next* silent bug reaching prod |
| 3 | Split server.js + cleanup | 3–5 d | Makes everything after cheaper & safer |
| 4 | Data-driven prune | ongoing | Focus = the real professional upgrade |
| 5 | IAP / perf | later | Monetize the retention once stable |

**One-line verdict:** the product is feature-complete to a fault. The professional upgrade is *reliability + focus*, not more systems. Start with Sprint 1 (I can execute it immediately), then the CI/backup safety net.
