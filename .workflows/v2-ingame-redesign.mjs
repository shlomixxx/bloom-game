export const meta = {
  name: 'bloom-v2-ingame-redesign',
  description: 'Design team: re-engineer the BLOOM v2 in-game board page - big board + always-visible tier ladder + max addiction, gated v2, classic untouched',
  phases: [
    { title: 'Map' },
    { title: 'Design' },
    { title: 'Judge' },
    { title: 'Critique' },
  ],
}

const REPO = '/Users/shlomishemtov/Documents/Python/bloom-game'

const CONTEXT = [
  'PROJECT: BLOOM - Suika-style 4x6 merge puzzle, RTL Hebrew, vanilla JS IIFE.',
  'Repo: ' + REPO + '. Frontend built by build.sh from src/*.js -> public/app.js and public/css/*.css -> public/styles.css. EDIT SOURCES, never the built files.',
  '',
  'THE TASK (in-game / board page only): the player says the GAME PAGE has a serious UI/UX problem and wants a full team to engineer it. Hard requirements:',
  '1. The BOARD must be BIG (the hero of the screen).',
  '2. The 8-TIER LADDER must be ALWAYS VISIBLE during play (the row of all 8 tile types in merge order) - the players memory aid for the merge sequence. It is currently hidden in v2; that regression must be fixed.',
  '3. The NEXT piece must be clearly visible (planning = skill = addiction).',
  '4. A HOLD/swap slot is a nice-to-have v2 mechanic (can be small or folded in).',
  '5. PRIME DIRECTIVE: maximally addictive - no player should want to start their day without a game. Best-in-class mobile-puzzle UI/UX (Royal Match / Suika / Threes / Two Dots polish), but ON BRAND (BLOOM = warm cream/neutral backgrounds, gold #C9923B accent, mint-green success, rounded tiles ~14px radius, Hebrew RTL).',
  '',
  'HARD ENGINEERING CONSTRAINTS (non-negotiable):',
  '- EVERYTHING gated behind v2On() (src/01-constants.js) and scoped under body.bloom-v2 in CSS. Flag OFF = zero change, pure classic, instant admin revert. Do NOT touch the classic layout.',
  '- Do NOT change the merge ENGINE, the 4x6 grid, or scoring (CLAUDE.md section 10 protected). LAYOUT/HUD/visual only.',
  '- v2 board mechanics live in src/52-v2-board.js (shared IIFE) + public/css/v2-mechanics.css (every rule scoped body.bloom-v2, built LAST). The launch row HTML is #v2-launch in public/index.html (between #tier-bar and #grid-wrap). The tier ladder is #tier-bar, built by buildTierBar/highlightNextTier/revealNextTier in src/12-tour-info.js; rollNextPiece advances the next piece.',
  '',
  'KNOWN MEASUREMENTS (verified live on iPhone 13 Pro, 390x844):',
  '- The board is WIDTH-BOUND at 90px cells (grid 375px wide) WHENEVER the chrome stacked above #grid-wrap leaves >= ~565px for the grid. CLASSIC PROVES THIS: classic shows the tier-ladder (#tier-bar ~65px) AND a 90px board at the same time.',
  '- The v2 board SHRANK (to ~77px cells) ONLY because v2 added the #v2-launch row (~75px) ON TOP OF the tier-bar (~65px) = ~140px chrome -> grid-wrap dropped below 565px -> board became HEIGHT-bound and smaller. (We then hid the tier-bar to compensate, but the player wants the ladder back.)',
  '- IMPLICATION: to keep a BIG (90px) board AND show the ladder, total chrome above the grid must stay <= ~90px. So you CANNOT have BOTH a full tier-bar AND a separate full launch row. The elegant answer is likely ONE unified strip that is the ladder AND carries the next/hold indicators. Other competing chrome: .top (brand hidden in v2 + a compact stats row ~64px: hits/streak/best/score), #mode-extras (dynamic-board chips, often empty), .col-mult-bar (x1 x2 x4 x8, only for boards with column multipliers e.g. daily-special, ~21px), and FLOATING (out of flow): flow pill (AS.1), danger meter (AD.4), above-best pill (AB.1).',
  '',
  'ALREADY-SHIPPED v2 JUICE you must COMPLEMENT (not conflict): full-column fall (v2PlayFall), gravity-settle slide after merges (playV2GravitySlide), landing squash (.v2-landed), flow/combo meter, danger meter, multi-merge MEGA/MASSIVE badges, legendary-chain overlay, clutch-save banner.',
].join('\n')

// ---------------- Phase 1: Map the page (parallel, read-only) ----------------
phase('Map')
const mapTasks = [
  {
    label: 'map:layout-heights',
    prompt: CONTEXT + '\n\nYOUR JOB (read-only): produce a PRECISE vertical-space map of the in-game screen for v2. Read public/index.html (the .app in-game DOM order), public/css/base.css (.app/.top/.stats/.mode-bar/.mode-extras/.tier-bar/.grid-wrap rules + flex sizing), public/css/v2-mechanics.css (current #v2-launch + tier-bar-hide rules), and src/06-contests.js fitGrid(). Return, with file:line excerpts: (a) exact DOM order of in-flow elements inside .app during play, (b) each elements height/box model + which are flex:0 vs flex:1, (c) how fitGrid computes cell size from #grid-wrap and what triggers a re-fit, (d) which elements are position:fixed/absolute (out of flow) vs in-flow, (e) the exact current v2 rules (tier-bar hidden? launch row height?). Be concrete and exhaustive.',
  },
  {
    label: 'map:ladder-and-launch',
    prompt: CONTEXT + '\n\nYOUR JOB (read-only): map the TIER LADDER + NEXT-PIECE + LAUNCH-ROW systems. Read src/12-tour-info.js (buildTierBar, highlightNextTier, revealNextTier, rollNextPiece, how the ladder shows points-per-tier + highlights the next tile) and src/52-v2-board.js (paintV2Launch - the Hold/Current/Next row; v2SwapHold; v2NextUp lookahead; how nextPiece/heldPiece flow). Return: the exact functions, their DOM output, the data they read (getActiveTiers(), nextPiece, v2NextUp, heldPiece), and the integration points (where rollNextPiece + render call the paint hooks). Note what each currently shows so a unified strip can absorb both jobs.',
  },
  {
    label: 'map:brand-and-juice',
    prompt: CONTEXT + '\n\nYOUR JOB (read-only): capture the BLOOM in-game visual language + existing juice so the new design stays on-brand and complements. Read public/css/base.css (.cell/tile styling, colors, the .stats row, tier-bar styling, design tokens in :root), public/css/v2-mechanics.css (v2 accents), and skim the juice modules (grep flow-pill, danger-meter, above-best-pill in src/11-game.js + base.css). Return: exact color tokens/values, tile look (radius, shadow, svg fill %), stats-row styling, fonts, and a list of floating juice elements with positions/z-index so a redesign will not collide with them.',
  },
]
const maps = (await parallel(mapTasks.map(function (t) { return function () { return agent(t.prompt, { label: t.label, phase: 'Map', agentType: 'Explore' }) } }))).filter(Boolean)
const MAP = maps.join('\n\n=====\n\n')
log('Map complete (' + maps.length + ' reports). Fanning out 5 design proposals.')

// ---------------- Phase 2: Design panel (parallel, diverse lenses) — PROSE output ----------------
phase('Design')
const SPEC_FORMAT = '\n\nReturn your design as clearly-labeled PROSE sections (NOT a tool call, NOT JSON). Use exactly these headings:\n## NAME\n## CONCEPT (1-2 sentences)\n## STRIPS (each in-flow band top->bottom: name | approx height px | what it shows | interaction)\n## BOARD SIZE MATH (prove cells stay ~90px width-bound: chrome budget vs 565px)\n## TIER LADDER PLAN (how the always-visible 8-tier ladder works incl next-piece highlight + points)\n## NEXT PIECE PLAN\n## HOLD PLAN\n## ADDICTION HOOKS (concrete dopamine/retention mechanics)\n## ON-BRAND NOTES\n## CSS APPROACH (how it stays gated body.bloom-v2 + classic untouched)\n## RISKS\nBe concrete and implementation-ready. The MAP above is authoritative ground truth - you generally do NOT need to read more files; spend your effort DESIGNING. End your message with the spec.'
const LENSES = [
  { key: 'unified-ladder-launch', brief: 'THE UNIFIED STRIP: collapse the tier-ladder AND the next/hold indicators into ONE compact horizontal strip (~70-85px). The 8-tier ladder is the spine; the CURRENT piece is shown enlarged/glowing in its ladder position (or a dedicated cell at the strip edge); NEXT is marked on the ladder; a small HOLD chip sits at the start/end. One strip does both jobs so the board stays 90px. This is the front-runner - make it excellent.' },
  { key: 'board-hero-minimal', brief: 'BOARD-HERO MINIMALISM: ruthlessly compact ALL chrome. Fuse the stats (score/best/streak) into a single ultra-thin top line, keep a slim single-row tier ladder, next/hold as tiny corner chips. Maximize negative space + board dominance. Refined, premium, calm - let the board breathe and the tiles be the art.' },
  { key: 'threes-suika-ergonomics', brief: 'ERGONOMIC / THUMB-FIRST (Threes + Suika references): optimize for one-handed play. Where does the next-queue belong for a thumb player; consider a horizontal next-queue + ladder rail placement that keeps the eyes near the board and the action near the thumb. Justify spatial choices by reachability + glanceability.' },
  { key: 'juice-ladder', brief: 'THE LADDER AS A DOPAMINE ENGINE: make the always-visible ladder itself the addiction driver - it lights up / pulses the tier you just merged into, fills a highest-tier-reached-this-game progress, teases the next locked tier (crown), and ties into flow/combo. The ladder becomes a progress bar the player wants to climb. Keep board big.' },
  { key: 'compact-hud-fusion', brief: 'HUD FUSION (radical space reclaim): merge the stats row INTO the ladder strip (score/best live on the same band as the ladder, or a single fused HUD bar), eliminating one whole strip so the board gets maximum height AND the ladder is present. Show the height math proving the board grows.' },
]
const designs = (await parallel(LENSES.map(function (L) {
  return function () {
    return agent(
      CONTEXT + '\n\n===== PAGE MAP (ground truth from the recon team) =====\n' + MAP + '\n\n===== YOUR DESIGN LENS: ' + L.key + ' =====\n' + L.brief + '\n\nDesign the COMPLETE in-game/board layout for v2 under this lens. Honor every hard requirement (big board, always-visible 8-tier ladder, clear next piece, addiction-max, on-brand, gated v2 / classic untouched, no engine change). Think like a top mobile-puzzle UI/UX engineer.' + SPEC_FORMAT,
      { label: 'design:' + L.key, phase: 'Design' }
    )
  }
}))).filter(Boolean)
const DESIGNS_TEXT = designs.map(function (d, i) { return '######## DESIGN ' + (i + 1) + ' (' + LENSES[i].key + ') ########\n' + d }).join('\n\n')
log(designs.length + '/5 designs in. Judging + synthesizing the winner.')

// ---------------- Phase 3: Judge + synthesize ONE winner — PROSE output ----------------
phase('Judge')
const winner = await agent(
  CONTEXT + '\n\n===== PAGE MAP =====\n' + MAP + '\n\n===== THE 5 DESIGN PROPOSALS =====\n' + DESIGNS_TEXT + '\n\nYou are the lead design judge + synthesizer. FIRST score all 5 proposals (table) on board-size, ladder-clarity, next-piece-clarity, addiction power, on-brand fit, implementability-without-breaking-classic (1-10 each + total). THEN synthesize ONE winning, implementation-ready design taking the best of each (it will almost certainly center on a single unified ladder+launch strip so the board stays big AND the ladder is always visible).\n\nReturn clearly-labeled PROSE sections (NOT JSON):\n## SCORING TABLE\n## WINNER TITLE\n## RATIONALE (which designs it blends and why)\n## FINAL LAYOUT (every in-flow band top->bottom with height px + contents)\n## BOARD SIZE MATH (prove ~90px cells)\n## TIER LADDER PLAN\n## NEXT PIECE PLAN\n## HOLD PLAN\n## JUICE / ADDICTION PLAN (integrated with the shipped fall/gravity/flow/danger/merge juice)\n## CSS CHANGES (file + exact change, all scoped body.bloom-v2 in public/css/v2-mechanics.css)\n## JS CHANGES (file + function + exact change, gated v2On, in src/52-v2-board.js / src/12-tour-info.js / public/index.html)\n## GATING NOTES (how every change is gated)\n## CLASSIC SAFETY (why flag OFF = byte-identical classic)\n## FIVE-QUESTIONS CHECK (next session? understood <3s? not covering higher signal? one clear close? visible only when relevant?)\nBe specific enough that an engineer implements directly from this.',
  { label: 'judge:synthesize', phase: 'Judge' }
)
log('Winner synthesized. Running adversarial feasibility review.')

// ---------------- Phase 4: Adversarial feasibility / safety critique — PROSE output ----------------
const critique = await agent(
  CONTEXT + '\n\n===== PAGE MAP =====\n' + MAP + '\n\n===== PROPOSED WINNING DESIGN =====\n' + winner + '\n\nYou are an adversarial senior reviewer. Stress-test this design against the real codebase + constraints. Read the actual files at ' + REPO + ' where needed. Verify INDEPENDENTLY:\n(1) does the board truly stay ~90px on 390x844 given the chrome budget - recompute;\n(2) is EVERY change provably gated (v2On / body.bloom-v2) so flag OFF is byte-identical classic - find any leak;\n(3) does it break the shipped v2PlayFall fall / playV2GravitySlide / flow pill / danger meter / col-mult-bar coexistence;\n(4) does it pass the UX 5-questions gate;\n(5) iPhone SE 375x667 + safe-area edge cases.\n\nReturn clearly-labeled PROSE sections (NOT JSON):\n## VERDICT (ship | ship-with-fixes | revise)\n## BLOCKERS\n## FIXES (concrete adjustments)\n## BOARD MATH CHECK (recompute the chrome budget)\n## CLASSIC SAFETY CHECK (gating audit)\n## FIVE-QUESTIONS CHECK\n## FINAL SPEC (the complete implementation-ready spec, with all fixes folded in, that the engineer builds from)',
  { label: 'critic:feasibility', phase: 'Critique' }
)

return {
  winner: winner,
  critique: critique,
  designSummaries: designs.map(function (d, i) { return LENSES[i].key + ': ' + d.slice(0, 200) }),
}
